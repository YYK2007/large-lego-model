import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import type { ReferenceComplexity, ReferenceModelEvidence, ReferenceTextSource, ReferenceViewHint } from '../shared/references.js';
import { parseReferenceStl, renderReferenceStl } from './reference-model.js';

export type ReferenceSubject = { name: string; location?: string; aliases?: string[] };
export type ReferenceCandidate = {
  fileTitle: string; sourcePageUrl: string; imageUrl: string; description: string;
  articleTitle?: string; articleUrl?: string; articleExtract?: string;
  matchedBy: 'article-image' | 'article-gallery' | 'commons-search'; query: string;
  viewHints?: ReferenceViewHint[]; identityEvidence?: 'article-linked' | 'metadata-match' | 'search-only';
  artist: string; credit: string; licenseName: string; licenseUrl: string;
  attributionRequired: boolean; width: number; height: number;
  mediaType?: 'photo' | 'model-render'; viewLabel?: string;
};
export type ReferenceMetadata = ReferenceCandidate & { fetchedAt: string; sha256: string };
export type ReferenceImage = { metadata: ReferenceMetadata; inlineData: { mimeType: 'image/jpeg'; data: string } };
type Options = { signal?: AbortSignal; complexity?: ReferenceComplexity };
type WikiPage = {
  title?: string; pageimage?: string; fullurl?: string; extract?: string; index?: number;
  lastrevid?: number; missing?: boolean; pageprops?: { disambiguation?: string; wikibase_item?: string };
  images?: { title?: string }[]; extlinks?: { url?: string }[]; fetchedAt?: string;
  imageinfo?: { url?: string; thumburl?: string; descriptionurl?: string; mime?: string; size?: number;
    width?: number; height?: number; thumbwidth?: number; thumbheight?: number;
    extmetadata?: Record<string, { value?: string }> }[];
};
const apiHosts = new Set(['en.wikipedia.org', 'commons.wikimedia.org', 'www.wikidata.org']);
const imageHosts = new Set(['upload.wikimedia.org', 'thumb.wikimedia.org']);
const userAgent = 'LargeLegoModel/0.1 (reference-image research; local HackNC prototype)';
const maxImageBytes = 5_000_000;
const maxCandidates = 48;
const cacheTtlMs = 15 * 60_000;
function cache<T>(maxEntries: number, maxBytes: number) {
  const entries = new Map<string, { value: T; expiresAt: number; size: number }>();
  let bytes = 0;
  const remove = (key: string) => { const entry = entries.get(key); if (entry) bytes -= entry.size; entries.delete(key); };
  return {
    get(key: string): T | undefined {
      const entry = entries.get(key);
      if (!entry) return;
      if (entry.expiresAt <= Date.now()) { remove(key); return; }
      entries.delete(key); entries.set(key, entry);
      return entry.value;
    },
    put(key: string, value: T, size: number) {
      remove(key);
      if (size > maxBytes) return;
      while (entries.size >= maxEntries || bytes + size > maxBytes) remove(entries.keys().next().value!);
      entries.set(key, { value, size, expiresAt: Date.now() + cacheTtlMs }); bytes += size;
    },
    clear() { entries.clear(); bytes = 0; },
  };
}
const metadataCache = cache<WikiPage[]>(32, 8 * 1024 * 1024);
export type WikidataEntity = { id?: string; lastrevid?: number; labels?: Record<string, { value?: string }>; claims?: Record<string, {
  id?: string; rank?: string; mainsnak?: { snaktype?: string; datavalue?: { value?: unknown } };
  qualifiers?: Record<string, { datavalue?: { value?: unknown } }[]>;
  references?: { snaks?: Record<string, { datavalue?: { value?: unknown } }[]> }[];
}[]> };
const entityCache = cache<{ entities: Record<string, WikidataEntity>; fetchedAt: string }>(16, 8 * 1024 * 1024);
type Pixels = { inlineData: ReferenceImage['inlineData']; width: number; height: number; fetchedAt: string; sha256: string; signature: Float64Array | undefined };
const pixelCache = cache<Pixels>(24, 24 * 1024 * 1024);
let networkQueue: Promise<unknown> = Promise.resolve();
let nextRequestAt = 0;
const cooldowns = new Map<string, number>();

/** Test isolation only; never used to bypass an upstream cooldown in production. */
export function resetReferenceStateForTests() {
  metadataCache.clear(); entityCache.clear(); pixelCache.clear(); cooldowns.clear(); networkQueue = Promise.resolve(); nextRequestAt = 0;
}

function cancellable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    pending.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}

// Wikimedia asks clients to serialize requests and cache reusable results:
// https://www.mediawiki.org/wiki/API:Etiquette
function scheduled<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  const task = networkQueue.then(async () => {
    signal.throwIfAborted();
    const wait = nextRequestAt - Date.now();
    if (wait > 0) await delay(wait, undefined, { signal });
    try { return await operation(); }
    finally { nextRequestAt = Date.now() + 100; }
  });
  networkQueue = task.catch(() => {});
  return cancellable(task, signal);
}

// All remote text is source material, never HTML for insertion or model instructions.
function plain(value: unknown, max = 2000): string {
  if (typeof value !== 'string') return '';
  return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, ' ').replace(/&(?:amp|lt|gt|quot|apos|nbsp);|&#(?:x[0-9a-f]+|\d+);/gi, entity => {
      const known: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' };
      if (known[entity.toLowerCase()]) return known[entity.toLowerCase()];
      const code = entity[2].toLowerCase() === 'x' ? parseInt(entity.slice(3, -1), 16) : parseInt(entity.slice(2, -1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }).replace(/[<>\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function allowedUrl(value: string, kind: 'api' | 'image' | 'model'): URL {
  const url = new URL(value);
  const hosts = kind === 'api' ? apiHosts : imageHosts;
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !hosts.has(url.hostname)
    || (kind === 'api' && url.pathname !== '/w/api.php')) throw new Error('Reference URL is outside the allowed Wikimedia endpoints.');
  return url;
}

function publicLink(value: unknown, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : fallback;
  } catch { return fallback; }
}

async function boundedFetch(value: string, kind: 'api' | 'image' | 'model', signal: AbortSignal): Promise<{ bytes: Buffer; contentType: string }> {
  allowedUrl(value, kind);
  return scheduled(signal, () => fetchBytes(value, kind, signal));
}

async function fetchBytes(value: string, kind: 'api' | 'image' | 'model', signal: AbortSignal): Promise<{ bytes: Buffer; contentType: string }> {
  let url = allowedUrl(value, kind);
  const limit = kind === 'api' ? 1_000_000 : maxImageBytes;
  let redirects = 0, retries = 0;
  while (redirects <= 2) {
    signal.throwIfAborted();
    const remainingCooldown = (cooldowns.get(url.hostname) || 0) - Date.now();
    if (remainingCooldown > 0) throw new Error(`Wikimedia reference requests are rate limited (429). Retry after ${Math.ceil(remainingCooldown / 1000)} seconds, or attach a reference photo.`);
    const response = await fetch(url, { redirect: 'manual', signal, headers: { 'User-Agent': userAgent, Accept: kind === 'api' ? 'application/json' : kind === 'model' ? 'application/sla,model/stl,application/octet-stream' : 'image/jpeg,image/png,image/webp' } });
    if (response.status === 429) {
      await response.body?.cancel();
      const header = response.headers.get('retry-after');
      const seconds = header !== null && /^\d+(?:\.\d+)?$/.test(header.trim()) ? Number(header) : NaN;
      const parsed = Number.isFinite(seconds) ? seconds * 1000 : header ? Date.parse(header) - Date.now() : NaN;
      const retryMs = Number.isFinite(parsed) ? Math.max(0, parsed) : 5_000;
      cooldowns.set(url.hostname, Date.now() + (retries ? Math.max(5_000, retryMs) : retryMs));
      if (retries++ === 0 && retryMs <= 2_000) { await delay(Math.max(100, retryMs), undefined, { signal }); continue; }
      throw new Error(`Wikimedia reference requests are rate limited (429). Retry after ${Math.ceil(retryMs / 1000)} seconds, or attach a reference photo.`);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location || redirects === 2) throw new Error('Reference redirect limit reached.');
      url = allowedUrl(new URL(location, url).href, kind);
      redirects++;
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Wikimedia reference request failed (${response.status}).`); }
    if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new Error('Reference response exceeds its byte limit.'); }
    if (!response.body) throw new Error('Wikimedia returned an empty reference response.');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        signal.throwIfAborted();
        const { done, value: chunk } = await reader.read();
        if (done) break;
        length += chunk.byteLength;
        if (length > limit) throw new Error('Reference response exceeds its byte limit.');
        chunks.push(chunk);
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
    return { bytes: Buffer.concat(chunks), contentType: response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || '' };
  }
  throw new Error('Reference redirect limit reached.');
}

async function query(host: string, params: Record<string, string>, signal: AbortSignal): Promise<WikiPage[]> {
  const url = new URL(`https://${host}/w/api.php`);
  url.search = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', ...params }).toString();
  signal.throwIfAborted();
  const cached = metadataCache.get(url.href);
  if (cached) return structuredClone(cached);
  const { bytes } = await boundedFetch(url.href, 'api', signal);
  const result = JSON.parse(bytes.toString('utf8')) as { error?: { code?: string }; query?: { pages?: WikiPage[] } };
  if (result.error) throw new Error(`Wikimedia query failed (${plain(result.error.code, 80)}).`);
  const fetchedAt = new Date().toISOString();
  const pages = (Array.isArray(result.query?.pages) ? result.query.pages : []).map(page => ({ ...page, fetchedAt })).sort((a, b) => (a.index ?? Infinity) - (b.index ?? Infinity));
  if (pages.length) metadataCache.put(url.href, structuredClone(pages), bytes.length);
  return pages;
}

const imageInfoParams = { prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: '1280', iiextmetadatalanguage: 'en',
  iiextmetadatafilter: 'ImageDescription|Artist|Credit|LicenseShortName|LicenseUrl|AttributionRequired|UsageTerms' };

function candidate(page: WikiPage, search: string, article?: WikiPage): ReferenceCandidate | undefined {
  const info = page.imageinfo?.[0];
  if (!info || !/^File:/i.test(page.title || '') || !['image/jpeg', 'image/png', 'image/webp'].includes(info.mime || '')) return;
  const imageUrl = info.thumburl || info.url;
  if (!imageUrl) return;
  try { allowedUrl(imageUrl, 'image'); } catch { return; }
  const text = (key: string) => plain(info.extmetadata?.[key]?.value);
  const licenseName = text('LicenseShortName') || text('UsageTerms');
  if (!licenseName) return; // Attribution and license evidence must accompany every returned photo.
  const fileTitle = plain(page.title, 500);
  return {
    fileTitle, sourcePageUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(fileTitle.replaceAll(' ', '_'))}`,
    imageUrl, description: text('ImageDescription'), matchedBy: article ? `File:${article.pageimage}`.replaceAll('_', ' ') === page.title?.replaceAll('_', ' ') ? 'article-image' : 'article-gallery' : 'commons-search', query: search,
    ...(article ? { articleTitle: plain(article.title, 300), articleUrl: publicLink(article.fullurl), articleExtract: plain(article.extract, 2500) } : {}),
    artist: text('Artist'), credit: text('Credit'), licenseName, licenseUrl: publicLink(info.extmetadata?.LicenseUrl?.value),
    attributionRequired: text('AttributionRequired').toLowerCase() !== 'false',
    width: info.thumbwidth ?? info.width ?? 0, height: info.thumbheight ?? info.height ?? 0,
  };
}

export type ReferenceArticle = { source: ReferenceTextSource; entityId?: string; links: string[] };
function articleEvidence(page: WikiPage): ReferenceArticle | undefined {
  const title = plain(page.title, 300), excerpt = plain(page.extract, 6000);
  if (!title || !excerpt || page.missing || page.pageprops?.disambiguation !== undefined) return;
  const revisionId = Number.isSafeInteger(page.lastrevid) && page.lastrevid! > 0 ? page.lastrevid : undefined;
  const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replaceAll(' ', '_'))}` + (revisionId ? `?oldid=${revisionId}` : '');
  const entityId = page.pageprops?.wikibase_item;
  return { source: { id: `wikipedia:${title}`, title, url, publisher: 'Wikipedia', excerpt, fetchedAt: page.fetchedAt!,
    sha256: createHash('sha256').update(excerpt).digest('hex'), ...(revisionId ? { revisionId } : {}),
    licenseName: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' },
    ...(/^Q[1-9]\d*$/.test(entityId || '') ? { entityId } : {}),
    links: [...new Set((page.extlinks || []).map(link => publicLink(link.url)).filter(Boolean))].slice(0, 12),
  };
}

/** One exact article, including source text beyond the lead. No external link is fetched. */
export async function loadArticleEvidence(title: string, options: Options = {}): Promise<ReferenceArticle | undefined> {
  if (typeof title !== 'string' || !title.trim() || title.length > 300 || title.includes('|')) throw new Error('Provide one exact article title.');
  const signal = AbortSignal.any([AbortSignal.timeout(10_000), ...(options.signal ? [options.signal] : [])]);
  const pages = await query('en.wikipedia.org', { titles: title, redirects: '1', prop: 'extracts|info|pageprops|extlinks', explaintext: '1', exlimit: '1', exsectionformat: 'plain', inprop: 'url', ellimit: '12' }, signal);
  return pages.map(articleEvidence).find(Boolean);
}

/** Only validated Wikidata entity IDs can reach this allowlisted API. */
export async function loadWikidataEntities(ids: string[], options: Options = {}) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 20 || ids.some(id => typeof id !== 'string' || !/^Q[1-9]\d*$/.test(id))) throw new Error('Provide 1–20 Wikidata entity IDs.');
  const signal = AbortSignal.any([AbortSignal.timeout(10_000), ...(options.signal ? [options.signal] : [])]);
  const url = new URL('https://www.wikidata.org/w/api.php');
  url.search = new URLSearchParams({ action: 'wbgetentities', format: 'json', ids: [...new Set(ids)].sort().join('|'), props: 'labels|claims|info', languages: 'en' }).toString();
  signal.throwIfAborted();
  const cached = entityCache.get(url.href);
  if (cached) return structuredClone(cached);
  const { bytes } = await boundedFetch(url.href, 'api', signal);
  const json = JSON.parse(bytes.toString('utf8')) as { entities?: Record<string, WikidataEntity>; error?: { code?: string } };
  if (json.error || !json.entities || typeof json.entities !== 'object' || Array.isArray(json.entities)) throw new Error('Wikidata reference details could not be read.');
  const entities = Object.fromEntries(Object.entries(json.entities).filter(([id, value]) => ids.includes(id) && value && typeof value === 'object' && !Array.isArray(value)));
  const result = { entities, fetchedAt: new Date().toISOString() };
  if (Object.keys(entities).length) entityCache.put(url.href, structuredClone(result), bytes.length);
  return result;
}

function viewHints(item: ReferenceCandidate): ReferenceViewHint[] {
  const text = `${item.fileTitle} ${item.description}`.toLowerCase();
  const patterns: [ReferenceViewHint, RegExp][] = [
    ['front', /\bfront(?:al)?\b/], ['rear', /\brear\b|\bback (?:side|view)\b/], ['side', /\bside (?:view|profile)\b|\blateral\b|\bin profile\b/],
    ...(['north', 'south', 'east', 'west'] as const).map(direction => [direction, new RegExp(`\\b${direction}(?:ern)?[ -](?:side|face|facade|elevation|view)\\b|\\b(?:from|facing|toward|towards) (?:the )?${direction}\\b`)] as [ReferenceViewHint, RegExp]),
    ['above', /\baerial\b|\bfrom above\b|\btop view\b/], ['interior', /\binterior\b|\binside\b/], ['detail', /\bdetail\b|\bclose[ -]?up\b/],
  ];
  return patterns.filter(([, pattern]) => pattern.test(text)).map(([hint]) => hint);
}

// Derivative credits often name an original file even when an edit was renamed.
// These keys only select references; they never replace the selected file's credit.
function photoFamily(item: ReferenceCandidate): Set<string> {
  const normalize = (title: string) => title.normalize('NFKC').toLowerCase().replace(/^file:/, '').replace(/\.(?:jpe?g|png|webp)$/i, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\b(?:edit(?:ed)?|crop(?:ped)?|retouched|restored|resized|enhanced)\s*\d*\b/g, '')
    .replace(/\s+/g, ' ').trim();
  const originals = [...item.credit.matchAll(/(?:File:)?([^;:<>\n]*?\.(?:jpe?g|png|webp))\b/gi)]
    .map(match => match[1].replace(/^(?:edited version of|derivative work of|based on|source)\s*/i, ''));
  return new Set([item.fileTitle, ...originals].map(normalize).filter(Boolean));
}

function sameFamily(a: Set<string>, b: Set<string>) { return [...a].some(key => b.has(key)); }

// Preserve the best identity evidence, then offer other photo families before edits.
function diverseOrder(items: ReferenceCandidate[]): ReferenceCandidate[] {
  const primary: ReferenceCandidate[] = [], edits: ReferenceCandidate[] = [], families: Set<string>[] = [];
  for (const item of items) {
    const family = photoFamily(item), known = families.filter(existing => sameFamily(existing, family));
    if (known.length) { edits.push(item); for (const existing of known) for (const key of family) existing.add(key); }
    else { primary.push(item); families.push(family); }
  }
  if (!primary.some(item => item.viewHints?.length)) return [...primary, ...edits];
  const ordered = [primary.shift()!], covered = new Set(ordered[0].viewHints || []);
  while (primary.length) {
    let best = 0, bestScore = -Infinity;
    primary.forEach((item, index) => {
      const score = (item.viewHints || []).filter(hint => hint !== 'detail' && hint !== 'interior' && !covered.has(hint)).length * 4 - index / Math.max(1, primary.length);
      if (score > bestScore) { best = index; bestScore = score; }
    });
    const [next] = primary.splice(best, 1);
    ordered.push(next); for (const hint of next.viewHints || []) covered.add(hint);
  }
  return [...ordered, ...edits];
}

// Strict same-view check: normalized luminance tolerates re-encoding/brightness
// edits, but does not claim a different camera angle or verify subject identity.
async function signature(data: Buffer): Promise<Float64Array | undefined> {
  const pixels = await sharp(data).resize(32, 32, { fit: 'fill' }).greyscale().raw().toBuffer();
  const mean = pixels.reduce((sum, value) => sum + value, 0) / pixels.length;
  const scale = Math.sqrt(pixels.reduce((sum, value) => sum + (value - mean) ** 2, 0) / pixels.length);
  if (scale < 8) return; // Featureless photos cannot supply a reliable comparison.
  return Float64Array.from(pixels, value => (value - mean) / scale);
}

function nearDuplicate(a: Float64Array | undefined, b: Float64Array | undefined): boolean {
  if (!a || !b) return false;
  let squared = 0;
  for (let i = 0; i < a.length; i++) squared += (a[i] - b[i]) ** 2;
  return squared / a.length < 0.012; // Correlation > .994: retain merely similar views.
}

/** Search results are candidates, not proof of identity. Verify metadata AND fetched pixels against the intended subject. */
export async function discoverReferences(subject: ReferenceSubject, options: Options = {}): Promise<{ subject: string; candidates: ReferenceCandidate[]; articles: ReferenceArticle[]; warnings: string[] }> {
  if (!subject || typeof subject.name !== 'string' || !subject.name.trim() || subject.name.length > 200
    || (subject.location !== undefined && (typeof subject.location !== 'string' || subject.location.length > 200))
    || (subject.aliases !== undefined && (!Array.isArray(subject.aliases) || subject.aliases.length > 3 || subject.aliases.some(alias => typeof alias !== 'string' || alias.length > 200)))) throw new Error('Provide a concise reference subject and location.');
  const signal = AbortSignal.any([AbortSignal.timeout(15_000), ...(options.signal ? [options.signal] : [])]);
  const name = plain(subject.name, 200), location = plain(subject.location, 200);
  if (!/[\p{L}\p{N}]/u.test(name)) throw new Error('Provide a concise reference subject and location.');
  // Quote entity words rather than requiring a full caption phrase, which misses useful alternate views.
  const quote = (text: string) => `"${text.replace(/["\\]/g, ' ')}"`;
  const names = [...new Set([name, ...(subject.aliases || []).map(alias => plain(alias, 200)).filter(alias => /[\p{L}\p{N}]/u.test(alias))])];
  const wordsQuery = (value: string) => value.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean).map(quote).join(' ');
  const search = wordsQuery(`${name} ${location}`);
  // https://www.mediawiki.org/wiki/Help:CirrusSearch documents OR and grouping.
  // Canonical/alias search need not repeat every geographic word in a caption.
  const alternateSearch = names.length > 1 ? names.map(value => `(${wordsQuery(value)})`).join(' OR ') : wordsQuery(name);
  const searches = [...new Set([search, alternateSearch])];
  const enriched = options.complexity === 'complex' || options.complexity === 'intricate';
  // Broad search already supplies hero/front views. Spend the two supplemental
  // queries on other sides, without treating a query match as a verified angle.
  // Keep these searches simple: live CirrusSearch grouped OR queries returned
  // no raster hits, while the same canonical subject plus one view term did.
  const angleSearches = [`${wordsQuery(name)} rear filetype:bitmap`, `${wordsQuery(name)} "side view" filetype:bitmap`];
  searches.push(...angleSearches);
  const warnings: string[] = [];
  const results = await Promise.allSettled([
    query('en.wikipedia.org', { titles: names.join('|'), redirects: '1', prop: `pageimages|extracts|info|pageprops${enriched ? '|images' : ''}`, piprop: 'name', pilicense: 'free', exintro: '1', explaintext: '1', inprop: 'url', ...(enriched ? { imlimit: '24' } : {}) }, signal),
    ...searches.map(gsrsearch => query('commons.wikimedia.org', { generator: 'search', gsrsearch, gsrnamespace: '6', gsrlimit: enriched ? '24' : '12', ...imageInfoParams }, signal)),
  ]);
  signal.throwIfAborted();
  const articles = results[0].status === 'fulfilled' ? results[0].value.filter(page => !page.missing && page.pageprops?.disambiguation === undefined) : [];
  const articleFiles = (article: WikiPage) => [article.pageimage ? `File:${article.pageimage}` : '', ...(enriched ? (article.images || []).map(image => image.title || '') : [])].filter(title => /^File:/i.test(title));
  const titles = [...new Set(articles.flatMap(articleFiles))].slice(0, 24);
  let articleImages: WikiPage[] = [];
  if (titles.length) {
    try { articleImages = await query('commons.wikimedia.org', { titles: titles.join('|'), ...imageInfoParams }, signal); }
    catch (error) { signal.throwIfAborted(); warnings.push(error instanceof Error ? error.message : 'Article image lookup failed.'); }
  }
  for (const result of results) if (result.status === 'rejected') warnings.push(result.reason instanceof Error ? result.reason.message : 'Reference search failed.');
  const candidates: ReferenceCandidate[] = [];
  const targetedFiles = new Set<string>();
  const pages = [...articleImages.map(page => ({ page, query: search })), ...results.slice(1).flatMap((result, index) =>
    result.status === 'fulfilled' ? result.value.map(page => ({ page, query: searches[index] })) : [])];
  for (const { page, query: matchedQuery } of pages) {
    const article = articles.find(item => articleFiles(item).some(title => title.replaceAll('_', ' ') === page.title?.replaceAll('_', ' ')));
    const item = candidate(page, matchedQuery, article);
    if (item && angleSearches.includes(matchedQuery)) targetedFiles.add(item.fileTitle);
    if (item && !candidates.some(existing => existing.fileTitle === item.fileTitle)) candidates.push(item);
  }
  // Prefer files actually named for the subject over campus panoramas whose captions merely mention it.
  // This orders candidates only; neither a filename nor an article association verifies the pixels.
  const words = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const subjectWords = [...new Set(words(name))];
  const matchesName = (item: ReferenceCandidate) => names.some(name => {
    const tokens = words(name), metadata = words(`${item.fileTitle} ${item.description}`);
    return tokens.length > 0 && tokens.every(token => metadata.includes(token));
  });
  for (let index = candidates.length - 1; index >= 0; index--) {
    const item = candidates[index];
    if (!enriched && !angleSearches.includes(item.query)) continue;
    const incidentalGraphic = item.fileTitle.match(/\b(?:coat of arms|locator map|logo|signature|flag)\b/i)?.[0];
    // Article galleries also contain maps, neighboring sites and navigation images.
    if (incidentalGraphic && !names.some(name => name.toLowerCase().includes(incidentalGraphic.toLowerCase())) || item.matchedBy !== 'article-image' && !matchesName(item)) candidates.splice(index, 1);
  }
  for (const item of candidates) {
    item.identityEvidence = item.matchedBy !== 'commons-search' ? 'article-linked' : matchesName(item) ? 'metadata-match' : 'search-only';
    item.viewHints = viewHints(item);
  }
  const relevance = (item: ReferenceCandidate) => {
    const titleWords = words(item.fileTitle), title = titleWords.join(' ');
    return (item.matchedBy === 'article-image' ? 10 : item.matchedBy === 'article-gallery' ? 3 : 0)
      + (title.includes(subjectWords.join(' ')) ? 2 : 0)
      + subjectWords.filter(word => titleWords.includes(word)).length / subjectWords.length;
  };
  candidates.sort((a, b) => relevance(b) - relevance(a));
  // Keep the strongest identity anchor, then retain targeted hits ahead of
  // redundant broad results before the bounded candidate list is truncated.
  const anchor = candidates[0];
  candidates.sort((a, b) => Number(b === anchor) - Number(a === anchor)
    || (relevance(b) + (targetedFiles.has(b.fileTitle) ? 4 : 0)) - (relevance(a) + (targetedFiles.has(a.fileTitle) ? 4 : 0)));
  const ordered = diverseOrder(candidates).slice(0, enriched ? maxCandidates : 12);
  if (ordered.length && ordered.every(item => sameFamily(photoFamily(ordered[0]), photoFamily(item)))) warnings.push('Only one distinct reference photo family was found. Hidden sides and depth remain uncertain.');
  return { subject: [name, location].filter(Boolean).join(', '), candidates: ordered, articles: articles.map(articleEvidence).filter((article): article is ReferenceArticle => Boolean(article)), warnings };
}

/** Metadata suggests coverage; it cannot establish the camera poses in pixels. */
export function referenceViewWarnings(images: readonly ReferenceImage[]): string[] {
  const photos = images.filter(image => image.metadata.mediaType !== 'model-render');
  if (!photos.length) return [];
  if (photos.length === 1) return ['Only one usable reference photograph was confirmed. Other sides and depth remain unverified.'];
  const hints = new Set(photos.flatMap(image => image.metadata.viewHints || []).filter(hint => hint !== 'detail' && hint !== 'interior'));
  if (hints.size < 2) return ['Multiple photographs were retrieved, but distinct camera angles could not be established from their metadata. Hidden sides and depth remain unverified.'];
  return [`Reference metadata suggests ${[...hints].join(', ')} views. Verify these angles in the actual photos; labels do not prove independent viewpoints, and unseen sides remain uncertain.`];
}

/** Pixels are transient: persist metadata only; send inlineData directly to the multimodal planner. */
export async function loadReferenceImages(candidates: ReferenceCandidate[], options: Options & { maxImages?: number } = {}): Promise<ReferenceImage[]> {
  const maxImages = options.maxImages ?? 2;
  if (!Number.isInteger(maxImages) || maxImages < 1 || maxImages > 12) throw new Error('Load one to twelve reference images.');
  const signal = AbortSignal.any([AbortSignal.timeout(15_000), ...(options.signal ? [options.signal] : [])]);
  const images: ReferenceImage[] = [];
  const selected: { family: Set<string>; signature: Float64Array | undefined }[] = [];
  let decodedBytes = 0, attempted = 0;
  let firstFailure: unknown;
  const remaining = diverseOrder(candidates.slice(0, maxCandidates));
  while (remaining.length) {
    // A failed download or duplicate photo does not cover an angle. Re-rank
    // against accepted pixels so another candidate can still supply that view.
    const covered = new Set(images.flatMap(image => image.metadata.viewHints || []));
    let next = 0, bestScore = -Infinity;
    if (images.length) remaining.forEach((item, index) => {
      const score = (item.viewHints || []).filter(hint => hint !== 'detail' && hint !== 'interior' && !covered.has(hint)).length * 4 - index / remaining.length;
      if (score > bestScore) { next = index; bestScore = score; }
    });
    const [item] = remaining.splice(next, 1);
    options.signal?.throwIfAborted();
    if (signal.aborted && images.length) break;
    signal.throwIfAborted();
    const family = photoFamily(item);
    const related = selected.filter(previous => sameFamily(previous.family, family));
    if (related.length) { for (const previous of related) for (const key of family) previous.family.add(key); continue; }
    if (images.some(previous => previous.metadata.imageUrl === item.imageUrl)) continue;
    if (attempted++ >= 24) break;
    try {
      allowedUrl(item.imageUrl, 'image');
      let decoded = pixelCache.get(item.imageUrl);
      if (!decoded) {
        const { bytes, contentType } = await boundedFetch(item.imageUrl, 'image', signal);
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) throw new Error('Reference response is not a supported raster image.');
        const input = sharp(bytes, { limitInputPixels: 24_000_000, animated: false });
        const info = await input.metadata();
        if (!['jpeg', 'png', 'webp'].includes(info.format || '') || (info.pages ?? 1) > 1) throw new Error('Reference must be a single raster photograph.');
        signal.throwIfAborted();
        const { data, info: output } = await input.rotate().resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer({ resolveWithObject: true });
        decoded = { inlineData: { mimeType: 'image/jpeg', data: data.toString('base64') }, width: output.width, height: output.height,
          fetchedAt: new Date().toISOString(), sha256: createHash('sha256').update(data).digest('hex'), signature: await signature(data) };
        signal.throwIfAborted();
        pixelCache.put(item.imageUrl, decoded, decoded.inlineData.data.length * 2 + (decoded.signature?.byteLength || 0) + 200);
      }
      signal.throwIfAborted();
      if (images.some(previous => previous.metadata.sha256 === decoded.sha256) || selected.some(previous => nearDuplicate(previous.signature, decoded.signature))) continue;
      const bytes = Buffer.byteLength(decoded.inlineData.data, 'base64');
      if (decodedBytes + bytes > 8_000_000) continue;
      const { inlineData, signature: pixels, ...metadata } = decoded;
      images.push({ metadata: { ...item, ...metadata }, inlineData: { ...inlineData } });
      decodedBytes += bytes;
      selected.push({ family, signature: pixels });
      if (images.length === maxImages) break;
    } catch (error) {
      options.signal?.throwIfAborted();
      if (signal.aborted && images.length) break;
      signal.throwIfAborted();
      firstFailure ??= error;
    }
  }
  if (!images.length && firstFailure) throw firstFailure;
  return images;
}

/** One optional public data-only model, never a required substitute for photos.
 * CirrusSearch filetype:3d is documented at mediawiki.org/wiki/Help:CirrusSearch.
 * Unsupported formats (including .blend) are not downloaded or executed. */
export async function loadReferenceModel(subject: ReferenceSubject, options: { signal: AbortSignal; deadline: number }): Promise<{ images: ReferenceImage[]; model: ReferenceModelEvidence } | undefined> {
  const name = plain(subject.name, 200), words = name.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return;
  const search = words.map(word => `"${word}"`).join(' ') + ' filetype:3d filesize:<4883';
  const pages = await query('commons.wikimedia.org', { generator: 'search', gsrsearch: search, gsrnamespace: '6', gsrlimit: '6', ...imageInfoParams }, options.signal);
  const page = pages.find(page => {
    const info = page.imageinfo?.[0], metadata = plain(`${page.title} ${info?.extmetadata?.ImageDescription?.value}`).toLowerCase();
    if (!/\.stl$/i.test(page.title || '') || !info?.url || !['application/sla', 'model/stl', 'model/x.stl-binary', 'model/x.stl-ascii', 'application/octet-stream'].includes(info.mime || '') || (info.size ?? 0) > maxImageBytes
      || !words.every(word => metadata.includes(word)) || !plain(info.extmetadata?.LicenseShortName?.value || info.extmetadata?.UsageTerms?.value)) return false;
    try { allowedUrl(info.url, 'model'); if (info.thumburl) allowedUrl(info.thumburl, 'image'); return true; } catch { return false; }
  });
  if (!page) return;
  const info = page.imageinfo![0], { bytes } = await boundedFetch(info.url!, 'model', options.signal);
  options.signal.throwIfAborted();
  const mesh = parseReferenceStl(bytes), renders = await renderReferenceStl(mesh, options);
  const text = (key: string) => plain(info.extmetadata?.[key]?.value);
  const title = plain(page.title, 500), sourcePageUrl = `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replaceAll(' ', '_'))}`;
  const fetchedAt = new Date().toISOString();
  const model: ReferenceModelEvidence = { title, sourcePageUrl, assetUrl: info.url!, artist: text('Artist'), credit: text('Credit'),
    licenseName: text('LicenseShortName') || text('UsageTerms'), licenseUrl: publicLink(info.extmetadata?.LicenseUrl?.value), format: 'stl', geometryRead: true,
    sha256: createHash('sha256').update(bytes).digest('hex'), fetchedAt, triangleCount: mesh.triangleCount, bounds: mesh.bounds, units: 'unspecified', viewImageIndices: [] };
  return { model, images: renders.map(({ label, bytes }) => ({ inlineData: { mimeType: 'image/jpeg', data: bytes.toString('base64') }, metadata: {
    fileTitle: title, sourcePageUrl, imageUrl: info.thumburl || info.url!, description: `External 3D model, not a photograph. ${text('ImageDescription')} ${label}; numeric STL geometry was read. Source units, orientation and subject accuracy are unverified. Grayscale rendering does not establish material colors.`,
    artist: model.artist, credit: model.credit, licenseName: model.licenseName, licenseUrl: model.licenseUrl, attributionRequired: text('AttributionRequired').toLowerCase() !== 'false',
    matchedBy: 'commons-search', query: search, identityEvidence: 'metadata-match', mediaType: 'model-render', viewLabel: label, width: 320, height: 320,
    fetchedAt, sha256: createHash('sha256').update(bytes).digest('hex'),
  } })) };
}

import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';

export type ReferenceSubject = { name: string; location?: string; aliases?: string[] };
export type ReferenceCandidate = {
  fileTitle: string; sourcePageUrl: string; imageUrl: string; description: string;
  articleTitle?: string; articleUrl?: string; articleExtract?: string;
  matchedBy: 'article-image' | 'commons-search'; query: string;
  artist: string; credit: string; licenseName: string; licenseUrl: string;
  attributionRequired: boolean; width: number; height: number;
};
export type ReferenceMetadata = ReferenceCandidate & { fetchedAt: string; sha256: string };
export type ReferenceImage = { metadata: ReferenceMetadata; inlineData: { mimeType: 'image/jpeg'; data: string } };
type Options = { signal?: AbortSignal };
type WikiPage = {
  title?: string; pageimage?: string; fullurl?: string; extract?: string; index?: number;
  imageinfo?: { url?: string; thumburl?: string; descriptionurl?: string; mime?: string;
    width?: number; height?: number; thumbwidth?: number; thumbheight?: number;
    extmetadata?: Record<string, { value?: string }> }[];
};
const apiHosts = new Set(['en.wikipedia.org', 'commons.wikimedia.org']);
const imageHosts = new Set(['upload.wikimedia.org', 'thumb.wikimedia.org']);
const userAgent = 'LargeLegoModel/0.1 (reference-image research; local HackNC prototype)';
const maxImageBytes = 5_000_000;
const maxCandidates = 12;
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
type Pixels = { inlineData: ReferenceImage['inlineData']; width: number; height: number; fetchedAt: string; sha256: string; signature: Float64Array | undefined };
const pixelCache = cache<Pixels>(24, 24 * 1024 * 1024);
let networkQueue: Promise<unknown> = Promise.resolve();
let nextRequestAt = 0;
const cooldowns = new Map<string, number>();

/** Test isolation only; never used to bypass an upstream cooldown in production. */
export function resetReferenceStateForTests() {
  metadataCache.clear(); pixelCache.clear(); cooldowns.clear(); networkQueue = Promise.resolve(); nextRequestAt = 0;
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

function allowedUrl(value: string, kind: 'api' | 'image'): URL {
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

async function boundedFetch(value: string, kind: 'api' | 'image', signal: AbortSignal): Promise<{ bytes: Buffer; contentType: string }> {
  allowedUrl(value, kind);
  return scheduled(signal, () => fetchBytes(value, kind, signal));
}

async function fetchBytes(value: string, kind: 'api' | 'image', signal: AbortSignal): Promise<{ bytes: Buffer; contentType: string }> {
  let url = allowedUrl(value, kind);
  const limit = kind === 'api' ? 1_000_000 : maxImageBytes;
  let redirects = 0, retries = 0;
  while (redirects <= 2) {
    signal.throwIfAborted();
    const remainingCooldown = (cooldowns.get(url.hostname) || 0) - Date.now();
    if (remainingCooldown > 0) throw new Error(`Wikimedia reference requests are rate limited (429). Retry after ${Math.ceil(remainingCooldown / 1000)} seconds, or attach a reference photo.`);
    const response = await fetch(url, { redirect: 'manual', signal, headers: { 'User-Agent': userAgent, Accept: kind === 'api' ? 'application/json' : 'image/jpeg,image/png,image/webp' } });
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
  const pages = (Array.isArray(result.query?.pages) ? result.query.pages : []).sort((a, b) => (a.index ?? Infinity) - (b.index ?? Infinity));
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
    imageUrl, description: text('ImageDescription'), matchedBy: article ? 'article-image' : 'commons-search', query: search,
    ...(article ? { articleTitle: plain(article.title, 300), articleUrl: publicLink(article.fullurl), articleExtract: plain(article.extract, 2500) } : {}),
    artist: text('Artist'), credit: text('Credit'), licenseName, licenseUrl: publicLink(info.extmetadata?.LicenseUrl?.value),
    attributionRequired: text('AttributionRequired').toLowerCase() !== 'false',
    width: info.thumbwidth ?? info.width ?? 0, height: info.thumbheight ?? info.height ?? 0,
  };
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
  return [...primary, ...edits];
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
export async function discoverReferences(subject: ReferenceSubject, options: Options = {}): Promise<{ subject: string; candidates: ReferenceCandidate[]; warnings: string[] }> {
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
  const warnings: string[] = [];
  const results = await Promise.allSettled([
    query('en.wikipedia.org', { titles: names.join('|'), redirects: '1', prop: 'pageimages|extracts|info', piprop: 'name', pilicense: 'free', exintro: '1', explaintext: '1', exsentences: '3', inprop: 'url' }, signal),
    ...searches.map(gsrsearch => query('commons.wikimedia.org', { generator: 'search', gsrsearch, gsrnamespace: '6', gsrlimit: '12', ...imageInfoParams }, signal)),
  ]);
  signal.throwIfAborted();
  const articles = results[0].status === 'fulfilled' ? results[0].value.filter(page => page.pageimage) : [];
  let articleImages: WikiPage[] = [];
  if (articles.length) {
    try { articleImages = await query('commons.wikimedia.org', { titles: articles.map(article => `File:${article.pageimage}`).join('|'), ...imageInfoParams }, signal); }
    catch (error) { signal.throwIfAborted(); warnings.push(error instanceof Error ? error.message : 'Article image lookup failed.'); }
  }
  for (const result of results) if (result.status === 'rejected') warnings.push(result.reason instanceof Error ? result.reason.message : 'Reference search failed.');
  const candidates: ReferenceCandidate[] = [];
  const pages = [...articleImages.map(page => ({ page, query: search })), ...results.slice(1).flatMap((result, index) =>
    result.status === 'fulfilled' ? result.value.map(page => ({ page, query: searches[index] })) : [])];
  for (const { page, query: matchedQuery } of pages) {
    const article = articles.find(item => `File:${item.pageimage}`.replaceAll('_', ' ') === page.title?.replaceAll('_', ' '));
    const item = candidate(page, matchedQuery, article);
    if (item && !candidates.some(existing => existing.fileTitle === item.fileTitle)) candidates.push(item);
  }
  // Prefer files actually named for the subject over campus panoramas whose captions merely mention it.
  // This orders candidates only; neither a filename nor an article association verifies the pixels.
  const words = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const subjectWords = [...new Set(words(name))];
  const relevance = (item: ReferenceCandidate) => {
    const titleWords = words(item.fileTitle), title = titleWords.join(' ');
    return (item.matchedBy === 'article-image' ? 10 : 0)
      + (title.includes(subjectWords.join(' ')) ? 2 : 0)
      + subjectWords.filter(word => titleWords.includes(word)).length / subjectWords.length;
  };
  candidates.sort((a, b) => relevance(b) - relevance(a));
  const ordered = diverseOrder(candidates).slice(0, maxCandidates);
  if (ordered.length && ordered.every(item => sameFamily(photoFamily(ordered[0]), photoFamily(item)))) warnings.push('Only one distinct reference photo family was found. Hidden sides and depth remain uncertain.');
  return { subject: [name, location].filter(Boolean).join(', '), candidates: ordered, warnings };
}

/** Pixels are transient: persist metadata only; send inlineData directly to the multimodal planner. */
export async function loadReferenceImages(candidates: ReferenceCandidate[], options: Options & { maxImages?: number } = {}): Promise<ReferenceImage[]> {
  const maxImages = options.maxImages ?? 2;
  if (!Number.isInteger(maxImages) || maxImages < 1 || maxImages > 3) throw new Error('Load one to three reference images.');
  const signal = AbortSignal.any([AbortSignal.timeout(15_000), ...(options.signal ? [options.signal] : [])]);
  const images: ReferenceImage[] = [];
  const selected: { family: Set<string>; signature: Float64Array | undefined }[] = [];
  let firstFailure: unknown;
  for (const item of diverseOrder(candidates.slice(0, maxCandidates))) {
    signal.throwIfAborted();
    const family = photoFamily(item);
    const related = selected.filter(previous => sameFamily(previous.family, family));
    if (related.length) { for (const previous of related) for (const key of family) previous.family.add(key); continue; }
    if (images.some(previous => previous.metadata.imageUrl === item.imageUrl)) continue;
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
      const { inlineData, signature: pixels, ...metadata } = decoded;
      images.push({ metadata: { ...item, ...metadata }, inlineData: { ...inlineData } });
      selected.push({ family, signature: pixels });
      if (images.length === maxImages) break;
    } catch (error) {
      signal.throwIfAborted();
      firstFailure ??= error;
    }
  }
  if (!images.length && firstFailure) throw firstFailure;
  return images;
}

import { createHash } from 'node:crypto';
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
  let url = allowedUrl(value, kind);
  const limit = kind === 'api' ? 1_000_000 : maxImageBytes;
  for (let redirects = 0; redirects <= 2; redirects++) {
    signal.throwIfAborted();
    const response = await fetch(url, { redirect: 'manual', signal, headers: { 'User-Agent': userAgent, Accept: kind === 'api' ? 'application/json' : 'image/jpeg,image/png,image/webp' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location || redirects === 2) throw new Error('Reference redirect limit reached.');
      url = allowedUrl(new URL(location, url).href, kind);
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
  const { bytes } = await boundedFetch(url.href, 'api', signal);
  const result = JSON.parse(bytes.toString('utf8')) as { error?: { code?: string }; query?: { pages?: WikiPage[] } };
  if (result.error) throw new Error(`Wikimedia query failed (${plain(result.error.code, 80)}).`);
  return (Array.isArray(result.query?.pages) ? result.query.pages : []).sort((a, b) => (a.index ?? Infinity) - (b.index ?? Infinity));
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
  const names = [...new Set([name, ...(subject.aliases || []).map(alias => plain(alias, 200)).filter(Boolean)])];
  const search = `${name} ${location}`.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean).map(quote).join(' ');
  const warnings: string[] = [];
  const results = await Promise.allSettled([
    query('en.wikipedia.org', { titles: names.join('|'), redirects: '1', prop: 'pageimages|extracts|info', piprop: 'name', pilicense: 'free', exintro: '1', explaintext: '1', exsentences: '3', inprop: 'url' }, signal),
    query('commons.wikimedia.org', { generator: 'search', gsrsearch: search, gsrnamespace: '6', gsrlimit: '6', ...imageInfoParams }, signal),
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
  const pages = [...articleImages, ...(results[1].status === 'fulfilled' ? results[1].value : [])];
  for (const page of pages) {
    const article = articles.find(item => `File:${item.pageimage}`.replaceAll('_', ' ') === page.title?.replaceAll('_', ' '));
    const item = candidate(page, search, article);
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
  return { subject: [name, location].filter(Boolean).join(', '), candidates: candidates.slice(0, 6), warnings };
}

/** Pixels are transient: persist metadata only; send inlineData directly to the multimodal planner. */
export async function loadReferenceImages(candidates: ReferenceCandidate[], options: Options & { maxImages?: number } = {}): Promise<ReferenceImage[]> {
  const maxImages = options.maxImages ?? 2;
  if (!Number.isInteger(maxImages) || maxImages < 1 || maxImages > 3) throw new Error('Load one to three reference images.');
  const signal = AbortSignal.any([AbortSignal.timeout(15_000), ...(options.signal ? [options.signal] : [])]);
  const images: ReferenceImage[] = [];
  let firstFailure: unknown;
  for (const item of candidates.slice(0, 6)) {
    try {
      const { bytes, contentType } = await boundedFetch(item.imageUrl, 'image', signal);
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) throw new Error('Reference response is not a supported raster image.');
      const input = sharp(bytes, { limitInputPixels: 24_000_000, animated: false });
      const info = await input.metadata();
      if (!['jpeg', 'png', 'webp'].includes(info.format || '') || (info.pages ?? 1) > 1) throw new Error('Reference must be a single raster photograph.');
      signal.throwIfAborted();
      const { data, info: output } = await input.rotate().resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer({ resolveWithObject: true });
      signal.throwIfAborted();
      images.push({ metadata: { ...item, width: output.width, height: output.height, fetchedAt: new Date().toISOString(), sha256: createHash('sha256').update(data).digest('hex') }, inlineData: { mimeType: 'image/jpeg', data: data.toString('base64') } });
      if (images.length === maxImages) break;
    } catch (error) {
      signal.throwIfAborted();
      firstFailure ??= error;
    }
  }
  if (!images.length && firstFailure) throw firstFailure;
  return images;
}

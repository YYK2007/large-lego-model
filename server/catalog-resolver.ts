import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { readConfig } from './config.js';
import { resolveLDrawGeometry, tightenCatalogEnvelope } from './ldraw-resolver.js';
import { PARTS, resolveCatalog, type CatalogManifest, type CatalogPart, type CatalogColor } from '../shared/model.js';
import type { CatalogAsset } from '../shared/catalog.js';
import seedData from './catalog-seed.json';

const seed = seedData as unknown as CatalogManifest;

export type CatalogDiscovery = { partId: string; name: string; categoryId: number; partUrl: string; status: 'discovered' | 'assembly-supported' | 'unsupported'; reason?: string };
const root = join(process.cwd(), 'data', 'catalog');
const digest = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const validId = (id: string) => /^[a-zA-Z0-9_-]{1,80}$/.test(id);
const sourceFailure = (error: unknown) => error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'
  || /fetch failed|lookup failed|download failed|rate limited|needs REBRICKABLE_API_KEY|ECONN|ENOTFOUND|ETIMEDOUT/.test(error.message));
let queue = Promise.resolve(), lastRequest = 0;

async function readJson<T>(path: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}
async function saveJson(path: string, value: unknown) {
  await mkdir(join(path, '..'), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value)); await rename(temporary, path);
}

async function cachedPart(partId: string): Promise<CatalogPart | undefined> {
  const path = join(root, 'resolved', partId + '.json');
  const previous = await readJson<CatalogPart>(path); if (!previous) return;
  const part = tightenCatalogEnvelope(previous);
  if (part !== previous) {
    // Accepted revisions are immutable. Keep the previously trusted snapshot
    // admissible when its source geometry is re-reserved more accurately.
    await saveJson(join(root, 'resolved-history', digest(previous) + '.json'), previous);
    await saveJson(path, part);
  }
  return part;
}

async function catalogApi(path: string, signal?: AbortSignal): Promise<{ data: any; source: CatalogAsset }> {
  const url = `https://rebrickable.com/api/v3/lego/${path}`;
  const cachePath = join(root, 'rebrickable', digest(url) + '.json');
  signal?.throwIfAborted();
  const cached = await readJson<{ data: any; source: CatalogAsset }>(cachePath); if (cached) return cached;
  const { rebrickableKey } = readConfig();
  if (!rebrickableKey) throw new Error('Catalog resolution needs REBRICKABLE_API_KEY. Public part search is available without it.');
  const request = queue.then(async () => {
    await new Promise(resolve => setTimeout(resolve, Math.max(0, 1050 - (Date.now() - lastRequest)))); signal?.throwIfAborted();
    lastRequest = Date.now();
    const response = await fetch(url, { headers: { Authorization: `key ${rebrickableKey}` }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25_000)]) : AbortSignal.timeout(25_000) });
    if (!response.ok) throw new Error(`Rebrickable catalog lookup failed (${response.status}); retry after its rate limit or check the configured key.`);
    const text = await response.text(), data = JSON.parse(text);
    const result = { data, source: { url, sha256: digest(text), license: 'Rebrickable catalog API; attribution retained' } };
    await saveJson(cachePath, result); return result;
  });
  queue = request.then(() => undefined, () => undefined);
  return request;
}

/** CSV quoting is required because real catalog names contain commas and quotes. */
export function parseCatalogCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []; let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { row.push(field); field = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); if (row.some(Boolean)) rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (quoted) throw new Error('Malformed bulk catalog CSV.');
  if (field || row.length) { row.push(field); rows.push(row); }
  const headings = rows.shift() || [];
  return rows.map(values => Object.fromEntries(headings.map((heading, index) => [heading, values[index] || ''])));
}

let indexPromise: Promise<CatalogDiscovery[]> | undefined;
export async function loadCatalogIndex(signal?: AbortSignal, refresh = false): Promise<CatalogDiscovery[]> {
  signal?.throwIfAborted();
  if (refresh) indexPromise = undefined;
  indexPromise ??= (async () => {
    const path = join(root, 'parts-index.json');
    const saved = refresh ? undefined : await readJson<{ parts: CatalogDiscovery[] }>(path); if (saved) return saved.parts;
    const url = 'https://cdn.rebrickable.com/media/downloads/parts.csv.gz';
    const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Bulk part catalog download failed (${response.status}).`);
    const compressed = Buffer.from(await response.arrayBuffer());
    const parts = parseCatalogCsv(gunzipSync(compressed).toString('utf8')).filter(row => validId(row.part_num)).map(row => ({
      partId: row.part_num, name: row.name, categoryId: Number(row.part_cat_id), partUrl: `https://rebrickable.com/parts/${encodeURIComponent(row.part_num)}/`, status: 'discovered' as const,
    }));
    if (!parts.length) throw new Error('Bulk catalog contains no parts.');
    await saveJson(path, { source: url, sha256: digest(compressed.toString('base64')), retrievedAt: new Date().toISOString(), parts });
    return parts;
  })().catch(error => { indexPromise = undefined; throw error; });
  return indexPromise;
}

export function rankCatalogParts(index: CatalogDiscovery[], query: string): CatalogDiscovery[] {
  const words = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(word => word.replace(/s$/, ''));
  const terms = words(query);
  const scored = index.map(part => {
    const name = new Set(words(part.name));
    const score = part.partId.toLowerCase() === query.trim().toLowerCase() ? 1000 : terms.reduce((score, term) => score + Number(name.has(term)), 0);
    // Keep every family searchable, but prefer unprinted System geometry for
    // automatic construction. An exact requested ID always wins.
    const specialtyPenalty = Number(/\b(duplo|primo|scala|belville|clikits|watch)\b/i.test(part.name))
      + Number(/\b(print|pattern|sticker)\b/i.test(part.name));
    const simplePriority = Number(/^(Brick|Plate) \d+ x \d+(?: x \d+)?$/.test(part.name));
    return { part, score, specialtyPenalty, simplePriority };
  }).filter(({ score }) => !terms.length || score > 0);
  scored.sort((a, b) => b.score - a.score || a.specialtyPenalty - b.specialtyPenalty || b.simplePriority - a.simplePriority || a.part.name.length - b.part.name.length || a.part.partId.localeCompare(b.part.partId));
  return scored.map(({ part }) => ({ ...part }));
}

export async function searchCatalog(query: string, options: { limit?: number; offset?: number; signal?: AbortSignal } = {}): Promise<CatalogDiscovery[]> {
  const ranked = rankCatalogParts(await loadCatalogIndex(options.signal), query);
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  return ranked.slice(offset, offset + Math.max(1, Math.min(500, options.limit ?? 80)));
}

async function resolvedColors(signal?: AbortSignal): Promise<Record<number, CatalogColor>> {
  const path = join(root, 'colors.json'), cached = await readJson<Record<number, CatalogColor>>(path); if (cached) return cached;
  const result: Record<number, CatalogColor> = {}; let page = 1;
  while (true) {
    const { data } = await catalogApi(`colors/?page_size=1000&page=${page}`, signal);
    if (!Array.isArray(data.results)) throw new Error('Invalid catalog color response.');
    for (const color of data.results) {
      const ldraw = color.external_ids?.LDraw?.ext_ids?.[0] ?? color.external_ids?.LDraw?.[0];
      // Transparent colors require separate material support. Other catalog
      // colors use the source RGB; metallic/pearl finishes are not simulated.
      if (!Number.isSafeInteger(color.id) || color.id < 0 || !/^[a-f0-9]{6}$/i.test(color.rgb || '') || color.is_trans || !Number.isSafeInteger(Number(ldraw))) continue;
      result[color.id] = { id: color.id, name: color.name, hex: `#${color.rgb}`, ldrawId: Number(ldraw) };
    }
    if (!data.next) break; page++;
  }
  await saveJson(path, result); return result;
}

async function partColorRecord(partId: string, colors: Record<number, CatalogColor>, signal?: AbortSignal) {
  const { data, source } = await catalogApi(`parts/${encodeURIComponent(partId)}/colors/?page_size=1000`, signal);
  if (!Array.isArray(data.results) || data.next) throw new Error('Part color response is incomplete.');
  const allowedColors = data.results.map((row: { color_id: number }) => row.color_id).filter((id: number) => Object.hasOwn(colors, id)).sort((a: number, b: number) => a - b);
  if (!allowedColors.length) throw new Error('No produced colors with a supported material and LDraw mapping were found.');
  const result = { allowedColors: [...new Set<number>(allowedColors)], source };
  await saveJson(join(root, 'part-colors', partId + '.json'), result); return result;
}

export async function resolveCatalogPart(partId: string, signal?: AbortSignal): Promise<CatalogPart> {
  if (!validId(partId)) throw new Error('Invalid catalog part ID.');
  if (Object.hasOwn(PARTS, partId)) return PARTS[partId];
  const path = join(root, 'resolved', partId + '.json'), cached = await cachedPart(partId); if (cached) return cached;
  if (seed.parts[partId]) return structuredClone(seed.parts[partId]);
  const { data, source } = await catalogApi(`parts/${encodeURIComponent(partId)}/`, signal);
  if (data.part_num !== partId || data.print_of) throw new Error('Printed variants or changed part identity require separate material support.');
  const ids = data.external_ids?.LDraw;
  if (!Array.isArray(ids) || !ids.length) throw new Error('This catalog record has no exact LDraw mapping.');
  const colors = await resolvedColors(signal), produced = await partColorRecord(partId, colors, signal);
  const failures: string[] = [];
  for (const id of ids) {
    if (!validId(String(id))) continue;
    try {
      const resolved = await resolveLDrawGeometry(`${id}.dat`, signal);
      const part: CatalogPart = { id: partId, name: data.name, kind: 'imported', ldrawId: `${id}.dat`, ...resolved, allowedColors: produced.allowedColors };
      part.geometry!.assets.push(source, produced.source);
      await saveJson(path, part); return part;
    } catch (error) { signal?.throwIfAborted(); failures.push((error as Error).message); }
  }
  throw new Error(failures[0] || 'No usable exact LDraw mapping was resolved.');
}

/** Verified local snapshots only: no discovery, API key, or network request. */
export async function loadCachedCatalog(signal?: AbortSignal): Promise<CatalogManifest> {
  signal?.throwIfAborted();
  const catalog = structuredClone(seed);
  catalog.colors = { ...catalog.colors, ...await readJson<Record<number, CatalogColor>>(join(root, 'colors.json')) };
  for (const id of Object.keys(PARTS)) {
    signal?.throwIfAborted();
    const cached = await readJson<{ allowedColors: number[]; source: CatalogAsset }>(join(root, 'part-colors', id + '.json'));
    if (cached) catalog.partColors![id] = cached;
  }
  let cachedFiles: string[] = [];
  try { cachedFiles = await readdir(join(root, 'resolved')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  for (const file of cachedFiles.filter(file => /^[a-zA-Z0-9_-]+\.json$/.test(file))) {
    signal?.throwIfAborted();
    const part = await cachedPart(file.slice(0, -5)); if (part && !PARTS[part.id]) catalog.parts[part.id] = part;
  }
  signal?.throwIfAborted();
  resolveCatalog(catalog);
  return catalog;
}

export async function resolveGenerationCatalog(options: { query: string; queries?: string[]; partIds?: string[]; signal?: AbortSignal; limit?: number; budgetMs?: number }): Promise<{ catalog: CatalogManifest; candidates: CatalogPart[]; discovered: CatalogDiscovery[]; warnings: string[] }> {
  options.signal?.throwIfAborted();
  const budget = options.budgetMs === undefined ? undefined : AbortSignal.timeout(Math.max(1, Math.floor(options.budgetMs)));
  const signal = options.signal && budget ? AbortSignal.any([options.signal, budget]) : options.signal || budget;
  const warnings: string[] = [];
  const catalog = await loadCachedCatalog(options.signal);
  const rows: CatalogDiscovery[] = (options.partIds || []).map(partId => ({ partId, name: partId, categoryId: 0, partUrl: `https://rebrickable.com/parts/${encodeURIComponent(partId)}/`, status: 'discovered' }));
  try {
    catalog.colors = { ...catalog.colors, ...await resolvedColors(signal) };
    for (const id of Object.keys(PARTS)) catalog.partColors![id] = await partColorRecord(id, catalog.colors, signal);
    const queries = options.queries?.length ? options.queries : [options.query];
    for (const query of [...new Set(queries)]) rows.push(...await searchCatalog(query, { limit: Math.ceil((options.limit ?? 80) / new Set(queries).size), signal }));
  } catch (error) {
    options.signal?.throwIfAborted();
    if (!budget?.aborted) throw error;
    warnings.push('Catalog discovery time was exhausted; previously verified parts and colors remain available.');
  }
  const discovered = [...new Map(rows.map(row => [row.partId, row])).values()];
  discovered.sort((a, b) => Number(!!catalog.parts[b.partId] || !!PARTS[b.partId]) - Number(!!catalog.parts[a.partId] || !!PARTS[a.partId]));
  for (const row of discovered) {
    options.signal?.throwIfAborted();
    try {
      if (budget?.aborted && !catalog.parts[row.partId] && !PARTS[row.partId]) { row.reason = 'Not resolved within this discovery allowance.'; continue; }
      const part = catalog.parts[row.partId] || PARTS[row.partId] || await resolveCatalogPart(row.partId, signal);
      if (!PARTS[part.id]) catalog.parts[part.id] = part; row.name = part.name; row.status = 'assembly-supported';
    } catch (error) { options.signal?.throwIfAborted(); row.status = budget?.aborted || sourceFailure(error) ? 'discovered' : 'unsupported'; row.reason = budget?.aborted ? 'Not resolved within this discovery allowance.' : (error as Error).message; }
  }
  if (budget?.aborted && !warnings.length) warnings.push('Catalog discovery time was exhausted; the successfully verified subset was retained.');
  options.signal?.throwIfAborted();
  return { catalog, candidates: Object.values(resolveCatalog(catalog).parts), discovered, warnings };
}

/** Walk the entire index across bounded runs. No family list or total-size cap.
 * Save each result before advancing so interruption cannot lose verified work.
 * Source outages leave the current part pending, never permanently unsupported. */
export async function expandFullCatalog(options: { budgetMs: number; restart?: boolean; refresh?: boolean; signal?: AbortSignal }) {
  options.signal?.throwIfAborted();
  const budget = AbortSignal.timeout(Math.max(1, Math.floor(options.budgetMs)));
  const signal = options.signal ? AbortSignal.any([options.signal, budget]) : budget;
  const path = join(root, 'expansion.json');
  const index = rankCatalogParts(await loadCatalogIndex(signal, options.refresh), '');
  const indexHash = digest(index.map(part => part.partId));
  const previous = options.restart ? undefined : await readJson<{ indexHash: string; next: number; results: Record<string, CatalogDiscovery> }>(path);
  const state = previous?.indexHash === indexHash ? previous : { indexHash, next: 0, results: {} as Record<string, CatalogDiscovery> };
  let examined = 0;
  while (state.next < index.length && !signal.aborted) {
    const row = { ...index[state.next] };
    try {
      await resolveCatalogPart(row.partId, signal);
      row.status = 'assembly-supported';
    } catch (error) {
      options.signal?.throwIfAborted();
      row.status = signal.aborted || sourceFailure(error) ? 'discovered' : 'unsupported';
      row.reason = signal.aborted ? 'Not resolved within this discovery allowance.' : (error as Error).message;
    }
    state.results[row.partId] = row;
    examined++;
    if (row.status !== 'discovered') state.next++;
    await saveJson(path, state);
    if (row.status === 'discovered') break;
  }
  options.signal?.throwIfAborted();
  return { total: index.length, examined, next: state.next, complete: state.next === index.length,
    supported: Object.values(state.results).filter(row => row.status === 'assembly-supported').length,
    unsupported: Object.values(state.results).filter(row => row.status === 'unsupported').length,
    pending: Object.values(state.results).find(row => row.status === 'discovered'), checkpoint: path };
}

/** Server admission: a client cannot invent a mesh and call its own hash verified. */
export async function verifyCatalogManifest(catalog?: CatalogManifest): Promise<void> {
  if (!catalog) return;
  resolveCatalog(catalog);
  for (const [id, part] of Object.entries(catalog.parts)) {
    const trusted = await readJson<CatalogPart>(join(root, 'resolved', id + '.json'));
    if ((!seed.parts[id] || digest(part) !== digest(seed.parts[id])) && (!trusted || digest(part) !== digest(trusted))) {
      const historical = await readJson<CatalogPart>(join(root, 'resolved-history', digest(part) + '.json'));
      if (!historical || digest(part) !== digest(historical)) throw new Error(`Part ${id} is not a trusted resolved catalog snapshot.`);
    }
  }
  for (const [id, row] of Object.entries(catalog.partColors || {})) {
    const trusted = await readJson(join(root, 'part-colors', id + '.json'));
    if ((!seed.partColors?.[id] || digest(row) !== digest(seed.partColors[id])) && (!trusted || digest(row) !== digest(trusted))) throw new Error(`Part ${id} has unverified produced-color metadata.`);
  }
  const trustedColors = await readJson<Record<number, CatalogColor>>(join(root, 'colors.json'));
  for (const [id, color] of Object.entries(catalog.colors)) if ((!seed.colors[Number(id)] || digest(color) !== digest(seed.colors[Number(id)]))
    && (!trustedColors?.[Number(id)] || digest(color) !== digest(trustedColors[Number(id)]))) throw new Error(`Color ${id} is not a verified catalog material.`);
}

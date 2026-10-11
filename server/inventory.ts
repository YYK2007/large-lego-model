import { randomUUID } from 'node:crypto';
import { resolveCatalog, type CatalogManifest, type InventoryItem } from '../shared/model.js';
import { subsetCatalog } from '../shared/catalog.js';
import { loadCachedCatalog } from './catalog-resolver.js';
import { GenerationError } from './generation.js';
import { readConfig } from './config.js';

let lastRequest = 0;
let queue = Promise.resolve();
function pacedFetch(url: string, key: string): Promise<Response> {
  const result = queue.then(async () => {
    await new Promise(resolve => setTimeout(resolve, Math.max(0, 1050 - (Date.now() - lastRequest))));
    lastRequest = Date.now();
    return fetch(url, { headers: { Authorization: `key ${key}` }, signal: AbortSignal.timeout(20000) });
  });
  queue = result.then(() => undefined, () => undefined);
  return result;
}

export async function importSet(setNumber: string): Promise<{ items: InventoryItem[]; catalog: CatalogManifest; excluded: number; source: string; note: string }> {
  if (typeof setNumber !== 'string' || !/^[A-Za-z0-9]+-\d+$/.test(setNumber) || setNumber.length > 30) throw new GenerationError('Use the full set number, for example 10696-1.', 400);
  const { rebrickableKey } = readConfig();
  if (!rebrickableKey) throw new GenerationError('Set lookup needs REBRICKABLE_API_KEY in .env. You can add loose bricks manually now.', 503);
  const manifest = await loadCachedCatalog();
  const { parts: PARTS, colors: COLORS } = resolveCatalog(manifest);
  let next: string | null = `https://rebrickable.com/api/v3/lego/sets/${encodeURIComponent(setNumber)}/parts/?inc_part_details=1&page_size=1000`;
  const source = `Set ${setNumber} · copy ${randomUUID().slice(0, 6)}`;
  const quantities = new Map<string, InventoryItem>();
  let excluded = 0;
  for (let page = 0; next && page < 20; page++) {
    const url = new URL(next);
    if (url.origin !== 'https://rebrickable.com' || !url.pathname.startsWith('/api/v3/lego/sets/')) throw new GenerationError('Set lookup returned an unexpected page.', 502);
    const response = await pacedFetch(next, rebrickableKey);
    if (!response.ok) throw new GenerationError(response.status === 404 ? 'That set number was not found.' : 'Rebrickable lookup failed. Check your API key or try again shortly.', response.status === 404 ? 404 : 502);
    const body = await response.json() as { results?: { part?: { part_num?: string }; color?: { id?: number }; quantity?: number; is_spare?: boolean }[]; next?: string | null };
    if (!Array.isArray(body.results)) throw new GenerationError('Unexpected set inventory response.', 502);
    for (const row of body.results) {
      const partId = row.part?.part_num;
      const colorId = row.color?.id;
      if (!Number.isInteger(row.quantity) || row.quantity! < 0) throw new GenerationError('Unexpected set quantity.', 502);
      if (row.is_spare || typeof partId !== 'string' || !Number.isInteger(colorId) || !Object.hasOwn(PARTS, partId) || !Object.hasOwn(COLORS, colorId!) || !PARTS[partId].allowedColors.includes(colorId!)) { excluded += row.quantity!; continue; }
      const key = `${partId}:${colorId}`;
      const existing = quantities.get(key);
      if (existing) existing.quantity += row.quantity!;
      else quantities.set(key, { partId, colorId: colorId!, quantity: row.quantity!, source });
    }
    next = body.next || null;
  }
  if (next) throw new GenerationError('This inventory is too large for the current importer.', 422);
  return { items: [...quantities.values()], catalog: subsetCatalog(manifest, [...quantities.values()].map(item => item.partId)), excluded, source, note: 'Supported catalog parts and verified colors only. Spare and unsupported parts are excluded. Check the returned inventory against your physical set; alternate set inventory versions are not resolved automatically.' };
}

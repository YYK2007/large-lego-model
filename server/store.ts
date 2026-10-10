import { mkdir, readFile, writeFile, link, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { normalizeDesign, type Design, type InventoryItem } from '../shared/model.js';

export type SavedDesign = Design & { inventory?: InventoryItem[] };
const directory = join(process.cwd(), 'data', 'designs');
const validId = (id: string) => /^[a-zA-Z0-9_-]{1,80}$/.test(id);

export async function saveDesign(design: SavedDesign): Promise<void> {
  if (!validId(design.id)) throw new Error('Invalid design ID.');
  design = normalizeDesign(design);
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `${design.id}.${randomUUID()}.tmp`);
  const serialized = JSON.stringify(design);
  await writeFile(temporary, serialized, { mode: 0o600 });
  try { await link(temporary, join(directory, `${design.id}.json`)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || !isDeepStrictEqual(normalizeDesign(JSON.parse(await readFile(join(directory, `${design.id}.json`), 'utf8'))), design)) throw new Error('A saved design revision cannot be overwritten. Create a new revision.');
  } finally { await unlink(temporary); }
}

export async function loadDesign(id: string): Promise<SavedDesign | null> {
  if (!validId(id)) return null;
  try { return normalizeDesign(JSON.parse(await readFile(join(directory, `${id}.json`), 'utf8'))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}

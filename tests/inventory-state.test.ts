import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { readCollection, saveCollection } from '../src/inventory-state.js';
import { submitJob } from '../src/generation-jobs.js';
import { validateInput } from '../server/generation.js';
import { mergeCatalogManifests, resolveCatalog, type CatalogManifest } from '../shared/model.js';

test('imported owned stock survives selecting a built-in design and reload, and a new build carries no previous design', async () => {
  const part = JSON.parse(await readFile(new URL('./fixtures/catalog-3021.json', import.meta.url), 'utf8'));
  const colors = JSON.parse(await readFile(new URL('./fixtures/catalog-colors.json', import.meta.url), 'utf8'));
  const imported: CatalogManifest = { schemaVersion: 1, parts: { [part.id]: part }, colors };
  const items = [{ partId: '3021', colorId: 3, quantity: 5, source: 'Confirmed plate collection' }];
  const memory = new Map<string, string>();
  const storage = { getItem: (key: string) => memory.get(key) || null, setItem: (key: string, value: string) => { memory.set(key, value); } };
  saveCollection(storage, { items, catalog: imported });
  storage.setItem('sprout-design', JSON.stringify({ id: 'sample-castle' }));
  const restored = readCollection(storage);
  assert.deepEqual(restored.items, items);
  assert.equal(resolveCatalog(restored.catalog).parts['3021'].name, part.name);
  assert.deepEqual(mergeCatalogManifests(restored.catalog, undefined).parts, imported.parts);
  const input = { prompt: 'Make a new sculpture from my plates', quality: 'quick' as const, inventory: restored.items, inventoryCatalog: restored.catalog, inventoryMode: 'owned' as const };
  assert.doesNotThrow(() => validateInput(input));
  const original = globalThis.fetch;
  try {
    let body: any;
    const id = '33333333-3333-4333-8333-333333333333';
    globalThis.fetch = async (_url, options) => { body = JSON.parse(String(options?.body)); return Response.json({ id, status: 'queued', milestones: [] }); };
    await submitJob(id, input);
    assert.equal(body.input.previous, undefined);
    assert.deepEqual(body.input.inventory, items);
    assert.deepEqual(body.input.inventoryCatalog, imported);
  } finally { globalThis.fetch = original; }
});

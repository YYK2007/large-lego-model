import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';
import { SAMPLE_DESIGNS } from '../shared/examples.js';
import type { SavedDesign } from '../server/store.js';

// The store captures its directory when imported; isolate it from real saved designs.
const originalCwd = process.cwd();
const sandbox = await mkdtemp(join(tmpdir(), 'sprout-store-test-'));
let store: typeof import('../server/store.js');
try {
  process.chdir(sandbox);
  store = await import('../server/store.js');
} finally {
  process.chdir(originalCwd);
}
after(async () => { await rm(sandbox, { recursive: true, force: true }); });

function snapshot(id: string): SavedDesign {
  return {
    ...structuredClone(SAMPLE_DESIGNS[0]), id,
    inventory: [{ partId: '3001', colorId: 71, quantity: 5, source: 'Original set copy A' }],
  };
}

test('saved geometry and inventory remain a copy when caller or loaded objects change', async () => {
  const input = snapshot('copy-isolation');
  const expected = structuredClone(input);
  await store.saveDesign(input);
  input.title = 'Changed title';
  input.bricks[0].colorId = 4;
  input.inventory![0].source = 'Changed collection';
  input.inventory![0].quantity = 99;
  const loaded = await store.loadDesign(input.id);
  assert.deepEqual(loaded, expected);
  loaded!.inventory![0].quantity = 0;
  loaded!.bricks.pop();
  assert.deepEqual(await store.loadDesign(input.id), expected);
});

test('repeating an identical save is idempotent, including concurrent retries', async () => {
  const input = snapshot('idempotent-retry');
  await Promise.all([store.saveDesign(input), store.saveDesign(structuredClone(input))]);
  await store.saveDesign(structuredClone(input));
  assert.deepEqual(await store.loadDesign(input.id), input);
  const files = (await readdir(join(sandbox, 'data', 'designs'))).filter(name => name.startsWith(input.id));
  assert.deepEqual(files, ['idempotent-retry.json']);
});

test('conflicting writes preserve the first saved revision and clean temporary files', async () => {
  const original = snapshot('immutable-revision');
  await store.saveDesign(original);
  await assert.rejects(store.saveDesign({ ...original, title: 'Replacement geometry' }), /cannot be overwritten/);
  await assert.rejects(store.saveDesign({ ...original, inventory: [] }), /cannot be overwritten/);
  assert.deepEqual(await store.loadDesign(original.id), original);
  const files = (await readdir(join(sandbox, 'data', 'designs'))).filter(name => name.startsWith(original.id));
  assert.deepEqual(files, ['immutable-revision.json']);
});

test('concurrent conflicting saves produce one complete winner, never a mixed snapshot', async () => {
  const a = snapshot('concurrent-revision');
  const b = { ...structuredClone(a), title: 'Other candidate', inventory: [] };
  const results = await Promise.allSettled([store.saveDesign(a), store.saveDesign(b)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  const winner = await store.loadDesign(a.id);
  assert.deepEqual(winner, results[0].status === 'fulfilled' ? a : b);
  const files = (await readdir(join(sandbox, 'data', 'designs'))).filter(name => name.startsWith(a.id));
  assert.deepEqual(files, ['concurrent-revision.json']);
});

test('unsafe IDs cannot write or read outside the design store', async () => {
  const before = await readdir(sandbox);
  for (const id of ['', '../escape', '/tmp/escape', 'folder/file', 'folder\\file', '.', '..', 'x'.repeat(81)]) {
    await assert.rejects(store.saveDesign(snapshot(id)), /Invalid design ID/);
    assert.equal(await store.loadDesign(id), null);
  }
  assert.deepEqual(await readdir(sandbox), before);
  assert.equal(await store.loadDesign('missing-valid-id'), null);
});

test('legacy snapshots migrate in memory and can be saved again without changing their original bytes', async () => {
  const expected = snapshot('legacy-revision');
  const legacy = structuredClone(expected);
  delete legacy.schemaVersion;
  delete legacy.catalogVersion;
  delete legacy.coordinateSystem;
  legacy.bricks.forEach(brick => { brick.z /= 3; });
  const file = join(sandbox, 'data', 'designs', `${legacy.id}.json`);
  await mkdir(join(sandbox, 'data', 'designs'), { recursive: true });
  const originalBytes = JSON.stringify(legacy);
  await writeFile(file, originalBytes);
  assert.deepEqual(await store.loadDesign(legacy.id), expected);
  await store.saveDesign(expected);
  assert.equal(await readFile(file, 'utf8'), originalBytes);
});

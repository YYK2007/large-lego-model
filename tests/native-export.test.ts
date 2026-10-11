import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generateMobileFile, generateNativeFile } from '../server/native-export.js';
import type { CatalogPart, Design } from '../shared/model.js';
import { archiveFiles, verifyBatchedUsdz } from './usdz-artifact.js';

const design: Design = {
  id: 'cached-native-model', title: 'Native cache test', description: 'Exact revision export.', source: 'sample',
  prompt: 'Cache fixture', createdAt: '2026-10-11', schemaVersion: 2, coordinateSystem: 'stud-xy-plate-z',
  catalogVersion: 'upright-plates-slopes-1',
  bricks: [{ id: 'piece', partId: '3020', colorId: 4, x: 2, y: 3, z: 0, rotation: 0 }],
};

test('native export coalesces exact revisions, snapshots input and protects cached bytes from callers', async () => {
  const input = structuredClone(design);
  const first = generateNativeFile(input), second = generateNativeFile(structuredClone(input));
  input.bricks[0].colorId = 1;
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(a, b, 'Identical in-flight requests share one serialization');
  assert.notEqual(a, b, 'Each caller receives isolated bytes');
  verifyBatchedUsdz(archiveFiles(a), design);
  a.fill(0);
  assert.deepEqual(await generateNativeFile(design), b, 'Caller mutation cannot damage a later download');
  const changed = await generateNativeFile(input);
  verifyBatchedUsdz(archiveFiles(changed), input);
  assert.notDeepEqual(changed, b, 'The same ID with changed geometry/color cannot use stale bytes');
});

test('native cache includes the entire pinned catalog geometry', async () => {
  const petal: CatalogPart = JSON.parse(await readFile(new URL('./fixtures/catalog-recessed-petal.json', import.meta.url), 'utf8'));
  const original: Design = { ...design, id: 'cached-imported-model',
    catalog: { schemaVersion: 1, colors: {}, parts: { [petal.id]: petal } },
    bricks: [{ ...design.bricks[0], partId: petal.id }],
  };
  const first = await generateNativeFile(original);
  const changed = structuredClone(original);
  const vertex = changed.catalog!.parts[petal.id].geometry!.body.vertices.find(point => point[0] > 0.1 && point[0] < petal.width - 0.1)!;
  vertex[0] -= 0.01;
  const second = await generateNativeFile(changed);
  assert.notDeepEqual(first, second, 'A changed pinned mesh is a different export even when placements and ID match');
  verifyBatchedUsdz(archiveFiles(first), original);
  verifyBatchedUsdz(archiveFiles(second), changed);
  await assert.rejects(generateNativeFile({ ...original, bricks: [] }), /invalid design/);
});

test('native cache retains at most two completed revisions and refreshes recent hits', async () => {
  const a = { ...design, id: 'native-lru-a' }, b = { ...design, id: 'native-lru-b' }, c = { ...design, id: 'native-lru-c' };
  const firstA = await generateNativeFile(a), firstB = await generateNativeFile(b);
  assert.deepEqual(await generateNativeFile(a), firstA);
  await generateNativeFile(c);
  assert.deepEqual(await generateNativeFile(a), firstA, 'Recently used revision survives eviction');
  const secondB = await generateNativeFile(b);
  assert.notDeepEqual(secondB, firstB, 'Evicted revision is serialized again with fresh USD geometry IDs');
  verifyBatchedUsdz(archiveFiles(secondB), b);
});

test('lightweight downloads coalesce snapshots without sharing exact-mode cache bytes', async () => {
  const stacked: Design = { ...design, id: 'mobile-cache-test', bricks: [
    { ...design.bricks[0] }, { ...design.bricks[0], id: 'upper', z: 1 },
  ] };
  const exact = await generateNativeFile(stacked);
  const input = structuredClone(stacked);
  const first = generateMobileFile(input), second = generateMobileFile(structuredClone(input));
  input.bricks[0].colorId = 1;
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(a, b, 'Concurrent lightweight exports share one serialization');
  assert.notEqual(a, b, 'Each lightweight caller receives isolated bytes');
  assert.notDeepEqual(a, exact, 'Lightweight and canonical modes have different geometry');
  assert.deepEqual(await generateNativeFile(stacked), exact, 'Lightweight export never replaces the full-model cache');
  verifyBatchedUsdz(archiveFiles(exact), stacked);
  a.fill(0);
  assert.deepEqual(await generateMobileFile(stacked), b, 'Caller mutation cannot damage the viewing download');
  assert.notDeepEqual(await generateMobileFile(input), b, 'Same ID with changed color cannot use stale lightweight bytes');
  await assert.rejects(generateMobileFile({ ...stacked, bricks: [] }), /invalid design/);
});

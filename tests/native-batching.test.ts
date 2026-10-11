import test from 'node:test';
import assert from 'node:assert/strict';
import { generateUsdz } from '../server/native-model.js';
import { SAMPLE_DESIGNS } from '../shared/examples.js';
import { ROOF_SAMPLE } from '../shared/roof-sample.js';
import { PARTS, type Design } from '../shared/model.js';
import { archiveFiles, inspectUsdz, verifyBatchedUsdz } from './usdz-artifact.js';

test('castle export uses six meshes instead of thousands while preserving every triangle', async () => {
  const castle = SAMPLE_DESIGNS.find(design => design.id === 'sample-castle')!;
  const before = structuredClone(castle);
  const files = archiveFiles(await generateUsdz(castle));
  assert.equal(inspectUsdz(files).meshes.length, 6, 'One mesh for each of the six castle colors');
  const report = verifyBatchedUsdz(files, castle, false);
  assert.equal(report.bodies, 1345);
  assert.equal(report.studs, 4773);
  assert.equal(report.triangles, 398268);
  assert.deepEqual(castle, before, 'Export leaves placements and inventory identity intact');
});

test('dense single-color designs split oversized batches without losing bodies or studs', async () => {
  const dense: Design = { ...ROOF_SAMPLE, id: 'native-dense-batch', bricks: Array.from({ length: 32 }, (_, z) => ({
    id: `plate-${z}`, partId: '91405', colorId: 15, x: 0, y: 0, z, rotation: 0,
  })) };
  const files = archiveFiles(await generateUsdz(dense));
  const meshes = inspectUsdz(files).meshes;
  assert.equal(meshes.length, 2, 'A dense color is split before its serialized geometry grows too large');
  assert.ok(meshes.every(mesh => mesh.indices.length <= 1_000_000), 'Every serialized batch stays bounded');
  const report = verifyBatchedUsdz(files, dense, false);
  assert.equal(report.bodies, 32);
  assert.equal(report.studs, 8192);
  assert.equal(report.triangles, 655744);
});

test('batched geometry preserves canonical precision at the workspace maximum height', async () => {
  for (const part of Object.values(PARTS)) for (const rotation of [0, 90, 180, 270] as const) {
    const z = 384 - part.heightPlates;
    const tall: Design = { ...ROOF_SAMPLE, id: 'native-tall-batch', bricks: [
      ...Array.from({ length: z }, (_, plate) => ({ id: `column-${plate}`, partId: '3024', colorId: 15, x: 0, y: 0, z: plate, rotation: 0 as const })),
      { id: 'top', partId: part.id, colorId: 15, x: 0, y: 0, z, rotation },
    ] };
    const report = verifyBatchedUsdz(archiveFiles(await generateUsdz(tall)), tall, false);
    assert.equal(report.bodies, z + 1);
  }
});

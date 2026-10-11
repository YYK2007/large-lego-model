import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generateUsdz } from '../server/native-model.js';
import { ROOF_SAMPLE } from '../shared/roof-sample.js';
import type { CatalogPart, Design } from '../shared/model.js';
import { archiveFiles, inspectUsdz, verifyBatchedUsdz } from './usdz-artifact.js';

test('large native exports share exact body/stud shapes across placements and colors, including imported parts at every yaw', async () => {
  const petal: CatalogPart = JSON.parse(await readFile(new URL('./fixtures/catalog-recessed-petal.json', import.meta.url), 'utf8'));
  const rotations = [0, 90, 180, 270] as const;
  const design: Design = { ...ROOF_SAMPLE, id: 'native-shape-reuse',
    catalog: { schemaVersion: 1, colors: {}, parts: { [petal.id]: petal } },
    bricks: [
      ...Array.from({ length: 52 }, (_, z) => ({ id: `plate-${z}`, partId: '91405',
        colorId: z % 2 ? 71 : 15, x: 0, y: 0, z, rotation: rotations[z % 4] })),
      ...Array.from({ length: 8 }, (_, index) => ({ id: `petal-${index}`, partId: petal.id,
        colorId: index < 4 ? 4 : 15, x: index % 4 * 4, y: Math.floor(index / 4) * 8,
        z: 52, rotation: rotations[index % 4] })),
    ],
  };
  const before = structuredClone(design);
  const archive = await generateUsdz(design);
  const files = archiveFiles(archive);
  const { model, meshes } = inspectUsdz(files);
  assert.equal(meshes.length, design.bricks.length, 'Every brick has its own placement and material binding');
  assert.ok(meshes.every(mesh => mesh.name.startsWith('Piece_')));
  assert.equal(new Set(meshes.map(mesh => mesh.geometryFile)).size, 8, 'Two actual parts, each at four yaws');
  assert.equal(files.size, 9, 'The package stores each shape once, plus the root layer');
  for (let yaw = 0; yaw < 4; yaw++) {
    assert.equal(meshes[52 + yaw].geometryFile, meshes[56 + yaw].geometryFile, 'Different colors reuse the same exact imported shape');
    assert.notDeepEqual(meshes[52 + yaw].color, meshes[56 + yaw].color, 'Each reference retains its own material');
  }
  assert.match(model, /planeAnchoring:alignment = "horizontal"/);
  assert.ok(archive.length < 8 * 1024 * 1024, 'Repeated detail does not expand into a large attachment');
  const report = verifyBatchedUsdz(files, design, false);
  assert.equal(report.bodies, 60);
  assert.equal(report.studs, 52 * 256, 'Recessed petal surfaces remain body geometry, with no invented studs');
  assert.deepEqual(design, before, 'Export leaves the saved revision unchanged');
});

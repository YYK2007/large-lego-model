import assert from 'node:assert/strict';
import test from 'node:test';
import seedData from '../server/catalog-seed.json';
import { subsetCatalog, type CatalogManifest } from '../shared/catalog.js';
import { allocateInventory, billOfMaterials, buildSteps, catalogForDesign, exportLDraw, partBottomSites, validateDesign, type Design } from '../shared/model.js';
import { loadCachedCatalog, verifyCatalogManifest } from '../server/catalog-resolver.js';
import { compileGeneratedPlan } from '../server/generation.js';
import { createBrickModel, createInstancedBrickModel } from '../shared/brick-geometry.js';
import { generateUsdz } from '../server/native-model.js';
import { archiveFiles, verifyBatchedUsdz } from './usdz-artifact.js';

const catalog = seedData as unknown as CatalogManifest;
const base: Design = { id: 'flower-catalog-test', title: 'Real flower pieces', description: 'Small source-backed flower assembly fixture.', source: 'sample',
  prompt: 'Two flowers on simple brick stems', createdAt: '2026-10-10', schemaVersion: 2, coordinateSystem: 'stud-xy-plate-z', catalogVersion: 'upright-architecture-2', catalog, bricks: [] };

export const flowerDesign: Design = { ...base, catalog: subsetCatalog(catalog, ['3036', '3005', '24866', '33291', '6141']), bricks: [
  { id: 'base', partId: '3036', colorId: 2, x: 0, y: 0, z: 0, rotation: 0 },
  { id: 'stem-a1', partId: '3005', colorId: 2, x: 1, y: 1, z: 1, rotation: 0 },
  { id: 'stem-b1', partId: '3005', colorId: 2, x: 4, y: 4, z: 1, rotation: 0 },
  { id: 'stem-a2', partId: '3005', colorId: 2, x: 1, y: 1, z: 4, rotation: 0 },
  { id: 'stem-b2', partId: '3005', colorId: 2, x: 4, y: 4, z: 4, rotation: 0 },
  { id: 'five-petal', partId: '24866', colorId: 25, x: 1, y: 1, z: 7, rotation: 0 },
  { id: 'four-petal', partId: '33291', colorId: 4, x: 3, y: 3, z: 7, rotation: 0 },
  { id: 'center-a', partId: '6141', colorId: 14, x: 1, y: 1, z: 8, rotation: 0 },
  { id: 'center-b', partId: '6141', colorId: 14, x: 4, y: 4, z: 8, rotation: 0 },
] };

test('every bundled part mounts on a verified underside at all four yaws without invented sites', () => {
  for (const part of Object.values(catalog.parts)) for (const rotation of [0, 90, 180, 270] as const) {
    const piece = { id: 'imported', partId: part.id, colorId: part.allowedColors[0], x: 0, y: 0, z: 1, rotation };
    const context = catalogForDesign(base), site = partBottomSites(piece, context)[0];
    const design = { ...base, bricks: [{ id: 'support', partId: '3024', colorId: 15, x: site.x - 0.5, y: site.y - 0.5, z: 0, rotation: 0 as const }, piece] };
    assert.equal(validateDesign(design).valid, true, `${part.id} at yaw ${rotation}: ${validateDesign(design).errors.join('; ')}`);
    assert.equal(buildSteps(design).flatMap(step => step.bricks).length, 2);
  }
});

test('flowers preserve exact produced colors, inventory, connected assembly and source geometry in native exports', async () => {
  assert.equal(validateDesign(flowerDesign).valid, true);
  const bom = billOfMaterials(flowerDesign);
  assert.equal(bom.reduce((sum, row) => sum + row.quantity, 0), 9);
  assert.equal(allocateInventory(flowerDesign, bom.map(row => ({ ...row, source: 'Confirmed flower collection' }))).totalMissing, 0);
  assert.equal(allocateInventory(flowerDesign, []).totalMissing, 9);
  for (const partId of ['24866', '33291']) {
    const piece = flowerDesign.bricks.find(brick => brick.partId === partId)!;
    const invalid = { ...flowerDesign, bricks: flowerDesign.bricks.map(brick => brick.id === piece.id ? { ...brick, colorId: 0 } : brick) };
    assert.equal(validateDesign(invalid).valid, false, 'A real shape cannot use an unproduced flower color');
    assert.match(exportLDraw(flowerDesign), new RegExp(`0 FILE ${partId}.dat`));
  }
  const native = createBrickModel(flowerDesign), instanced = createInstancedBrickModel(flowerDesign);
  assert.equal(native.children.length, flowerDesign.bricks.length);
  assert.ok(instanced.model.children.length > 0); instanced.dispose();
  const verified = verifyBatchedUsdz(archiveFiles(await generateUsdz(flowerDesign)), flowerDesign);
  assert.equal(verified.bodies, 9);
});

test('fresh installations trust the bundled flower snapshots but reject altered meshes and colors', async () => {
  await verifyCatalogManifest(catalog);
  const fake = structuredClone(catalog); fake.parts['24866'].name = 'Invented flower';
  await assert.rejects(verifyCatalogManifest(fake), /not a trusted resolved catalog snapshot/);
  const recolored = structuredClone(catalog); recolored.colors[25].hex = '#000000';
  await assert.rejects(verifyCatalogManifest(recolored), /not a verified catalog material/);
  const available = await loadCachedCatalog();
  assert.ok(available.parts['24866']); assert.ok(available.parts['33291']);
});

test('ordinary volumes pack as rectangular pieces and retain only the definitions they used', () => {
  const design = compileGeneratedPlan({ schemaVersion: 2, coordinateSystem: 'stud-xy-plate-z', title: 'Simple volume', description: 'Rectangular packing preference.',
    boxes: [{ x: 0, y: 0, z: 0, width: 4, depth: 4, height: 9, colorId: 4 }] }, { prompt: 'A rectangular red block' }, undefined, catalog);
  const context = catalogForDesign(design);
  assert.ok(design.bricks.every(brick => ['brick', 'plate'].includes(context.parts[brick.partId].kind)));
  assert.equal(Object.keys(design.catalog!.parts).length, 0);
  assert.equal(JSON.stringify(design.catalog).length < JSON.stringify(catalog).length / 10, true);
});

test('compact manifests retain used builtin color overrides even without a part-color expansion', () => {
  const manifest: CatalogManifest = { schemaVersion: 1, parts: {}, colors: { 4: catalog.colors[4], 25: catalog.colors[25] } };
  const selected = subsetCatalog(manifest, ['3001'], [4]);
  assert.deepEqual(selected.colors, { 4: manifest.colors[4] });
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { retainContainedStudGeometry } from '../server/ldraw-resolver.js';
import { buildSteps, billOfMaterials, catalogForDesign, exportLDraw, partTopStuds, validateDesign, type CatalogPart, type Design } from '../shared/model.js';
import type { CatalogMesh, ImportedGeometry } from '../shared/catalog.js';
import { partSurfaces } from '../shared/part-surfaces.js';
import { createBrickModel } from '../shared/brick-geometry.js';
import { renderDesignSvg } from '../shared/illustration.js';
import { generateUsdz } from '../server/native-model.js';
import { generateManualPdf } from '../server/manual.js';
import { archiveFiles, verifyBatchedUsdz } from './usdz-artifact.js';

const triangle = (z: number): CatalogMesh => ({ vertices: [[0.2, 0.2, z], [0.8, 0.2, z], [0.5, 0.8, z]], faces: [[0, 1, 2]] });
const envelope = { width: 1, depth: 1, heightPlates: 2 };
const faces = (mesh: CatalogMesh) => mesh.faces.map(face => face.map(index => mesh.vertices[index]));

test('contained recessed stud surfaces are preserved exactly without publishing an attachment', () => {
  const body = triangle(0), recessed = { position: [0.5, 0.5, 1], mesh: triangle(1.5) } as ImportedGeometry['studs'][number];
  const input = structuredClone({ body, recessed });
  const result = retainContainedStudGeometry(body, [recessed], envelope);
  assert.deepEqual(faces(result.body), [...faces(body), ...faces(recessed.mesh)]);
  assert.deepEqual(result.studs, []);
  assert.match(result.unsupportedSnaps.join(' '), /geometry only.*mating is unsupported/);
  assert.deepEqual({ body, recessed }, input, 'Source points and source face indices are not mutated');
});

test('ordinary top studs remain usable; off-grid studs are geometry only if entirely contained', () => {
  const top = { position: [0.5, 0.5, 2], mesh: triangle(2.5) } as ImportedGeometry['studs'][number];
  const offGrid = { position: [0.4, 0.4, 1], mesh: triangle(1.5) } as ImportedGeometry['studs'][number];
  const result = retainContainedStudGeometry(triangle(0), [top, offGrid], envelope);
  assert.deepEqual(result.studs, [top]);
  assert.deepEqual(faces(result.body), [...faces(triangle(0)), ...faces(offGrid.mesh)]);
  assert.equal(result.unsupportedSnaps.length, 1);
  for (const [axis, value] of [[0, -0.01], [1, 1.01], [2, 2.01]] as const) {
    const unsafe = structuredClone(offGrid); unsafe.mesh.vertices[0][axis] = value;
    assert.throws(() => retainContainedStudGeometry(triangle(0), [unsafe], envelope), /outside the body envelope/);
  }
});

const petal: CatalogPart = JSON.parse(await readFile(new URL('./fixtures/catalog-recessed-petal.json', import.meta.url), 'utf8'));
const design: Design = {
  id: 'recessed-petal-test', title: 'Real rounded petal', description: 'Official LDraw geometry mounted by its verified underside.',
  source: 'sample', prompt: 'Catalog connection regression', createdAt: '2026-10-11', schemaVersion: 2,
  coordinateSystem: 'stud-xy-plate-z', catalogVersion: 'upright-plates-slopes-1', catalog: { schemaVersion: 1, colors: {}, parts: { [petal.id]: petal } },
  bricks: [{ id: 'base', partId: '3020', colorId: 2, x: 0, y: 0, z: 0, rotation: 0 },
    { id: 'petal', partId: petal.id, colorId: 4, x: 0, y: 0, z: 1, rotation: 0 }],
};

test('actual rounded petal mounts at all yaws and never exposes recessed mating sites', () => {
  assert.deepEqual([petal.width, petal.depth, petal.heightPlates], [4, 3, 2]);
  assert.equal(petal.geometry!.receivers.length, 12);
  assert.equal(petal.geometry!.studs.length, 0);
  assert.equal(petal.geometry!.unsupportedSnaps.filter(s => s.includes('geometry only')).length, 2);
  assert.ok(petal.allowedColors.includes(4)); assert.ok(petal.allowedColors.includes(320));
  for (const rotation of [0, 90, 180, 270] as const) {
    const one = { ...design, bricks: [design.bricks[0], { ...design.bricks[1], rotation }] };
    assert.equal(validateDesign(one).valid, true);
    assert.deepEqual(partTopStuds(one.bricks[1], catalogForDesign(one)), []);
    assert.deepEqual(buildSteps(one).flatMap(step => step.bricks.map(brick => brick.id)), ['base', 'petal']);
  }
  const unsupported: Design = { ...design, bricks: [...design.bricks, { id: 'upper', partId: '3005', colorId: 4, x: 1, y: 2, z: 3, rotation: 0 }] };
  assert.equal(validateDesign(unsupported).valid, false, 'A body-only recessed stud cannot support a brick above the curved body');
  assert.deepEqual(billOfMaterials(design).find(row => row.partId === petal.id), { partId: petal.id, colorId: 4, quantity: 1 });
});

test('actual recessed stud surfaces remain in preview and native export as body geometry', async () => {
  const catalog = catalogForDesign(design), surface = partSurfaces(design.bricks[1], catalog);
  assert.equal(surface.faces.length, petal.geometry!.body.faces.length);
  const model = createBrickModel(design);
  assert.equal(model.children[1].children.length, 1, 'Recessed studs are included in the single body mesh');
  assert.match(exportLDraw(design), /93604/);
  const usdz = verifyBatchedUsdz(archiveFiles(await generateUsdz(design)), design);
  assert.equal(usdz.bodies, 2); assert.equal(usdz.studs, 8, 'Only the base has usable/exported top-stud primitives; the petal stud surfaces stay in its body');
});

test('actual recessed petal surfaces export as SVG and manual', async () => {
  for (const rotation of [0, 90, 180, 270] as const) {
    assert.match(renderDesignSvg({ ...design, bricks: [design.bricks[0], { ...design.bricks[1], rotation }] }), /<svg/);
  }
  const pdf = await generateManualPdf(design); assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
});

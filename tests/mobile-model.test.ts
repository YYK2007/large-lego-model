import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Matrix3, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js';
import { createMobileModel, generateMobileUsdz } from '../server/mobile-model.js';
import { createBrickModel, METERS_PER_STUD } from '../shared/brick-geometry.js';
import { COLORS, type CatalogPart, type Design } from '../shared/model.js';
import { archiveFiles, inspectUsdz } from './usdz-artifact.js';

const design: Design = {
  id: 'mobile-model-test', title: 'Lightweight viewing test', description: 'Covered and exposed studs.', source: 'sample',
  prompt: 'Viewing derivative fixture', createdAt: '2026-10-11', schemaVersion: 2, coordinateSystem: 'stud-xy-plate-z',
  catalogVersion: 'upright-plates-slopes-1',
  bricks: [{ id: 'base', partId: '3020', colorId: 4, x: 4, y: 7, z: 0, rotation: 0 },
    { id: 'top', partId: '3020', colorId: 1, x: 4, y: 7, z: 1, rotation: 0 }],
};

async function verifyRetained(input: Design, omitted: Set<string>, serialized?: Buffer) {
  const before = structuredClone(input), prepared = createMobileModel(input);
  const source = createBrickModel(input); source.scale.setScalar(METERS_PER_STUD); source.updateMatrixWorld(true);
  try {
    const { meshes } = inspectUsdz(archiveFiles(serialized ?? Buffer.from(await new USDZExporter().parseAsync(prepared.model, { quickLookCompatible: true }))));
    const offsets = new Map(meshes.map(mesh => [mesh, 0]));
    let triangles = 0, removed = 0;
    const expected = new Vector3(), actual = new Vector3(), expectedNormal = new Vector3(), actualNormal = new Vector3();
    source.traverse(object => {
      if (!(object instanceof Mesh)) return;
      const position = object.geometry.getAttribute('position'), normal = object.geometry.getAttribute('normal'), index = object.geometry.index;
      if (omitted.has(object.name)) { removed++; return; }
      const color = (object.material as MeshStandardMaterial).color.toArray();
      const batch = meshes.find(mesh => offsets.get(mesh)! < mesh.indices.length && mesh.color.every((value, axis) => Math.abs(value - color[axis]) < 1e-6));
      assert.ok(batch, `Retained geometry exists for ${object.name}`);
      let offset = offsets.get(batch)!;
      const matrix = new Matrix3().getNormalMatrix(object.matrixWorld);
      for (let corner = 0; corner < (index?.count ?? position.count); corner++) {
        const vertex: number = index ? index.getX(corner) : corner;
        const exported: number = batch.indices[offset++];
        assert.ok(exported !== undefined, 'No retained triangle is missing');
        expected.fromBufferAttribute(position, vertex).applyMatrix4(object.matrixWorld);
        actual.fromArray(batch.positions, exported * 3).applyMatrix4(batch.transform);
        assert.ok(expected.distanceTo(actual) < 8e-8, `${object.name}: exact retained position`);
        expectedNormal.fromBufferAttribute(normal, vertex).applyNormalMatrix(matrix);
        actualNormal.fromArray(batch.normals, exported * 3).applyNormalMatrix(batch.normalMatrix);
        assert.ok(expectedNormal.distanceTo(actualNormal) < 1e-5, `${object.name}: exact retained normal`);
        triangles += 1 / 3;
      }
      offsets.set(batch, offset);
    });
    for (const mesh of meshes) assert.equal(offsets.get(mesh), mesh.indices.length, 'No replacement or invented surfaces');
    assert.equal(removed, omitted.size);
    assert.equal(prepared.report.omittedCoveredStuds, removed);
    assert.equal(prepared.report.bodies, input.bricks.length);
    assert.equal(prepared.report.triangles, Math.round(triangles));
    assert.equal(prepared.report.viewingOnly, true);
    assert.match(prepared.report.approximation, /cosmetic interlayer gaps/);
    assert.deepEqual(input, before);
    return prepared.report;
  } finally {
    prepared.dispose();
    const resources = new Set<Mesh['geometry'] | MeshStandardMaterial>();
    source.traverse(object => { if (object instanceof Mesh) { resources.add(object.geometry); resources.add(object.material as MeshStandardMaterial); } });
    resources.forEach(resource => resource.dispose());
  }
}

test('only fully covered ordinary studs are omitted; bodies, colors and exposed studs remain exact', async () => {
  const omitted = new Set(Array.from({ length: 8 }, (_, index) => `Stud_0_${index % 2}_${Math.floor(index / 2)}`));
  const report = await verifyRetained(design, omitted);
  assert.equal(report.studs, 8);
  assert.equal(report.originalTriangles - report.triangles, 8 * 80);
});

test('rotated partial coverage leaves all uncovered studs and overhang geometry intact', async () => {
  const partial: Design = { ...design, bricks: [design.bricks[0], { ...design.bricks[1], rotation: 90 }] };
  await verifyRetained(partial, new Set(['Stud_0_0_0', 'Stud_0_1_0', 'Stud_0_0_1', 'Stud_0_1_1']));
});

test('ordinary bricks and grooved tiles cover only their own footprint', async () => {
  await verifyRetained({ ...design, bricks: [design.bricks[0], { ...design.bricks[1], partId: '3001' }] },
    new Set(Array.from({ length: 8 }, (_, index) => `Stud_0_${index % 2}_${Math.floor(index / 2)}`)));
  await verifyRetained({ ...design, bricks: [design.bricks[0], { ...design.bricks[1], partId: '3068b' }] },
    new Set(['Stud_0_0_0', 'Stud_0_1_0', 'Stud_0_0_1', 'Stud_0_1_1']));
});

test('sloped and translucent covers cannot hide studs using a rectangular envelope', async () => {
  await verifyRetained({ ...design, bricks: [design.bricks[0], { ...design.bricks[1], partId: '3039' }] }, new Set());
  await verifyRetained({ ...design, catalog: { schemaVersion: 1, parts: {}, colors: { 1: { ...COLORS[1], alpha: 0.5 } } } }, new Set());
});

test('imported bodies and imported studs are retained even when ordinary parts cover them', async () => {
  const part: CatalogPart = JSON.parse(await readFile(new URL('./fixtures/catalog-3021.json', import.meta.url), 'utf8'));
  const catalog = { schemaVersion: 1 as const, parts: { [part.id]: part }, colors: {} };
  await verifyRetained({ ...design, catalog, bricks: [{ ...design.bricks[0], partId: part.id }, design.bricks[1]] }, new Set());
  await verifyRetained({ ...design, catalog, bricks: [design.bricks[0], { ...design.bricks[1], partId: part.id }] }, new Set());
});

test('invalid designs never become lightweight viewing exports', () => {
  assert.throws(() => createMobileModel({ ...design, bricks: [] }), /invalid design/);
  assert.throws(() => createMobileModel({ ...design, bricks: [design.bricks[0], { ...design.bricks[1], z: 0 }] }), /overlap/);
});

test('missing optional USD tools retain a complete portable viewing archive', async () => {
  const path = process.env.PATH;
  try {
    process.env.PATH = '/nonexistent-openusd-tools';
    const exported = await generateMobileUsdz(design);
    const omitted = new Set(Array.from({ length: 2 }, (_, x) => Array.from({ length: 4 }, (_, y) => `Stud_0_${x}_${y}`)).flat());
    await verifyRetained(design, omitted, exported.bytes);
    assert.equal(exported.report.omittedCoveredStuds, 8);
  } finally {
    if (path === undefined) delete process.env.PATH; else process.env.PATH = path;
  }
});

test('a failing optional converter preserves viewing geometry without hiding invalid designs', { skip: process.platform === 'win32' }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mobile-usdz-failed-tool-'));
  const path = process.env.PATH;
  const log = t.mock.method(console, 'error', () => {});
  try {
    await writeFile(join(directory, 'usdcat'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    process.env.PATH = directory;
    const exported = await generateMobileUsdz(design);
    const omitted = new Set(Array.from({ length: 2 }, (_, x) => Array.from({ length: 4 }, (_, y) => `Stud_0_${x}_${y}`)).flat());
    await verifyRetained(design, omitted, exported.bytes);
    assert.deepEqual(log.mock.calls.map(call => call.arguments), [['Binary USDZ preparation failed; keeping the portable lightweight viewing model.']]);
    await assert.rejects(generateMobileUsdz({ ...design, bricks: [] }), /invalid design/);
    assert.equal(log.mock.callCount(), 1, 'Invalid geometry must reject before optional conversion');
  } finally {
    if (path === undefined) delete process.env.PATH; else process.env.PATH = path;
    await rm(directory, { recursive: true, force: true });
  }
});

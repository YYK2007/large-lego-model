import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { InstancedMesh, Matrix3, Matrix4, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { createBrickModel, createInstancedBrickModel } from '../shared/brick-geometry.js';
import { COLORS, type CatalogPart, type Design } from '../shared/model.js';

const design: Design = {
  id: 'guide-viewing-test', title: 'Guide viewing fixture', description: '', source: 'sample', prompt: '', createdAt: '2026-10-11',
  schemaVersion: 2, coordinateSystem: 'stud-xy-plate-z', catalogVersion: 'upright-plates-slopes-1',
  bricks: [{ id: 'base', partId: '3020', colorId: 4, x: 4, y: 7, z: 0, rotation: 0 },
    { id: 'top', partId: '3020', colorId: 1, x: 4, y: 7, z: 1, rotation: 0 }],
};
const hiddenBaseStuds = new Set(Array.from({ length: 8 }, (_, i) => `Stud_0_${i % 2}_${Math.floor(i / 2)}`));
const triangles = (web: ReturnType<typeof createInstancedBrickModel>) => web.model.children.reduce((sum, object) =>
  sum + (object instanceof InstancedMesh && object.visible ? object.count * (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3 : 0), 0);

// Compare every retained surface corner, normal and material to the native
// geometry, independent of instance batching and emission order.
function assertSurfaces(web: ReturnType<typeof createInstancedBrickModel>, input: Design, omitted = new Set<string>(), visible?: string[], moving?: { id: string; offset: [number, number, number] }) {
  const expected: number[][] = [], actual: number[][] = [];
  const point = new Vector3(), normal = new Vector3();
  const append = (target: number[][], mesh: Mesh, transform: Matrix4) => {
    const positions = mesh.geometry.getAttribute('position'), normals = mesh.geometry.getAttribute('normal'), indices = mesh.geometry.index;
    const normalMatrix = new Matrix3().getNormalMatrix(transform), color = (mesh.material as MeshStandardMaterial).color.toArray();
    for (let i = 0; i < (indices?.count ?? positions.count); i++) {
      const index = indices ? indices.getX(i) : i;
      point.fromBufferAttribute(positions, index).applyMatrix4(transform);
      normal.fromBufferAttribute(normals, index).applyNormalMatrix(normalMatrix);
      target.push([...point.toArray(), ...normal.toArray(), ...color]);
    }
  };
  const native = createBrickModel(input);
  native.children.forEach(group => { if (moving && moving.id === group.userData.brickId) group.position.fromArray(moving.offset); });
  native.updateMatrixWorld(true);
  native.traverse(object => {
    if (object instanceof Mesh && !omitted.has(object.name) && (!visible || visible.includes(object.parent!.userData.brickId))) append(expected, object, object.matrixWorld);
  });
  const matrix = new Matrix4();
  for (const object of web.model.children) if (object instanceof InstancedMesh && object.visible) {
    for (let i = 0; i < object.count; i++) { object.getMatrixAt(i, matrix); append(actual, object, matrix); }
  }
  const key = (point: number[]) => point.map(value => Math.round(value * 1000)).join(',');
  const sort = (a: number[], b: number[]) => key(a).localeCompare(key(b));
  expected.sort(sort); actual.sort(sort);
  assert.equal(actual.length, expected.length, 'No missing or invented retained surfaces');
  actual.forEach((point, i) => point.forEach((value, axis) => assert.ok(Math.abs(value - expected[i][axis]) < 1e-5, `Corner ${i}, position/normal/color channel ${axis}`)));
  const resources = new Set<Mesh['geometry'] | MeshStandardMaterial>();
  native.traverse(object => { if (object instanceof Mesh) { resources.add(object.geometry); resources.add(object.material as MeshStandardMaterial); } });
  resources.forEach(resource => resource.dispose());
}

test('optional guide rendering keeps exact bodies and exposed studs; the default remains complete', () => {
  const exact = createInstancedBrickModel(design), disabled = createInstancedBrickModel(design, false, { omitCoveredStuds: false });
  const guide = createInstancedBrickModel(design, false, { omitCoveredStuds: true });
  try {
    assertSurfaces(exact, design); assertSurfaces(disabled, design); assertSurfaces(guide, design, hiddenBaseStuds);
    assert.equal(triangles(exact) - triangles(guide), 8 * 80);
  } finally { exact.dispose(); disabled.dispose(); guide.dispose(); }
});

test('step visibility and backwards navigation restore studs without rebuilding geometry', () => {
  const guide = createInstancedBrickModel(design, false, { omitCoveredStuds: true });
  const geometries = guide.model.children.map(object => object instanceof Mesh ? object.geometry : null);
  try {
    guide.update(['base']); assertSurfaces(guide, design, new Set(), ['base']);
    guide.update(['base', 'top']); assertSurfaces(guide, design, hiddenBaseStuds);
    guide.update(['base']); assertSurfaces(guide, design, new Set(), ['base']);
    guide.update([]); assert.equal(triangles(guide), 0);
    guide.update(); assertSurfaces(guide, design, hiddenBaseStuds);
    assert.deepEqual(guide.model.children.map(object => object instanceof Mesh ? object.geometry : null), geometries);
  } finally { guide.dispose(); }
});

test('moving pieces retain their own studs and expose studs below until they settle, including replay', () => {
  const guide = createInstancedBrickModel(design, false, { omitCoveredStuds: true });
  try {
    for (const id of ['top', 'base']) {
      guide.update(undefined, undefined, id); assertSurfaces(guide, design);
      guide.setOffset(1.25, 2.5, -0.5); assertSurfaces(guide, design, new Set(), undefined, { id, offset: [1.25, 2.5, -0.5] });
      guide.setOffset(0, 0, 0); assertSurfaces(guide, design, hiddenBaseStuds);
      guide.setLift(3); assertSurfaces(guide, design, new Set(), undefined, { id, offset: [0, 3, 0] });
      guide.setLift(0); assertSurfaces(guide, design, hiddenBaseStuds);
    }
  } finally { guide.dispose(); }
});

test('transparent faded covers retain lower studs; opaque guide context may omit them', () => {
  const translucent = createInstancedBrickModel(design, false, { omitCoveredStuds: true });
  const opaque = createInstancedBrickModel(design, true, { omitCoveredStuds: true });
  const exact = createInstancedBrickModel(design);
  try {
    translucent.update(undefined, ['base']); opaque.update(undefined, ['base']);
    assert.equal(triangles(translucent), triangles(exact));
    assert.equal(triangles(opaque), triangles(exact) - 8 * 80);
  } finally { translucent.dispose(); opaque.dispose(); exact.dispose(); }
});

test('rotated partial covers remove only the covered ordinary studs', () => {
  const partial: Design = { ...design, bricks: [design.bricks[0], { ...design.bricks[1], rotation: 90 }] };
  const guide = createInstancedBrickModel(partial, false, { omitCoveredStuds: true });
  try { assertSurfaces(guide, partial, new Set(['Stud_0_0_0', 'Stud_0_0_1', 'Stud_0_1_0', 'Stud_0_1_1'])); }
  finally { guide.dispose(); }
});

test('imported, hollow, sloped and translucent geometry is retained in guide mode', async () => {
  const part: CatalogPart = JSON.parse(await readFile(new URL('./fixtures/catalog-3021.json', import.meta.url), 'utf8'));
  const catalog = { schemaVersion: 1 as const, parts: { [part.id]: part }, colors: {} };
  const specimens: Design[] = [
    { ...design, catalog, bricks: [{ ...design.bricks[0], partId: part.id }, design.bricks[1]] },
    { ...design, catalog, bricks: [design.bricks[0], { ...design.bricks[1], partId: part.id }] },
    { ...design, bricks: [{ ...design.bricks[0], partId: '3062b' }, { ...design.bricks[1], z: 3 }] },
    { ...design, bricks: [design.bricks[0], { ...design.bricks[1], partId: '3039' }] },
    { ...design, catalog: { schemaVersion: 1, parts: {}, colors: { 1: { ...COLORS[1], alpha: 0.5 } } } },
    { ...design, catalog: { schemaVersion: 1, parts: {}, colors: { 4: { ...COLORS[4], alpha: 0.5 } } } },
  ];
  for (const specimen of specimens) {
    const guide = createInstancedBrickModel(specimen, false, { omitCoveredStuds: true });
    try { assertSurfaces(guide, specimen); } finally { guide.dispose(); }
  }
});

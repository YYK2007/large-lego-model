import assert from 'node:assert/strict';
import test from 'node:test';
import { InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { createBrickModel, createInstancedBrickModel } from '../shared/brick-geometry.js';
import { CATALOG_VERSION, COORDINATE_SYSTEM, PARTS, WORKSPACE, type Design } from '../shared/model.js';

const design: Design = {
  id: 'render-test', title: 'Renderer specimen', description: '', source: 'sample', prompt: '', createdAt: '2026-10-10',
  schemaVersion: 2, catalogVersion: CATALOG_VERSION, coordinateSystem: COORDINATE_SYSTEM,
  bricks: [{ id: 'a', partId: '3003', colorId: 4, x: 5, y: 7, z: 9, rotation: 0 }],
};

function vertices(mesh: Mesh, transform: Matrix4) {
  const points = mesh.geometry.getAttribute('position'), index = mesh.geometry.index;
  return Array.from({ length: index?.count ?? points.count }, (_, i) => {
    const point = new Vector3().fromBufferAttribute(points, index ? index.getX(i) : i).applyMatrix4(transform);
    return point.toArray();
  });
}
function assertVerticesMatch(actual: number[][], expected: number[][], label: string) {
  assert.equal(actual.length, expected.length, `${label}: vertex count`);
  // Merging studs into Float32 geometry and storing instance translations adds
  // rounding that native meshes defer until rendering. Compare distances, not
  // rounded hashes: nearby points can lie on opposite rounding boundaries.
  // 1e-5 stud = 0.00008 mm, including the full 384-plate workspace height.
  for (let i = 0; i < expected.length; i++) for (let axis = 0; axis < 3; axis++) {
    assert.ok(Math.abs(actual[i][axis] - expected[i][axis]) <= 1e-5, `${label}: vertex ${i}, axis ${axis}`);
  }
}
const batches = (model: ReturnType<typeof createInstancedBrickModel>) => model.model.children.filter((item): item is InstancedMesh => item instanceof InstancedMesh && item.visible);

test('instanced rendering preserves every native body/stud vertex and catalog color at all four yaws', () => {
  for (const part of Object.values(PARTS)) for (const rotation of [0, 90, 180, 270] as const) for (const z of [9, WORKSPACE.heightPlates - part.heightPlates]) {
    const specimen = { ...design, bricks: [{ ...design.bricks[0], partId: part.id, rotation, z }] };
    const native = createBrickModel(specimen);
    native.updateMatrixWorld(true);
    const nativePoints: number[][] = [];
    native.traverse(object => { if (object instanceof Mesh) nativePoints.push(...vertices(object, object.matrixWorld)); });
    const web = createInstancedBrickModel(specimen);
    const meshes = batches(web);
    assert.equal(meshes.length, 1);
    const matrix = new Matrix4();
    meshes[0].getMatrixAt(0, matrix);
    assertVerticesMatch(vertices(meshes[0], matrix), nativePoints, `${part.id} at ${rotation} degrees, z=${z}`);
    const body = native.children[0].children[0] as Mesh;
    assert.equal((meshes[0].material as MeshStandardMaterial).color.getHex(), (body.material as MeshStandardMaterial).color.getHex());
    web.dispose();
  }
});

test('vertex equivalence rejects a real instance displacement', () => {
  const web = createInstancedBrickModel(design);
  const mesh = batches(web)[0], matrix = new Matrix4();
  mesh.getMatrixAt(0, matrix);
  const original = vertices(mesh, matrix);
  matrix.elements[12] += 0.001;
  assert.throws(() => assertVerticesMatch(vertices(mesh, matrix), original, 'Displaced instance'), /vertex 0, axis 0/);
  web.dispose();
});

test('1,024 repeated pieces use one solid draw batch and preserve every piece instance', () => {
  const bricks = Array.from({ length: 1024 }, (_, i) => ({ ...design.bricks[0], id: `b${i}`, x: (i % 8) * 2, y: (Math.floor(i / 8) % 8) * 2, z: Math.floor(i / 64) * 3 }));
  const web = createInstancedBrickModel({ ...design, bricks });
  assert.equal(batches(web).length, 1);
  assert.equal(batches(web)[0].count, 1024);
  web.update(['b0', 'b1', 'b2'], ['b2'], 'b2');
  const visible = batches(web);
  assert.equal(visible.reduce((sum, mesh) => sum + mesh.count, 0), 3);
  const solid = visible.find(mesh => !(mesh.material as { transparent: boolean }).transparent)!;
  const faded = visible.find(mesh => (mesh.material as { transparent: boolean }).transparent)!;
  assert.equal(solid.count, 1);
  assert.equal(faded.count, 2);
  const before = new Matrix4(), after = new Matrix4(), fadedBefore = new Matrix4(), fadedAfter = new Matrix4();
  solid.getMatrixAt(0, before); faded.getMatrixAt(0, fadedBefore);
  web.setLift(2);
  solid.getMatrixAt(0, after); faded.getMatrixAt(0, fadedAfter);
  assert.equal(after.elements[13] - before.elements[13], 2);
  assert.deepEqual(fadedAfter.elements, fadedBefore.elements, 'Only the active piece moves');
  web.setOffset(1.5, -0.2, 2);
  solid.getMatrixAt(0, after);
  assert.equal(after.elements[12] - before.elements[12], 1.5);
  assert.ok(Math.abs(after.elements[13] - before.elements[13] + 0.2) < 1e-7);
  assert.equal(after.elements[14] - before.elements[14], 2);
  web.setOffset(0, 0, 0);
  solid.getMatrixAt(0, after);
  assert.deepEqual(after.elements, before.elements, 'Checked placement animation restores the exact canonical pose');
  web.update();
  assert.equal(batches(web)[0].count, 1024);
  web.dispose();
});

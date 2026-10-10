import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { createBrickModel, createInstancedBrickModel } from '../shared/brick-geometry.js';
import { CATALOG_VERSION, COORDINATE_SYSTEM, PARTS, type Design } from '../shared/model.js';

const design: Design = {
  id: 'render-test', title: 'Renderer specimen', description: '', source: 'sample', prompt: '', createdAt: '2026-10-10',
  schemaVersion: 2, catalogVersion: CATALOG_VERSION, coordinateSystem: COORDINATE_SYSTEM,
  bricks: [{ id: 'a', partId: '3003', colorId: 4, x: 5, y: 7, z: 9, rotation: 0 }],
};

function vertices(mesh: Mesh, transform: Matrix4) {
  const points = mesh.geometry.getAttribute('position'), index = mesh.geometry.index;
  return Array.from({ length: index?.count ?? points.count }, (_, i) => {
    const point = new Vector3().fromBufferAttribute(points, index ? index.getX(i) : i).applyMatrix4(transform);
    return point.toArray().map(value => Math.round(value * 1e5)).join(',');
  });
}
const signature = (points: string[]) => createHash('sha256').update(points.sort().join(';')).digest('hex');
const batches = (model: ReturnType<typeof createInstancedBrickModel>) => model.model.children.filter((item): item is InstancedMesh => item instanceof InstancedMesh && item.visible);

test('instanced rendering preserves every native body/stud vertex and catalog color at all four yaws', () => {
  for (const part of Object.values(PARTS)) for (const rotation of [0, 90, 180, 270] as const) {
    const specimen = { ...design, bricks: [{ ...design.bricks[0], partId: part.id, rotation }] };
    const native = createBrickModel(specimen);
    native.updateMatrixWorld(true);
    const nativePoints: string[] = [];
    native.traverse(object => { if (object instanceof Mesh) nativePoints.push(...vertices(object, object.matrixWorld)); });
    const web = createInstancedBrickModel(specimen);
    const meshes = batches(web);
    assert.equal(meshes.length, 1);
    const matrix = new Matrix4();
    meshes[0].getMatrixAt(0, matrix);
    assert.equal(signature(vertices(meshes[0], matrix)), signature(nativePoints), `${part.id} at ${rotation} degrees`);
    const body = native.children[0].children[0] as Mesh;
    assert.equal((meshes[0].material as MeshStandardMaterial).color.getHex(), (body.material as MeshStandardMaterial).color.getHex());
    web.dispose();
  }
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
  web.update();
  assert.equal(batches(web)[0].count, 1024);
  web.dispose();
});

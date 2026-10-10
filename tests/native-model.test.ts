import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Color, Matrix3, Matrix4, Vector3 } from 'three';
import { generateUsdz } from '../server/native-model.js';
import { CATALOG_VERSION, COLORS, COORDINATE_SYSTEM, PARTS, normalizeDesign, partTopStuds, type Design } from '../shared/model.js';
import { SAMPLE_DESIGNS } from '../shared/examples.js';
import { ROOF_SAMPLE } from '../shared/roof-sample.js';

const design: Design = {
  id: 'native-test', title: 'Native model', description: 'Native export test.', source: 'sample',
  prompt: 'A pair of bricks', createdAt: '2026-10-10T12:00:00.000Z',
  bricks: [
    { id: 'base', partId: '3001', colorId: 4, x: 5, y: 7, z: 0, rotation: 0 },
    { id: 'top', partId: '3001', colorId: 1, x: 5, y: 7, z: 1, rotation: 90 },
  ],
};
const v2 = { schemaVersion: 2, catalogVersion: CATALOG_VERSION, coordinateSystem: COORDINATE_SYSTEM } as const;

// USDZ requires uncompressed ZIP entries aligned to 64 bytes. Inspect the
// actual artifact rather than just testing the scene that fed the exporter.
function archiveFiles(archive: Buffer): Map<string, string> {
  const files = new Map<string, string>();
  let offset = 0;
  while (archive.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(archive.readUInt16LE(offset + 8), 0, 'USDZ entry must be uncompressed');
    const size = archive.readUInt32LE(offset + 18);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const name = archive.subarray(offset + 30, offset + 30 + nameLength).toString();
    const start = offset + 30 + nameLength + extraLength;
    assert.equal(start % 64, 0, 'USDZ entry must be 64-byte aligned');
    files.set(name, archive.subarray(start, start + size).toString());
    offset = start + size;
  }
  assert.equal(archive.readUInt32LE(offset), 0x02014b50, 'ZIP central directory must follow file entries');
  assert.equal(files.keys().next().value, 'model.usda');
  return files;
}

const numbers = (text: string): number[] => [...text.matchAll(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)].map(match => Number(match[0]));

function exportedMeshes(files: Map<string, string>): { name: string; transform: Matrix4; bounds: Box3; vertices: Vector3[]; normals: Vector3[] }[] {
  const model = files.get('model.usda')!;
  const root = model.match(/def Xform "BrickModel"\s*\{\s*matrix4d xformOp:transform = ([^\n]+)/)!;
  assert.ok(root, 'Model scale transform exists');
  const rootTransform = new Matrix4().fromArray(numbers(root[1]));
  return [...model.matchAll(/def Xform "((?:Body|Stud)_[^"]+)" \(\s*prepend references = @\.\/([^@]+)@[\s\S]*?matrix4d xformOp:transform = ([^\n]+)/g)].map(match => {
    const geometry = files.get(match[2]);
    assert.ok(geometry, `Geometry reference ${match[2]} resolves within archive`);
    const points = geometry.match(/point3f\[\] points = \[([^\]]+)\]/)!;
    assert.ok(points, 'Geometry contains vertex positions');
    const transform = rootTransform.clone().multiply(new Matrix4().fromArray(numbers(match[3])));
    const values = numbers(points[1]);
    assert.equal(values.length % 3, 0);
    const bounds = new Box3();
    const vertices: Vector3[] = [];
    for (let i = 0; i < values.length; i += 3) {
      const point = new Vector3(...values.slice(i, i + 3) as [number, number, number]).applyMatrix4(transform);
      bounds.expandByPoint(point); vertices.push(point);
    }
    const normalValues = numbers(geometry.match(/normal3f\[\] normals = \[([^\]]+)\]/)![1]);
    const normalMatrix = new Matrix3().getNormalMatrix(transform);
    const normals: Vector3[] = [];
    for (let i = 0; i < normalValues.length; i += 3) normals.push(new Vector3(...normalValues.slice(i, i + 3) as [number, number, number]).applyNormalMatrix(normalMatrix));
    return { name: match[1], transform, bounds, vertices, normals };
  });
}

function close(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-8, `Expected ${expected}, received ${actual}`);
}

test('USDZ runs in Node, includes every body and stud, and declares upright metric units', async () => {
  assert.equal(typeof document, 'undefined');
  assert.equal(typeof window, 'undefined');
  const files = archiveFiles(await generateUsdz(design));
  const model = files.get('model.usda')!;
  assert.match(model, /metersPerUnit = 1\s+upAxis = "Y"/);
  assert.match(model, /planeAnchoring:alignment = "horizontal"/);
  const meshes = exportedMeshes(files);
  assert.equal(meshes.filter(mesh => mesh.name.startsWith('Body')).length, 2);
  assert.equal(meshes.filter(mesh => mesh.name.startsWith('Stud')).length, 16);
  assert.equal((model.match(/def Material /g) ?? []).length, 2);
  assert.ok([...files.keys()].every(name => name.endsWith('.usda')), 'Untextured model needs no browser canvas or external assets');
  assert.doesNotMatch(model, /Camera|Light|Pedestal|Grid|Texture/i);
});

test('actual archived geometry preserves 8 mm stud pitch, 9.6 mm layers, and rotated footprints', async () => {
  const meshes = exportedMeshes(archiveFiles(await generateUsdz(design)));
  const base = meshes.find(mesh => mesh.name === 'Body_0')!;
  const top = meshes.find(mesh => mesh.name === 'Body_1')!;
  const baseSize = base.bounds.getSize(new Vector3());
  const topSize = top.bounds.getSize(new Vector3());
  close(baseSize.x, 0.01568); close(baseSize.y, 0.00936); close(baseSize.z, 0.03168);
  close(topSize.x, 0.03168); close(topSize.z, 0.01568);
  close(top.bounds.min.y - base.bounds.min.y, 0.0096);
  close(base.bounds.min.y, 0.00004);
  const stud0 = meshes.find(mesh => mesh.name === 'Stud_0_0_0')!;
  const stud1 = meshes.find(mesh => mesh.name === 'Stud_0_1_0')!;
  close(stud1.bounds.getCenter(new Vector3()).x - stud0.bounds.getCenter(new Vector3()).x, 0.008);
  const all = meshes.reduce((bounds, mesh) => bounds.union(mesh.bounds), new Box3());
  close(all.min.x + all.max.x, 0); close(all.min.z + all.max.z, 0);
  close(all.max.y, 0.02072);
});

test('every catalog part at all four yaws exports the correct number of actual top studs', async () => {
  for (const part of Object.values(PARTS)) for (const rotation of [0, 90, 180, 270] as const) {
    const one = { ...design, ...v2, bricks: [{ ...design.bricks[0], partId: part.id, rotation }] };
    const meshes = exportedMeshes(archiveFiles(await generateUsdz(one)));
    assert.equal(meshes.length, 1 + (part.kind === 'tile' ? 0 : part.kind === 'slope' ? part.width : part.width * part.depth), `${part.id} at ${rotation} degrees`);
  }
});

test('sample builds have no missing geometry references or meshes', async () => {
  for (const sample of SAMPLE_DESIGNS) {
    const meshes = exportedMeshes(archiveFiles(await generateUsdz(sample)));
    const expected = normalizeDesign(sample).bricks.reduce((sum, brick) => sum + 1 + partTopStuds(brick).length, 0);
    assert.equal(meshes.length, expected, sample.title);
  }
});

test('stacked plates occupy 3.2 mm each and support full bricks at the canonical height', async () => {
  const stack: Design = { ...design, ...v2, bricks: [
    { ...design.bricks[0], id: 'plate-a', partId: '3022', z: 0 },
    { ...design.bricks[0], id: 'plate-b', partId: '3022', z: 1 },
    { ...design.bricks[0], id: 'brick', partId: '3003', z: 2 },
  ] };
  const bodies = exportedMeshes(archiveFiles(await generateUsdz(stack))).filter(mesh => mesh.name.startsWith('Body'));
  close(bodies[0].bounds.getSize(new Vector3()).y, 0.00296); // nominal 3.2 mm less cosmetic seam
  close(bodies[1].bounds.min.y - bodies[0].bounds.min.y, 0.0032);
  close(bodies[2].bounds.min.y - bodies[1].bounds.min.y, 0.0032);
  close(bodies[2].bounds.getSize(new Vector3()).y, 0.00936);
});

test('narrow plates retain their independent metric dimensions and 8 mm stud pitch in USDZ', async () => {
  for (const [partId, length] of [['3024', 1], ['3023', 2], ['3623', 3], ['3710', 4]] as const) {
    for (const rotation of [0, 90, 180, 270] as const) {
      const one: Design = { ...design, ...v2, bricks: [{ ...design.bricks[0], partId, rotation }] };
      const meshes = exportedMeshes(archiveFiles(await generateUsdz(one)));
      const body = meshes.find(mesh => mesh.name.startsWith('Body'))!;
      const size = body.bounds.getSize(new Vector3());
      close(size.y, 0.0032 - 0.00024);
      close(size.x, (rotation % 180 ? length : 1) * 0.008 - 0.00032);
      close(size.z, (rotation % 180 ? 1 : length) * 0.008 - 0.00032);
      const studs = meshes.filter(mesh => mesh.name.startsWith('Stud')).map(mesh => mesh.bounds.getCenter(new Vector3()));
      assert.equal(studs.length, length);
      studs.sort((a, b) => rotation % 180 ? a.x - b.x : a.z - b.z);
      for (let i = 1; i < studs.length; i++) close(studs[i].distanceTo(studs[i - 1]), 0.008);
    }
  }
});

test('the assembled plate-and-slope specimen exports every connector at the right total height', async () => {
  const meshes = exportedMeshes(archiveFiles(await generateUsdz(ROOF_SAMPLE)));
  assert.equal(meshes.filter(mesh => mesh.name.startsWith('Body')).length, 13);
  assert.equal(meshes.filter(mesh => mesh.name.startsWith('Stud')).length, 64);
  close(Math.max(...meshes.map(mesh => mesh.bounds.max.y)), 0.03032);
});

test('slope ramp, rear studs, and outward face normals survive all four yaw exports', async () => {
  for (const rotation of [0, 90, 180, 270] as const) {
    const slope: Design = { ...design, ...v2, bricks: [{ ...design.bricks[0], partId: '3039', rotation }] };
    const meshes = exportedMeshes(archiveFiles(await generateUsdz(slope)));
    const body = meshes.find(mesh => mesh.name === 'Body_0')!;
    const horizontalAxis = rotation === 0 || rotation === 180 ? 'z' : 'x';
    const front = rotation === 0 || rotation === 270 ? body.bounds.min[horizontalAxis] : body.bounds.max[horizontalAxis];
    const frontVertices = body.vertices.filter(point => Math.abs(point[horizontalAxis] - front) < 1e-8);
    close(Math.max(...frontVertices.map(point => point.y)), 0.0016);
    close(body.bounds.max.y, 0.0094);
    const studSide = rotation === 0 || rotation === 270 ? 0.004 : -0.004;
    const studs = meshes.filter(mesh => mesh.name.startsWith('Stud'));
    assert.equal(studs.length, 2);
    for (const stud of studs) close(stud.bounds.getCenter(new Vector3())[horizontalAxis], studSide);
    const interior = body.vertices.reduce((sum, point) => sum.add(point), new Vector3()).divideScalar(body.vertices.length);
    for (let i = 0; i < body.vertices.length; i += 3) {
      const [a, b, c] = body.vertices.slice(i, i + 3);
      const cross = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
      assert.ok(cross.dot(body.normals[i]) > 0.999, 'Face winding agrees with exported normal');
      assert.ok(cross.dot(a.clone().sub(interior)) > 0, 'Face points outside the slope');
    }
  }
});

test('legacy and normalized V2 designs export identical world-space body and stud bounds', async () => {
  const original = structuredClone(design);
  const legacy = exportedMeshes(archiveFiles(await generateUsdz(design)));
  const canonical = exportedMeshes(archiveFiles(await generateUsdz(normalizeDesign(design))));
  assert.deepEqual(legacy.map(mesh => [mesh.name, mesh.bounds.min.toArray(), mesh.bounds.max.toArray()]), canonical.map(mesh => [mesh.name, mesh.bounds.min.toArray(), mesh.bounds.max.toArray()]));
  assert.deepEqual(design, original, 'Export does not rewrite the legacy input');
});

test('native materials retain catalog colors for new part families', async () => {
  for (const color of Object.values(COLORS)) {
    const slope: Design = { ...design, ...v2, bricks: [{ ...design.bricks[0], partId: '3039', colorId: color.id }] };
    const model = archiveFiles(await generateUsdz(slope)).get('model.usda')!;
    const exported = numbers(model.match(/color3f inputs:diffuseColor = \(([^)]+)\)/)![1]);
    const expected = new Color(color.hex).toArray();
    exported.forEach((value, axis) => assert.ok(Math.abs(value - expected[axis]) < 1e-5));
  }
});

test('invalid geometry is rejected before export', async () => {
  await assert.rejects(generateUsdz({ ...design, bricks: [] }), /invalid design.*at least one brick/);
  await assert.rejects(generateUsdz({ ...design, bricks: [...design.bricks, { ...design.bricks[0], id: 'collision' }] }), /invalid design.*overlap/);
});

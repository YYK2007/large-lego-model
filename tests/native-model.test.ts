import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Matrix4, Vector3 } from 'three';
import { generateUsdz } from '../server/native-model.js';
import { PARTS, type Design } from '../shared/model.js';
import { SAMPLE_DESIGNS } from '../shared/examples.js';

const design: Design = {
  id: 'native-test', title: 'Native model', description: 'Native export test.', source: 'sample',
  prompt: 'A pair of bricks', createdAt: '2026-10-10T12:00:00.000Z',
  bricks: [
    { id: 'base', partId: '3001', colorId: 4, x: 5, y: 7, z: 0, rotation: 0 },
    { id: 'top', partId: '3001', colorId: 1, x: 5, y: 7, z: 1, rotation: 90 },
  ],
};

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

function exportedMeshes(files: Map<string, string>): { name: string; transform: Matrix4; bounds: Box3 }[] {
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
    for (let i = 0; i < values.length; i += 3) bounds.expandByPoint(new Vector3(...values.slice(i, i + 3) as [number, number, number]).applyMatrix4(transform));
    return { name: match[1], transform, bounds };
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

test('every catalog part in either rotation exports with all studs', async () => {
  for (const part of Object.values(PARTS)) for (const rotation of [0, 90] as const) {
    const one = { ...design, bricks: [{ ...design.bricks[0], partId: part.id, rotation }] };
    const meshes = exportedMeshes(archiveFiles(await generateUsdz(one)));
    assert.equal(meshes.length, 1 + part.width * part.depth, `${part.id} at ${rotation} degrees`);
  }
});

test('sample builds have no missing geometry references or meshes', async () => {
  for (const sample of SAMPLE_DESIGNS) {
    const meshes = exportedMeshes(archiveFiles(await generateUsdz(sample)));
    const expected = sample.bricks.reduce((sum, brick) => sum + 1 + PARTS[brick.partId].width * PARTS[brick.partId].depth, 0);
    assert.equal(meshes.length, expected, sample.title);
  }
});

test('invalid geometry is rejected before export', async () => {
  await assert.rejects(generateUsdz({ ...design, bricks: [] }), /invalid design.*at least one brick/);
  await assert.rejects(generateUsdz({ ...design, bricks: [...design.bricks, { ...design.bricks[0], id: 'collision' }] }), /invalid design.*overlap/);
});

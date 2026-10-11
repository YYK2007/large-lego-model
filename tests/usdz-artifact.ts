import assert from 'node:assert/strict';
import { Box3, Matrix3, Matrix4, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { createBrickModel, METERS_PER_STUD } from '../shared/brick-geometry.js';
import type { Design } from '../shared/model.js';

export function archiveFiles(archive: Buffer): Map<string, string> {
  const files = new Map<string, string>();
  let offset = 0;
  while (archive.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(archive.readUInt16LE(offset + 8), 0, 'USDZ entries are uncompressed');
    const size = archive.readUInt32LE(offset + 18);
    const nameLength = archive.readUInt16LE(offset + 26);
    const start = offset + 30 + nameLength + archive.readUInt16LE(offset + 28);
    assert.equal(start % 64, 0, 'USDZ entries are aligned');
    files.set(archive.subarray(offset + 30, offset + 30 + nameLength).toString(), archive.subarray(start, start + size).toString());
    offset = start + size;
  }
  assert.equal(archive.readUInt32LE(offset), 0x02014b50);
  assert.equal(files.keys().next().value, 'model.usda');
  return files;
}

const numbers = (value: string): number[] => Array.from(value.matchAll(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi), match => Number(match[0]));

export function inspectUsdz(files: Map<string, string>) {
  const model = files.get('model.usda')!;
  assert.match(model, /metersPerUnit = 1\s+upAxis = "Y"/);
  const root = model.match(/def Xform "BrickModel"\s*\{\s*matrix4d xformOp:transform = ([^\n]+)/)!;
  assert.ok(root, 'Metric root transform exists');
  const rootTransform = new Matrix4().fromArray(numbers(root[1]));
  assert.deepEqual(rootTransform.elements, [.008, 0, 0, 0, 0, .008, 0, 0, 0, 0, .008, 0, 0, 0, 0, 1]);
  const materials = new Map(Array.from(model.matchAll(/def Material "([^"]+)"[\s\S]*?color3f inputs:diffuseColor = \(([^)]+)\)/g), match => [match[1], numbers(match[2])]));
  const meshes = Array.from(model.matchAll(/def Xform "((?:Body|Stud|Color)_[^"]+)" \(\s*prepend references = @\.\/([^@]+)@[\s\S]*?matrix4d xformOp:transform = ([^\n]+)[\s\S]*?rel material:binding = <\/Materials\/([^>]+)>/g), match => {
    const geometry = files.get(match[2]);
    assert.ok(geometry, `Geometry ${match[2]} resolves`);
    const positions = Float64Array.from(numbers(geometry.match(/point3f\[\] points = \[([^\]]+)\]/)![1]));
    const normals = Float64Array.from(numbers(geometry.match(/normal3f\[\] normals = \[([^\]]+)\]/)![1]));
    const indices = Uint32Array.from(numbers(geometry.match(/int\[\] faceVertexIndices = \[([^\]]+)\]/)![1]));
    const faceCounts = numbers(geometry.match(/int\[\] faceVertexCounts = \[([^\]]+)\]/)![1]);
    assert.equal(positions.length % 3, 0);
    assert.equal(normals.length, positions.length);
    assert.ok(faceCounts.every(count => count === 3), 'All exported faces are triangles');
    assert.equal(indices.length, faceCounts.length * 3);
    const transform = rootTransform.clone().multiply(new Matrix4().fromArray(numbers(match[3])));
    const color = materials.get(match[4]);
    assert.ok(color, 'Each mesh has a material');
    return { name: match[1], positions, normals, indices, transform, normalMatrix: new Matrix3().getNormalMatrix(transform), color };
  });
  assert.ok(meshes.length > 0);
  assert.equal(meshes.length, Array.from(model.matchAll(/prepend references = /g)).length, 'Every geometry reference is inspected');
  return { model, meshes };
}

export type ExportedPart = { name: string; transform: Matrix4; bounds: Box3; vertices: Vector3[]; normals: Vector3[] };

// Verify the actual exported triangle stream against canonical geometry. Splitting
// it into parts here preserves the independent metric/shape tests after batching.
export function verifyBatchedUsdz(files: Map<string, string>, design: Design, collectParts = true) {
  const { meshes } = inspectUsdz(files);
  assert.ok(meshes.every(mesh => mesh.name.startsWith('Color_')), 'Native export batches by color');
  const source = createBrickModel(design);
  source.scale.setScalar(METERS_PER_STUD);
  source.updateMatrixWorld(true);
  const offsets = new Map(meshes.map(mesh => [mesh, 0]));
  const parts: ExportedPart[] = [];
  let bodies = 0, studs = 0, checkedCorners = 0;
  const expectedPoint = new Vector3(), actualPoint = new Vector3();
  const expectedNormal = new Vector3(), actualNormal = new Vector3();
  const resources = new Set<Mesh['geometry'] | MeshStandardMaterial>();
  try {
    source.traverse(object => {
      if (!(object instanceof Mesh)) return;
      const material = object.material as MeshStandardMaterial;
      resources.add(object.geometry); resources.add(material);
      const color = material.color.toArray();
      const matches = meshes.filter(mesh => mesh.color.every((value, axis) => Math.abs(value - color[axis]) < 1e-6));
      assert.ok(matches.length > 0, `Exported batches exist for ${object.name}'s color`);
      const batch = matches.find(mesh => offsets.get(mesh)! < mesh.indices.length);
      assert.ok(batch, `No missing geometry for ${object.name}`);
      const position = object.geometry.getAttribute('position'), normal = object.geometry.getAttribute('normal');
      const index = object.geometry.index;
      const normalMatrix = new Matrix3().getNormalMatrix(object.matrixWorld);
      const part: ExportedPart = { name: object.name, transform: batch.transform, bounds: new Box3(), vertices: [], normals: [] };
      let offset = offsets.get(batch)!;
      for (let corner = 0; corner < (index?.count ?? position.count); corner++) {
        const sourceIndex = index ? index.getX(corner) : corner;
        assert.ok(offset < batch.indices.length, `No missing triangles for ${object.name}`);
        const actualIndex: number = batch.indices[offset++];
        assert.ok(actualIndex * 3 + 2 < batch.positions.length, 'Vertex index resolves');
        expectedPoint.fromBufferAttribute(position, sourceIndex).applyMatrix4(object.matrixWorld);
        actualPoint.fromArray(batch.positions, actualIndex * 3).applyMatrix4(batch.transform);
        assert.ok(actualPoint.distanceTo(expectedPoint) < 8e-8, `${object.name} triangle corner retains canonical placement`);
        expectedNormal.fromBufferAttribute(normal, sourceIndex).applyNormalMatrix(normalMatrix);
        actualNormal.fromArray(batch.normals, actualIndex * 3).applyNormalMatrix(batch.normalMatrix);
        assert.ok(actualNormal.distanceTo(expectedNormal) < 1e-5, `${object.name} normal is preserved`);
        if (collectParts && !part.vertices[sourceIndex]) {
          part.vertices[sourceIndex] = actualPoint.clone();
          part.normals[sourceIndex] = actualNormal.clone();
          part.bounds.expandByPoint(actualPoint);
        }
        checkedCorners++;
      }
      offsets.set(batch, offset);
      if (collectParts) parts.push(part);
      if (object.name.startsWith('Body')) bodies++; else studs++;
    });
    for (const batch of meshes) assert.equal(offsets.get(batch), batch.indices.length, 'No invented triangles');
    return { parts, meshes: meshes.length, bodies, studs, triangles: checkedCorners / 3 };
  } finally {
    resources.forEach(resource => resource.dispose());
  }
}

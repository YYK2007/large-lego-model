import { Box3, BufferGeometry, Group, Material, Matrix4, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createBrickModel, METERS_PER_STUD } from '../shared/brick-geometry.js';
import { validateDesign, type Design } from '../shared/model.js';

// The exporter builds each geometry layer as a JS string. Split large colors
// well below V8's string limit; this bounds a batch, never the design's pieces.
const MAX_BATCH_CORNERS = 1_000_000;
// Beyond this stream size, repeated detailed parts dominate the uncompressed
// archive. Reuse one body+stud geometry per part/yaw instead of baking copies.
const MAX_BAKED_CORNERS = 3_000_000;

export async function generateUsdz(design: Design): Promise<Buffer> {
  const validation = validateDesign(design);
  if (!validation.valid) throw new Error(`Cannot export invalid design: ${validation.errors.join(' ')}`);
  const source = createBrickModel(design);
  source.updateMatrixWorld(true);
  const resources = new Set<BufferGeometry | Material>();
  let corners = 0;
  source.traverse(object => {
    if (!(object instanceof Mesh)) return;
    corners += object.geometry.index?.count ?? object.geometry.getAttribute('position').count;
    resources.add(object.geometry);
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach(material => resources.add(material));
  });
  const model = new Group();
  model.name = 'BrickModel';
  // USDZExporter declares metersPerUnit=1 and Y-up. Convert the same upright
  // geometry used by the web viewer from stud units to meters before export.
  model.scale.setScalar(METERS_PER_STUD);
  try {
    if (corners > MAX_BAKED_CORNERS) {
      const shapes = new Map<BufferGeometry, BufferGeometry>();
      source.children.forEach((brick, index) => {
        const body = brick.children[0] as Mesh;
        const origin = new Vector3().setFromMatrixPosition(body.matrixWorld);
        let geometry = shapes.get(body.geometry);
        if (!geometry) {
          const shift = new Matrix4().makeTranslation(-origin.x, -origin.y, -origin.z);
          const parts = brick.children.map(child => {
            const mesh = child as Mesh;
            const part = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
            resources.add(part);
            part.deleteAttribute('uv');
            return part.applyMatrix4(new Matrix4().multiplyMatrices(shift, mesh.matrixWorld));
          });
          const merged = mergeGeometries(parts);
          if (!merged) throw new Error('Cannot combine native brick geometry.');
          resources.add(merged);
          geometry = mergeVertices(merged, 1e-8);
          resources.add(geometry);
          for (const part of [...parts, merged]) { part.dispose(); resources.delete(part); }
          shapes.set(body.geometry, geometry);
        }
        // USDZExporter writes a shared BufferGeometry once, then references it
        // from each separately colored/positioned mesh. Local vertices stay near
        // zero, with the exact placement retained in the double-precision Xform.
        const mesh = new Mesh(geometry, body.material);
        mesh.position.copy(origin);
        mesh.name = `Piece_${index}`;
        model.add(mesh);
      });
      model.updateMatrixWorld(true);
      return Buffer.from(await new USDZExporter().parseAsync(model, { quickLookCompatible: true }));
    }
    // Quick Look pays for every mesh, even when pieces share their geometry.
    // Bake placements into a few indexed meshes per color. Index each distinct
    // source shape once so large builds avoid expanding every stud triangle.
    const shapes = new Map<BufferGeometry, BufferGeometry>();
    type Batch = { parts: { shape: BufferGeometry; transform: Matrix4 }[]; corners: number; bounds: Box3 };
    const batches = new Map<MeshStandardMaterial, Batch[]>();
    source.traverse(object => {
      if (!(object instanceof Mesh)) return;
      const material = object.material as MeshStandardMaterial;
      let shape = shapes.get(object.geometry);
      if (!shape) {
        const copy = object.geometry.clone();
        resources.add(copy);
        copy.deleteAttribute('uv'); // Untextured bodies and studs need matching attributes.
        shape = mergeVertices(copy, 1e-8);
        if (!shape) throw new Error('Cannot index native brick geometry.');
        shape.computeBoundingBox();
        resources.add(shape);
        shapes.set(object.geometry, shape);
      }
      const colorBatches = batches.get(material) ?? [];
      const corners = shape.index!.count;
      let batch = colorBatches.at(-1);
      if (!batch || batch.corners + corners > MAX_BATCH_CORNERS) {
        batch = { parts: [], corners: 0, bounds: new Box3() };
        colorBatches.push(batch);
      }
      batch.parts.push({ shape, transform: object.matrixWorld });
      batch.bounds.union(shape.boundingBox!.clone().applyMatrix4(object.matrixWorld));
      batch.corners += corners;
      batches.set(material, colorBatches);
    });
    for (const [material, colorBatches] of batches) {
      colorBatches.forEach(({ parts, bounds }, index) => {
        // Keep local vertices near zero before Float32/USDA rounding, including
        // at maximum workspace height. The mesh transform restores the origin.
        const origin = bounds.getCenter(new Vector3());
        const shift = new Matrix4().makeTranslation(-origin.x, -origin.y, -origin.z);
        const positioned = parts.map(({ shape, transform }) => {
          const part = shape.clone().applyMatrix4(new Matrix4().multiplyMatrices(shift, transform));
          resources.add(part);
          return part;
        });
        const geometry = mergeGeometries(positioned);
        if (!geometry) throw new Error('Cannot combine native brick geometry.');
        resources.add(geometry);
        positioned.forEach(part => { part.dispose(); resources.delete(part); });
        parts.length = 0;
        const mesh = new Mesh(geometry, material);
        mesh.position.copy(origin);
        mesh.name = `Color_${material.color.getHexString()}_${index}`;
        model.add(mesh);
      });
    }
    model.updateMatrixWorld(true);
    return Buffer.from(await new USDZExporter().parseAsync(model, { quickLookCompatible: true }));
  } finally {
    resources.forEach(resource => resource.dispose());
  }
}

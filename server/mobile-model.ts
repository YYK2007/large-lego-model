import { Box3, BufferGeometry, Group, Material, Matrix4, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js';
import { createBrickModel, METERS_PER_STUD } from '../shared/brick-geometry.js';
import { catalogForDesign, normalizeDesign, validateDesign, type Design } from '../shared/model.js';
import { ordinaryStudCovers } from '../shared/covered-studs.js';
import { addUsdzAttribution, compactUsdz } from './usdz-package.js';

export type MobileModelReport = {
  viewingOnly: true; approximation: string;
  bodies: number; studs: number; omittedCoveredStuds: number;
  originalTriangles: number; triangles: number; meshes: number;
};

/** Optional viewing derivative. Every body and every exposed/imported stud stays
 * exact. Covered ordinary studs are omitted, including their tiny side bands
 * visible through the renderer's cosmetic interlayer gaps. Never use this mesh
 * for the BOM, assembly checks or the full canonical model download.
 */
export function createMobileModel(input: Design): { model: Group; report: MobileModelReport; dispose: () => void } {
  const checked = validateDesign(input);
  if (!checked.valid) throw new Error(`Cannot export invalid design: ${checked.errors.join(' ')}`);
  const design = normalizeDesign(input), catalog = catalogForDesign(design);
  const omitted = ordinaryStudCovers(design, catalog);
  const source = createBrickModel(design);
  source.updateMatrixWorld(true);
  const resources = new Set<BufferGeometry | Material>();
  const model = new Group(); model.name = 'BrickModel'; model.scale.setScalar(METERS_PER_STUD);
  const report: MobileModelReport = {
    viewingOnly: true,
    approximation: 'Ordinary studs covered by opaque rectangular parts are omitted, including tiny stud bands in cosmetic interlayer gaps. All bodies, exposed studs and imported geometry retain their canonical placements and colors.',
    bodies: 0, studs: 0, omittedCoveredStuds: 0, originalTriangles: 0, triangles: 0, meshes: 0,
  };
  const dispose = () => { resources.forEach(resource => resource.dispose()); };
  try {
    type Batch = { parts: { shape: BufferGeometry; transform: Matrix4 }[]; corners: number; bounds: Box3 };
    const batches = new Map<MeshStandardMaterial, Batch[]>();
    const shapes = new Map<BufferGeometry, BufferGeometry>();
    source.traverse(object => {
      if (!(object instanceof Mesh)) return;
      const material = object.material as MeshStandardMaterial;
      resources.add(object.geometry); resources.add(material);
      const corners = object.geometry.index?.count ?? object.geometry.getAttribute('position').count;
      report.originalTriangles += corners / 3;
      if (omitted.has(object.name)) { report.omittedCoveredStuds++; return; }
      if (object.name.startsWith('Body_')) report.bodies++; else report.studs++;
      report.triangles += corners / 3;
      let shape = shapes.get(object.geometry);
      if (!shape) {
        const copy = object.geometry.clone(); copy.deleteAttribute('uv');
        shape = mergeVertices(copy, 1e-8); copy.dispose();
        shape.computeBoundingBox(); resources.add(shape); shapes.set(object.geometry, shape);
      }
      const colorBatches = batches.get(material) ?? [];
      let batch = colorBatches.at(-1);
      if (!batch || batch.corners + corners > 1_000_000) {
        batch = { parts: [], corners: 0, bounds: new Box3() }; colorBatches.push(batch);
      }
      batch.parts.push({ shape, transform: object.matrixWorld }); batch.corners += corners;
      batch.bounds.union(shape.boundingBox!.clone().applyMatrix4(object.matrixWorld));
      batches.set(material, colorBatches);
    });
    for (const [material, colorBatches] of batches) colorBatches.forEach(({ parts, bounds }, index) => {
      const origin = bounds.getCenter(new Vector3());
      const shift = new Matrix4().makeTranslation(-origin.x, -origin.y, -origin.z);
      const positioned = parts.map(({ shape, transform }) => {
        const geometry = shape.clone().applyMatrix4(new Matrix4().multiplyMatrices(shift, transform));
        resources.add(geometry); return geometry;
      });
      const geometry = mergeGeometries(positioned);
      if (!geometry) throw new Error('Cannot combine lightweight viewing geometry.');
      resources.add(geometry);
      positioned.forEach(part => { part.dispose(); resources.delete(part); });
      const mesh = new Mesh(geometry, material); mesh.position.copy(origin);
      mesh.name = `Color_${material.color.getHexString()}_${index}`; model.add(mesh);
    });
    model.updateMatrixWorld(true); report.meshes = model.children.length;
    return { model, report, dispose };
  } catch (error) { dispose(); throw error; }
}

export async function generateMobileUsdz(design: Design): Promise<{ bytes: Buffer; report: MobileModelReport }> {
  const prepared = createMobileModel(design);
  try {
    let bytes: Buffer = addUsdzAttribution(Buffer.from(await new USDZExporter().parseAsync(prepared.model, { quickLookCompatible: true })), design, true);
    try { bytes = await compactUsdz(bytes); }
    catch { console.error('Binary USDZ preparation failed; keeping the portable lightweight viewing model.'); }
    return { bytes, report: prepared.report };
  } finally { prepared.dispose(); }
}

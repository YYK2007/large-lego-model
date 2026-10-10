import { Mesh } from 'three';
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js';
import { createBrickModel, METERS_PER_STUD } from '../shared/brick-geometry.js';
import { validateDesign, type Design } from '../shared/model.js';

export async function generateUsdz(design: Design): Promise<Buffer> {
  const validation = validateDesign(design);
  if (!validation.valid) throw new Error(`Cannot export invalid design: ${validation.errors.join(' ')}`);
  const model = createBrickModel(design);
  // USDZExporter declares metersPerUnit=1 and Y-up. Convert the same upright
  // geometry used by the web viewer from stud units to meters before export.
  model.scale.setScalar(METERS_PER_STUD);
  model.updateMatrixWorld(true);
  try {
    return Buffer.from(await new USDZExporter().parseAsync(model, { quickLookCompatible: true }));
  } finally {
    model.traverse(object => {
      if (object instanceof Mesh) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach(material => material.dispose());
      }
    });
  }
}

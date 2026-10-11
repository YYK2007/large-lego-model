import { footprint, partTopStuds, type Brick, type CatalogContext, type Design } from './model.js';

export function canOmitOrdinaryStuds(brick: Brick, catalog: CatalogContext): boolean {
  const part = catalog.parts[brick.partId];
  return !part.geometry && ['brick', 'plate'].includes(part.kind) && part.topStudStyle !== 'hollow'
    && (catalog.colors[brick.colorId].alpha ?? 1) === 1;
}

/** Potential covers only. Viewing renderers must also require visible, settled,
 * opaque covers. Omitting these studs removes tiny bands in cosmetic seams;
 * it is not a change to canonical geometry, assembly checks or the BOM.
 */
export function ordinaryStudCovers(design: Design, catalog: CatalogContext): Map<string, string[]> {
  const covers = new Map<string, string[]>();
  const siteKey = (x: number, y: number, z: number) => `${x},${y},${z}`;
  for (const brick of design.bricks) {
    const part = catalog.parts[brick.partId];
    if (part.geometry || !['brick', 'plate', 'tile'].includes(part.kind) || (catalog.colors[brick.colorId].alpha ?? 1) !== 1) continue;
    const { width, depth } = footprint(brick, catalog);
    for (let x = 0; x < width; x++) for (let y = 0; y < depth; y++) {
      const key = siteKey(brick.x + x + 0.5, brick.y + y + 0.5, brick.z);
      const ids = covers.get(key) ?? []; ids.push(brick.id); covers.set(key, ids);
    }
  }
  const result = new Map<string, string[]>();
  design.bricks.forEach((brick, index) => {
    if (!canOmitOrdinaryStuds(brick, catalog)) return;
    for (const site of partTopStuds(brick, catalog)) {
      const ids = covers.get(siteKey(site.x, site.y, site.z));
      if (ids) result.set(`Stud_${index}_${Math.floor(site.x - brick.x)}_${Math.floor(site.y - brick.y)}`, ids);
    }
  });
  return result;
}

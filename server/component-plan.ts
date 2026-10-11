import { randomUUID } from 'node:crypto';
import { resolveCatalog, type CatalogContext, type CatalogManifest, allocateInventory, footprint, partTopStuds, partBottomSites, validateDesign, SCHEMA_VERSION, COORDINATE_SYSTEM, CATALOG_VERSION, type Brick, type Design, type InventoryItem } from '../shared/model.js';
import { CompilationDeadlineError, type ShapePlan, type ShapePlanV2, type ShapeBox, type ShapePart, type ShapeRepeat, type SlopeRun } from './compiler.js';
import type { ShapeProfile } from './shape-profiles.js';

export type ShapeComponent = {
  id: string; parentId: string; role: string;
  target: { x: number; y: number; z: number };
  tolerance: { x: number; y: number; z: number };
  rotation: Brick['rotation'];
  boxes: ShapeBox[]; profiles?: ShapeProfile[]; parts?: ShapePart[]; slopes?: SlopeRun[]; repeats?: ShapeRepeat[];
};
export const componentSchema = { type: 'object', required: ['id', 'parentId', 'role', 'target', 'tolerance', 'rotation', 'geometryJson'], properties: {
  id: { type: 'string' }, parentId: { type: 'string', description: 'Earlier component ID, or empty string for the first ground component.' }, role: { type: 'string' },
  target: { type: 'object', required: ['x', 'y', 'z'], properties: { x: { type: 'integer' }, y: { type: 'integer' }, z: { type: 'integer' } } },
  tolerance: { type: 'object', required: ['x', 'y', 'z'], properties: { x: { type: 'integer' }, y: { type: 'integer' }, z: { type: 'integer' } } },
  rotation: { type: 'integer', enum: [0, 90, 180, 270] },
  geometryJson: { type: 'string', description: 'JSON-encoded object containing boxes, profiles, parts, slopes and optional repeats. Component LOCAL coordinates, lowest occupied plate at z=0. Use real part IDs from the supplied catalog.' },
} };

/** Decode the compact provider schema once; subsequent patches edit real paths. */
export function decodeComponentPlan<T extends ShapePlan>(plan: T): T {
  if (!plan?.components) return plan;
  if (!Array.isArray(plan.components)) throw new Error('Construction components must be an array.');
  const decoded = structuredClone(plan);
  decoded.boxes ??= [];
  for (const component of decoded.components!) {
    const encoded = component as ShapeComponent & { geometryJson?: unknown };
    if (typeof encoded.geometryJson !== 'string' || encoded.geometryJson.length > 500_000) throw new Error('Each construction section needs a complete geometryJson object.');
    const geometry = JSON.parse(encoded.geometryJson);
    if (!geometry || typeof geometry !== 'object' || Array.isArray(geometry) || geometry.boxes !== undefined && !Array.isArray(geometry.boxes) || geometry.components) throw new Error('Section geometry needs local boxes and cannot contain nested components.');
    encoded.boxes = geometry.boxes || [];
    for (const field of ['boxes', 'profiles', 'parts', 'slopes', 'repeats'] as const) if (geometry[field] !== undefined) Object.assign(encoded, { [field]: geometry[field] });
    delete encoded.geometryJson;
  }
  return decoded;
}
type Options = { prompt: string; inventory?: InventoryItem[]; ownedOnly?: boolean; maxBricks?: number; deadline?: number; catalog?: CatalogManifest };
type CompileSection = (plan: ShapePlanV2, options: Options) => Design;
const pointKey = (point: { x: number; y: number; z: number }) => `${point.x},${point.y},${point.z}`;

function rotated(bricks: Brick[], rotation: Brick['rotation'], catalog: CatalogContext): Brick[] {
  const maxX = Math.max(...bricks.map(brick => brick.x + footprint(brick, catalog).width));
  const maxY = Math.max(...bricks.map(brick => brick.y + footprint(brick, catalog).depth));
  return bricks.map(brick => {
    const { width, depth } = footprint(brick, catalog);
    const [x, y] = rotation === 0 ? [brick.x, brick.y] : rotation === 90 ? [maxY - brick.y - depth, brick.x]
      : rotation === 180 ? [maxX - brick.x - width, maxY - brick.y - depth] : [brick.y, maxX - brick.x - width];
    return { ...brick, x, y, rotation: ((brick.rotation + rotation) % 360) as Brick['rotation'] };
  });
}

function remainingInventory(inventory: InventoryItem[], placed: Brick[]): InventoryItem[] {
  const used = new Map<string, number>();
  for (const brick of placed) { const key = `${brick.partId}:${brick.colorId}`; used.set(key, (used.get(key) || 0) + 1); }
  return inventory.map(item => {
    const key = `${item.partId}:${item.colorId}`, spent = Math.min(item.quantity, used.get(key) || 0);
    used.set(key, (used.get(key) || 0) - spent);
    return { ...item, quantity: item.quantity - spent };
  });
}

/** Compile connected sections independently, then search only allowed translations
 * for real stud mates. Never add support, delete volume, change color or relax the
 * final collision/assembly checks. The result still has a checked per-piece order;
 * this does not claim that whole subassemblies can be inserted as rigid bodies. */
export function compileComponents(plan: ShapePlan & { components: ShapeComponent[] }, options: Options, compileSection: CompileSection): Design {
  if (!Array.isArray(plan.components) || !plan.components.length) throw new Error('The component plan needs connected sections.');
  if (plan.boxes.length || plan.profiles?.length || plan.parts?.length || plan.slopes?.length || plan.repeats?.length) throw new Error('Use component-local geometry throughout a component plan; put global geometry in its root component.');
  const checkDeadline = () => { if (options.deadline !== undefined && Date.now() >= options.deadline) throw new CompilationDeadlineError(); };
  const catalog = resolveCatalog(options.catalog);
  const groups = new Map<string, Brick[]>();
  let placed: Brick[] = [];
  const template: Design = { id: randomUUID(), schemaVersion: SCHEMA_VERSION, coordinateSystem: COORDINATE_SYSTEM, catalogVersion: CATALOG_VERSION,
    title: plan.title, description: plan.description, source: 'ai', prompt: options.prompt, createdAt: new Date().toISOString(), bricks: [], ...(options.catalog ? { catalog: options.catalog } : {}) };
  for (const [index, component] of plan.components.entries()) {
    checkDeadline();
    if (!component || !/^[a-z][a-z0-9_-]{0,60}$/.test(component.id) || groups.has(component.id) || typeof component.role !== 'string'
      || !component.role.trim() || component.role.length > 600 || (index === 0 ? component.parentId !== '' : !groups.has(component.parentId))
      || !component.target || ![component.target.x, component.target.y, component.target.z].every(Number.isSafeInteger)
      || !component.tolerance || ![component.tolerance.x, component.tolerance.y, component.tolerance.z].every(value => Number.isSafeInteger(value) && value >= 0)
      || component.tolerance.x > 4 || component.tolerance.y > 4 || component.tolerance.z > 9 || ![0, 90, 180, 270].includes(component.rotation)
      || !Array.isArray(component.boxes) || 'components' in component) throw new Error(`/components/${index}: unique ID, earlier parent, role, integer target, bounded explicit tolerance (x/y ≤4 studs, z ≤9 plates), yaw and local geometry are required.`);
    const local: ShapePlanV2 = { schemaVersion: SCHEMA_VERSION, coordinateSystem: COORDINATE_SYSTEM, title: plan.title, description: plan.description, partPlacement: plan.partPlacement,
      boxes: component.boxes, profiles: component.profiles, parts: component.parts, slopes: component.slopes, repeats: component.repeats };
    let section: Design;
    try { section = compileSection(local, { ...options, inventory: options.ownedOnly ? remainingInventory(options.inventory || [], placed) : options.inventory,
      maxBricks: options.maxBricks === undefined ? undefined : options.maxBricks - placed.length }); }
    catch (error) {
      if (error instanceof CompilationDeadlineError) throw error;
      const failure = new Error(`/components/${index} (${component.id}): ${(error as Error).message}`);
      const failures = (error as { failures?: number }).failures;
      if (Number.isSafeInteger(failures) && failures! > 0) Object.assign(failure, { failures });
      const failedSection = (error as { design?: Design }).design;
      if (failedSection?.bricks.length) {
        const transformed = rotated(failedSection.bricks, component.rotation, catalog).map((brick, i) => ({ ...brick,
          id: `b${placed.length + i + 1}`, x: brick.x + component.target.x, y: brick.y + component.target.y, z: brick.z + component.target.z }));
        Object.assign(failure, { design: { ...template, bricks: [...placed, ...transformed] }, partial: true });
      }
      throw failure;
    }
    const bricks = rotated(section.bricks, component.rotation, catalog);
    const parent = component.parentId ? groups.get(component.parentId)! : [];
    const parentTops = new Set(parent.flatMap(brick => partTopStuds(brick, catalog)).map(pointKey)), parentBottoms = new Set(parent.flatMap(brick => partBottomSites(brick, catalog)).map(pointKey));
    const childTops = bricks.flatMap(brick => partTopStuds(brick, catalog)), childBottoms = bricks.flatMap(brick => partBottomSites(brick, catalog));
    const offsets: { x: number; y: number; z: number; score: number }[] = [];
    const tolerance = index ? component.tolerance : { x: 0, y: 0, z: 0 };
    for (let dz = -tolerance.z; dz <= tolerance.z; dz++) for (let dy = -tolerance.y; dy <= tolerance.y; dy++) for (let dx = -tolerance.x; dx <= tolerance.x; dx++)
      offsets.push({ x: component.target.x + dx, y: component.target.y + dy, z: component.target.z + dz, score: dx * dx + dy * dy + (dz * 0.4) ** 2 });
    offsets.sort((a, b) => a.score - b.score || a.z - b.z || a.y - b.y || a.x - b.x);
    let accepted: Brick[] | undefined;
    let lastCandidate: Design | undefined;
    let lastErrors: string[] = [];
    for (const offset of offsets) {
      checkDeadline();
      if (index && !childBottoms.some(point => parentTops.has(pointKey({ x: point.x + offset.x, y: point.y + offset.y, z: point.z + offset.z })))
        && !childTops.some(point => parentBottoms.has(pointKey({ x: point.x + offset.x, y: point.y + offset.y, z: point.z + offset.z })))) continue;
      const transformed = bricks.map((brick, i) => ({ ...brick, id: `b${placed.length + i + 1}`, x: brick.x + offset.x, y: brick.y + offset.y, z: brick.z + offset.z }));
      const candidate = { ...template, bricks: [...placed, ...transformed] };
      lastCandidate = candidate;
      const check = validateDesign(candidate);
      if (check.valid) { accepted = transformed; break; }
      lastErrors = check.errors;
    }
    if (!accepted) throw Object.assign(new Error(`/components/${index} (${component.id}) cannot attach to ${component.parentId || 'the table'} within its declared position tolerance. ${lastErrors.slice(0, 3).join('; ') || 'No actual stud/underside mate exists in that search region.'} Preserve its shape and change the joint, parent or target position.`), lastCandidate ? { design: lastCandidate, partial: index < plan.components.length - 1 } : {});
    placed = [...placed, ...accepted]; groups.set(component.id, accepted);
  }
  const design = { ...template, bricks: placed };
  const check = validateDesign(design);
  if (!check.valid) throw new Error(check.errors.join('; '));
  if (options.ownedOnly && allocateInventory(design, options.inventory || []).totalMissing) throw new Error('Connected sections exceed the confirmed inventory.');
  if (options.maxBricks !== undefined && placed.length > options.maxBricks) throw new Error('Connected sections exceed the requested brick budget.');
  return design;
}

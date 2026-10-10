import { randomUUID } from 'node:crypto';
import { PARTS, COLORS, partTopStuds, partBottomSites, SCHEMA_VERSION, COORDINATE_SYSTEM, CATALOG_VERSION, type Brick, type Design, type InventoryItem } from '../shared/model.js';

export type ShapeCutout = { x: number; y: number; z: number; width: number; depth: number; height: number };
export type ShapeBox = { x: number; y: number; z: number; width: number; depth: number; height: number; colorId: number; cutouts?: ShapeCutout[] };
export type SlopeRun = { kind: 'upright45'; x: number; y: number; z: number; width: number; rotation: 0 | 90 | 180 | 270; colorId: number };
export type ShapeRepeat = { boxes?: ShapeBox[]; slopes?: SlopeRun[]; count: number; dx: number; dy: number; dz: number };
export type ShapePlan = { title: string; description: string; boxes: ShapeBox[]; schemaVersion?: 2; coordinateSystem?: 'stud-xy-plate-z'; slopes?: SlopeRun[]; repeats?: ShapeRepeat[] };
export type ShapePlanV2 = ShapePlan & { schemaVersion: 2; coordinateSystem: 'stud-xy-plate-z' };

const keyAt = (x: number, y: number, z: number) => `${x},${y},${z}`;
const legacyParts = new Set(['3005', '3004', '3622', '3010', '3003', '3002', '3001']);
const validColor = (color: number) => Number.isInteger(color) && Object.hasOwn(COLORS, color);

// The planner describes space and supported surface primitives. Only this compiler chooses real parts.
export function compilePlan(plan: ShapePlan, options: { prompt: string; inventory?: InventoryItem[]; ownedOnly?: boolean; maxBricks?: number; scanOrder?: 'y-major' | 'x-major' }): Design {
  if (!plan || typeof plan.title !== 'string' || !plan.title.trim() || plan.title.length > 90 || typeof plan.description !== 'string' || !plan.description.trim() || plan.description.length > 600 || !Array.isArray(plan.boxes)) {
    throw new Error('The shape plan must include a title, description, and boxes array.');
  }
  const legacy = plan.schemaVersion === undefined && plan.coordinateSystem === undefined;
  if ((!legacy && (plan.schemaVersion !== SCHEMA_VERSION || plan.coordinateSystem !== COORDINATE_SYSTEM)) || (legacy && (plan.slopes !== undefined || plan.repeats !== undefined))) throw new Error('Label new plans with schemaVersion 2 and coordinateSystem stud-xy-plate-z. Slopes and repeated features require a V2 plan.');
  if (plan.slopes !== undefined && !Array.isArray(plan.slopes)) throw new Error('Slope runs must be an array.');
  if (plan.repeats !== undefined && !Array.isArray(plan.repeats)) throw new Error('Repeated features must be an array.');
  const runs = plan.slopes || [];
  const repeats = plan.repeats || [];
  for (const repeat of repeats) {
    if (!repeat || typeof repeat !== 'object' || 'repeats' in repeat ||
      !Number.isSafeInteger(repeat.count) || repeat.count < 1 || ![repeat.dx, repeat.dy, repeat.dz].every(Number.isSafeInteger) ||
      (repeat.boxes !== undefined && !Array.isArray(repeat.boxes)) || (repeat.slopes !== undefined && !Array.isArray(repeat.slopes)) ||
      !(repeat.boxes?.length || repeat.slopes?.length)) throw new Error('Each repeated feature needs boxes or slopes, a positive safe-integer count, integer dx/dy/dz, and no nested repeats.');
    if (repeat.count > 1 && !repeat.dx && !repeat.dy && !repeat.dz) throw new Error('Repeated copies must move along at least one axis.');
    // A nonzero integer displacement bounds copies by the physical workspace,
    // before expansion. A huge count must not become a huge allocation or loop.
    if (Math.abs(repeat.dx) * (repeat.count - 1) > 23 || Math.abs(repeat.dy) * (repeat.count - 1) > 23 || Math.abs(repeat.dz) * (repeat.count - 1) > 71) throw new Error('Repeated feature exceeds the 24 × 24 stud, 72 plate-height design grid.');
  }
  if (plan.boxes.length + runs.length + repeats.length < 1) throw new Error('Use at least one shape box or slope run.');
  function* expanded<T extends ShapeBox | SlopeRun>(initial: T[], field: 'boxes' | 'slopes'): Generator<T> {
    yield* initial;
    for (const repeat of repeats) for (let i = 0; i < repeat.count; i++) for (const primitive of repeat[field] || []) {
      if (!primitive) { yield primitive as T; continue; }
      yield { ...primitive, x: primitive.x + i * repeat.dx, y: primitive.y + i * repeat.dy, z: primitive.z + i * repeat.dz } as T;
    }
  }
  const maxBricks = options.maxBricks;
  if (maxBricks !== undefined && (!Number.isSafeInteger(maxBricks) || maxBricks < 1)) throw new Error('The optional part budget must be a positive safe integer.');
  const cells = new Map<string, number>();
  const layers = new Set<number>();
  let extentX = 0, extentY = 0;
  for (const raw of expanded(plan.boxes, 'boxes')) {
    if (!raw || !['x', 'y', 'z', 'width', 'depth', 'height', 'colorId'].every(key => Number.isInteger(raw[key as keyof ShapeBox])) || !validColor(raw.colorId)) throw new Error('Each shape box needs integer dimensions and a supported color.');
    if (legacy && raw.cutouts !== undefined) throw new Error('Box cutouts require a V2 plan with plate-height coordinates.');
    if (raw.cutouts !== undefined && !Array.isArray(raw.cutouts)) throw new Error('Box cutouts must be an array of local volumes.');
    const box = { ...raw, z: raw.z * (legacy ? 3 : 1), height: raw.height * (legacy ? 3 : 1) };
    if (box.x < 0 || box.y < 0 || box.z < 0 || box.width < 1 || box.depth < 1 || box.height < 1 || box.x + box.width > 24 || box.y + box.depth > 24 || box.z + box.height > 72) throw new Error('Shape exceeds the 24 × 24 stud, 72 plate-height design grid.');
    const cutouts = box.cutouts || [];
    for (const cut of cutouts) {
      if (!cut || typeof cut !== 'object' || Array.isArray(cut) || 'cutouts' in cut || !['x', 'y', 'z', 'width', 'depth', 'height'].every(key => Number.isInteger(cut[key as keyof ShapeCutout])) ||
        cut.x < 0 || cut.y < 0 || cut.z < 0 || cut.width < 1 || cut.depth < 1 || cut.height < 1 || cut.x + cut.width > box.width || cut.y + cut.depth > box.depth || cut.z + cut.height > box.height) {
        throw new Error('Each box cutout needs nonempty integer dimensions fully contained in its parent box, using local stud-x/y and plate-z coordinates.');
      }
    }
    extentX = Math.max(extentX, box.x + box.width);
    extentY = Math.max(extentY, box.y + box.depth);
    for (let z = box.z; z < box.z + box.height; z++) {
      layers.add(z);
      for (let y = box.y; y < box.y + box.depth; y++) for (let x = box.x; x < box.x + box.width; x++) {
        // A cutout omits this box's contribution; it never deletes earlier boxes
        // or trims whole slope parts. Repeat translations leave local cuts unchanged.
        if (cutouts.some(cut => x >= box.x + cut.x && x < box.x + cut.x + cut.width && y >= box.y + cut.y && y < box.y + cut.y + cut.depth && z >= box.z + cut.z && z < box.z + cut.z + cut.height)) continue;
        cells.set(keyAt(x, y, z), box.colorId);
      }
    }
  }
  const fixed: Brick[] = [];
  const reservations = new Set<string>();
  for (const run of expanded(runs, 'slopes')) {
    if (!run || run.kind !== 'upright45' || !['x', 'y', 'z', 'width', 'rotation', 'colorId'].every(key => Number.isInteger(run[key as keyof SlopeRun])) || !validColor(run.colorId) || ![0, 90, 180, 270].includes(run.rotation) || run.width < 2 || run.width % 2 !== 0) throw new Error('A slope run needs kind upright45, integer coordinates, an even width, a supported color, and yaw 0, 90, 180, or 270.');
    const width = run.rotation % 180 ? 2 : run.width, depth = run.rotation % 180 ? run.width : 2;
    if (run.x < 0 || run.y < 0 || run.z < 0 || run.x + width > 24 || run.y + depth > 24 || run.z + 3 > 72) throw new Error('Slope run exceeds the design grid.');
    for (let z = run.z; z < run.z + 3; z++) for (let y = run.y; y < run.y + depth; y++) for (let x = run.x; x < run.x + width; x++) {
      const key = keyAt(x, y, z);
      if (cells.has(key) || reservations.has(key)) throw new Error('A slope envelope overlaps a box or another slope run. Keep its whole 2-stud-depth, 3-plate-height envelope clear.');
      reservations.add(key);
    }
    for (let offset = 0; offset < run.width; offset += 2) {
      const along = run.rotation >= 180 ? run.width - 2 - offset : offset;
      fixed.push({ id: '', partId: '3039', colorId: run.colorId, x: run.x + (run.rotation % 180 ? 0 : along), y: run.y + (run.rotation % 180 ? along : 0), z: run.z, rotation: run.rotation });
    }
  }
  const available = new Map<string, number>();
  for (const item of options.inventory || []) {
    if (!item || typeof item.partId !== 'string' || !Object.hasOwn(PARTS, item.partId) || !validColor(item.colorId) || !Number.isSafeInteger(item.quantity) || item.quantity < 0) throw new Error('Invalid inventory part, color, or quantity.');
    const key = `${item.partId}:${item.colorId}`;
    const quantity = (available.get(key) || 0) + item.quantity;
    if (!Number.isSafeInteger(quantity)) throw new Error('Combined inventory quantity exceeds exact integer precision.');
    available.set(key, quantity);
  }
  // Reserve all requested slopes first, so rectangular packing cannot spend their inventory.
  if (options.ownedOnly) for (const brick of fixed) {
    const key = `${brick.partId}:${brick.colorId}`, remaining = available.get(key) || 0;
    if (remaining < 1) throw new Error(`Cannot build the slope runs with the available inventory: missing ${COLORS[brick.colorId].name} 3039.`);
    available.set(key, remaining - 1);
  }
  const bricks: Brick[] = [];
  const placedStuds = new Map<string, string>();
  const components = new Map<string, string>();
  const componentSizes = new Map<string, number>();
  const component = (id: string): string => {
    let root = id;
    while (components.get(root) !== root) root = components.get(root)!;
    while (id !== root) {
      const parent = components.get(id)!;
      components.set(id, root);
      id = parent;
    }
    return root;
  };
  const supportGroups = (brick: Brick) => {
    const supports = new Set<string>();
    for (const site of partBottomSites(brick)) {
      const below = placedStuds.get(keyAt(site.x, site.y, site.z));
      if (below) supports.add(component(below));
    }
    return supports;
  };
  const place = (brick: Brick) => {
    brick.id = `b${bricks.length + 1}`;
    const supports = supportGroups(brick);
    components.set(brick.id, brick.id);
    componentSizes.set(brick.id, 1);
    let root = brick.id;
    for (const group of supports) {
      if (componentSizes.get(root)! < componentSizes.get(group)!) {
        components.set(root, group);
        componentSizes.set(group, componentSizes.get(group)! + componentSizes.get(root)!);
        root = group;
      } else {
        components.set(group, root);
        componentSizes.set(root, componentSizes.get(root)! + componentSizes.get(group)!);
      }
    }
    bricks.push(brick);
    if (maxBricks !== undefined && bricks.length > maxBricks) throw new Error(`Design exceeds the requested ${maxBricks}-brick budget. Increase that budget or simplify the requested shape.`);
    for (const stud of partTopStuds(brick)) placedStuds.set(keyAt(stud.x, stud.y, stud.z), brick.id);
  };
  const sizes = Object.values(PARTS).filter(part => part.kind !== 'slope' && (!legacy || legacyParts.has(part.id))).flatMap(part => ([0, 90] as const).filter(rotation => rotation === 0 || part.width !== part.depth).map(rotation => ({ part, rotation, width: rotation ? part.depth : part.width, depth: rotation ? part.width : part.depth })));
  const fixedLayers = new Map<number, Brick[]>();
  for (const brick of fixed) {
    layers.add(brick.z);
    const layer = fixedLayers.get(brick.z) || [];
    layer.push(brick);
    fixedLayers.set(brick.z, layer);
  }
  for (const z of [...layers].sort((a, b) => a - b)) {
    for (const brick of fixedLayers.get(z) || []) place(brick);
    const layer = legacy ? z / 3 : z;
    const candidates = [...sizes].sort((a, b) => b.width * b.depth * b.part.heightPlates - a.width * a.depth * a.part.heightPlates || (layer % 2 ? b.width - a.width : b.depth - a.depth));
    const candidateBrick = (candidate: typeof sizes[number], x: number, y: number, colorId: number): Brick => ({ id: '', partId: candidate.part.id, rotation: candidate.rotation, colorId, x, y, z });
    const fits = (candidate: typeof sizes[number], x: number, y: number, colorId: number, reservedPart?: string) => {
      if (options.ownedOnly && (available.get(`${candidate.part.id}:${colorId}`) || 0) - Number(candidate.part.id === reservedPart) <= 0) return false;
      for (let dz = 0; dz < candidate.part.heightPlates; dz++) for (let dy = 0; dy < candidate.depth; dy++) for (let dx = 0; dx < candidate.width; dx++) if (cells.get(keyAt(x + dx, y + dy, z + dz)) !== colorId) return false;
      return true;
    };
    const xMajor = options.scanOrder === 'x-major';
    for (let row = 0; row < (xMajor ? extentX : extentY); row++) for (let col = 0; col < (xMajor ? extentY : extentX); col++) {
      const x = xMajor ? row : col, y = xMajor ? col : row;
      const colorId = cells.get(keyAt(x, y, z));
      if (colorId === undefined) continue;
      let chosen: typeof sizes[number] | undefined;
      let bestScore = -Infinity;
      let bestSupported = -1;
      for (const candidate of candidates) {
        if (!fits(candidate, x, y, colorId)) continue;
        const supports = supportGroups(candidateBrick(candidate, x, y, colorId));
        const supported = Number(z === 0 || supports.size > 0);
        let score = z === 0 ? 0 : supports.size - 1;
        if (z > 0 && score >= 0) {
          // A short prefix lets the next part bridge a seam; reserve its inventory in this lookahead.
          let nextBenefit = 0;
          let unsupportedNext = 0;
          for (const [nextX, nextY] of [[x + candidate.width, y], [x, y + candidate.depth]]) {
            if (cells.get(keyAt(nextX, nextY, z)) !== colorId) continue;
            let canSupportNext = false;
            for (const next of candidates) if (fits(next, nextX, nextY, colorId, candidate.part.id)) {
              const nextGroups = supportGroups(candidateBrick(next, nextX, nextY, colorId));
              if (nextGroups.size) canSupportNext = true;
              const joined = [...nextGroups].filter(group => supports.has(group)).length;
              nextBenefit = Math.max(nextBenefit, nextGroups.size - Math.max(0, joined - 1) - 1);
            }
            if (!canSupportNext) unsupportedNext++;
          }
          score += nextBenefit - unsupportedNext;
        }
        if (supported > bestSupported || (supported === bestSupported && score > bestScore)) {
          chosen = candidate; bestScore = score; bestSupported = supported;
        }
        if (z === 0) break;
      }
      if (!chosen) throw new Error(`Cannot pack color ${COLORS[colorId].name} at (${x}, ${y}, ${z} plates) ${options.ownedOnly ? 'with the available inventory' : 'with the supported part shapes'}. ${options.ownedOnly ? 'Adjust the shape or use parts and colors from the confirmed inventory.' : 'Adjust the dimensions to fit the supported catalog: full bricks are 3 plates high and plates are 1 plate high.'}`);
      place(candidateBrick(chosen, x, y, colorId));
      const key = `${chosen.part.id}:${colorId}`;
      if (options.ownedOnly) available.set(key, available.get(key)! - 1);
      for (let dz = 0; dz < chosen.part.heightPlates; dz++) for (let dy = 0; dy < chosen.depth; dy++) for (let dx = 0; dx < chosen.width; dx++) cells.delete(keyAt(x + dx, y + dy, z + dz));
    }
  }
  return { id: randomUUID(), title: plan.title.trim(), description: plan.description.trim(), bricks, source: 'ai', prompt: options.prompt, createdAt: new Date().toISOString(), schemaVersion: SCHEMA_VERSION, coordinateSystem: COORDINATE_SYSTEM, catalogVersion: CATALOG_VERSION };
}

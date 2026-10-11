import { catalogForDesign, type CatalogContext, footprint, partHeight, partTopStuds, partBottomSites, validateDesign, allocateInventory, type Brick, type Design, type InventoryItem } from '../shared/model.js';

type Options = { fixedIds: ReadonlySet<string>; inventory?: InventoryItem[]; ownedOnly?: boolean; maxBricks?: number; allowedPartIds?: ReadonlySet<string>; deadline?: number; globalDeadline?: number; assemblyBlockedIds?: ReadonlySet<string> };
const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
const rectangular = (brick: Brick, catalog: CatalogContext) => ['brick', 'plate'].includes(catalog.parts[brick.partId].kind);

function connections(bricks: Brick[], catalog: CatalogContext) {
  const parents = bricks.map((_, index) => index);
  const root = (index: number): number => { while (parents[index] !== index) { parents[index] = parents[parents[index]]; index = parents[index]; } return index; };
  const studs = new Map<string, number>(), undersides = new Map<string, number>();
  bricks.forEach((brick, index) => {
    for (const stud of partTopStuds(brick, catalog)) studs.set(key(stud.x, stud.y, stud.z), index);
    for (const site of partBottomSites(brick, catalog)) undersides.set(key(site.x, site.y, site.z), index);
  });
  const withoutLower: { brick: Brick; index: number }[] = [];
  bricks.forEach((brick, index) => {
    let supported = brick.z === 0;
    for (const site of partBottomSites(brick, catalog)) {
      const lower = studs.get(key(site.x, site.y, site.z));
      if (lower !== undefined) { parents[root(index)] = root(lower); supported = true; }
    }
    if (!supported) withoutLower.push({ brick, index });
  });
  const grounded = new Set(bricks.flatMap((brick, index) => brick.z === 0 ? [root(index)] : []));
  const unsupported = withoutLower.filter(({ index }) => !grounded.has(root(index))).map(({ brick }) => brick);
  return { root, studs, undersides, grounded, unsupported, count: new Set(parents.map((_, index) => root(index))).size };
}

/** Cross one existing seam with smaller plates, without changing its rectangle. */
function repairBlockedPlateSeam(design: Design, options: Options, blocked: ReadonlySet<string>, expired: () => boolean, check: typeof validateDesign): Design | null {
  const catalog = catalogForDesign(design);
  const movable = design.bricks.filter(brick => !options.fixedIds.has(brick.id) && catalog.parts[brick.partId].kind === 'plate' && partHeight(brick, catalog) === 1);
  const sizes = Object.values(catalog.parts).filter(part => part.kind === 'plate' && part.heightPlates === 1 && (!options.allowedPartIds || options.allowedPartIds.has(part.id)))
    .flatMap(part => ([0, 90] as const).filter(rotation => !rotation || part.width !== part.depth).map(rotation => ({ part, rotation, width: rotation ? part.depth : part.width, depth: rotation ? part.width : part.depth })))
    .sort((a, b) => b.width * b.depth - a.width * a.depth);
  const ids = new Set(design.bricks.map(brick => brick.id));
  let checked = 0, serial = 0;
  for (const target of movable.filter(brick => blocked.has(brick.id))) for (const neighbor of movable) {
    if (expired() || checked >= 4) return null;
    if (neighbor === target || neighbor.z !== target.z || neighbor.colorId !== target.colorId) continue;
    const a = footprint(target, catalog), b = footprint(neighbor, catalog);
    const alongX = target.y === neighbor.y && a.depth === b.depth && (target.x + a.width === neighbor.x || neighbor.x + b.width === target.x);
    const alongY = target.x === neighbor.x && a.width === b.width && (target.y + a.depth === neighbor.y || neighbor.y + b.depth === target.y);
    if (!alongX && !alongY) continue;
    const x = Math.min(target.x, neighbor.x), y = Math.min(target.y, neighbor.y);
    const width = alongX ? a.width + b.width : a.width, depth = alongY ? a.depth + b.depth : a.depth;
    const seam = alongX ? Math.max(target.x, neighbor.x) - x : Math.max(target.y, neighbor.y) - y;
    const outside = design.bricks.filter(brick => brick !== target && brick !== neighbor);
    for (const size of sizes) {
      if (expired() || checked >= 4) return null;
      if (!size.part.allowedColors.includes(target.colorId) || width % size.width || depth % size.depth || seam % (alongX ? size.width : size.depth) === 0) continue;
      const count = width * depth / (size.width * size.depth);
      if (options.maxBricks !== undefined && outside.length + count > options.maxBricks) continue;
      const replacements: Brick[] = [];
      for (let yy = y; yy < y + depth; yy += size.depth) for (let xx = x; xx < x + width; xx += size.width) {
        let id: string; do { id = `packing-strip-${serial++}`; } while (ids.has(id));
        replacements.push({ id, partId: size.part.id, colorId: target.colorId, x: xx, y: yy, z: target.z, rotation: size.rotation });
      }
      const candidate = { ...design, bricks: [...outside, ...replacements] };
      if (options.ownedOnly && allocateInventory(candidate, options.inventory || []).totalMissing) continue;
      checked++;
      const validation = check(candidate);
      if (options.globalDeadline !== undefined && Date.now() >= options.globalDeadline) return null;
      if (validation.valid) return candidate;
    }
  }
  return null;
}

/** Bounded local exact-cover search. It changes seams across nearby courses, never their
 * colored cells or fixed parts. Retain strict structural improvements even when
 * another region still fails; callers must validate before admitting a design.
 * No improvement returns null and never mutates the input.
 * Search limits bound computation, not the allowed model size. */
export function repairPacking(design: Design, options: Options): Design | null {
  const catalog = catalogForDesign(design), PARTS = catalog.parts;
  let validationMs = 0;
  // The local allowance bounds retiling work; mandatory assembly checks can
  // take longer. Their time never extends the original generation deadline.
  const expired = () => (options.globalDeadline !== undefined && Date.now() >= options.globalDeadline) || (options.deadline !== undefined && Date.now() >= options.deadline + validationMs);
  const check: typeof validateDesign = candidate => {
    const started = Date.now();
    try { return validateDesign(candidate); } finally { validationMs += Date.now() - started; }
  };
  if (expired()) return null;
  let bricks = design.bricks;
  let graph = connections(bricks, catalog);
  if (!graph.unsupported.length && graph.count === 1) return options.assemblyBlockedIds?.size
    ? repairBlockedPlateSeam(design, options, options.assemblyBlockedIds, expired, check) ?? design : design;
  const initialUnsupported = graph.unsupported.length, initialComponents = graph.count;
  const result = (): Design | null => {
    if (graph.unsupported.length > initialUnsupported || graph.count > initialComponents ||
      (graph.unsupported.length === initialUnsupported && graph.count === initialComponents)) return null;
    const fixedIds = new Set<string>();
    const candidate = { ...design, bricks: [...bricks].sort((a, b) => a.z - b.z).map((brick, index) => {
      const id = `b${index + 1}`;
      if (options.fixedIds.has(brick.id)) fixedIds.add(id);
      return { ...brick, id };
    }) };
    // Partial improvement may expose a blocked assembly after joining groups.
    // It is still not admissible; retain its concrete feedback without allowing
    // a collision, invalid placement, stock shortage, or budget violation.
    const validation = check(candidate);
    if (options.globalDeadline !== undefined && Date.now() >= options.globalDeadline) return null;
    if (validation.errors.some(error => !/no stud support|disconnected groups|No assembly path was found/.test(error))) return null;
    if (options.maxBricks !== undefined && candidate.bricks.length > options.maxBricks) return null;
    if (options.ownedOnly && allocateInventory(candidate, options.inventory || []).totalMissing) return null;
    const blocked = new Set(validation.errors.flatMap(error => error.match(/Blocked pieces: ([^.]+)\./)?.[1].split(', ') || []));
    return blocked.size ? repairBlockedPlateSeam(candidate, { ...options, fixedIds }, blocked, expired, check) ?? candidate : candidate;
  };
  const sizes = Object.values(PARTS).filter(part => ['brick', 'plate'].includes(part.kind) && (!options.allowedPartIds || options.allowedPartIds.has(part.id)))
    .flatMap(part => ([0, 90] as const).filter(rotation => !rotation || part.width !== part.depth).map(rotation => ({ part, rotation, width: rotation ? part.depth : part.width, depth: rotation ? part.width : part.depth })));
  let visits = 0, attempts = 0, regions = 0, repairs = 0;
  const tried = new Set<string>();
  while (attempts < 24 && regions < 96 && visits < 20_000 && !expired()) {
    const movable = bricks.filter(brick => !options.fixedIds.has(brick.id) && rectangular(brick, catalog));
    let targets = graph.unsupported.filter(brick => movable.includes(brick));
    if (!targets.length && !graph.unsupported.length) {
      // Disconnected courses can be joined by moving a seam across two groups.
      // Only inspect actual touching boundaries, not every pair in a large model.
      const bodies = new Map<string, number>();
      bricks.forEach((brick, index) => { const size = footprint(brick, catalog); for (let y = brick.y; y < brick.y + size.depth; y++) for (let x = brick.x; x < brick.x + size.width; x++) bodies.set(key(x, y, brick.z), index); });
      const indices = new Map(bricks.map((brick, index) => [brick.id, index]));
      targets = movable.filter(brick => {
        const size = footprint(brick, catalog), group = graph.root(indices.get(brick.id)!);
        for (let y = brick.y; y < brick.y + size.depth; y++) for (let x = brick.x; x < brick.x + size.width; x++) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const other = bodies.get(key(x + dx, y + dy, brick.z));
          if (other !== undefined && graph.root(other) !== group) return true;
        }
        return false;
      });
      // A large connected body can exhaust the bounded search on its side of
      // a seam before the small stranded section is considered.
      const componentSizes = new Map<number, number>();
      bricks.forEach((_, index) => { const root = graph.root(index); componentSizes.set(root, (componentSizes.get(root) || 0) + 1); });
      targets.sort((a, b) => componentSizes.get(graph.root(indices.get(a.id)!))! - componentSizes.get(graph.root(indices.get(b.id)!))!);
    }
    let improved = false;
    // Retiling lower one-plate courses cannot create new studs: each already
    // occupies every grid site of its cells. Spend this search on the current
    // course's seams; mixed-height packing still needs the vertical pass.
    const modes = sizes.every(candidate => candidate.part.heightPlates === 1) ? ['course'] : graph.unsupported.length ? ['vertical', 'course', 'mixed'] : ['course', 'mixed', 'vertical'];
    for (const mode of modes) for (const target of targets) {
      if (improved || attempts >= 24 || regions >= 96 || visits >= 20_000 || expired()) break;
      const size = footprint(target, catalog), height = partHeight(target, catalog);
      // Missing support can originate one course below a header. Disconnected
      // groups try horizontal seams first, keeping the smaller search space.
      for (const margin of [2, 4, 8]) {
        if (attempts >= 24 || regions >= 96 || visits >= 20_000 || expired()) break;
        regions++;
        const region = movable.filter(brick => {
          const other = footprint(brick, catalog);
          const vertical = mode === 'vertical' ? brick.z < target.z + height && brick.z + partHeight(brick, catalog) > target.z - 3 : brick.z === target.z;
          return vertical && (mode !== 'course' || partHeight(brick, catalog) === height) && brick.colorId === target.colorId &&
            brick.x < target.x + size.width + margin && brick.x + other.width > target.x - margin && brick.y < target.y + size.depth + margin && brick.y + other.depth > target.y - margin;
        });
        const signature = `${mode}:` + region.map(brick => brick.id).sort().join(',');
        if (tried.has(signature)) continue;
        tried.add(signature);
        attempts++;
        const points: { x: number; y: number; z: number }[] = [];
        for (const brick of region) { const other = footprint(brick, catalog); for (let z = brick.z; z < brick.z + partHeight(brick, catalog); z++) for (let y = brick.y; y < brick.y + other.depth; y++) for (let x = brick.x; x < brick.x + other.width; x++) points.push({ x, y, z }); }
        if (points.length > 768) continue;
        points.sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);
        const removed = new Set(region.map(brick => brick.id)), outside = bricks.filter(brick => !removed.has(brick.id)), outsideGraph = connections(outside, catalog);
        const outsideRoots = [...new Set(outside.map((_, index) => outsideGraph.root(index)))];
        const groupIndices = new Map(outsideRoots.map((root, index) => [root, index]));
        const remainingStock = new Map<string, number>();
        if (options.ownedOnly) {
          for (const item of options.inventory || []) { const id = `${item.partId}:${item.colorId}`; remainingStock.set(id, (remainingStock.get(id) || 0) + item.quantity); }
          for (const brick of outside) { const id = `${brick.partId}:${brick.colorId}`; remainingStock.set(id, (remainingStock.get(id) || 0) - 1); }
        }
        const pointIndices = new Map(points.map((point, index) => [key(point.x, point.y, point.z), index]));
        type Choice = { brick: Brick; mask: bigint; stock: string; joins: number[]; area: number; supported: boolean; bottom: string[]; top: string[]; below: bigint };
        const covering: Choice[][] = points.map(() => []);
        for (const point of points) {
          if (expired()) return result();
          for (const candidate of sizes) {
          if ((mode === 'course' && candidate.part.heightPlates !== height) || !candidate.part.allowedColors.includes(target.colorId)) continue;
          const stock = `${candidate.part.id}:${target.colorId}`;
          if (options.ownedOnly && (remainingStock.get(stock) || 0) < 1) continue;
          let mask = 0n;
          const indices: number[] = [];
          for (let dz = 0; dz < candidate.part.heightPlates; dz++) for (let dy = 0; dy < candidate.depth; dy++) for (let dx = 0; dx < candidate.width; dx++) {
            const index = pointIndices.get(key(point.x + dx, point.y + dy, point.z + dz));
            if (index !== undefined) { mask |= 1n << BigInt(index); indices.push(index); }
          }
          if (indices.length !== candidate.width * candidate.depth * candidate.part.heightPlates) continue;
          const brick: Brick = { id: '', partId: candidate.part.id, colorId: target.colorId, x: point.x, y: point.y, z: point.z, rotation: candidate.rotation };
          const joins = new Set<number>();
          let supported = brick.z === 0;
          for (const site of partBottomSites(brick, catalog)) {
            const lower = outsideGraph.studs.get(key(site.x, site.y, site.z));
            if (lower !== undefined) { supported = true; joins.add(groupIndices.get(outsideGraph.root(lower))!); }
          }
          let below = 0n;
          for (const site of partBottomSites(brick, catalog)) { const index = pointIndices.get(key(Math.floor(site.x), Math.floor(site.y), site.z - 1)); if (index !== undefined) below |= 1n << BigInt(index); }
          for (const stud of partTopStuds(brick, catalog)) {
            const upper = outsideGraph.undersides.get(key(stud.x, stud.y, stud.z));
            if (upper !== undefined) {
              if (outsideGraph.grounded.has(outsideGraph.root(upper))) supported = true;
              joins.add(groupIndices.get(outsideGraph.root(upper))!);
            }
          }
          // A real outside upper mate can anchor a hanging course. This does
          // not assume an insertion path or invent a future attachment: final
          // validation still checks grounding, connectivity and assembly motion.
          if (!supported && !below) continue;
          const choice = { brick, mask, stock, joins: [...joins], area: indices.length, supported, below,
            bottom: partBottomSites(brick, catalog).map(site => key(site.x, site.y, site.z)), top: partTopStuds(brick, catalog).map(stud => key(stud.x, stud.y, stud.z)) };
          for (const index of indices) covering[index].push(choice);
          }
        }
        // A point no real supported candidate can cover is a genuine local
        // obstruction; do not spend the search budget on permutations around it.
        if (covering.some(choices => !choices.length)) continue;
        for (const choices of covering) choices.sort((a, b) => b.joins.length - a.joins.length || b.area - a.area);
        const full = (1n << BigInt(points.length)) - 1n, selected: Choice[] = [], selectedStuds = new Map<string, number>();
        let solution: Brick[] | null = null, localVisits = 0;
        const search = (filled: bigint): boolean => {
          if (++visits > 20_000 || ++localVisits > 4_000 || expired()) return false;
          if (filled === full) {
            const parents = Array.from({ length: outsideRoots.length + selected.length }, (_, index) => index);
            const root = (index: number): number => { while (parents[index] !== index) index = parents[index]; return index; };
            selected.forEach((choice, index) => {
              for (const group of choice.joins) parents[root(outsideRoots.length + index)] = root(group);
              for (const site of choice.bottom) { const lower = selectedStuds.get(site); if (lower !== undefined) parents[root(outsideRoots.length + index)] = root(outsideRoots.length + lower); }
            });
            const count = new Set(parents.map((_, index) => root(index))).size;
            if (count > graph.count || (!graph.unsupported.length && count === graph.count)) return false;
            solution = selected.map((choice, index) => ({ ...choice.brick, id: `packing-${repairs}-${index}` }));
            return true;
          }
          if (options.maxBricks !== undefined && outside.length + selected.length >= options.maxBricks) return false;
          let choices: Choice[] | undefined, lowestZ: number | undefined;
          for (let index = 0; index < points.length; index++) if (!(filled & (1n << BigInt(index)))) {
            lowestZ ??= points[index].z;
            const currentLevel = points[index].z === lowestZ;
            // Prune a lower-course decision as soon as it makes a later header
            // impossible. An unfilled cell below is only potential support;
            // actual placement always requires an existing stud.
            const fits = covering[index].filter(choice => !(filled & choice.mask) && (choice.supported || choice.bottom.some(site => selectedStuds.has(site)) || (!currentLevel && Boolean(choice.below & ~filled))) && (!options.ownedOnly || (remainingStock.get(choice.stock) || 0) > 0));
            if (!fits.length) return false;
            if (!currentLevel) continue;
            if (!choices || fits.length < choices.length) choices = fits;
          }
          for (const choice of choices!) {
            if (visits >= 20_000 || localVisits >= 4_000 || expired()) break;
            for (const stud of choice.top) selectedStuds.set(stud, selected.length);
            selected.push(choice);
            if (options.ownedOnly) remainingStock.set(choice.stock, remainingStock.get(choice.stock)! - 1);
            if (search(filled | choice.mask)) return true;
            if (options.ownedOnly) remainingStock.set(choice.stock, remainingStock.get(choice.stock)! + 1);
            selected.pop();
            for (const stud of choice.top) selectedStuds.delete(stud);
          }
          return false;
        };
        if (!search(0n) || !solution) continue;
        bricks = [...outside, ...solution];
        repairs++;
        graph = connections(bricks, catalog);
        if (!graph.unsupported.length && graph.count === 1) return result();
        improved = true;
        break;
      }
    }
    if (!improved) return result();
  }
  return result();
}

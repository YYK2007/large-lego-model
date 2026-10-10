import { PARTS, footprint, partHeight, partTopStuds, partBottomSites, validateDesign, allocateInventory, type Brick, type Design, type InventoryItem } from '../shared/model.js';

type Options = { fixedIds: ReadonlySet<string>; inventory?: InventoryItem[]; ownedOnly?: boolean; maxBricks?: number; allowedPartIds?: ReadonlySet<string>; deadline?: number };
const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
const rectangular = (brick: Brick) => ['brick', 'plate'].includes(PARTS[brick.partId].kind);

function connections(bricks: Brick[]) {
  const parents = bricks.map((_, index) => index);
  const root = (index: number): number => { while (parents[index] !== index) { parents[index] = parents[parents[index]]; index = parents[index]; } return index; };
  const studs = new Map<string, number>(), undersides = new Map<string, number>();
  bricks.forEach((brick, index) => {
    for (const stud of partTopStuds(brick)) studs.set(key(stud.x, stud.y, stud.z), index);
    for (const site of partBottomSites(brick)) undersides.set(key(site.x, site.y, site.z), index);
  });
  const withoutLower: { brick: Brick; index: number }[] = [];
  bricks.forEach((brick, index) => {
    let supported = brick.z === 0;
    for (const site of partBottomSites(brick)) {
      const lower = studs.get(key(site.x, site.y, site.z));
      if (lower !== undefined) { parents[root(index)] = root(lower); supported = true; }
    }
    if (!supported) withoutLower.push({ brick, index });
  });
  const grounded = new Set(bricks.flatMap((brick, index) => brick.z === 0 ? [root(index)] : []));
  const unsupported = withoutLower.filter(({ index }) => !grounded.has(root(index))).map(({ brick }) => brick);
  return { root, studs, undersides, grounded, unsupported, count: new Set(parents.map((_, index) => root(index))).size };
}

/** Bounded local exact-cover search. It changes seams across nearby courses, never their
 * colored cells or fixed parts. Retain strict structural improvements even when
 * another region still fails; callers must validate before admitting a design.
 * No improvement returns null and never mutates the input.
 * Search limits bound computation, not the allowed model size. */
export function repairPacking(design: Design, options: Options): Design | null {
  const expired = () => options.deadline !== undefined && Date.now() >= options.deadline;
  if (expired()) return null;
  let bricks = design.bricks;
  let graph = connections(bricks);
  if (!graph.unsupported.length && graph.count === 1) return design;
  const initialUnsupported = graph.unsupported.length, initialComponents = graph.count;
  const result = (): Design | null => {
    if (graph.unsupported.length > initialUnsupported || graph.count > initialComponents ||
      (graph.unsupported.length === initialUnsupported && graph.count === initialComponents)) return null;
    const candidate = { ...design, bricks: [...bricks].sort((a, b) => a.z - b.z).map((brick, index) => ({ ...brick, id: `b${index + 1}` })) };
    // Partial improvement may retain support/connectivity failures, never a new
    // collision, invalid placement, stock shortage, or budget violation.
    if (validateDesign(candidate).errors.some(error => !/no stud support|disconnected groups/.test(error))) return null;
    if (options.maxBricks !== undefined && candidate.bricks.length > options.maxBricks) return null;
    if (options.ownedOnly && allocateInventory(candidate, options.inventory || []).totalMissing) return null;
    return candidate;
  };
  const sizes = Object.values(PARTS).filter(part => ['brick', 'plate'].includes(part.kind) && (!options.allowedPartIds || options.allowedPartIds.has(part.id)))
    .flatMap(part => ([0, 90] as const).filter(rotation => !rotation || part.width !== part.depth).map(rotation => ({ part, rotation, width: rotation ? part.depth : part.width, depth: rotation ? part.width : part.depth })));
  let visits = 0, attempts = 0, regions = 0, repairs = 0;
  const tried = new Set<string>();
  while (attempts < 24 && regions < 96 && visits < 20_000 && !expired()) {
    const movable = bricks.filter(brick => !options.fixedIds.has(brick.id) && rectangular(brick));
    let targets = graph.unsupported.filter(brick => movable.includes(brick));
    if (!targets.length && !graph.unsupported.length) {
      // Disconnected courses can be joined by moving a seam across two groups.
      // Only inspect actual touching boundaries, not every pair in a large model.
      const bodies = new Map<string, number>();
      bricks.forEach((brick, index) => { const size = footprint(brick); for (let y = brick.y; y < brick.y + size.depth; y++) for (let x = brick.x; x < brick.x + size.width; x++) bodies.set(key(x, y, brick.z), index); });
      const indices = new Map(bricks.map((brick, index) => [brick.id, index]));
      targets = movable.filter(brick => {
        const size = footprint(brick), group = graph.root(indices.get(brick.id)!);
        for (let y = brick.y; y < brick.y + size.depth; y++) for (let x = brick.x; x < brick.x + size.width; x++) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const other = bodies.get(key(x + dx, y + dy, brick.z));
          if (other !== undefined && graph.root(other) !== group) return true;
        }
        return false;
      });
    }
    let improved = false;
    // Retiling lower one-plate courses cannot create new studs: each already
    // occupies every grid site of its cells. Spend this search on the current
    // course's seams; mixed-height packing still needs the vertical pass.
    const modes = sizes.every(candidate => candidate.part.heightPlates === 1) ? ['course'] : graph.unsupported.length ? ['vertical', 'course', 'mixed'] : ['course', 'mixed', 'vertical'];
    for (const mode of modes) for (const target of targets) {
      if (improved || attempts >= 24 || regions >= 96 || visits >= 20_000 || expired()) break;
      const size = footprint(target), height = partHeight(target);
      // Missing support can originate one course below a header. Disconnected
      // groups try horizontal seams first, keeping the smaller search space.
      for (const margin of [2, 4, 8]) {
        if (attempts >= 24 || regions >= 96 || visits >= 20_000 || expired()) break;
        regions++;
        const region = movable.filter(brick => {
          const other = footprint(brick);
          const vertical = mode === 'vertical' ? brick.z < target.z + height && brick.z + partHeight(brick) > target.z - 3 : brick.z === target.z;
          return vertical && (mode !== 'course' || partHeight(brick) === height) && brick.colorId === target.colorId &&
            brick.x < target.x + size.width + margin && brick.x + other.width > target.x - margin && brick.y < target.y + size.depth + margin && brick.y + other.depth > target.y - margin;
        });
        const signature = `${mode}:` + region.map(brick => brick.id).sort().join(',');
        if (tried.has(signature)) continue;
        tried.add(signature);
        attempts++;
        const points: { x: number; y: number; z: number }[] = [];
        for (const brick of region) { const other = footprint(brick); for (let z = brick.z; z < brick.z + partHeight(brick); z++) for (let y = brick.y; y < brick.y + other.depth; y++) for (let x = brick.x; x < brick.x + other.width; x++) points.push({ x, y, z }); }
        if (points.length > 768) continue;
        points.sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);
        const removed = new Set(region.map(brick => brick.id)), outside = bricks.filter(brick => !removed.has(brick.id)), outsideGraph = connections(outside);
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
          for (const site of partBottomSites(brick)) {
            const lower = outsideGraph.studs.get(key(site.x, site.y, site.z));
            if (lower !== undefined) { supported = true; joins.add(groupIndices.get(outsideGraph.root(lower))!); }
          }
          let below = 0n;
          for (const site of partBottomSites(brick)) { const index = pointIndices.get(key(Math.floor(site.x), Math.floor(site.y), site.z - 1)); if (index !== undefined) below |= 1n << BigInt(index); }
          for (const stud of partTopStuds(brick)) {
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
            bottom: partBottomSites(brick).map(site => key(site.x, site.y, site.z)), top: partTopStuds(brick).map(stud => key(stud.x, stud.y, stud.z)) };
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
        graph = connections(bricks);
        if (!graph.unsupported.length && graph.count === 1) return result();
        improved = true;
        break;
      }
    }
    if (!improved) return result();
  }
  return result();
}

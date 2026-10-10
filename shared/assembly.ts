export type AssemblyPoint = { x: number; y: number; z: number };
export type AssemblyPart = AssemblyPoint & {
  id: string; width: number; depth: number; height: number;
  studs: AssemblyPoint[]; receivers: AssemblyPoint[];
};
export type Placement = {
  brickId: string;
  approach: 'above' | '-X' | '+X' | '-Y' | '+Y';
  waypoints: AssemblyPoint[];
  attachedTo: string[];
};
type AssemblyPlan = { valid: true; placements: Placement[] } | { valid: false; error: string; blockedIds: string[] };
type Box = { min: AssemblyPoint; max: AssemblyPoint };
export const STUD_HEIGHT_PLATES = 0.5; // Official ordinary stud: 4 LDU; plate: 8 LDU.
const STUD_RADIUS = 0.3, EPSILON = 1e-8;
const axes = ['x', 'y', 'z'] as const;
const pointKey = (p: AssemblyPoint) => `${p.x},${p.y},${p.z}`;
const intersects = (a: Box, b: Box) => axes.every(axis => a.min[axis] < b.max[axis] - EPSILON && b.min[axis] < a.max[axis] - EPSILON);
const body = (part: AssemblyPart, at: AssemblyPoint = part): Box => ({ min: at, max: { x: at.x + part.width, y: at.y + part.depth, z: at.z + part.height } });
const studBox = (point: AssemblyPoint): Box => ({ min: { x: point.x - STUD_RADIUS, y: point.y - STUD_RADIUS, z: point.z }, max: { x: point.x + STUD_RADIUS, y: point.y + STUD_RADIUS, z: point.z + STUD_HEIGHT_PLATES } });
const swept = (a: Box, b: Box): Box => ({ min: { x: Math.min(a.min.x, b.min.x), y: Math.min(a.min.y, b.min.y), z: Math.min(a.min.z, b.min.z) }, max: { x: Math.max(a.max.x, b.max.x), y: Math.max(a.max.y, b.max.y), z: Math.max(a.max.z, b.max.z) } });
const offsetStud = (stud: AssemblyPoint, part: AssemblyPart, at: AssemblyPoint) => ({ x: stud.x + at.x - part.x, y: stud.y + at.y - part.y, z: stud.z + at.z - part.z });

/** Index placed conservative envelopes, including the exposed studs. */
class PlacedIndex {
  private cells = new Map<string, Set<AssemblyPart>>();
  private keys(box: Box): string[] {
    const keys: string[] = [];
    for (let x = Math.floor(box.min.x / 4); x <= Math.floor(box.max.x / 4); x++)
      for (let y = Math.floor(box.min.y / 4); y <= Math.floor(box.max.y / 4); y++)
        for (let z = Math.floor(box.min.z / 8); z <= Math.floor(box.max.z / 8); z++) keys.push(`${x},${y},${z}`);
    return keys;
  }
  add(part: AssemblyPart) {
    const bounds = body(part); bounds.max.z += STUD_HEIGHT_PLATES;
    for (const key of this.keys(bounds)) { if (!this.cells.has(key)) this.cells.set(key, new Set()); this.cells.get(key)!.add(part); }
  }
  query(box: Box) {
    const found = new Set<AssemblyPart>();
    for (const key of this.keys(box)) for (const part of this.cells.get(key) || []) found.add(part);
    return found;
  }
}

function clearSegment(part: AssemblyPart, from: AssemblyPoint, to: AssemblyPoint, index: PlacedIndex, seating: 'down' | 'up' | null) {
  if (Math.min(from.z, to.z) < 0) return false;
  const movingBody = swept(body(part, from), body(part, to));
  const movingStuds = part.studs.map(stud => swept(studBox(offsetStud(stud, part, from)), studBox(offsetStud(stud, part, to))));
  const query = { min: { ...movingBody.min }, max: { ...movingBody.max, z: movingBody.max.z + STUD_HEIGHT_PLATES } };
  const receivers = new Set(part.receivers.map(pointKey));
  for (const fixed of index.query(query)) {
    const fixedBody = body(fixed), fixedReceivers = new Set(fixed.receivers.map(pointKey));
    if (intersects(movingBody, fixedBody)) return false;
    for (const stud of fixed.studs) {
      const fixedStud = studBox(stud);
      if (intersects(movingBody, fixedStud) && !(seating === 'down' && receivers.has(pointKey(stud)))) return false;
      if (movingStuds.some(box => intersects(box, fixedStud))) return false;
    }
    for (let i = 0; i < movingStuds.length; i++) {
      if (intersects(movingStuds[i], fixedBody) && !(seating === 'up' && fixedReceivers.has(pointKey(part.studs[i])))) return false;
    }
  }
  return true;
}

/** Deterministic single-part assembly. No rotations, hand clearance or force simulation. */
export function planAssembly(input: AssemblyPart[]): AssemblyPlan {
  const parts = [...input].sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
  const studs = new Map<string, number>(), below = parts.map(() => new Set<number>()), above = parts.map(() => new Set<number>());
  parts.forEach((part, i) => part.studs.forEach(stud => studs.set(pointKey(stud), i)));
  parts.forEach((part, i) => part.receivers.forEach(site => { const lower = studs.get(pointKey(site)); if (lower !== undefined && lower !== i) { below[i].add(lower); above[lower].add(i); } }));
  const position = (part: AssemblyPart): AssemblyPoint => ({ x: part.x, y: part.y, z: part.z });
  // A standalone CAD part also retains a usable pose/export; validateDesign
  // independently rejects an elevated part as an ungrounded physical build.
  const ordinary = parts.length === 1 || parts.every((part, i) => part.z === 0 || below[i].size > 0);
  // With nonoverlapping upright envelopes, lower-to-higher order leaves a clear
  // vertical approach. Preserve that established order without spatial searches.
  if (ordinary) return { valid: true, placements: parts.map((part, i) => ({ brickId: part.id, approach: 'above', waypoints: [{ ...position(part), z: part.z + part.height + 2 }, position(part)], attachedTo: [...below[i]].map(j => parts[j].id) })) };
  const first = planOrder(parts, below, above, new Set());
  if (first.valid) return first;
  // Finish neighboring pieces beneath the same anchor before adding a lower
  // course that can seal their entry. Retry once, rechecking every movement.
  const blocked = new Set(first.blockedIds), preferred = new Set<number>();
  parts.forEach((part, i) => {
    if (!blocked.has(part.id)) return;
    preferred.add(i);
    for (const anchor of above[i]) for (const sibling of below[anchor]) {
      if (parts[sibling].z === part.z) preferred.add(sibling);
    }
  });
  const retry = planOrder(parts, below, above, preferred);
  return retry.valid ? retry : first;
}

function planOrder(parts: AssemblyPart[], below: Set<number>[], above: Set<number>[], preferred: Set<number>): AssemblyPlan {
  const position = (part: AssemblyPart): AssemblyPoint => ({ x: part.x, y: part.y, z: part.z });
  const placed = new Set<number>(), index = new PlacedIndex(), placements: Placement[] = [];
  // A priority frontier avoids repeatedly scanning all unplaced pieces. A blocked
  // part is reconsidered only when another one of its mating neighbors is added.
  const frontier: number[] = [], queued = new Set<number>();
  const compare = (a: number, b: number) => Number(preferred.has(b)) - Number(preferred.has(a)) || a - b;
  const enqueue = (i: number) => {
    if (placed.has(i) || queued.has(i)) return;
    frontier.push(i); queued.add(i);
    for (let child = frontier.length - 1; child > 0;) {
      const parent = (child - 1) >>> 1;
      if (compare(frontier[parent], frontier[child]) <= 0) break;
      [frontier[parent], frontier[child]] = [frontier[child], frontier[parent]]; child = parent;
    }
  };
  const dequeue = () => {
    const first = frontier[0], last = frontier.pop()!;
    if (frontier.length) {
      frontier[0] = last;
      for (let parent = 0;;) {
        const left = parent * 2 + 1, right = left + 1;
        if (left >= frontier.length) break;
        const child = right < frontier.length && compare(frontier[right], frontier[left]) < 0 ? right : left;
        if (compare(frontier[parent], frontier[child]) <= 0) break;
        [frontier[parent], frontier[child]] = [frontier[child], frontier[parent]]; parent = child;
      }
    }
    queued.delete(first); return first;
  };
  parts.forEach((part, i) => { if (part.z === 0) enqueue(i); });
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = 0;
  while (frontier.length) {
    const i = dequeue();
    const part = parts[i], final = position(part);
    const lower = [...below[i]].filter(j => placed.has(j)), upper = [...above[i]].filter(j => placed.has(j));
    let placement: Placement | undefined;
    if (part.z === 0 || lower.length) {
      const start = { ...final, z: Math.max(part.z + part.height + 2, maxZ + 1) };
      if (clearSegment(part, start, final, index, 'down')) placement = { brickId: part.id, approach: 'above', waypoints: [start, final], attachedTo: lower.map(j => parts[j].id) };
    }
    if (!placement && upper.length) {
      // Disengage the 4-LDU stud before lateral entry; the small positive margin
      // avoids treating grazing contact as a clear path. The table is immutable.
      const ready = { ...final, z: part.z - STUD_HEIGHT_PLATES - 0.0001 };
      const starts: [Placement['approach'], AssemblyPoint][] = [
        ['-X', { ...ready, x: minX - part.width - 1 }], ['+X', { ...ready, x: maxX + 1 }],
        ['-Y', { ...ready, y: minY - part.depth - 1 }], ['+Y', { ...ready, y: maxY + 1 }],
      ];
      if (clearSegment(part, ready, final, index, 'up')) for (const [approach, start] of starts) {
        if (clearSegment(part, start, ready, index, null)) { placement = { brickId: part.id, approach, waypoints: [start, ready, final], attachedTo: upper.map(j => parts[j].id) }; break; }
      }
    }
    if (!placement) continue;
    placements.push(placement); placed.add(i); index.add(part);
    minX = Math.min(minX, part.x); minY = Math.min(minY, part.y);
    maxX = Math.max(maxX, part.x + part.width); maxY = Math.max(maxY, part.y + part.depth); maxZ = Math.max(maxZ, part.z + part.height + STUD_HEIGHT_PLATES);
    for (const neighbor of [...below[i], ...above[i]]) enqueue(neighbor);
  }
  if (placed.size !== parts.length) return { valid: false, error: 'No assembly path was found in the supported placement directions. A different order or separate subassembly may be needed.', blockedIds: parts.filter((_, i) => !placed.has(i)).map(part => part.id) };
  return { valid: true, placements };
}

export function placementInstruction(placement: Placement): string {
  if (placement.approach === 'above') return 'Lower this piece straight down onto the marked studs.';
  const ready = placement.waypoints[1];
  return `Enter from ${placement.approach} with the body bottom ${(ready.z * 3.2).toFixed(1)} mm above the table. Slide to X ${ready.x}, Y ${ready.y}, then raise it 1.6 mm to attach its top studs underneath the built section.`;
}

/** Canonical translation offset at a normalized animation time; final pose is zero. */
export function placementOffset(placement: Placement, progress: number): AssemblyPoint {
  const final = placement.waypoints.at(-1)!;
  const t = Math.min(1, Math.max(0, progress)) * (placement.waypoints.length - 1);
  const segment = Math.min(placement.waypoints.length - 2, Math.floor(t)), fraction = t - segment;
  const a = placement.waypoints[segment], b = placement.waypoints[segment + 1];
  return { x: a.x + (b.x - a.x) * fraction - final.x, y: a.y + (b.y - a.y) * fraction - final.y, z: a.z + (b.z - a.z) * fraction - final.z };
}

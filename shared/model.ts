export type Brick = {
  id: string;
  partId: string;
  colorId: number;
  x: number;
  y: number;
  z: number;
  rotation: 0 | 90 | 180 | 270;
};

export const SCHEMA_VERSION = 2;
export const CATALOG_VERSION = 'upright-plates-slopes-1';
export const COORDINATE_SYSTEM = 'stud-xy-plate-z';

export type Design = {
  schemaVersion?: 2;
  catalogVersion?: typeof CATALOG_VERSION;
  coordinateSystem?: typeof COORDINATE_SYSTEM;
  id: string;
  title: string;
  description: string;
  bricks: Brick[];
  source: 'sample' | 'ai';
  prompt: string;
  createdAt: string;
};

export type InventoryItem = {
  partId: string;
  colorId: number;
  quantity: number;
  source: string;
};

export const PARTS: Record<string, { id: string; name: string; width: number; depth: number; heightPlates: 1 | 3; kind: 'brick' | 'plate' | 'slope'; ldrawId: string }> = {
  '3005': { id: '3005', name: 'Brick 1 × 1', width: 1, depth: 1, heightPlates: 3, kind: 'brick', ldrawId: '3005.dat' },
  '3004': { id: '3004', name: 'Brick 1 × 2', width: 1, depth: 2, heightPlates: 3, kind: 'brick', ldrawId: '3004.dat' },
  '3622': { id: '3622', name: 'Brick 1 × 3', width: 1, depth: 3, heightPlates: 3, kind: 'brick', ldrawId: '3622.dat' },
  '3010': { id: '3010', name: 'Brick 1 × 4', width: 1, depth: 4, heightPlates: 3, kind: 'brick', ldrawId: '3010.dat' },
  '3003': { id: '3003', name: 'Brick 2 × 2', width: 2, depth: 2, heightPlates: 3, kind: 'brick', ldrawId: '3003.dat' },
  '3002': { id: '3002', name: 'Brick 2 × 3', width: 2, depth: 3, heightPlates: 3, kind: 'brick', ldrawId: '3002.dat' },
  '3001': { id: '3001', name: 'Brick 2 × 4', width: 2, depth: 4, heightPlates: 3, kind: 'brick', ldrawId: '3001.dat' },
  '3022': { id: '3022', name: 'Plate 2 × 2', width: 2, depth: 2, heightPlates: 1, kind: 'plate', ldrawId: '3022.dat' },
  '3020': { id: '3020', name: 'Plate 2 × 4', width: 2, depth: 4, heightPlates: 1, kind: 'plate', ldrawId: '3020.dat' },
  '3039': { id: '3039', name: 'Slope 45° 2 × 2', width: 2, depth: 2, heightPlates: 3, kind: 'slope', ldrawId: '3039.dat' },
};

// Keys are Rebrickable color IDs. Keep the explicit LDraw mapping even where IDs match.
export const COLORS: Record<number, { id: number; name: string; hex: string; ldrawId: number }> = {
  0: { id: 0, name: 'Black', hex: '#05131D', ldrawId: 0 },
  1: { id: 1, name: 'Blue', hex: '#0055BF', ldrawId: 1 },
  2: { id: 2, name: 'Green', hex: '#237841', ldrawId: 2 },
  4: { id: 4, name: 'Red', hex: '#C91A09', ldrawId: 4 },
  14: { id: 14, name: 'Yellow', hex: '#F2CD37', ldrawId: 14 },
  15: { id: 15, name: 'White', hex: '#FFFFFF', ldrawId: 15 },
  25: { id: 25, name: 'Orange', hex: '#FE8A18', ldrawId: 25 },
  70: { id: 70, name: 'Reddish Brown', hex: '#582A12', ldrawId: 70 },
  71: { id: 71, name: 'Light Bluish Gray', hex: '#A0A5A9', ldrawId: 71 },
};

export function footprint(brick: Brick): { width: number; depth: number } {
  const part = Object.hasOwn(PARTS, brick.partId) ? PARTS[brick.partId] : undefined;
  if (!part) throw new Error(`Unknown part ${brick.partId}.`);
  return brick.rotation === 90 || brick.rotation === 270
    ? { width: part.depth, depth: part.width }
    : { width: part.width, depth: part.depth };
}

/** Convert legacy full-brick heights once, without changing the saved source. */
export function normalizeDesign(design: Design): Design {
  if (!design || typeof design !== 'object' || !Array.isArray(design.bricks)) throw new Error('Design bricks must be an array.');
  if (design.schemaVersion === SCHEMA_VERSION) {
    if (design.catalogVersion !== CATALOG_VERSION || design.coordinateSystem !== COORDINATE_SYSTEM) throw new Error('Unsupported design catalog or coordinate system.');
    return { ...design, bricks: design.bricks.map(brick => ({ ...brick })) };
  }
  if (design.schemaVersion !== undefined || design.catalogVersion !== undefined || design.coordinateSystem !== undefined) throw new Error('Unsupported design version or incomplete coordinate metadata.');
  const bricks = design.bricks.map(brick => {
    if (!brick || !Object.hasOwn(PARTS, brick.partId) || PARTS[brick.partId].kind !== 'brick') throw new Error('Legacy design contains an unsupported part.');
    if (!Number.isInteger(brick.z) || brick.z < 0 || brick.z >= 24) throw new Error('Legacy brick z must be an integer from 0 to 23.');
    if (brick.rotation !== 0 && brick.rotation !== 90) throw new Error('Legacy brick rotation must be 0 or 90.');
    return { ...brick, z: brick.z * 3 };
  });
  return { ...design, schemaVersion: SCHEMA_VERSION, catalogVersion: CATALOG_VERSION, coordinateSystem: COORDINATE_SYSTEM, bricks };
}

export const partHeight = (brick: Brick): number => PARTS[brick.partId].heightPlates;

/** Rotate a local stud-space point and anchor it at the minimum footprint corner. */
export function partPoint(brick: Brick, u: number, v: number): { x: number; y: number } {
  const { width: w, depth: d } = PARTS[brick.partId];
  const [x, y] = brick.rotation === 0 ? [u, v] : brick.rotation === 90 ? [d - v, u] : brick.rotation === 180 ? [w - u, d - v] : [v, w - u];
  return { x: brick.x + x, y: brick.y + y };
}

export function partTopStuds(brick: Brick): { x: number; y: number; z: number }[] {
  const part = PARTS[brick.partId];
  const points = [];
  for (let y = part.kind === 'slope' ? 1 : 0; y < part.depth; y++) for (let x = 0; x < part.width; x++) points.push({ ...partPoint(brick, x + 0.5, y + 0.5), z: brick.z + part.heightPlates });
  return points;
}

export function partBottomSites(brick: Brick): { x: number; y: number; z: number }[] {
  const part = PARTS[brick.partId];
  const points = [];
  for (let y = 0; y < part.depth; y++) for (let x = 0; x < part.width; x++) points.push({ ...partPoint(brick, x + 0.5, y + 0.5), z: brick.z });
  return points;
}

export function validateDesign(design: Design): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings = ['Physical stability has not been verified. Connection checks do not measure strength or tipping.'];
  if (!design || typeof design !== 'object') return { valid: false, errors: ['Design must be an object.'], warnings };
  for (const key of ['id', 'title', 'description', 'prompt', 'createdAt'] as const) {
    if (typeof design[key] !== 'string' || !design[key].trim()) errors.push(`Design ${key} must be a nonempty string.`);
  }
  const limits = { id: 80, title: 90, description: 600, prompt: 4000, createdAt: 64 };
  for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
    if (typeof design[key] === 'string' && design[key].length > limits[key]) errors.push(`Design ${key} exceeds ${limits[key]} characters.`);
  }
  if (typeof design.id === 'string' && !/^[a-zA-Z0-9_-]{1,80}$/.test(design.id)) errors.push('Design ID contains unsupported characters.');
  if (typeof design.createdAt === 'string' && !Number.isFinite(Date.parse(design.createdAt))) errors.push('Design createdAt must be a valid date.');
  if (design.source !== 'sample' && design.source !== 'ai') errors.push('Design source must be sample or ai.');
  if (!Array.isArray(design.bricks)) return { valid: false, errors: [...errors, 'Design bricks must be an array.'], warnings };
  if (design.bricks.length === 0) errors.push('Design must contain at least one brick.');

  try { design = normalizeDesign(design); } catch (error) { return { valid: false, errors: [...errors, (error as Error).message], warnings }; }

  const usable: Brick[] = [];
  const ids = new Set<string>();
  design.bricks.forEach((brick, i) => {
    const label = `Brick ${i + 1}`;
    if (!brick || typeof brick !== 'object') { errors.push(`${label} must be an object.`); return; }
    const before = errors.length;
    if (typeof brick.id !== 'string' || !brick.id.trim() || brick.id.length > 80) errors.push(`${label} needs an ID of at most 80 characters.`);
    else if (ids.has(brick.id)) errors.push(`${label} repeats ID ${brick.id}.`);
    else ids.add(brick.id);
    if (typeof brick.partId !== 'string' || !Object.hasOwn(PARTS, brick.partId)) errors.push(`${label} has an unsupported part.`);
    if (!Number.isInteger(brick.colorId) || !Object.hasOwn(COLORS, brick.colorId)) errors.push(`${label} has an unsupported color.`);
    if (![0, 90, 180, 270].includes(brick.rotation)) errors.push(`${label} rotation must be 0, 90, 180, or 270.`);
    for (const axis of ['x', 'y', 'z'] as const) {
      const limit = axis === 'z' ? 72 : 24;
      if (!Number.isInteger(brick[axis]) || brick[axis] < 0 || brick[axis] >= limit) errors.push(`${label} ${axis} must be an integer from 0 to ${limit - 1}.`);
    }
    if (errors.length !== before) return;
    const { width, depth } = footprint(brick);
    if (brick.x + width > 24 || brick.y + depth > 24) { errors.push(`${label} extends beyond the 24 × 24 stud workspace.`); return; }
    if (brick.z + partHeight(brick) > 72) { errors.push(`${label} extends beyond the vertical workspace.`); return; }
    usable.push(brick);
  });

  const neighbors = usable.map(() => [] as number[]);
  const supported = new Set<number>();
  // Integer cells keep checks local as designs grow. Slopes reserve their full
  // body envelope; this upright palette does not permit nesting in the ramp.
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const bodies = new Map<string, number>();
  const studs = new Map<string, number>();
  usable.forEach((brick, i) => {
    const { width, depth } = footprint(brick);
    const collisions = new Set<number>();
    for (let z = brick.z; z < brick.z + partHeight(brick); z++) for (let y = brick.y; y < brick.y + depth; y++) for (let x = brick.x; x < brick.x + width; x++) {
      const cell = key(x, y, z);
      const existing = bodies.get(cell);
      if (existing !== undefined) collisions.add(existing);
      else bodies.set(cell, i);
    }
    for (const other of collisions) errors.push(`Bricks ${usable[other].id} and ${brick.id} overlap their body envelopes.`);
    for (const stud of partTopStuds(brick)) studs.set(key(stud.x, stud.y, stud.z), i);
  });
  usable.forEach((brick, upper) => {
    const supports = new Set<number>();
    for (const site of partBottomSites(brick)) {
      const lower = studs.get(key(site.x, site.y, site.z));
      if (lower !== undefined && lower !== upper) supports.add(lower);
    }
    for (const lower of supports) { neighbors[lower].push(upper); neighbors[upper].push(lower); supported.add(upper); }
    for (const stud of partTopStuds(brick)) {
      const target = bodies.get(key(Math.floor(stud.x), Math.floor(stud.y), stud.z));
      if (target !== undefined && usable[target].z !== stud.z) errors.push(`Studs on ${brick.id} intersect ${usable[target].id} without a matching underside connection.`);
    }
  });
  usable.forEach((brick, i) => {
    if (brick.z > 0 && !supported.has(i)) errors.push(`Brick ${brick.id} has no stud support directly below it.`);
  });
  if (usable.length > 0) {
    const reached = new Set<number>([0]);
    const queue = [0];
    for (let i = 0; i < queue.length; i++) {
      for (const next of neighbors[queue[i]]) if (!reached.has(next)) { reached.add(next); queue.push(next); }
    }
    if (reached.size !== usable.length) errors.push('The model contains disconnected groups. Side-to-side contact does not connect studs.');
  }
  if (usable.filter((brick) => brick.z === 0).length > 1) warnings.push('Position the separate first-layer bricks on a flat surface; the following layers join them.');
  return { valid: errors.length === 0, errors, warnings };
}

export function billOfMaterials(design: Design): { partId: string; colorId: number; quantity: number }[] {
  const rows = new Map<string, { partId: string; colorId: number; quantity: number }>();
  for (const brick of design.bricks) {
    const key = `${brick.partId}:${brick.colorId}`;
    const row = rows.get(key);
    if (row) row.quantity++;
    else rows.set(key, { partId: brick.partId, colorId: brick.colorId, quantity: 1 });
  }
  return [...rows.values()].sort((a, b) => a.partId.localeCompare(b.partId) || a.colorId - b.colorId);
}

export function buildSteps(design: Design): { index: number; z: number; bricks: Brick[]; instruction: string }[] {
  design = normalizeDesign(design);
  const layers = new Map<number, Brick[]>();
  for (const brick of design.bricks) {
    if (!layers.has(brick.z)) layers.set(brick.z, []);
    layers.get(brick.z)!.push(brick);
  }
  const steps: { index: number; z: number; bricks: Brick[]; instruction: string }[] = [];
  for (const [z, layer] of [...layers].sort(([a], [b]) => a - b)) {
    layer.sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
    for (let offset = 0; offset < layer.length; offset += 12) steps.push({
      index: steps.length + 1,
      z,
      bricks: layer.slice(offset, offset + 12),
      instruction: z === 0
        ? 'Arrange these bricks on a flat table at the marked stud coordinates. Keep the loose bricks in position; the following layers join them.'
        : `Place these pieces at the marked stud coordinates, ${(z * 3.2).toFixed(1)} mm above the table. Match their underside connections to the supporting studs; slopes have studs only on their high edge.`,
    });
  }
  return steps;
}

export function allocateInventory(design: Design, inventory: InventoryItem[]): {
  items: { partId: string; colorId: number; quantity: number; owned: number; missing: number; sources: { source: string; quantity: number }[] }[];
  totalMissing: number;
} {
  const items = billOfMaterials(design).map((row) => {
    let remaining = row.quantity;
    const sources = new Map<string, number>();
    for (const item of inventory) {
      if (item.partId !== row.partId || item.colorId !== row.colorId || !Number.isSafeInteger(item.quantity) || item.quantity <= 0) continue;
      const used = Math.min(remaining, item.quantity);
      if (used > 0) sources.set(item.source, (sources.get(item.source) ?? 0) + used);
      remaining -= used;
      if (remaining === 0) break;
    }
    return { ...row, owned: row.quantity - remaining, missing: remaining, sources: [...sources].map(([source, quantity]) => ({ source, quantity })) };
  });
  return { items, totalMissing: items.reduce((sum, row) => sum + row.missing, 0) };
}

export function exportLDraw(design: Design): string {
  const clean = (value: string) => value.replace(/[\r\n]/g, ' ');
  const lines = [`0 ${clean(design.title)}`, '0 Unofficial brick model. Physical stability has not been verified.'];
  for (const step of buildSteps(design)) {
    if (step.index > 1) lines.push('0 STEP');
    for (const brick of step.bricks) {
      const part = PARTS[brick.partId];
      const color = COLORS[brick.colorId];
      const { width, depth } = footprint(brick);
      const cos = [1, 0, -1, 0][brick.rotation / 90], sin = [0, 1, 0, -1][brick.rotation / 90];
      // Rectangular DATs have their long axis along X. 3039 instead has a
      // rear-row origin: native bounds X[-20,20], Z[-30,10], with top at Y0.
      const matrix = part.kind === 'slope'
        ? [cos, 0, -sin, 0, 1, 0, sin, 0, cos]
        : [sin, 0, cos, 0, 1, 0, -cos, 0, sin];
      const origin = part.kind === 'slope' ? partPoint(brick, 1, 1.5) : { x: brick.x + width / 2, y: brick.y + depth / 2 };
      lines.push(`1 ${color.ldrawId} ${origin.x * 20} ${-(brick.z + partHeight(brick)) * 8} ${origin.y * 20} ${matrix.join(' ')} ${part.ldrawId}`);
    }
  }
  return lines.join('\r\n') + '\r\n';
}

export function exportCsv(design: Design, inventory: InventoryItem[] = []): string {
  const cell = (value: string | number) => {
    const text = String(value);
    const safe = /^[=+@\-\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const rows: (string | number)[][] = [['Part ID', 'Part', 'Color ID', 'Color', 'Required', 'Owned', 'Missing', 'Sources']];
  for (const item of allocateInventory(design, inventory).items) {
    rows.push([item.partId, PARTS[item.partId].name, item.colorId, COLORS[item.colorId].name, item.quantity, item.owned, item.missing,
      item.sources.map((source) => `${source.source}: ${source.quantity}`).join('; ')]);
  }
  return rows.map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';
}

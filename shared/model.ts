export type Brick = {
  id: string;
  partId: string;
  colorId: number;
  x: number;
  y: number;
  z: number;
  rotation: 0 | 90;
};

export type Design = {
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

export const PARTS: Record<string, { id: string; name: string; width: number; depth: number; ldrawId: string }> = {
  '3005': { id: '3005', name: 'Brick 1 × 1', width: 1, depth: 1, ldrawId: '3005.dat' },
  '3004': { id: '3004', name: 'Brick 1 × 2', width: 1, depth: 2, ldrawId: '3004.dat' },
  '3622': { id: '3622', name: 'Brick 1 × 3', width: 1, depth: 3, ldrawId: '3622.dat' },
  '3010': { id: '3010', name: 'Brick 1 × 4', width: 1, depth: 4, ldrawId: '3010.dat' },
  '3003': { id: '3003', name: 'Brick 2 × 2', width: 2, depth: 2, ldrawId: '3003.dat' },
  '3002': { id: '3002', name: 'Brick 2 × 3', width: 2, depth: 3, ldrawId: '3002.dat' },
  '3001': { id: '3001', name: 'Brick 2 × 4', width: 2, depth: 4, ldrawId: '3001.dat' },
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
  return brick.rotation === 90
    ? { width: part.depth, depth: part.width }
    : { width: part.width, depth: part.depth };
}

function overlaps(a: Brick, b: Brick): boolean {
  const af = footprint(a);
  const bf = footprint(b);
  return a.x < b.x + bf.width && b.x < a.x + af.width
    && a.y < b.y + bf.depth && b.y < a.y + af.depth;
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
  if (design.bricks.length > 160) return { valid: false, errors: [...errors, 'Design exceeds the limit of 160 bricks.'], warnings };

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
    if (brick.rotation !== 0 && brick.rotation !== 90) errors.push(`${label} rotation must be 0 or 90.`);
    for (const axis of ['x', 'y', 'z'] as const) {
      if (!Number.isInteger(brick[axis]) || brick[axis] < 0 || brick[axis] >= 24) errors.push(`${label} ${axis} must be an integer from 0 to 23.`);
    }
    if (errors.length !== before) return;
    const { width, depth } = footprint(brick);
    if (brick.x + width > 24 || brick.y + depth > 24) { errors.push(`${label} extends beyond the 24 × 24 stud workspace.`); return; }
    usable.push(brick);
  });

  const neighbors = usable.map(() => [] as number[]);
  const supported = new Set<number>();
  for (let i = 0; i < usable.length; i++) {
    for (let j = i + 1; j < usable.length; j++) {
      const a = usable[i];
      const b = usable[j];
      if (!overlaps(a, b)) continue;
      if (a.z === b.z) errors.push(`Bricks ${a.id} and ${b.id} overlap.`);
      if (Math.abs(a.z - b.z) === 1) {
        neighbors[i].push(j);
        neighbors[j].push(i);
        supported.add(a.z > b.z ? i : j);
      }
    }
  }
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
  const levels = [...new Set(design.bricks.map((brick) => brick.z))].sort((a, b) => a - b);
  return levels.map((z, i) => ({
    index: i + 1,
    z,
    bricks: design.bricks.filter((brick) => brick.z === z).sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id)),
    instruction: z === 0
      ? 'Arrange these bricks on a flat table at the marked stud coordinates. Keep the loose bricks in position; the following layers join them.'
      : `Add layer ${z + 1} at the marked stud coordinates. Press each new brick onto the studs of the layer directly below.`,
  }));
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
      // Standard LDraw bricks have the long axis along X and the origin at top-center.
      const matrix = brick.rotation === 0 ? '0 0 1 0 1 0 -1 0 0' : '1 0 0 0 1 0 0 0 1';
      lines.push(`1 ${color.ldrawId} ${(brick.x + width / 2) * 20} ${-(brick.z + 1) * 24} ${(brick.y + depth / 2) * 20} ${matrix} ${part.ldrawId}`);
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

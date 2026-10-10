import { randomUUID } from 'node:crypto';
import { PARTS, COLORS, type Brick, type Design, type InventoryItem } from '../shared/model.js';

export type ShapeBox = { x: number; y: number; z: number; width: number; depth: number; height: number; colorId: number };
export type ShapePlan = { title: string; description: string; boxes: ShapeBox[] };

// Large Lego Model: the model describes occupied space. This compiler alone chooses actual bricks.
export function compilePlan(plan: ShapePlan, options: { prompt: string; inventory?: InventoryItem[]; ownedOnly?: boolean; maxBricks?: number }): Design {
  if (!plan || typeof plan.title !== 'string' || !plan.title.trim() || plan.title.length > 90 || typeof plan.description !== 'string' || plan.description.length > 600 || !Array.isArray(plan.boxes) || !plan.boxes.length || plan.boxes.length > 120) {
    throw new Error('The shape plan must include a title, description, and 1–120 boxes.');
  }
  const cells = new Map<string, number>();
  for (const box of plan.boxes) {
    if (!box || !['x', 'y', 'z', 'width', 'depth', 'height', 'colorId'].every(key => Number.isInteger(box[key as keyof ShapeBox])) || !COLORS[box.colorId]) throw new Error('Each shape box needs integer dimensions and a supported color.');
    if (box.x < 0 || box.y < 0 || box.z < 0 || box.width < 1 || box.depth < 1 || box.height < 1 || box.x + box.width > 24 || box.y + box.depth > 24 || box.z + box.height > 24) throw new Error('Shape exceeds the 24 × 24 × 24 design grid.');
    for (let z = box.z; z < box.z + box.height; z++) for (let y = box.y; y < box.y + box.depth; y++) for (let x = box.x; x < box.x + box.width; x++) cells.set(`${x},${y},${z}`, box.colorId);
  }
  if (cells.size > 1600) throw new Error('Use a smaller, simpler sculpture: at most 1,600 occupied stud cells.');
  const available = new Map<string, number>();
  for (const item of options.inventory || []) {
    const key = `${item.partId}:${item.colorId}`;
    available.set(key, (available.get(key) || 0) + item.quantity);
  }
  const bricks: Brick[] = [];
  const placedCells = new Map<string, string>();
  const components = new Map<string, string>();
  const component = (id: string): string => {
    const parent = components.get(id)!;
    if (parent === id) return id;
    const root = component(parent);
    components.set(id, root);
    return root;
  };
  const sizes = Object.values(PARTS).flatMap(part => ([0, 90] as const).filter(rotation => rotation === 0 || part.width !== part.depth).map(rotation => ({ part, rotation, width: rotation ? part.depth : part.width, depth: rotation ? part.width : part.depth })));
  for (let z = 0; z < 24; z++) {
    // Prefer larger bricks, with orientation only breaking ties in connection benefit.
    const candidates = [...sizes].sort((a, b) => b.width * b.depth - a.width * a.depth || (z % 2 ? b.width - a.width : b.depth - a.depth));
    const fits = (candidate: typeof sizes[number], x: number, y: number, colorId: number, reservedPart?: string) => {
      if (options.ownedOnly && (available.get(`${candidate.part.id}:${colorId}`) || 0) - Number(candidate.part.id === reservedPart) <= 0) return false;
      for (let dy = 0; dy < candidate.depth; dy++) for (let dx = 0; dx < candidate.width; dx++) if (cells.get(`${x + dx},${y + dy},${z}`) !== colorId) return false;
      return true;
    };
    const supportGroups = (candidate: typeof sizes[number], x: number, y: number) => {
      const supports = new Set<string>();
      for (let dy = 0; dy < candidate.depth; dy++) for (let dx = 0; dx < candidate.width; dx++) {
        const below = placedCells.get(`${x + dx},${y + dy},${z - 1}`);
        if (below) supports.add(component(below));
      }
      return supports;
    };
    for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
      const colorId = cells.get(`${x},${y},${z}`);
      if (colorId === undefined) continue;
      let chosen: typeof sizes[number] | undefined;
      let bestScore = -Infinity;
      for (const candidate of candidates) {
        if (!fits(candidate, x, y, colorId)) continue;
        const supports = supportGroups(candidate, x, y);
        let score = z === 0 ? 0 : supports.size - 1;
        if (z > 0 && score >= 0) {
          // A short prefix can let the next brick cross a seam in a narrow beam.
          // Look just one placement ahead along either axis, reserving this brick's inventory.
          let nextBenefit = 0;
          for (const [nextX, nextY] of [[x + candidate.width, y], [x, y + candidate.depth]]) {
            if (cells.get(`${nextX},${nextY},${z}`) !== colorId) continue;
            for (const next of candidates) if (fits(next, nextX, nextY, colorId, candidate.part.id)) {
              const nextGroups = supportGroups(next, nextX, nextY);
              const joined = [...nextGroups].filter(group => supports.has(group)).length;
              nextBenefit = Math.max(nextBenefit, nextGroups.size - Math.max(0, joined - 1) - 1);
            }
          }
          score += nextBenefit;
        }
        if (score > bestScore) { chosen = candidate; bestScore = score; }
        if (z === 0) break;
      }
      if (!chosen) throw new Error(`Cannot pack color ${COLORS[colorId].name} at (${x}, ${y}, ${z}) with the available inventory. Simplify the shape or change its palette.`);
      const id = `b${bricks.length + 1}`;
      const supports = supportGroups(chosen, x, y);
      components.set(id, id);
      for (const group of supports) components.set(group, id);
      bricks.push({ id, partId: chosen.part.id, colorId, x, y, z, rotation: chosen.rotation });
      if (bricks.length > (options.maxBricks || 100)) throw new Error(`Design exceeds the ${options.maxBricks || 100}-brick budget. Reduce its dimensions or fill volume.`);
      const key = `${chosen.part.id}:${colorId}`;
      if (options.ownedOnly) available.set(key, available.get(key)! - 1);
      for (let dy = 0; dy < chosen.depth; dy++) for (let dx = 0; dx < chosen.width; dx++) {
        const cell = `${x + dx},${y + dy},${z}`;
        cells.delete(cell);
        placedCells.set(cell, id);
      }
    }
  }
  return { id: randomUUID(), title: plan.title.trim(), description: plan.description.trim(), bricks, source: 'ai', prompt: options.prompt, createdAt: new Date().toISOString() };
}

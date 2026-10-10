import assert from 'node:assert/strict';
import test from 'node:test';
import { compilePlan, type ShapeBox, type ShapePlan } from '../server/compiler.js';
import { GenerationError, suggestInventory, validateInput, validateInventory, type GenerationInput } from '../server/generation.js';
import { allocateInventory, footprint, validateDesign, type Design, type InventoryItem } from '../shared/model.js';

const box = (overrides: Partial<ShapeBox> = {}): ShapeBox => ({ x: 0, y: 0, z: 0, width: 4, depth: 4, height: 2, colorId: 4, ...overrides });
const plan = (boxes: ShapeBox[] = [box()]): ShapePlan => ({ title: 'Small sculpture', description: 'A colorful brick sculpture.', boxes });

function shapeCells(shape: ShapePlan): Map<string, number> {
  const cells = new Map<string, number>();
  for (const b of shape.boxes) for (let z = b.z; z < b.z + b.height; z++) for (let y = b.y; y < b.y + b.depth; y++) for (let x = b.x; x < b.x + b.width; x++) cells.set(`${x},${y},${z}`, b.colorId);
  return cells;
}

function brickCells(design: Design): Map<string, number> {
  const cells = new Map<string, number>();
  for (const brick of design.bricks) {
    const { width, depth } = footprint(brick);
    for (let y = brick.y; y < brick.y + depth; y++) for (let x = brick.x; x < brick.x + width; x++) {
      const key = `${x},${y},${brick.z}`;
      assert.equal(cells.has(key), false, `compiled bricks overlap at ${key}`);
      cells.set(key, brick.colorId);
    }
  }
  return cells;
}

test('compiles an interlocked box into actual parts without changing shape or color', () => {
  const shape = plan();
  const before = JSON.stringify(shape);
  const result = compilePlan(shape, { prompt: 'A small red block' });
  assert.equal(validateDesign(result).valid, true);
  assert.equal(result.bricks.length, 4);
  assert.deepEqual(brickCells(result), shapeCells(shape));
  assert.equal(result.source, 'ai');
  assert.equal(result.prompt, 'A small red block');
  assert.equal(JSON.stringify(shape), before, 'the input plan remains intact for retries');
});

test('preserves a realistic multi-box rocket and later color overlays exactly', () => {
  const shape = plan([
    box({ width: 8, depth: 4, height: 2, colorId: 71 }),
    box({ x: 2, y: 1, z: 2, width: 4, depth: 2, height: 5, colorId: 15 }),
    box({ x: 3, y: 1, z: 7, width: 2, depth: 2, height: 2, colorId: 4 }),
    box({ x: 1, y: 1, z: 2, width: 1, depth: 2, height: 2, colorId: 4 }),
    box({ x: 6, y: 1, z: 2, width: 1, depth: 2, height: 2, colorId: 4 }),
    box({ x: 3, y: 1, z: 4, width: 2, depth: 2, height: 1, colorId: 1 }),
  ]);
  const result = compilePlan(shape, { prompt: 'A white rocket with red fins and a blue window' });
  const validation = validateDesign(result);
  assert.equal(validation.valid, true, validation.errors.join('; '));
  assert.deepEqual(brickCells(result), shapeCells(shape));
  assert.equal(brickCells(result).get('3,1,4'), 1, 'the later blue window replaces white cells');
});

test('known disconnected and floating plans are rejected by the final geometry gate', () => {
  const disconnected = compilePlan(plan([box({ width: 8, depth: 2, height: 1 })]), { prompt: 'A beam' });
  assert.match(validateDesign(disconnected).errors.join(' '), /disconnected/);
  const floating = compilePlan(plan([box({ z: 2, width: 2, depth: 2, height: 1 })]), { prompt: 'A floating block' });
  assert.match(validateDesign(floating).errors.join(' '), /no stud support/);
});

test('upper layers stagger narrow beam seams on both axes instead of repeating the ground partition', () => {
  for (const [width, depth] of [[8, 2], [2, 8], [8, 1], [1, 8], [6, 4], [8, 4]]) {
    const shape = plan([box({ width, depth })]);
    const result = compilePlan(shape, { prompt: 'An interlocked two-layer beam' });
    const validation = validateDesign(result);
    assert.equal(validation.valid, true, `${width} × ${depth}: ${validation.errors.join('; ')}`);
    assert.deepEqual(brickCells(result), shapeCells(shape));
  }
});

test('seam lookahead reserves owned pieces and finds the constrained 2+4+2 upper bond', () => {
  const shape = plan([box({ width: 8, depth: 2 })]);
  const inventory: InventoryItem[] = [
    { partId: '3001', colorId: 4, quantity: 3, source: 'Long bricks' },
    { partId: '3003', colorId: 4, quantity: 2, source: 'Square bricks' },
  ];
  const result = compilePlan(shape, { prompt: 'Build a connected beam with my five bricks', inventory, ownedOnly: true });
  assert.equal(validateDesign(result).valid, true);
  assert.deepEqual(result.bricks.filter((brick) => brick.z === 1).map((brick) => footprint(brick).width), [2, 4, 2]);
  assert.deepEqual(brickCells(result), shapeCells(shape));
  assert.equal(result.bricks.length, 5);
  assert.equal(allocateInventory(result, inventory).totalMissing, 0);
  const onlyLong: InventoryItem[] = [{ partId: '3001', colorId: 4, quantity: 4, source: 'Only long bricks' }];
  const limited = compilePlan(shape, { prompt: 'Do not invent bridging pieces', inventory: onlyLong, ownedOnly: true });
  assert.equal(allocateInventory(limited, onlyLong).totalMissing, 0);
  assert.equal(validateDesign(limited).valid, false, 'the final gate still rejects inventory that cannot bridge this seam');
});

test('packing conserves all cells across rotated, narrow, overlapping, and boundary shapes', () => {
  const shapes = [
    plan([box({ width: 1, depth: 9, height: 1 })]),
    plan([box({ width: 9, depth: 1, height: 1 })]),
    plan([box({ width: 7, depth: 5, height: 3 }), box({ x: 2, y: 1, z: 1, width: 3, depth: 2, height: 2, colorId: 14 })]),
    plan([box({ x: 20, y: 20, z: 23, height: 1 })]),
  ];
  for (const shape of shapes) assert.deepEqual(brickCells(compilePlan(shape, { prompt: 'Check voxel packing', maxBricks: 160 })), shapeCells(shape));
});

test('owned-only mode uses available quantities, exact colors, and duplicate source rows', () => {
  const inventory: InventoryItem[] = [
    { partId: '3001', colorId: 4, quantity: 1, source: 'Set A' },
    { partId: '3001', colorId: 4, quantity: 3, source: 'Set B' },
    { partId: '3001', colorId: 1, quantity: 10, source: 'Blue set' },
  ];
  const before = JSON.stringify(inventory);
  const result = compilePlan(plan(), { prompt: 'Use my red bricks', ownedOnly: true, inventory });
  assert.equal(validateDesign(result).valid, true);
  assert.equal(allocateInventory(result, inventory).totalMissing, 0);
  assert.equal(result.bricks.length, 4);
  assert.ok(result.bricks.every((brick) => brick.partId === '3001' && brick.colorId === 4));
  assert.equal(JSON.stringify(inventory), before, 'compilation does not consume saved inventory');
  assert.throws(() => compilePlan(plan(), { prompt: 'Use my red bricks', ownedOnly: true, inventory: inventory.filter((item) => item.source !== 'Set A') }), /available inventory/);
  assert.throws(() => compilePlan(plan(), { prompt: 'Use no bricks', ownedOnly: true, inventory: [] }), /available inventory/);
  const unlimited = compilePlan(plan(), { prompt: 'Allow missing bricks', inventory: [] });
  assert.equal(allocateInventory(unlimited, []).totalMissing, unlimited.bricks.length);
});

test('rejects malformed schema, unsupported colors, invalid dimensions, and grid overflow', () => {
  const malformed: unknown[] = [
    null, {}, { ...plan(), title: '' }, { ...plan(), title: 'a'.repeat(91) },
    { ...plan(), description: 12 }, { ...plan(), description: 'a'.repeat(601) },
    { ...plan(), boxes: null }, plan([]), { ...plan(), boxes: [null] },
    plan(Array.from({ length: 121 }, () => box())),
    plan([box({ width: 0 })]), plan([box({ width: 1.5 })]), plan([box({ height: -1 })]),
    plan([box({ x: -1 })]), plan([box({ y: NaN })]), plan([box({ colorId: 999999 })]),
    plan([box({ x: 21 })]), plan([box({ z: 23 })]),
  ];
  for (const value of malformed) assert.throws(() => compilePlan(value as ShapePlan, { prompt: 'Invalid input' }));
});

test('occupied volume and the requested brick budget impose actual limits', () => {
  assert.throws(() => compilePlan(plan([box({ width: 20, depth: 20, height: 5 })]), { prompt: 'Too big' }), /1,600/);
  assert.throws(() => compilePlan(plan(), { prompt: 'Only three bricks', maxBricks: 3 }), /3-brick budget/);
  assert.equal(compilePlan(plan(), { prompt: 'Exactly four bricks', maxBricks: 4 }).bricks.length, 4);
});

test('inventory API validation rejects prototype keys and coercible IDs', () => {
  const valid: InventoryItem = { partId: '3005', colorId: 4, quantity: 1, source: 'My bricks' };
  validateInventory([valid]);
  for (const overrides of [
    { partId: '__proto__' }, { partId: 'constructor' }, { partId: 3005 },
    { colorId: 'constructor' }, { colorId: '4' }, { colorId: 4.5 },
    { quantity: 0.5 }, { quantity: -1 }, { quantity: 10001 }, { quantity: NaN },
  ]) assert.throws(() => validateInventory([{ ...valid, ...overrides }]), (error: unknown) => error instanceof GenerationError && error.status === 400);
  assert.throws(() => validateInventory(Array.from({ length: 501 }, () => valid)), /500/);
});

test('malformed generation inputs produce actionable 400 errors before API calls', () => {
  for (const value of [null, undefined, [], {}, { prompt: '' }, { prompt: 'hi', inventory: {} }, { prompt: 'hi', inventoryMode: 'owned' }, { prompt: 'hi', maxBricks: 161 }]) {
    assert.throws(() => validateInput(value as GenerationInput), (error: unknown) => error instanceof GenerationError && error.status === 400);
  }
  validateInput({ prompt: 'Make a flower', maxBricks: 100 });
});

test('photo inventory requires an image before reading credentials or making an API call', async () => {
  for (const value of [undefined, null, {}, []]) {
    await assert.rejects(() => suggestInventory(value as { data: string; mimeType: string }), (error: unknown) => error instanceof GenerationError && error.status === 400);
  }
});

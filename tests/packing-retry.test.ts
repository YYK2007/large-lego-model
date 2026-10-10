import assert from 'node:assert/strict';
import test from 'node:test';
import { compilePlan, CompilationDeadlineError, type ShapePlanV2 } from '../server/compiler.js';
import { compileGeneratedPlan } from '../server/generation.js';
import { allocateInventory, footprint, partHeight, validateDesign, type Design, type InventoryItem } from '../shared/model.js';
import { BELL_TOWER_PACKING_PLAN } from './fixtures/bell-tower-packing-plan.js';
import { HOLLOW_ROOM_PLAN } from './fixtures/hollow-room-plan.js';

function occupied(design: Design) {
  const cells = new Map<string, number>();
  for (const brick of design.bricks) {
    const { width, depth } = footprint(brick);
    for (let z = brick.z; z < brick.z + partHeight(brick); z++) for (let y = brick.y; y < brick.y + depth; y++) for (let x = brick.x; x < brick.x + width; x++) {
      const key = `${x},${y},${z}`;
      assert.equal(cells.has(key), false, `Packing cannot overlap at ${key}`);
      cells.set(key, brick.colorId);
    }
  }
  return cells;
}

test('local repacking seats the recorded Bell Tower eaves without adding or removing any colored cells', () => {
  const plan = structuredClone(BELL_TOWER_PACKING_PLAN);
  // Keep the palette that exposed this bug. Larger new parts can bridge the
  // original eave on the first scan, which would no longer exercise the retry.
  const originalParts = ['3005', '3004', '3622', '3010', '3003', '3002', '3001', '3024', '3023', '3623', '3710', '3022', '3020', '3039'];
  const colors = [...new Set([...plan.boxes, ...(plan.slopes || [])].map(item => item.colorId))];
  const inventory: InventoryItem[] = originalParts.flatMap(partId => colors.map(colorId => ({ partId, colorId, quantity: 10000, source: 'Historical palette regression stock' })));
  const options = { prompt: plan.title, inventory, ownedOnly: true };
  const first = compilePlan(plan, options);
  assert.equal(validateDesign(first).valid, true);
  const alternate = compilePlan(plan, { ...options, scanOrder: 'x-major' });
  assert.equal(validateDesign(alternate).valid, true);
  assert.deepEqual(occupied(alternate), occupied(first));
  assert.deepEqual(plan, BELL_TOWER_PACKING_PLAN);
  const generated = compileGeneratedPlan(plan, { prompt: plan.title, inventory, inventoryMode: 'owned' });
  assert.equal(validateDesign(generated).valid, true);
  assert.deepEqual(occupied(generated), occupied(first));
  assert.equal(allocateInventory(generated, inventory).totalMissing, 0);
  assert.equal(allocateInventory(first, inventory).totalMissing, 0);
  assert.ok(alternate.bricks.some(brick => brick.partId === '3020' && brick.x === 8 && brick.y === 16 && brick.z === 66 && brick.rotation === 90), 'A real 2x4 plate bridges from the existing corner pier');
});

test('profile packing reaches mixed bricks when plate courses exceed a user budget or confirmed stock', () => {
  const profile = { shape: 'rectangle' as const, colorId: 15, sections: [
    { z: 0, cx: 2, cy: 2, width: 4, depth: 4 }, { z: 9, cx: 2, cy: 2, width: 4, depth: 4 },
  ] };
  const plan: ShapePlanV2 = { schemaVersion: 2, coordinateSystem: 'stud-xy-plate-z', title: 'Solid profile', description: 'A full three-dimensional profile with brick-only stock.', boxes: [], profiles: [profile] };
  const inventory: InventoryItem[] = [{ partId: '3001', colorId: 15, quantity: 6, source: 'Confirmed brick lot' }];
  const before = structuredClone({ plan, inventory });
  const expected = new Map<string, number>();
  for (let z = 0; z < 9; z++) for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) expected.set(`${x},${y},${z}`, 15);
  // Exercise direct profiles and the same profile nested in a repeat. Both
  // plate-first attempts must fail before the valid mixed fallback is tried.
  for (const nested of [false, true]) {
    const candidate = nested ? { ...plan, profiles: [], repeats: [{ count: 1, dx: 0, dy: 0, dz: 0, profiles: [profile] }] } : plan;
    for (const options of [{ maxBricks: 6 }, { inventory, ownedOnly: true }]) {
      for (const scanOrder of ['y-major', 'x-major'] as const) assert.throws(() => compilePlan(candidate, {
        prompt: plan.title, ...options, repair: false, packing: 'plates', scanOrder,
      }), /requested 6-brick budget|available inventory/);
      const result = compileGeneratedPlan(candidate, { prompt: plan.title, ...options, inventoryMode: options.ownedOnly ? 'owned' : 'unlimited' });
      assert.equal(validateDesign(result).valid, true);
      assert.equal(result.bricks.length, 6);
      assert.deepEqual(occupied(result), expected);
      if (options.ownedOnly) assert.equal(allocateInventory(result, inventory).totalMissing, 0);
    }
  }
  assert.deepEqual({ plan, inventory }, before);
});

test('an expired compiler deadline is not treated as a recoverable packing failure', () => {
  assert.throws(() => compileGeneratedPlan(HOLLOW_ROOM_PLAN, { prompt: 'Original room' }, Date.now() - 1), CompilationDeadlineError);
});

test('default scan retains a valid original packing and alternate scan retains exact owned stock constraints', () => {
  const defaultResult = compilePlan(HOLLOW_ROOM_PLAN, { prompt: 'Original room' });
  assert.equal(validateDesign(defaultResult).valid, true);
  assert.deepEqual(compilePlan(HOLLOW_ROOM_PLAN, { prompt: 'Original room', scanOrder: 'y-major' }).bricks, defaultResult.bricks);
  assert.deepEqual(compileGeneratedPlan(HOLLOW_ROOM_PLAN, { prompt: 'Original room' }).bricks, defaultResult.bricks);
  const plan: ShapePlanV2 = { schemaVersion: 2, coordinateSystem: 'stud-xy-plate-z', title: 'Owned plates', description: 'Three stacked narrow plates.', boxes: [{ x: 0, y: 0, z: 0, width: 1, depth: 4, height: 3, colorId: 15 }] };
  const inventory: InventoryItem[] = [{ partId: '3710', colorId: 15, quantity: 3, source: 'Confirmed lot' }, { partId: '3710', colorId: 0, quantity: 100, source: 'Other color' }];
  const original = structuredClone(inventory);
  const options = { prompt: plan.title, inventory, ownedOnly: true, scanOrder: 'x-major' as const };
  const alternate = compilePlan(plan, options);
  assert.equal(validateDesign(alternate).valid, true);
  assert.equal(allocateInventory(alternate, inventory).totalMissing, 0);
  assert.deepEqual(alternate.bricks.map(brick => [brick.partId, brick.colorId]), Array.from({ length: 3 }, () => ['3710', 15]));
  assert.throws(() => compilePlan(plan, { ...options, inventory: [{ ...inventory[0], quantity: 2 }, inventory[1]] }), /available inventory/);
  assert.throws(() => compilePlan(plan, { ...options, maxBricks: 2 }), /requested 2-brick budget/);
  assert.deepEqual(inventory, original);
});

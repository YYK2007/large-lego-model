import assert from 'node:assert/strict';
import test from 'node:test';
import { compilePlan, type ShapePlanV2 } from '../server/compiler.js';
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

test('an alternate scan seats the recorded Bell Tower eaves without adding or removing any colored cells', () => {
  const plan = structuredClone(BELL_TOWER_PACKING_PLAN);
  const first = compilePlan(plan, { prompt: plan.title });
  assert.equal(first.bricks.length, 488);
  assert.deepEqual(validateDesign(first).errors, ['Brick b446 has no stud support directly below it.']);
  const alternate = compilePlan(plan, { prompt: plan.title, scanOrder: 'x-major' });
  assert.equal(alternate.bricks.length, 487);
  assert.equal(validateDesign(alternate).valid, true);
  assert.deepEqual(occupied(alternate), occupied(first));
  assert.deepEqual(plan, BELL_TOWER_PACKING_PLAN);
  assert.deepEqual(compileGeneratedPlan(plan, { prompt: plan.title }).bricks, alternate.bricks);
  assert.ok(alternate.bricks.some(brick => brick.partId === '3020' && brick.x === 8 && brick.y === 16 && brick.z === 66 && brick.rotation === 90), 'A real 2x4 plate bridges from the existing corner pier');
});

test('default scan retains a valid original packing and alternate scan retains exact owned stock constraints', () => {
  const defaultResult = compilePlan(HOLLOW_ROOM_PLAN, { prompt: 'Original room' });
  assert.equal(defaultResult.bricks.length, 78);
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

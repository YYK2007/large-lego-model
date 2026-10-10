import assert from 'node:assert/strict';
import test from 'node:test';
import { compilePlan, type ShapePlanV2 } from '../server/compiler.js';
import { PARTS, allocateInventory, footprint, partHeight, validateDesign, type Design, type InventoryItem } from '../shared/model.js';
import { TAJ_PLATE_PACKING_PLAN } from './fixtures/taj-plate-packing-plan.js';

function occupied(design: Design) {
  const cells = new Map<string, number>();
  for (const brick of design.bricks) {
    const size = footprint(brick);
    for (let z = brick.z; z < brick.z + partHeight(brick); z++) for (let y = brick.y; y < brick.y + size.depth; y++) for (let x = brick.x; x < brick.x + size.width; x++) {
      const key = `${x},${y},${z}`;
      assert.equal(cells.has(key), false, `No overlapping cell ${key}`);
      cells.set(key, brick.colorId);
    }
  }
  return cells;
}

test('one-plate courses seat the recorded Taj plan without filling its openings or changing any colored volume', () => {
  const plan = structuredClone(TAJ_PLATE_PACKING_PLAN), before = structuredClone(plan);
  const original = compilePlan(plan, { prompt: plan.title });
  assert.equal(validateDesign(original).valid, false);
  assert.ok(validateDesign(original).errors.every(error => /no stud support|disconnected groups/.test(error)));
  const plates = compilePlan(plan, { prompt: plan.title, packing: 'plates' });
  assert.equal(validateDesign(plates).valid, true);
  assert.deepEqual(occupied(plates), occupied(original));
  assert.ok(plates.bricks.every(brick => PARTS[brick.partId].kind === 'plate' || brick.partId === '4589'));
  const cones = (design: Design) => design.bricks.filter(brick => brick.partId === '4589').map(({ id: _id, ...brick }) => brick).sort((a, b) => a.x - b.x || a.y - b.y);
  assert.deepEqual(cones(plates), cones(original));
  assert.deepEqual(plan, before);
});

test('plate fallback preserves fixed specialized parts and exact owned stock instead of spending unavailable bricks or colors', () => {
  const plan: ShapePlanV2 = { schemaVersion: 2, coordinateSystem: 'stud-xy-plate-z', title: 'Plate support and cone', description: 'Three plate courses beneath one fixed cone.',
    boxes: [{ x: 0, y: 0, z: 0, width: 2, depth: 2, height: 3, colorId: 15 }], parts: [{ partId: '4589', colorId: 15, x: 0, y: 0, z: 3, rotation: 180 }] };
  const inventory: InventoryItem[] = [{ partId: '3022', colorId: 15, quantity: 3, source: 'Confirmed lot' }, { partId: '4589', colorId: 15, quantity: 1, source: 'Confirmed lot' }];
  const before = structuredClone({ plan, inventory });
  const options = { prompt: plan.title, inventory, ownedOnly: true, maxBricks: 4, packing: 'plates' as const };
  const result = compilePlan(plan, options);
  assert.equal(validateDesign(result).valid, true);
  assert.equal(allocateInventory(result, inventory).totalMissing, 0);
  assert.equal(result.bricks.length, 4);
  assert.deepEqual(result.bricks.filter(brick => brick.partId === '4589').map(({ id: _id, ...brick }) => brick), plan.parts);
  assert.throws(() => compilePlan(plan, { ...options, maxBricks: 3 }), /requested 3-brick budget/);
  assert.throws(() => compilePlan(plan, { ...options, inventory: [{ ...inventory[0], quantity: 2 }, inventory[1], { ...inventory[0], colorId: 4, quantity: 100 }] }), /available inventory/);
  assert.throws(() => compilePlan(plan, { ...options, inventory: [{ ...inventory[0], partId: '3003', quantity: 100 }, inventory[1]] }), /available inventory/);
  assert.deepEqual({ plan, inventory }, before);
});

test('default full-brick packing and legacy behavior remain unchanged unless the V2 plate option is requested', () => {
  const plan = { title: 'Full brick', description: 'A two by two brick.', boxes: [{ x: 0, y: 0, z: 0, width: 2, depth: 2, height: 1, colorId: 15 }] };
  const legacy = compilePlan(plan, { prompt: plan.title });
  assert.equal(legacy.bricks.length, 1); assert.equal(legacy.bricks[0].partId, '3003');
  assert.throws(() => compilePlan(plan, { prompt: plan.title, packing: 'plates' }), /requires a V2 plan/);
  const v2: ShapePlanV2 = { ...plan, schemaVersion: 2, coordinateSystem: 'stud-xy-plate-z', boxes: [{ ...plan.boxes[0], height: 3 }] };
  assert.deepEqual(compilePlan(v2, { prompt: plan.title }).bricks, legacy.bricks);
  const plates = compilePlan(v2, { prompt: plan.title, packing: 'plates' });
  assert.equal(plates.bricks.length, 3);
  assert.deepEqual(occupied(plates), occupied(legacy));
});

test('plate courses cannot fill a missing support layer', () => {
  const plan: ShapePlanV2 = { schemaVersion: 2, coordinateSystem: 'stud-xy-plate-z', title: 'Floating cap', description: 'An actual gap remains.', boxes: [
    { x: 0, y: 0, z: 0, width: 2, depth: 2, height: 3, colorId: 15 }, { x: 0, y: 0, z: 4, width: 2, depth: 2, height: 3, colorId: 15 },
  ] };
  const result = compilePlan(plan, { prompt: plan.title, packing: 'plates' });
  assert.equal(validateDesign(result).valid, false);
  assert.ok(validateDesign(result).errors.some(error => /disconnected groups/.test(error)));
  for (const cell of occupied(result).keys()) assert.notEqual(Number(cell.split(',')[2]), 3);
});

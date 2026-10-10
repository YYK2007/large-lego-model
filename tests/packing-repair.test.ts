import assert from 'node:assert/strict';
import test from 'node:test';
import { repairPacking } from '../server/packing-repair.js';
import { compilePlan, repairCompiledPlan, CompilationDeadlineError } from '../server/compiler.js';
import { compileGeneratedPlan } from '../server/generation.js';
import { PARTS, allocateInventory, footprint, partHeight, validateDesign, CATALOG_VERSION, type Brick, type Design, type InventoryItem } from '../shared/model.js';
import { ELLIPSE_GREEDY_BRICKS } from './fixtures/ellipse-greedy-packing.js';

const design = (bricks: Brick[]): Design => ({ id: 'packing-test', title: 'Packing specimen', description: 'A structural packing regression.', prompt: 'A three dimensional specimen', source: 'ai', createdAt: '2026-10-10T00:00:00Z', schemaVersion: 2, coordinateSystem: 'stud-xy-plate-z', catalogVersion: CATALOG_VERSION, bricks });
const brick = (id: string, partId: string, x: number, z: number): Brick => ({ id, partId, x, y: 0, z, rotation: 0, colorId: 15 });
function occupied(model: Design) {
  const cells = new Map<string, number>();
  for (const brick of model.bricks) {
    const size = footprint(brick);
    for (let z = brick.z; z < brick.z + partHeight(brick); z++) for (let y = brick.y; y < brick.y + size.depth; y++) for (let x = brick.x; x < brick.x + size.width; x++) {
      const key = `${x},${y},${z}`;
      assert.equal(cells.has(key), false, `No overlap at ${key}`);
      cells.set(key, brick.colorId);
    }
  }
  return cells;
}

test('backtracking repairs a curved boundary disconnected by both greedy scan orders without changing a cell', () => {
  for (const bricks of ELLIPSE_GREEDY_BRICKS) {
    const input = design(bricks), before = structuredClone(input);
    assert.deepEqual(validateDesign(input).errors, ['The model contains disconnected groups. Side-to-side contact does not connect studs.']);
    const repaired = repairPacking(input, { fixedIds: new Set() });
    assert.ok(repaired);
    assert.equal(validateDesign(repaired).valid, true);
    assert.deepEqual(occupied(repaired), occupied(input));
    assert.deepEqual(input, before);
    assert.deepEqual(repairPacking(input, { fixedIds: new Set() })?.bricks, repaired.bricks, 'Search bounds and choices are deterministic');
  }
  const compiled = compilePlan({ schemaVersion: 2, coordinateSystem: 'stud-xy-plate-z', title: 'Ellipse cylinder', description: 'An exact curved boundary.', boxes: [],
    profiles: [{ shape: 'ellipse', colorId: 15, sections: [{ z: 0, cx: 8, cy: 8, width: 8, depth: 6 }, { z: 9, cx: 8, cy: 8, width: 8, depth: 6 }] }] }, { prompt: 'Ellipse cylinder' });
  assert.equal(validateDesign(compiled).valid, true);
  assert.deepEqual(occupied(compiled), occupied(design(ELLIPSE_GREEDY_BRICKS[0])));
});

test('repacking can replace an early full brick with a bridging plate and stacked plates of identical volume', () => {
  const input = design([brick('base', '3005', 0, 0), brick('early', '3005', 0, 3), brick('stranded', '3024', 1, 3)]);
  assert.match(validateDesign(input).errors.join(';'), /no stud support/);
  const repaired = repairPacking(input, { fixedIds: new Set(['base']), maxBricks: 4 });
  assert.ok(repaired); assert.equal(validateDesign(repaired).valid, true);
  assert.equal(repaired.bricks.length, 4);
  assert.ok(repaired.bricks.some(brick => brick.partId === '3023' && brick.rotation === 90 && brick.x === 0 && brick.z === 3));
  assert.deepEqual(occupied(repaired), occupied(input));
  assert.equal(repairPacking(input, { fixedIds: new Set(['base']), maxBricks: 3 }), null, 'A solution that needs more pieces cannot exceed the requested budget');
});

test('a ten-plate opening gets a supported header by retiling the adjacent lower course, not shortening the opening', () => {
  const plan = { schemaVersion: 2 as const, coordinateSystem: 'stud-xy-plate-z' as const, title: 'Offset header', description: 'A header at z25 between ordinary three-plate courses.', boxes: [
    { x: 0, y: 0, z: 0, width: 10, depth: 6, height: 12, colorId: 15 },
    { x: 0, y: 0, z: 12, width: 10, depth: 6, height: 18, colorId: 15, cutouts: [{ x: 2, y: 0, z: 3, width: 6, depth: 3, height: 10 }] },
  ] };
  const expected = new Map<string, number>();
  for (let z = 0; z < 30; z++) for (let y = 0; y < 6; y++) for (let x = 0; x < 10; x++) {
    if (z >= 15 && z < 25 && x >= 2 && x < 8 && y < 3) continue;
    expected.set(`${x},${y},${z}`, 15);
  }
  const before = structuredClone(plan);
  for (const scanOrder of ['y-major', 'x-major'] as const) {
    const result = compilePlan(plan, { prompt: plan.title, scanOrder });
    assert.equal(validateDesign(result).valid, true);
    assert.deepEqual(occupied(result), expected);
    assert.ok(result.bricks.some(brick => brick.z === 24 && partHeight(brick) === 1), 'A real plate ends at the header height');
  }
  assert.deepEqual(plan, before);
});

test('fixed specialized parts, exact colors, owned quantities and budgets survive a repair', () => {
  const input = design([brick('base', '3004', 0, 0), brick('left', '3005', 0, 3), brick('right', '3005', 1, 3), brick('cone', '4589', 1, 6)]);
  const inventory: InventoryItem[] = [ ['3004', 2], ['3005', 2], ['4589', 1] ].map(([partId, quantity]) => ({ partId: String(partId), quantity: Number(quantity), colorId: 15, source: 'Confirmed test lot' }));
  const before = structuredClone({ input, inventory });
  const options = { fixedIds: new Set(['base', 'cone']), inventory, ownedOnly: true, maxBricks: 3 };
  const repaired = repairPacking(input, options);
  assert.ok(repaired); assert.equal(validateDesign(repaired).valid, true);
  assert.equal(allocateInventory(repaired, inventory).totalMissing, 0);
  assert.deepEqual(occupied(repaired), occupied(input));
  const { id: _oldId, ...originalCone } = input.bricks[3];
  const { id: _newId, ...newCone } = repaired.bricks.find(brick => brick.partId === '4589')!;
  assert.deepEqual(newCone, originalCone);
  assert.equal(repairPacking(input, { ...options, maxBricks: 2 }), null);
  assert.equal(repairPacking(input, { ...options, fixedIds: new Set(['base', 'left', 'cone']) }), null, 'A fixed rectangular part also cannot be moved');
  const shortage = [{ ...inventory[0], quantity: 1 }, ...inventory.slice(1), { ...inventory[0], colorId: 4, quantity: 100 }];
  assert.equal(repairPacking(input, { ...options, inventory: shortage }), null, 'Other colors and exhausted owned parts are unavailable');
  assert.equal(repairPacking(input, { fixedIds: new Set(['base', 'cone']), allowedPartIds: new Set(['3005']) }), null, 'Legacy part restrictions are retained');
  assert.deepEqual({ input, inventory }, before);
});

test('truly floating volume remains rejected and a failed search leaves its cells and caller data unchanged', () => {
  const plan = { schemaVersion: 2 as const, coordinateSystem: 'stud-xy-plate-z' as const, title: 'Floating cap', description: 'A cap one plate above its support.', boxes: [
    { x: 0, y: 0, z: 0, width: 2, depth: 2, height: 3, colorId: 15 }, { x: 0, y: 0, z: 4, width: 2, depth: 2, height: 3, colorId: 15 },
  ] };
  const input = compilePlan(plan, { prompt: plan.title }), before = structuredClone(input);
  assert.match(validateDesign(input).errors.join(';'), /no stud support/);
  assert.equal(repairPacking(input, { fixedIds: new Set() }), null);
  assert.deepEqual(input, before);
  assert.throws(() => compileGeneratedPlan(plan, { prompt: plan.title }), /no stud support/);
});

test('a useful local repair survives an unrelated floating region with exact stock and fixed parts intact', () => {
  const input = design([brick('base', '3004', 0, 0), brick('left', '3005', 0, 3), brick('right', '3005', 1, 3), brick('cone', '4589', 1, 6),
    { ...brick('remote-base', '3005', 20, 0), colorId: 4 }, { ...brick('remote-cap', '3005', 20, 4), colorId: 4 }]);
  const inventory: InventoryItem[] = [
    { partId: '3004', colorId: 15, quantity: 2, source: 'Confirmed lot' }, { partId: '3005', colorId: 15, quantity: 2, source: 'Confirmed lot' },
    { partId: '4589', colorId: 15, quantity: 1, source: 'Confirmed lot' }, { partId: '3005', colorId: 4, quantity: 2, source: 'Confirmed lot' },
  ];
  const before = structuredClone({ input, inventory });
  assert.equal(validateDesign(input).errors.filter(error => /no stud support/.test(error)).length, 2);
  const partial = repairPacking(input, { fixedIds: new Set(['base', 'cone']), inventory, ownedOnly: true, maxBricks: 5 });
  assert.ok(partial);
  const check = validateDesign(partial);
  assert.equal(check.valid, false);
  const remote = partial.bricks.find(brick => brick.x === 20 && brick.z === 4)!;
  assert.deepEqual(check.errors.filter(error => /no stud support/.test(error)), [`Brick ${remote.id} has no stud support directly below it.`]);
  assert.deepEqual(occupied(partial), occupied(input));
  assert.equal(allocateInventory(partial, inventory).totalMissing, 0);
  assert.ok(partial.bricks.length <= 5);
  for (const id of ['base', 'cone']) {
    const { id: _id, ...fixed } = input.bricks.find(brick => brick.id === id)!;
    assert.ok(partial.bricks.some(({ id: _newId, ...placement }) => JSON.stringify(placement) === JSON.stringify(fixed)));
  }
  assert.deepEqual({ input, inventory }, before);
});

test('generation still rejects the unrepaired region after retaining a supported header', () => {
  const plan = { schemaVersion: 2 as const, coordinateSystem: 'stud-xy-plate-z' as const, title: 'Header and floating cap', description: 'Only the header is repairable.', boxes: [
    { x: 0, y: 0, z: 0, width: 10, depth: 6, height: 12, colorId: 15 },
    { x: 0, y: 0, z: 12, width: 10, depth: 6, height: 18, colorId: 15, cutouts: [{ x: 2, y: 0, z: 3, width: 6, depth: 3, height: 10 }] },
    { x: 20, y: 0, z: 0, width: 1, depth: 1, height: 3, colorId: 4 }, { x: 20, y: 0, z: 4, width: 1, depth: 1, height: 3, colorId: 4 },
  ] };
  const compiled = compilePlan(plan, { prompt: plan.title }), check = validateDesign(compiled);
  assert.equal(check.valid, false);
  assert.equal(check.errors.filter(error => /no stud support/.test(error)).length, 1);
  assert.ok(compiled.bricks.some(brick => brick.z === 24 && partHeight(brick) === 1));
  assert.throws(() => compileGeneratedPlan(plan, { prompt: plan.title }), error => {
    assert.match(String(error), /x=20, y=0, z=4 plates/);
    assert.doesNotMatch(String(error).split('Plan support diagnostics:')[0], /z=25 plates/);
    return true;
  });
});

test('already connected packing is retained unchanged', () => {
  const input = design([brick('base', '3005', 0, 0), brick('top', '3005', 0, 3)]);
  assert.equal(repairPacking(input, { fixedIds: new Set() }), input);
});

test('a delayed repair uses the quick compile stock, budget and fixed-piece snapshot rather than mutated caller options', () => {
  const plan = { schemaVersion: 2 as const, coordinateSystem: 'stud-xy-plate-z' as const, title: 'Quick curved specimen', description: 'An ellipse with a fixed cone.', boxes: [],
    profiles: [{ shape: 'ellipse' as const, colorId: 15, sections: [{ z: 0, cx: 8, cy: 8, width: 8, depth: 6 }, { z: 9, cx: 8, cy: 8, width: 8, depth: 6 }] }],
    parts: [{ partId: '4589', colorId: 15, x: 8, y: 8, z: 9, rotation: 0 as const }] };
  const inventory = Object.values(PARTS).filter(part => part.allowedColors.includes(15)).map(part => ({ partId: part.id, colorId: 15, quantity: 1000, source: 'Snapshot lot' }));
  const stock = structuredClone(inventory), fixed = structuredClone(plan.parts);
  const options = { prompt: plan.title, inventory, ownedOnly: true, maxBricks: 100, repair: false };
  const quick = compilePlan(plan, options), before = structuredClone(quick);
  assert.equal(validateDesign(quick).valid, false);
  for (const item of inventory) item.quantity = 0;
  options.maxBricks = 1; options.ownedOnly = false; plan.parts[0].x = 90;
  const repaired = repairCompiledPlan(quick);
  assert.equal(validateDesign(repaired).valid, true);
  assert.equal(allocateInventory(repaired, stock).totalMissing, 0);
  assert.deepEqual(repaired.bricks.filter(brick => brick.partId === '4589').map(({ id: _id, ...brick }) => brick), fixed);
  assert.deepEqual(occupied(repaired), occupied(quick));
  assert.deepEqual(quick, before);
  assert.deepEqual(Object.keys(quick), Object.keys(before), 'No compiler context fields enter the saved design');
  assert.deepEqual(JSON.parse(JSON.stringify(quick)), before);
});

test('compilation checks its absolute deadline during work, before returning a partial packing', t => {
  let reads = 0;
  t.mock.method(Date, 'now', () => ++reads <= 4 ? 0 : 100);
  const plan = { schemaVersion: 2 as const, coordinateSystem: 'stud-xy-plate-z' as const, title: 'Timed volume', description: 'A painting-loop deadline specimen.', boxes: [
    { x: 0, y: 0, z: 0, width: 8, depth: 8, height: 12, colorId: 15 },
  ] };
  const before = structuredClone(plan);
  assert.throws(() => compilePlan(plan, { prompt: plan.title, deadline: 50, repair: false }), CompilationDeadlineError);
  assert.ok(reads > 4, 'Work began before the clock advanced past the deadline');
  assert.deepEqual(plan, before);
});

test('delayed repair cannot extend the compile deadline and an expired search leaves its input untouched', t => {
  let now = 0;
  t.mock.method(Date, 'now', () => now);
  const plan = { schemaVersion: 2 as const, coordinateSystem: 'stud-xy-plate-z' as const, title: 'Delayed floating cap', description: 'An invalid design must remain invalid after its time budget.', boxes: [
    { x: 0, y: 0, z: 0, width: 2, depth: 2, height: 3, colorId: 15 }, { x: 0, y: 0, z: 4, width: 2, depth: 2, height: 3, colorId: 15 },
  ] };
  const quick = compilePlan(plan, { prompt: plan.title, repair: false, deadline: 100 }), before = structuredClone(quick);
  now = 100;
  assert.equal(repairCompiledPlan(quick, { deadline: 1000 }), quick);
  assert.equal(repairPacking(quick, { fixedIds: new Set(), deadline: 100 }), null);
  assert.deepEqual(quick, before);
  assert.equal(validateDesign(quick).valid, false);
});

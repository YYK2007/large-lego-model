import test from 'node:test';
import assert from 'node:assert/strict';
import { compileGeneratedPlan, GenerationError, validateInput, validateInventory, volumetricErrors } from '../server/generation.js';
import { compilePlan, type ShapePlanV2 } from '../server/compiler.js';
import { type Design } from '../shared/model.js';

const plan = (height = 9): ShapePlanV2 => ({ schemaVersion: 2, coordinateSystem: 'stud-xy-plate-z', title: 'Volumetric body', description: 'A small solid shape for admission checks.', boxes: [{ x: 0, y: 0, z: 0, width: 4, depth: 4, height, colorId: 4 }], slopes: [] });

test('AI admission requires explicit V2 units, even though the compiler supports legacy plans', () => {
  const { schemaVersion, coordinateSystem, ...legacy } = plan();
  assert.throws(() => compileGeneratedPlan(legacy, { prompt: 'A red sculpture' }), /explicitly use schemaVersion 2/);
  assert.throws(() => compileGeneratedPlan({ ...plan(), coordinateSystem: 'brick-layers' } as unknown as ShapePlanV2, { prompt: 'A red sculpture' }), /stud-xy-plate-z/);
  const result = compileGeneratedPlan(plan(), { prompt: 'A red sculpture' });
  assert.equal(result.schemaVersion, 2);
  assert.equal(result.bricks.length, 6);
});

test('volume admission measures occupied physical height rather than inflating a thin plate stack', () => {
  const thin = compilePlan(plan(2), { prompt: 'Thin plate slab' });
  assert.equal(thin.bricks.length > 0, true);
  assert.equal(volumetricErrors(thin).length, 1);
  assert.throws(() => compileGeneratedPlan(plan(2), { prompt: 'A three dimensional sculpture' }), /body is too flat/);
  assert.equal(compileGeneratedPlan(plan(2), { prompt: 'A flat mosaic' }).schemaVersion, 2);
  const full = compilePlan(plan(9), { prompt: 'Volumetric shape' });
  const legacy: Design = { ...full, schemaVersion: undefined, coordinateSystem: undefined, catalogVersion: undefined, bricks: full.bricks.map(brick => ({ ...brick, z: brick.z / 3 })) };
  assert.deepEqual(volumetricErrors(legacy), volumetricErrors(full));
  assert.deepEqual(volumetricErrors(full), []);
});

test('AI admission rejects a cap over the slopes low row rather than treating the whole footprint as studded', () => {
  const badRoof: ShapePlanV2 = { ...plan(), boxes: [
    { x: 0, y: 0, z: 0, width: 4, depth: 2, height: 3, colorId: 71 },
    { x: 0, y: 0, z: 6, width: 1, depth: 1, height: 3, colorId: 15 },
  ], slopes: [{ kind: 'upright45', x: 0, y: 0, z: 3, width: 4, rotation: 0, colorId: 4 }] };
  assert.throws(() => compileGeneratedPlan(badRoof, { prompt: 'A flat roof test' }), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /disconnected groups/);
    assert.match(error.message, /"x":0,"y":0,"z":6/);
    assert.match(error.message, /"nearestAlignedStudGapPlates":3/,
      'The empty low row of the slope is not mistaken for a stud at z6');
    return true;
  });
});

test('support feedback locates the nearest real stud under a footprint and reports the exact plate gap', () => {
  const floating: ShapePlanV2 = { ...plan(), boxes: [], parts: [
    { partId: '3003', colorId: 4, x: 0, y: 0, z: 0, rotation: 0 },
    { partId: '3005', colorId: 4, x: 0, y: 0, z: 3, rotation: 0 },
    { partId: '3024', colorId: 15, x: 0, y: 0, z: 8, rotation: 0 },
  ] };
  assert.throws(() => compileGeneratedPlan(floating, { prompt: 'A flat support check' }), /"nearestAlignedStudGapPlates":2/);
  const noColumn = { ...floating, parts: [floating.parts![0], { ...floating.parts![2], x: 6, y: 6 }] };
  assert.throws(() => compileGeneratedPlan(noColumn, { prompt: 'A flat support check' }), /"nearestAlignedStudGapPlates":null/);
});

test('narrow plates preserve the thin clock-face trim that previously rejected the Bell Tower', () => {
  const trim = { x: 0, y: 0, z: 9, width: 1, depth: 4, height: 4, colorId: 15 };
  const result = compileGeneratedPlan({ ...plan(), boxes: [...plan().boxes, trim] }, { prompt: 'A clock tower' });
  const white = result.bricks.filter(brick => brick.colorId === 15);
  assert.ok(white.some(brick => brick.partId === '3710' && brick.z === 12));
  assert.equal(Math.max(...white.map(brick => brick.z)), 12, 'The four-plate-high detail is preserved, not inflated to six');
});

test('previous legacy revisions validate without mutating coordinates and unknown versions get HTTP 400', () => {
  const full = compilePlan(plan(), { prompt: 'Previous design' });
  const legacy: Design = { ...full, schemaVersion: undefined, coordinateSystem: undefined, catalogVersion: undefined, bricks: full.bricks.map(brick => ({ ...brick, z: brick.z / 3 })) };
  const before = JSON.stringify(legacy);
  validateInput({ prompt: 'Change red to green', previous: legacy });
  assert.equal(JSON.stringify(legacy), before);
  assert.throws(() => validateInput({ prompt: 'Change red to green', previous: { ...full, schemaVersion: 99 } as unknown as Design }), (error: unknown) => error instanceof GenerationError && error.status === 400);
});

test('piece limits are optional and have no application ceiling', () => {
  validateInput({ prompt: 'A detailed castle' });
  for (const maxBricks of [1, 161, 2000, Number.MAX_SAFE_INTEGER]) validateInput({ prompt: 'A detailed castle', maxBricks });
  for (const maxBricks of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => validateInput({ prompt: 'A castle', maxBricks }), (error: unknown) => error instanceof GenerationError && error.status === 400);
  }
  // Fixed placements keep this admission test independent of future packing efficiencies.
  const large: ShapePlanV2 = { ...plan(), boxes: [], parts: [
    { partId: '3036', colorId: 4, x: 0, y: 0, z: 0, rotation: 0 },
    ...Array.from({ length: 6 }, (_, layer) => Array.from({ length: 8 }, (_, y) => Array.from({ length: 6 }, (_, x) => ({ partId: '3005', colorId: 4, x, y, z: 1 + layer * 3, rotation: 0 as const })))).flat(2),
  ] };
  const design = compileGeneratedPlan(large, { prompt: 'A solid volume for testing piece admission' });
  assert.ok(design.bricks.length > 160);
  assert.equal(design.bricks.length, large.parts!.length, 'Every explicit piece survives admission');
  assert.throws(() => compileGeneratedPlan(large, { prompt: 'An explicit small budget', maxBricks: 100 }), /100-brick budget/);
  assert.equal(compileGeneratedPlan(large, { prompt: 'An explicit larger budget', maxBricks: 2000 }).bricks.length, design.bricks.length);
});

test('bulk inventory uses exact safe integer quantities without the old 10000-piece cap', () => {
  const item = { partId: '3001', colorId: 4, quantity: 10001, source: 'Confirmed bulk collection' };
  validateInventory([item]);
  validateInventory([{ ...item, quantity: Number.MAX_SAFE_INTEGER }]);
  for (const quantity of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => validateInventory([{ ...item, quantity }]), (error: unknown) => error instanceof GenerationError && error.status === 400);
  }
});

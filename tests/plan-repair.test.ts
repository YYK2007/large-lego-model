import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlanRepair, describeRepairPlan, repairSchema, type PlanRepairEdit } from '../server/plan-repair.js';
import { compileGeneratedPlan } from '../server/generation.js';
import { compilePlan, type ShapePlanV2 } from '../server/compiler.js';
import { partHeight, validateDesign } from '../shared/model.js';

const plan: ShapePlanV2 & { observations: { usedImages: number[]; silhouette: string } } = {
  schemaVersion: 2, coordinateSystem: 'stud-xy-plate-z', title: 'Tower geometry repair specimen', description: 'A solid shaft and a cap with an accidental one-plate gap.',
  boxes: [
    { x: 0, y: 0, z: 0, width: 4, depth: 4, height: 12, colorId: 15 },
    { x: 0, y: 0, z: 13, width: 4, depth: 4, height: 3, colorId: 4 },
  ], slopes: [], observations: { usedImages: [0], silhouette: 'Tall tower with red cap.' },
};
const edit = (path: string, value: unknown, op: PlanRepairEdit['op'] = 'replace'): PlanRepairEdit => ({ op, path, valueJson: JSON.stringify(value) });

test('repair context identifies actual nested indices and part fields without truncating later geometry', () => {
  const source: ShapePlanV2 = { ...plan,
    parts: Array.from({ length: 60 }, (_, x) => ({ partId: '3024', colorId: 4, x, y: 0, z: 0, rotation: 0 })),
    repeats: [{ count: 2, dx: 6, dy: 0, dz: 0, profiles: [{ shape: 'ellipse', colorId: 4,
      sections: [{ z: 0, cx: 3, cy: 3, width: 6, depth: 6 }, { z: 9, cx: 3, cy: 3, width: 4, depth: 4 }] }] }],
  };
  const before = JSON.stringify(source), context = describeRepairPlan(source);
  const lastPart = context.split('\n').find(line => line.startsWith('/parts/59: '))!;
  assert.deepEqual(JSON.parse(lastPart.slice('/parts/59: '.length)), source.parts![59]);
  assert.doesNotMatch(lastPart, /width|depth|height/);
  assert.match(context, /\/parts: array with 60 items; append with \/parts\/-/);
  assert.match(context, /\/repeats\/0\/profiles\/0\/sections\/1: .*"z":9/);
  assert.equal(JSON.stringify(source), before);
});

test('one scalar correction repairs a floating cap without resending the plan or changing observations', () => {
  const floating = compilePlan(plan, { prompt: 'A tower' });
  const shaftTop = Math.max(...floating.bricks.filter(brick => brick.colorId === 15).map(brick => brick.z + partHeight(brick)));
  const capBottom = Math.min(...floating.bricks.filter(brick => brick.colorId === 4).map(brick => brick.z));
  assert.equal(capBottom - shaftTop, 1, 'The cap is separated from the grounded shaft by one plate of air');
  assert.equal(validateDesign(floating).valid, false);
  assert.throws(() => compileGeneratedPlan(plan, { prompt: 'A tower' }), /disconnected groups/);
  const before = JSON.stringify(plan);
  const repaired = applyPlanRepair(plan, [edit('/boxes/1/z', 12)]);
  const design = compileGeneratedPlan(repaired, { prompt: 'A tower' });
  assert.equal(validateDesign(design).valid, true);
  assert.equal(JSON.stringify(plan), before);
  assert.deepEqual((repaired as typeof plan).observations, plan.observations);
  assert.equal(repaired.title, plan.title);
  assert.deepEqual(repaired.boxes[0], plan.boxes[0]);
  assert.notEqual(repaired.boxes, plan.boxes, 'Returned geometry is independent of the source plan');
});

test('ordered array add, append, replace, and remove use JSON pointer indices', () => {
  const result = applyPlanRepair(plan, [
    edit('/boxes/1', { ...plan.boxes[1], z: 12 }, 'add'),
    { op: 'remove', path: '/boxes/2', valueJson: '{ignored invalid JSON' },
    edit('/parts', [], 'add'),
    edit('/parts/-', { partId: '4589', colorId: 4, x: 0, y: 0, z: 15, rotation: 0 }, 'add'),
    edit('/parts/0/colorId', 15),
  ]);
  assert.equal(result.boxes.length, 2);
  assert.equal(result.boxes[1].z, 12);
  assert.equal(result.parts?.[0].colorId, 15);
});

test('nested cutouts and repeated geometry can be repaired while metadata cannot', () => {
  const nested: ShapePlanV2 = { ...plan, repeats: [{ count: 2, dx: 6, dy: 0, dz: 0, boxes: [{ ...plan.boxes[0], cutouts: [{ x: 1, y: 1, z: 3, width: 2, depth: 2, height: 9 }] }] }] };
  const repaired = applyPlanRepair(nested, [edit('/repeats/0/boxes/0/cutouts/0/z', 6), edit('/repeats/0/count', 3)]);
  assert.equal(repaired.repeats?.[0].boxes?.[0].cutouts?.[0].z, 6);
  assert.equal(repaired.repeats?.[0].count, 3);
  for (const path of ['/title', '/observations/usedImages/0', '/schemaVersion', '/coordinateSystem']) assert.throws(() => applyPlanRepair(plan, [edit(path, 9)]), /safe geometry fields/);
});

test('malformed and nonexistent paths are rejected instead of creating sparse arrays or parent objects', () => {
  for (const path of ['', '/', 'boxes/0/z', '/boxes//z', '/boxes/01/z', '/boxes/-1/z', '/boxes/1.5/z', '/boxes/1e0/z', '/boxes/9007199254740992', '/boxes/4/z', '/boxes/-/z', '/boxes/0/missing/z', '/boxes/0/z/nested', '/boxes/0/x~2']) {
    assert.throws(() => applyPlanRepair(plan, [edit(path, 1)]), /Repair/);
  }
  assert.throws(() => applyPlanRepair(plan, [edit('/parts/0', {}, 'add')]), /parent path does not exist.*\/parts\/0/);
  assert.throws(() => applyPlanRepair(plan, [edit('/boxes/4', {}, 'add')]), /index does not exist/);
  assert.throws(() => applyPlanRepair(plan, [edit('/boxes/-', {})]), /array index/);
  assert.throws(() => applyPlanRepair(plan, [edit('/boxes/0/missing', 3)]), /target path does not exist.*\/boxes\/0\/missing/);
  assert.throws(() => applyPlanRepair(plan, [edit('/boxes', {})]), /must remain arrays/);
});

test('prototype keys are blocked in every path position and nested JSON values', () => {
  for (const path of ['/__proto__/polluted', '/boxes/__proto__/polluted', '/boxes/0/constructor/prototype/polluted', '/boxes/0/prototype', '/boxes/0/__proto__']) {
    assert.throws(() => applyPlanRepair(plan, [edit(path, true, 'add')]), /safe geometry/);
  }
  for (const valueJson of ['{"__proto__":{"polluted":true}}', '{"nested":[{"constructor":{"prototype":{"polluted":true}}}]}']) {
    assert.throws(() => applyPlanRepair(plan, [{ op: 'add', path: '/boxes/-', valueJson }]), /prototype keys/);
  }
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
});

test('any failed edit leaves the original plan byte-for-byte unchanged', () => {
  const before = JSON.stringify(plan);
  assert.throws(() => applyPlanRepair(plan, [edit('/boxes/1/z', 12), edit('/boxes/8/z', 5)]), /does not exist/);
  assert.equal(JSON.stringify(plan), before);
  assert.throws(() => applyPlanRepair(plan, [edit('/boxes/1/z', 12), { op: 'replace', path: '/boxes/0/height', valueJson: 'not JSON' }]), /not valid JSON/);
  assert.equal(JSON.stringify(plan), before);
});

test('edit count, payload, finite values, and nesting are bounded without imposing a piece limit', () => {
  assert.equal(Object.hasOwn(repairSchema.properties.edits, 'minItems'), false, 'Provider rejected these schema bounds; local admission still enforces them');
  assert.equal(Object.hasOwn(repairSchema.properties.edits, 'maxItems'), false);
  for (const edits of [null, [], Array.from({ length: 81 }, () => edit('/boxes/0/z', 0)), [{ op: 'move', path: '/boxes/0', valueJson: '{}' }]]) {
    assert.throws(() => applyPlanRepair(plan, edits), /repair edits|Each repair/);
  }
  assert.throws(() => applyPlanRepair(plan, [edit('/boxes/0/z', 'x'.repeat(100_001))]), /payload/);
  assert.throws(() => applyPlanRepair(plan, [{ op: 'replace', path: '/boxes/0/z', valueJson: '1e999' }]), /finite/);
  assert.throws(() => applyPlanRepair(plan, [{ op: 'add', path: '/parts', valueJson: '['.repeat(34) + '0' + ']'.repeat(34) }]), /nested too deeply/);
  const many: ShapePlanV2 = { ...plan, boxes: Array.from({ length: 500 }, () => ({ ...plan.boxes[0] })) };
  assert.equal(applyPlanRepair(many, [edit('/boxes/499/z', 6)]).boxes.length, 500);
});

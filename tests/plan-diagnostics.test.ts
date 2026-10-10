import assert from 'node:assert/strict';
import test from 'node:test';
import { compilePlan, type ShapePlanV2 } from '../server/compiler.js';
import { diagnosePlanSupport } from '../server/plan-diagnostics.js';
import { validateDesign } from '../shared/model.js';

const base = (changes: Partial<ShapePlanV2> = {}): ShapePlanV2 => ({ schemaVersion: 2, coordinateSystem: 'stud-xy-plate-z', title: 'Diagnostics specimen', description: 'A source attribution specimen.', boxes: [], ...changes });
const box = (x = 0, y = 0, z = 0, width = 2, depth = 2, height = 3, colorId = 4) => ({ x, y, z, width, depth, height, colorId });
const piece = (z = 0, x = 0) => ({ partId: '3005', colorId: 4, x, y: 0, z, rotation: 0 as const });
const inspect = (plan: ShapePlanV2) => diagnosePlanSupport(plan, compilePlan(plan, { prompt: plan.title }));

test('floating cap diagnostics identify the source box and actual one-plate gap without mutating the plan', () => {
  const plan = base({ boxes: [box(0, 0, 0, 2, 2, 9), box(0, 0, 10)] }), before = structuredClone(plan), result = inspect(plan);
  assert.equal(result.unsupportedPieceCount, 1); assert.equal(result.disconnectedComponents, 2);
  assert.deepEqual(result.groups[0].sources, [{ path: '/boxes/1' }]);
  assert.equal(result.groups[0].bottomZ, 10);
  assert.equal(result.groups[0].nearestAlignedStudGapPlates, 1);
  assert.equal(result.groups[0].occupiedBodyEnvelopeSitesBelow, 0);
  assert.deepEqual(plan, before);
});

test('later box overlays own their surviving colored cells rather than every intersecting box', () => {
  const result = inspect(base({ boxes: [box(0, 0, 0, 4, 2), box(0, 0, 4, 4, 2), box(2, 0, 4, 2, 2, 3, 15)] }));
  assert.equal(result.groups.length, 2);
  assert.deepEqual(result.groups.map(group => [group.colorId, group.sources]), [[4, [{ path: '/boxes/1' }]], [15, [{ path: '/boxes/2' }]]]);
});

test('repeated explicit pieces retain their editable template pointer, copy index and translation', () => {
  const result = inspect(base({ parts: [piece()], repeats: [{ parts: [piece(4)], count: 2, dx: 5, dy: 0, dz: 0 }] }));
  assert.equal(result.groups.length, 2);
  assert.deepEqual(result.groups.map(group => group.sources), [0, 1].map(copy => [{ path: '/repeats/0/parts/0', copy, translation: { x: 5 * copy, y: 0, z: 0 } }]));
  assert.equal(result.groups[0].nearestAlignedStudGapPlates, 1);
  assert.equal(result.groups[1].nearestAlignedStudGapPlates, null);
});

test('hollow room diagnostics point to the local cutout that removed material under a floating interior part', () => {
  const plan = base({ boxes: [{ ...box(0, 0, 0, 5, 5), cutouts: [{ x: 1, y: 1, z: 0, width: 3, depth: 3, height: 3 }] }], parts: [{ ...piece(3, 2), y: 2 }] });
  const result = inspect(plan), group = result.groups[0];
  assert.deepEqual(group.sources, [{ path: '/parts/0' }]);
  assert.deepEqual(group.cutoutsBelow, [{ source: { path: '/boxes/0' }, path: '/boxes/0/cutouts/0' }]);
  assert.equal(group.occupiedBodyEnvelopeSitesBelow, 0);
  assert.equal(group.nearestSameHeightStudDistance, 2);
  assert.equal(group.nearestAlignedStudGapPlates, null);
});

test('translated local cuts retain the repeat copy and successful supports produce no false error group', () => {
  const plan = base({ repeats: [{ boxes: [{ ...box(0, 0, 0, 5, 5), cutouts: [{ x: 1, y: 1, z: 0, width: 3, depth: 3, height: 3 }] }], parts: [{ ...piece(3, 2), y: 2 }], count: 2, dx: 8, dy: 0, dz: 0 }] });
  const result = inspect(plan);
  assert.deepEqual(result.groups[1].cutoutsBelow[0], { source: { path: '/repeats/0/boxes/0', copy: 1, translation: { x: 8, y: 0, z: 0 } }, path: '/repeats/0/boxes/0/cutouts/0' });
  const supportedPlan = base({ boxes: [box(0, 0, 0, 2, 2, 9)] }), model = compilePlan(supportedPlan, { prompt: 'Supported tower' });
  assert.equal(validateDesign(model).valid, true);
  assert.equal(diagnosePlanSupport(supportedPlan, model).unsupportedPieceCount, 0);
  assert.deepEqual(diagnosePlanSupport(supportedPlan, model).groups, []);
});

test('a studless tile occupying a cutout is distinguished from a missing body beneath a part', () => {
  const plan = base({ boxes: [{ ...box(0, 0, 0, 5, 5, 1), cutouts: [{ x: 1, y: 1, z: 0, width: 3, depth: 3, height: 1 }] }],
    parts: [{ partId: '3068b', colorId: 4, x: 1, y: 1, z: 0, rotation: 0 }, { ...piece(1, 1), y: 1 }] });
  const result = inspect(plan);
  assert.equal(result.unsupportedPieceCount, 1);
  assert.equal(result.groups[0].occupiedBodyEnvelopeSitesBelow, 1);
  assert.deepEqual(result.groups[0].cutoutsBelow, []);
});

test('group truncation reports omissions rather than silently hiding unexamined source structures', () => {
  const result = inspect(base({ parts: Array.from({ length: 12 }, (_, i) => piece(3, i * 2)) }));
  assert.equal(result.unsupportedPieceCount, 12); assert.equal(result.groups.length, 8); assert.equal(result.omittedGroups, 4);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { compilePlan, type ShapePlanV2 } from '../server/compiler.js';
import { allocateInventory, billOfMaterials, validateDesign, type InventoryItem } from '../shared/model.js';

const plan: ShapePlanV2 = {
  schemaVersion: 2, coordinateSystem: 'stud-xy-plate-z', title: 'Inset real parts', description: 'A continuous body with whole colored detail pieces replacing its filler.',
  boxes: [], profiles: [{ shape: 'rectangle', colorId: 15, sections: [
    { z: 0, cx: 4, cy: 2, width: 8, depth: 4 }, { z: 6, cx: 4, cy: 2, width: 8, depth: 4 },
  ] }],
  parts: [{ partId: '3068b', colorId: 4, x: 3, y: 1, z: 5, rotation: 0 }],
  repeats: [{ count: 2, dx: 6, dy: 0, dz: 0, parts: [{ partId: '3040b', colorId: 4, x: 0, y: 1, z: 3, rotation: 90 }] }],
};
const compile = (candidate: ShapePlanV2) => compilePlan(candidate, { prompt: candidate.title, packing: 'plates' });

test('declared part replacement matches deliberate cutouts, retaining exact fixed shapes and colors', () => {
  const replacement: ShapePlanV2 = { ...plan, partPlacement: 'replace-volume' };
  const before = structuredClone(replacement);
  assert.throws(() => compile(plan), /explicit part envelope overlaps/);
  const expected = compile({ ...plan, profiles: [], boxes: [{ x: 0, y: 0, z: 0, width: 8, depth: 4, height: 6, colorId: 15, cutouts: [
    { x: 3, y: 1, z: 5, width: 2, depth: 2, height: 1 },
    { x: 0, y: 1, z: 3, width: 2, depth: 1, height: 3 },
    { x: 6, y: 1, z: 3, width: 2, depth: 1, height: 3 },
  ] }] });
  const actual = compile(replacement);
  assert.equal(validateDesign(actual).valid, true);
  assert.deepEqual(actual.bricks, expected.bricks, 'The fixed slopes keep their empty wedges; filler never occupies any reserved envelope');
  assert.equal(actual.bricks.filter(brick => brick.partId === '3040b').length, 2);
  assert.equal(actual.bricks.filter(brick => brick.partId === '3068b').length, 1);
  assert.deepEqual(replacement, before);
});

test('slope runs in repeated groups replace only their declared filler envelope', () => {
  const replacement: ShapePlanV2 = { schemaVersion: 2, coordinateSystem: 'stud-xy-plate-z', title: 'Repeated sloped surfaces', description: 'Whole real slopes on a connected foundation.', partPlacement: 'replace-volume',
    boxes: [{ x: 0, y: 0, z: 0, width: 4, depth: 4, height: 6, colorId: 15 }],
    repeats: [{ count: 2, dx: 0, dy: 2, dz: 0, slopes: [{ kind: 'upright45', x: 0, y: 0, z: 3, width: 4, rotation: 0, colorId: 4 }] }],
  };
  const expected = compile({ ...replacement, partPlacement: undefined, boxes: [{ ...replacement.boxes[0], height: 3 }] });
  const actual = compile(replacement);
  assert.equal(validateDesign(actual).valid, true);
  assert.deepEqual(actual.bricks, expected.bricks);
  assert.equal(actual.bricks.filter(brick => brick.partId === '3039' && brick.colorId === 4).length, 4);
});

test('replacement never overwrites another fixed part or slope, even with identical part and color', () => {
  const replacement: ShapePlanV2 = { ...plan, partPlacement: 'replace-volume' };
  assert.throws(() => compile({ ...replacement, parts: [...plan.parts!, ...plan.parts!] }), /explicit part envelope overlaps/);
  assert.throws(() => compile({ ...replacement, parts: [], repeats: [], slopes: [
    { kind: 'upright45', x: 0, y: 0, z: 3, width: 4, rotation: 0, colorId: 4 },
    { kind: 'upright45', x: 2, y: 0, z: 3, width: 2, rotation: 0, colorId: 4 },
  ] }), /slope envelope overlaps/);
  assert.throws(() => compile({ ...replacement, slopes: [{ kind: 'upright45', x: 0, y: 0, z: 3, width: 2, rotation: 0, colorId: 4 }] }), /explicit part envelope overlaps/);
});

test('replacement keeps exact owned quantities and still rejects a studless support', () => {
  const replacement: ShapePlanV2 = { ...plan, partPlacement: 'replace-volume' };
  const unlimited = compile(replacement);
  const inventory: InventoryItem[] = billOfMaterials(unlimited).map(item => ({ partId: item.partId, colorId: item.colorId, quantity: item.quantity, source: 'Confirmed lot' }));
  const owned = compilePlan(replacement, { prompt: plan.title, inventory, ownedOnly: true, packing: 'plates' });
  assert.equal(validateDesign(owned).valid, true);
  assert.equal(allocateInventory(owned, inventory).totalMissing, 0);
  assert.deepEqual(owned.bricks, unlimited.bricks);
  assert.throws(() => compilePlan(replacement, { prompt: plan.title, inventory: inventory.filter(item => item.partId !== '3040b'), ownedOnly: true }), /missing.*3040b/);
  const capped: ShapePlanV2 = { ...replacement, profiles: [], repeats: [], boxes: [{ x: 0, y: 0, z: 0, width: 2, depth: 2, height: 6, colorId: 15 }], parts: [{ partId: '3068b', colorId: 4, x: 0, y: 0, z: 2, rotation: 0 }] };
  const invalid = compile(capped);
  assert.equal(validateDesign(invalid).valid, false);
  assert.ok(validateDesign(invalid).errors.some(error => /disconnected groups/.test(error)));
});

test('legacy and unknown replacement semantics reject instead of changing their volume silently', () => {
  assert.throws(() => compilePlan({ title: plan.title, description: plan.description, boxes: [], partPlacement: 'replace-volume' }, { prompt: plan.title }), /require a V2 plan/);
  assert.throws(() => compile({ ...plan, partPlacement: 'replace-all' } as unknown as ShapePlanV2), /Part placement/);
});

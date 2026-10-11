import test from 'node:test';
import assert from 'node:assert/strict';
import { groupManualSteps, MAX_REPEATS_PER_PAGE } from '../server/manual-repeats';
import type { BuildStep } from '../shared/model';

function step(index: number, x = 0, y = 0, z = 0, attachedTo: string[] = []): BuildStep {
  const bricks = [0, 1].map(offset => ({ id: `${index}-${offset}`, partId: '3024', colorId: 15, x: x + offset, y, z, rotation: 0 as const }));
  return { index, z, bricks, instruction: 'Place these pieces.', placements: bricks.map(brick => ({
    brickId: brick.id, approach: 'above', attachedTo,
    waypoints: [{ x: brick.x, y, z: z + 3 }, { x: brick.x, y, z }],
  })) };
}

test('exact consecutive translations share one template and retain every checked placement in order', () => {
  const steps = [step(1, 3, 4), step(2, 7, 4), step(3, 3, 6)];
  const before = structuredClone(steps);
  const groups = groupManualSteps(steps);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].kind, 'placements');
  assert.deepEqual(groups[0].origins, [{ x: 3, y: 4, z: 0 }, { x: 7, y: 4, z: 0 }, { x: 3, y: 6, z: 0 }]);
  assert.deepEqual(groups.flatMap(group => group.steps), before);
  assert.deepEqual(steps, before, 'Presentation must not mutate assembly instructions');
  const template = steps[0].bricks;
  groups[0].steps.forEach((copy, i) => copy.bricks.forEach((brick, j) => {
    const origin = groups[0].origins[i];
    assert.deepEqual([brick.x, brick.y, brick.z], [origin.x + template[j].x - 3, origin.y + template[j].y - 4, origin.z]);
  }));
});

test('different parts, colors, rotations, offsets, paths, order, or nonconsecutive steps remain separate', () => {
  const changes: ((value: BuildStep) => void)[] = [
    value => { value.bricks[0].partId = '3005'; },
    value => { value.bricks[0].colorId = 4; },
    value => { value.bricks[0].rotation = 90; },
    value => { value.bricks[1].x++; },
    value => { value.placements[0].waypoints[0].z++; },
    value => { value.bricks.reverse(); value.placements.reverse(); },
    value => { value.index++; },
  ];
  for (const change of changes) {
    const next = step(2, 4); change(next);
    assert.deepEqual(groupManualSteps([step(1), next]).map(group => group.kind), ['single', 'single']);
  }
});

test('side insertion and same-height dependencies are never presented as repeated independent copies', () => {
  const side = [step(1), step(2, 4)];
  for (const value of side) for (const placement of value.placements) placement.approach = '+X';
  assert.equal(groupManualSteps(side).length, 2);
  assert.equal(groupManualSteps([step(1), step(2, 4, 0, 0, ['1-0'])]).length, 2);
});

test('dependent vertical translations are labeled as a stack and layout splitting drops no steps', () => {
  const steps = Array.from({ length: MAX_REPEATS_PER_PAGE + 3 }, (_, i) => step(i + 1, 2, 5, i, i ? [`${i}-0`, `${i}-1`] : []));
  const groups = groupManualSteps(steps);
  assert.deepEqual(groups.map(group => [group.kind, group.steps.length]), [['stack', 8], ['stack', 3]]);
  assert.deepEqual(groups.flatMap(group => group.steps), steps);
  assert.equal(groupManualSteps([step(1), step(2, 0, 0, 1)]).length, 2, 'Height alone is not evidence of stacking');
  assert.equal(groupManualSteps([step(1), step(2, 1, 0, 1, ['1-0'])]).length, 2, 'A slanted pattern is not a repeated vertical stack');
});

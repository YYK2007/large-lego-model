import test from 'node:test';
import assert from 'node:assert/strict';
import { groupManualSteps, MAX_REPEATS_PER_PAGE } from '../shared/manual-repeats';
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

function alternating(count: number): BuildStep[] {
  return Array.from({ length: count }, (_, i) => {
    const layer = step(i + 1, 2, 5, i, i ? [`${i}-0`, `${i}-1`] : []);
    if (i % 2) for (const brick of layer.bricks) { brick.colorId = 4; brick.rotation = 90; }
    return layer;
  });
}

test('exact A/B stacks retain both ordered patterns and split only at complete cycles', () => {
  const steps = alternating(MAX_REPEATS_PER_PAGE * 4 + 5), before = structuredClone(steps);
  const groups = groupManualSteps(steps);
  assert.deepEqual(groups.map(group => [group.kind, group.patternLength, group.steps.length]), [
    ['stack', 2, 16], ['stack', 2, 16], ['stack', 2, 4], ['single', undefined, 1],
  ]);
  assert.deepEqual(groups.flatMap(group => group.steps), before);
  assert.deepEqual(steps, before, 'Grouping must never reorder or rewrite checked placements');
  for (const group of groups.filter(group => group.patternLength === 2)) for (let i = 0; i < group.steps.length; i++) {
    const template = group.steps[i % 2], at = group.origins[i], templateAt = group.origins[i % 2];
    group.steps[i].bricks.forEach((brick, j) => assert.deepEqual(
      [brick.partId, brick.colorId, brick.rotation, brick.x - at.x, brick.y - at.y, brick.z - at.z],
      [template.bricks[j].partId, template.bricks[j].colorId, template.bricks[j].rotation, template.bricks[j].x - templateAt.x, template.bricks[j].y - templateAt.y, template.bricks[j].z - templateAt.z],
    ));
  }
});

test('A/B grouping rejects changed shape/color/orientation/path/order and incomplete or unsupported cycles', () => {
  const changes: ((steps: BuildStep[]) => void)[] = [
    steps => { steps[2].bricks[0].partId = '3005'; },
    steps => { steps[2].bricks[0].colorId = 1; },
    steps => { steps[2].bricks[0].rotation = 180; },
    steps => { steps[2].bricks[1].x++; },
    steps => { steps[2].placements[0].waypoints[0].z++; },
    steps => { steps[2].bricks.reverse(); steps[2].placements.reverse(); },
    steps => { steps[2].index++; },
    steps => { steps[2].placements[0].approach = '+X'; },
    steps => { steps[2].placements[0].attachedTo = ['external-anchor']; },
    steps => { steps[1].placements[0].attachedTo = []; },
    steps => { for (const brick of steps[3].bricks) brick.z++; for (const placement of steps[3].placements) for (const point of placement.waypoints) point.z++; },
    steps => { for (const brick of steps[3].bricks) brick.x++; for (const placement of steps[3].placements) for (const point of placement.waypoints) point.x++; },
  ];
  for (const change of changes) {
    const steps = alternating(4); change(steps);
    assert.ok(groupManualSteps(steps).every(group => !group.patternLength));
  }
  for (const length of [2, 3]) assert.ok(groupManualSteps(alternating(length)).every(group => !group.patternLength));
});

test('A/B grouping has bounded lookahead on long checked sequences', t => {
  const steps = alternating(10_001), started = performance.now();
  const groups = groupManualSteps(steps);
  assert.equal(groups.length, 626);
  assert.deepEqual(groups.flatMap(group => group.steps), steps);
  assert.ok(groups.every(group => group.steps.length <= MAX_REPEATS_PER_PAGE * 2));
  t.diagnostic(`Grouped ${steps.length} steps in ${(performance.now() - started).toFixed(1)} ms.`);
});

test('a motif whose combined parts tray would crowd out the diagram keeps its original steps', () => {
  const steps = alternating(4);
  steps.forEach((layer, i) => {
    layer.bricks = Array.from({ length: 7 }, (_, j) => ({ ...layer.bricks[0], id: `${i + 1}-${j}`, partId: `part-${i % 2}-${j}`, x: j }));
    layer.placements = layer.bricks.map(brick => ({ brickId: brick.id, approach: 'above',
      attachedTo: i ? [`${i}-0`] : [], waypoints: [{ x: brick.x, y: brick.y, z: brick.z + 3 }, { x: brick.x, y: brick.y, z: brick.z }],
    }));
  });
  const groups = groupManualSteps(steps);
  assert.ok(groups.every(group => group.kind === 'single'));
  assert.deepEqual(groups.flatMap(group => group.steps), steps);
});

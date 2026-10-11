import test from 'node:test';
import assert from 'node:assert/strict';
import { readBuildProgress, moveBuildProgress } from '../src/build-progress.js';
import { buildSteps } from '../shared/model.js';
import { ROOF_SAMPLE } from '../shared/roof-sample.js';
const steps = buildSteps(ROOF_SAMPLE);

test('the guide restores only positions within this exact revision', () => {
  assert.deepEqual(readBuildProgress('{bad', steps), { step: 0, piece: 0, completed: false });
  assert.deepEqual(readBuildProgress('{"step":9999,"piece":0}', steps), { step: 0, piece: 0, completed: false });
  assert.deepEqual(readBuildProgress('{"step":0,"piece":0,"completed":true}', steps), { step: 0, piece: 0, completed: false });
  assert.deepEqual(readBuildProgress('{"step":1,"piece":0}', steps), { step: 1, piece: 0, completed: false });
});

test('guide navigation visits every checked piece in order, including step boundaries and completion', () => {
  let progress = { step: 0, piece: 0, completed: false };
  const visited = [];
  while (!progress.completed) {
    visited.push(steps[progress.step].bricks[progress.piece].id);
    progress = moveBuildProgress(progress, steps, 1);
  }
  assert.deepEqual(visited, steps.flatMap(step => step.bricks.map(brick => brick.id)));
  assert.deepEqual(readBuildProgress(JSON.stringify(progress), steps), progress);
  for (let i = visited.length - 1; i > 0; i--) {
    progress = moveBuildProgress(progress, steps, -1);
    assert.equal(steps[progress.step].bricks[progress.piece].id, visited[i - 1]);
    assert.equal(progress.completed, false);
  }
  assert.deepEqual(moveBuildProgress(progress, steps, -1), { step: 0, piece: 0, completed: false });
});

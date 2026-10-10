import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileGeneratedPlan } from '../server/generation.js';
import { buildSteps, partBottomSites, partTopStuds, validateDesign } from '../shared/model.js';

test('the recorded live observatory retains a connected large build and supported assembly order', () => {
  // Real Gemini output from 2026-10-10, retained so this regression costs no API calls.
  const plan = JSON.parse(readFileSync(new URL('./fixtures/live-observatory-plan.json', import.meta.url), 'utf8'));
  const design = compileGeneratedPlan(plan, { prompt: 'A detailed coastal observatory with hollow rooms, windows and a taller tower' });
  assert.equal(validateDesign(design).valid, true);
  assert.ok(design.bricks.length > 160);
  assert.equal(design.bricks.filter(brick => brick.partId === '3039').length, 20);
  const studs = new Set<string>();
  for (const step of buildSteps(design)) {
    assert.ok(step.bricks.length <= 12);
    for (const brick of step.bricks) {
      if (brick.z > 0) assert.ok(partBottomSites(brick).some(p => studs.has(`${p.x},${p.y},${p.z}`)), `No earlier support for ${brick.id}`);
      for (const p of partTopStuds(brick)) studs.add(`${p.x},${p.y},${p.z}`);
    }
  }
});

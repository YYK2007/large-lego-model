import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePlan } from '../server/compiler.js';
import { volumetricErrors } from '../server/generation.js';
import { SAMPLE_DESIGNS } from '../shared/examples.js';

test('a broad plinth does not disguise a thin vertical relief as a volumetric body', () => {
  const relief = compilePlan({ title: 'Relief', description: 'Thin test relief', boxes: [{ x: 0, y: 0, z: 0, width: 8, depth: 8, height: 2, colorId: 71 }, { x: 1, y: 3, z: 2, width: 6, depth: 2, height: 8, colorId: 4 }] }, { prompt: 'Test relief', maxBricks: 160 });
  assert.equal(volumetricErrors(relief).length, 1);
});

test('a genuinely volumetric body passes without requiring a solid interior', () => {
  const house = compilePlan({ title: 'Hollow house', description: 'A walled volume', boxes: [{ x: 0, y: 0, z: 0, width: 6, depth: 6, height: 2, colorId: 71 }, { x: 0, y: 0, z: 2, width: 6, depth: 1, height: 5, colorId: 4 }, { x: 0, y: 5, z: 2, width: 6, depth: 1, height: 5, colorId: 4 }, { x: 0, y: 1, z: 2, width: 1, depth: 4, height: 5, colorId: 4 }, { x: 5, y: 1, z: 2, width: 1, depth: 4, height: 5, colorId: 4 }] }, { prompt: 'Test house', maxBricks: 160 });
  assert.deepEqual(volumetricErrors(house), []);
});

test('a compact four-layer pyramid has volume above its base', () => {
  const pyramid = compilePlan({ title: 'Pyramid', description: 'A compact stepped solid', boxes: [{ x: 0, y: 0, z: 0, width: 6, depth: 6, height: 1, colorId: 2 }, { x: 1, y: 1, z: 1, width: 4, depth: 4, height: 2, colorId: 2 }, { x: 2, y: 2, z: 3, width: 2, depth: 2, height: 1, colorId: 2 }] }, { prompt: 'Small pyramid', maxBricks: 100 });
  assert.deepEqual(volumetricErrors(pyramid), []);
});

test('every curated sample demonstrates volume above the base', () => {
  for (const design of SAMPLE_DESIGNS) assert.deepEqual(volumetricErrors(design), [], design.id);
});

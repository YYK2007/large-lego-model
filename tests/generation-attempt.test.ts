import test from 'node:test';
import assert from 'node:assert/strict';
import { renderGenerationAttempt } from '../server/generation-attempt.js';
import { SCHEMA_VERSION, COORDINATE_SYSTEM, CATALOG_VERSION, validateDesign, type Design } from '../shared/model.js';

const disconnected: Design = {
  id: 'unfinished', title: 'Disconnected specimen', description: 'Two disconnected pieces.',
  schemaVersion: SCHEMA_VERSION, coordinateSystem: COORDINATE_SYSTEM, catalogVersion: CATALOG_VERSION,
  source: 'ai', prompt: 'Test attempt previews', createdAt: new Date(0).toISOString(),
  bricks: [
    { id: 'left', partId: '3005', colorId: 4, x: 0, y: 0, z: 0, rotation: 0 },
    { id: 'right', partId: '3005', colorId: 4, x: 5, y: 0, z: 0, rotation: 0 },
  ],
};

test('unfinished attempts expose exact disconnected pieces without admitting them as valid builds', async () => {
  assert.equal(validateDesign(disconnected).valid, false);
  const before = structuredClone(disconnected);
  const svg = await renderGenerationAttempt({ attempt: 5, status: 'invalid', checks: ['Disconnected groups'], design: disconnected });
  assert.ok(svg);
  assert.match(svg, /Unfinished attempt 5/);
  assert.match(svg, /not approved for building or export/);
  assert.match(svg, /data-brick-id="left"/);
  assert.match(svg, /data-brick-id="right"/);
  assert.deepEqual(disconnected, before);
  assert.equal(validateDesign(disconnected).valid, false);
});

test('unpacked plans and malformed model data never become invented brick previews', async () => {
  assert.equal(await renderGenerationAttempt({ attempt: 6, status: 'invalid', checks: ['Cannot pack'], response: '{incomplete' }), undefined);
  assert.equal(await renderGenerationAttempt({ attempt: 7, status: 'invalid', checks: [], design: { ...disconnected, bricks: [{ ...disconnected.bricks[0], partId: 'unknown' }] } }), undefined);
});

test('partial model previews are explicitly unfinished even if their available pieces pass checks', async () => {
  const svg = await renderGenerationAttempt({ attempt: 8, status: 'valid', partial: true, checks: [], design: { ...disconnected, bricks: [disconnected.bricks[0]] } });
  assert.match(svg!, /Unfinished attempt 8 · partial brick model/);
});

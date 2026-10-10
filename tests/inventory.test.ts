import assert from 'node:assert/strict';
import test from 'node:test';
import dotenv from 'dotenv';
import { importSet } from '../server/inventory.js';

test('set import keeps canonical parts and colors while excluding spares, aliases and unavailable colors', async (context) => {
  context.mock.method(dotenv, 'config', () => ({}));
  const previous = process.env.REBRICKABLE_API_KEY;
  process.env.REBRICKABLE_API_KEY = 'offline-test-key';
  context.after(() => { if (previous === undefined) delete process.env.REBRICKABLE_API_KEY; else process.env.REBRICKABLE_API_KEY = previous; });
  const rows = ['3024', '3023', '3623', '3710'].map((part_num, index) => ({ part: { part_num }, color: { id: 15 }, quantity: index + 1, is_spare: false }));
  let calls = 0;
  context.mock.method(globalThis, 'fetch', async (url: string) => {
    calls++;
    assert.equal(new URL(url).pathname, '/api/v3/lego/sets/10696-1/parts/');
    return new Response(JSON.stringify({ results: [...rows,
      { ...rows[1], quantity: 2 },
      { ...rows[0], quantity: 1, is_spare: true },
      { ...rows[0], part: { part_num: '3023b' }, quantity: 2 }, // LDraw alias is not an inventory ID.
      { ...rows[0], part: { part_num: '6141' }, quantity: 5 },
      { ...rows[0], part: { part_num: '4073' }, quantity: 2 }, // BrickLink alias is not a Rebrickable ID.
      { ...rows[0], part: { part_num: '3062b' }, color: { id: 28 }, quantity: 4 },
      { ...rows[0], part: { part_num: '4589' }, color: { id: 28 }, quantity: 3 },
    ], next: null }), { status: 200 });
  });
  const result = await importSet('10696-1');
  assert.equal(calls, 1);
  assert.deepEqual(result.items.map(({ partId, colorId, quantity }) => ({ partId, colorId, quantity })), [
    { partId: '3024', colorId: 15, quantity: 1 }, { partId: '3023', colorId: 15, quantity: 4 },
    { partId: '3623', colorId: 15, quantity: 3 }, { partId: '3710', colorId: 15, quantity: 4 },
    { partId: '6141', colorId: 15, quantity: 5 },
  ]);
  assert.equal(result.excluded, 12);
  assert.ok(result.items.every(item => item.source === result.source));
  assert.match(result.note, /verified colors/);
  assert.match(result.note, /Spare and unsupported parts are excluded/);
});

import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import { compilePlan } from '../server/compiler.js';
import { generateDesign, GenerationError } from '../server/generation.js';
import { billOfMaterials, validateDesign, type Design } from '../shared/model.js';
import type { GenerationAttempt } from '../server/generation-attempt.js';

const previous = compilePlan({ schemaVersion: 2, coordinateSystem: 'stud-xy-plate-z', title: 'Saved sculpture', description: 'A red body with a real sloped surface.',
  boxes: [{ x: 0, y: 0, z: 0, width: 4, depth: 4, height: 9, colorId: 4 }],
  parts: [{ partId: '3039', colorId: 4, x: 0, y: 0, z: 9, rotation: 180 }],
}, { prompt: 'A red sculpture with a sloped top' });
const observations = { usedImages: [], silhouette: 'A broad body with a sloped top.', proportions: 'The prior shape stays the same.', features: ['A blue first brick with the original red body and sloped top'], colors: ['Red', 'Blue'], limitations: ['Text-only requirements'] };
const matched = { matches: true, summary: 'The requested local color edit is visible.', issues: [], identity: { status: 'recognizable', perceivedSubject: 'The existing sculpture', evidence: 'Its prior form and slope remain.', correction: '' }, features: [{ index: 0, status: 'present', evidence: 'The local brick is blue and the other placements remain.', correction: '' }] };
const edit = (path: string, value: unknown) => ({ edits: [{ op: 'replace', path, valueJson: JSON.stringify(value) }] });
const placements = (design: Design) => design.bricks.map(({ id: _id, ...brick }) => brick);

function provider(t: TestContext, edits: unknown[]) {
  const keys = ['GEMINI_API_KEY', 'GEMINI_MODEL', 'REBRICKABLE_API_KEY'];
  const old = keys.map(key => process.env[key]);
  t.mock.method(dotenv, 'config', () => ({ parsed: {} }));
  process.env.GEMINI_API_KEY = 'mock-targeted-revision'; process.env.GEMINI_MODEL = 'gemini-3.8-flash'; delete process.env.REBRICKABLE_API_KEY;
  t.after(() => keys.forEach((key, index) => { if (old[index] === undefined) delete process.env[key]; else process.env[key] = old[index]; }));
  const calls: { kind: string; text: string; instruction: string }[] = [];
  let cursor = 0;
  t.mock.method(globalThis, 'fetch', async (url: string | URL, init: RequestInit = {}) => {
    assert.equal(new URL(String(url)).hostname, 'generativelanguage.googleapis.com');
    const body = JSON.parse(String(init.body)), fields = body.generationConfig.responseJsonSchema.properties;
    const kind = fields.kind ? 'subject' : fields.usedImages ? 'requirements' : fields.matches ? 'critic' : fields.edits ? 'patch' : 'new-plan';
    calls.push({ kind, text: body.contents[0].parts[0].text, instruction: body.systemInstruction.parts[0].text });
    assert.notEqual(kind, 'new-plan', 'Revisions must never request a new construction or concept plan');
    const result = kind === 'subject' ? { kind: 'original', name: '', location: '', aliases: [], complexity: 'simple' }
      : kind === 'requirements' ? observations : kind === 'critic' ? matched : edits[Math.min(cursor++, edits.length - 1)];
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] }, finishReason: 'STOP' }] }), { headers: { 'content-type': 'application/json' } });
  });
  return calls;
}

test('Quick and Detailed revisions patch exact saved placements without a fresh concept or construction plan', async t => {
  for (const quality of ['quick', 'detailed'] as const) await t.test(quality, async t => {
    const calls = provider(t, [edit('/parts/0/colorId', 1)]), before = JSON.stringify(previous);
    const artifacts: GenerationAttempt[] = [];
    const result = await generateDesign({ prompt: 'Keep the sculpture; change only its first brick to blue', previous, quality }, undefined,
      { visualReview: true, stopWhenMatched: true, onAttempt: value => { artifacts.push(value); } });
    assert.deepEqual(calls.map(call => call.kind), ['subject', 'requirements', 'patch', 'critic']);
    assert.match(calls[2].text, /EDIT THE EXISTING SAVED BUILD/);
    assert.match(calls[2].instruction, /preserving every unaffected saved placement/);
    const expected = placements(previous); expected[0].colorId = 1;
    assert.deepEqual(placements(result), expected);
    assert.deepEqual(artifacts[0].plan!.parts, expected);
    assert.deepEqual(billOfMaterials(result), billOfMaterials({ ...previous, bricks: previous.bricks.map((brick, i) => i ? brick : { ...brick, colorId: 1 }) }));
    assert.equal(validateDesign(result).valid, true); assert.notEqual(result.id, previous.id);
    assert.equal(JSON.stringify(previous), before, 'The saved revision is immutable');
  });
});

test('malformed and structurally invalid patches retain exact edit context through recovery', async t => {
  const calls = provider(t, [edit('/parts/999/z', 90), edit('/parts/0/z', 90), edit('/parts/0/z', 0)]);
  const attempts: GenerationAttempt[] = [];
  const result = await generateDesign({ prompt: 'Keep this same sculpture and refine its first part', previous, quality: 'detailed' }, undefined,
    { visualReview: false, continuous: true, stopWhenMatched: true, onAttempt: value => { attempts.push(value); } });
  assert.deepEqual(attempts.map(attempt => attempt.status), ['invalid', 'invalid', 'valid']);
  assert.deepEqual(placements(result), placements(previous));
  const patches = calls.filter(call => call.kind === 'patch');
  assert.equal(patches.length, 3); assert.match(patches[1].text, /\/parts\/0:.*"z":0/);
  assert.match(patches[2].text, /\/parts\/0:.*"z":90/);
  assert.ok(patches.every(call => !call.text.includes('SIMPLE GLOBAL REBUILD')));
});

test('failed edits cannot spend unavailable inventory or publish a new draft; the saved build remains untouched', async t => {
  const calls = provider(t, [edit('/parts/0/colorId', 1)]), before = JSON.stringify(previous);
  let saved = 0;
  await assert.rejects(generateDesign({ prompt: 'Make the first brick blue', previous, quality: 'detailed', inventoryMode: 'owned',
    inventory: billOfMaterials(previous).map(item => ({ ...item, source: 'Confirmed stock' })), maxBricks: previous.bricks.length,
  }, undefined, { visualReview: false, continuous: true, stopWhenMatched: true, onDraft: () => { saved++; } }),
  error => error instanceof GenerationError && error.status === 422);
  assert.equal(saved, 0); assert.equal(JSON.stringify(previous), before);
  assert.ok(calls.filter(call => call.kind === 'patch').length >= 3, 'Repeated failure still uses the saved placement plan');
  assert.ok(calls.every(call => !call.text.includes('SIMPLE GLOBAL REBUILD')));
});

test('revision patches cannot replace or remove the saved parts array, including the add shortcut', async t => {
  for (const op of ['replace', 'remove', 'add']) await t.test(op, async t => {
    const calls = provider(t, [{ edits: [{ op, path: '/parts', valueJson: JSON.stringify(placements(previous)) }] }]);
    const before = JSON.stringify(previous), attempts: GenerationAttempt[] = [];
    let saved = 0;
    await assert.rejects(generateDesign({ prompt: 'Change this existing sculpture', previous, quality: 'quick' }, undefined,
      { visualReview: false, continuous: true, stopWhenMatched: true, onDraft: () => { saved++; }, onAttempt: value => { attempts.push(value); } }),
    error => error instanceof GenerationError && error.status === 422);
    assert.equal(saved, 0); assert.equal(JSON.stringify(previous), before);
    assert.ok(attempts.every(attempt => attempt.status === 'invalid' && attempt.checks.some(check => check.includes('whole /parts array'))));
    for (const attempt of attempts) assert.deepEqual(attempt.plan!.parts, placements(previous));
    assert.ok(calls.every(call => call.kind !== 'new-plan'));
  });
});

test('indexed edits can recolor the whole build and append a real connected piece', async t => {
  const additions = { partId: '3024', colorId: 1, x: 2, y: 3, z: 9, rotation: 0 };
  provider(t, [{ edits: [
    ...previous.bricks.map((_, index) => ({ op: 'replace', path: `/parts/${index}/colorId`, valueJson: '1' })),
    { op: 'add', path: '/parts/-', valueJson: JSON.stringify(additions) },
  ] }]);
  const result = await generateDesign({ prompt: 'Recolor all the pieces blue and add the small blue plate', previous, quality: 'quick' }, undefined,
    { visualReview: false, stopWhenMatched: true });
  assert.deepEqual(placements(result), [...placements(previous).map(part => ({ ...part, colorId: 1 })), additions]);
  assert.equal(validateDesign(result).valid, true);
});

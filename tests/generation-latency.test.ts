import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import { generateDesign as generateWithPolicy, suggestInventory, GenerationError, type GenerationProgress } from '../server/generation.js';

// Preserve the fast-path regressions; detailed staged generation is tested separately.
const generateDesign: typeof generateWithPolicy = (input, progress, options) => generateWithPolicy({ ...input, quality: 'quick' }, progress, options);
import { footprint, validateDesign } from '../shared/model.js';
import { HOLLOW_ROOM_PLAN } from './fixtures/hollow-room-plan.js';

const validPlan = { schemaVersion: 2, coordinateSystem: 'stud-xy-plate-z', title: 'Test sculpture', description: 'A volume for checking request admission.', boxes: [{ x: 0, y: 0, z: 0, width: 4, depth: 4, height: 9, colorId: 4 }], slopes: [] };
const invalidPlan = { ...validPlan, boxes: [] };
const replaceBoxes = (boxes: unknown[]) => ({ edits: [{ op: 'replace', path: '/boxes', valueJson: JSON.stringify(boxes) }] });
const responseFor = (plan: unknown) => new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(plan) }] }, finishReason: 'STOP' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
const originalSubject = (init: RequestInit) => JSON.parse(String(init.body)).generationConfig.responseJsonSchema.properties.kind
  ? responseFor({ kind: 'original', name: 'Original sculpture', location: '', aliases: [] }) : undefined;

function isolateCredentials(t: TestContext, model = 'gemini-3.8-flash') {
  const key = process.env.GEMINI_API_KEY, previousModel = process.env.GEMINI_MODEL;
  t.mock.method(dotenv, 'config', () => ({ parsed: {} }));
  process.env.GEMINI_API_KEY = 'fake-test-key-never-sent';
  process.env.GEMINI_MODEL = model;
  t.after(() => {
    if (key === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = key;
    if (previousModel === undefined) delete process.env.GEMINI_MODEL; else process.env.GEMINI_MODEL = previousModel;
  });
}

test('generation announces actual stages and uses documented low thinking without shrinking the JSON budget', async t => {
  isolateCredentials(t);
  const events: GenerationProgress[] = [];
  let requestBody: Record<string, any> = {};
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    calls++;
    requestBody = JSON.parse(String(init.body));
    const classification = originalSubject(init);
    if (classification) { assert.equal(events.at(-1)?.stage, 'researching'); return classification; }
    assert.equal(events.at(-1)?.stage, 'planning', 'planning is visible before the provider request');
    return responseFor(validPlan);
  });
  const result = await generateDesign({ prompt: 'A red sculpture' }, event => events.push(event));
  assert.equal(result.bricks.length, 6);
  assert.equal(calls, 2, 'Subject identification precedes the single plan');
  assert.deepEqual(events, [{ stage: 'researching', attempt: 1, maxAttempts: 2 }, { stage: 'planning', attempt: 1, maxAttempts: 2 }, { stage: 'checking', attempt: 1, maxAttempts: 2 }]);
  assert.equal(requestBody.generationConfig.thinkingConfig.thinkingLevel, 'LOW');
  assert.equal(requestBody.generationConfig.maxOutputTokens, 14000);
  const brief = JSON.parse(requestBody.contents[0].parts[0].text.split('\n')[0]);
  assert.equal(Object.hasOwn(brief, 'budget'), false);
  assert.equal(Object.hasOwn(brief, 'maxBricks'), false, 'an omitted user limit must stay omitted at the provider boundary');
});

test('an explicitly requested large piece limit reaches the provider unchanged', async t => {
  isolateCredentials(t);
  let brief: Record<string, unknown> = {};
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const classification = originalSubject(init); if (classification) return classification;
    const request = JSON.parse(String(init.body));
    brief = JSON.parse(request.contents[0].parts[0].text.split('\n')[0]);
    return responseFor(validPlan);
  });
  await generateDesign({ prompt: 'A red sculpture', maxBricks: 2000 });
  assert.equal(brief.maxBricks, 2000);
  assert.equal(Object.hasOwn(brief, 'budget'), false);
});

test('a token-truncated provider response is reported without compiling or repairing partial JSON', async t => {
  isolateCredentials(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    calls++;
    const classification = originalSubject(init); if (classification) return classification;
    return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: '{"boxes":[' }] }, finishReason: 'MAX_TOKENS' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  await assert.rejects(generateDesign({ prompt: 'A red sculpture' }), error => error instanceof GenerationError && error.status === 502 && /before completing/.test(error.message) && /token budget/.test(error.checks.at(-1)!));
  assert.equal(calls, 2);
});

test('a complete leading JSON object survives provider garbage after it, including braces inside strings', async t => {
  isolateCredentials(t);
  const plan = { ...validPlan, description: 'A sculpture with a "quoted" {detail} and a \\ marker.' };
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const classification = originalSubject(init); if (classification) return classification;
    return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(plan) + 'Back to top``` - - -' }] }, finishReason: 'MAX_TOKENS' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const result = await generateDesign({ prompt: 'A red sculpture' });
  assert.equal(result.description, plan.description);
  assert.equal(validateDesign(result).valid, true);
});

test('the provider can return repeated structural groups which become connected, occupied geometry', async t => {
  isolateCredentials(t);
  const repeatedPlan = { ...validPlan, title: 'Courtyard piers', boxes: [{ x: 0, y: 0, z: 0, width: 10, depth: 6, height: 6, colorId: 71 }], repeats: [{
    count: 2, dx: 8, dy: 0, dz: 0, boxes: [
      { x: 0, y: 0, z: 6, width: 2, depth: 2, height: 9, colorId: 15 },
      { x: 0, y: 4, z: 6, width: 2, depth: 2, height: 9, colorId: 15 },
    ],
  }] };
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const classification = originalSubject(init); if (classification) return classification;
    const request = JSON.parse(String(init.body));
    assert.ok(request.generationConfig.responseJsonSchema.properties.repeats.items.properties.boxes);
    return responseFor(repeatedPlan);
  });
  const design = await generateDesign({ prompt: 'Four supported corner piers around an open courtyard' });
  assert.equal(validateDesign(design).valid, true);
  const body = new Set<string>();
  for (const brick of design.bricks.filter(brick => brick.z === 6)) {
    const { width, depth } = footprint(brick);
    for (let x = brick.x; x < brick.x + width; x++) for (let y = brick.y; y < brick.y + depth; y++) body.add(`${x},${y}`);
  }
  assert.equal(body.size, 16);
  for (const point of ['0,0', '0,4', '8,0', '8,4']) assert.ok(body.has(point), `missing repeated pier at ${point}`);
  assert.equal(body.has('4,2'), false, 'the courtyard is empty above its floor');
});

test('provider-local cutouts survive schema guidance and final generation admission', async t => {
  isolateCredentials(t);
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const classification = originalSubject(init); if (classification) return classification;
    const request = JSON.parse(String(init.body));
    const schema = request.generationConfig.responseJsonSchema;
    assert.ok(schema.properties.boxes.items.properties.cutouts.items.properties.height);
    assert.ok(schema.properties.repeats.items.properties.boxes.items.properties.cutouts);
    return responseFor(HOLLOW_ROOM_PLAN);
  });
  const design = await generateDesign({ prompt: 'An open room with real windows, a doorway and a table' });
  assert.equal(validateDesign(design).valid, true);
  assert.ok(design.bricks.some(brick => brick.colorId === 14 && brick.x === 2 && brick.y === 2 && brick.z === 9));
  assert.equal(design.bricks.some(brick => brick.z === 6 && brick.x <= 5 && brick.x + footprint(brick).width > 5 && brick.y === 0), false);
});

test('one rejected plan may be repaired, with checker feedback and distinct progress', async t => {
  isolateCredentials(t);
  const events: GenerationProgress[] = [];
  const bodies: Record<string, any>[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const classification = originalSubject(init); if (classification) return classification;
    bodies.push(JSON.parse(String(init.body)));
    return responseFor(bodies.length === 1 ? invalidPlan : replaceBoxes(validPlan.boxes));
  });
  await generateDesign({ prompt: 'A red sculpture' }, event => events.push(event));
  assert.equal(bodies.length, 2);
  assert.ok(bodies[1].generationConfig.responseJsonSchema.properties.edits);
  assert.equal(bodies[1].generationConfig.maxOutputTokens, 6000);
  assert.match(bodies[1].contents[0].parts[0].text.split('\n').slice(1).join('\n'), /Checker feedback.*at least one shape box/);
  assert.deepEqual(events.map(event => `${event.stage}:${event.attempt}/${event.maxAttempts}`), ['researching:1/2', 'planning:1/2', 'checking:1/2', 'repairing:2/2', 'planning:2/2', 'checking:2/2']);
});

test('two structural failures receive two bounded simpler-part repairs before stopping', async t => {
  isolateCredentials(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => { calls++; return originalSubject(init) || responseFor(calls === 2 ? invalidPlan : replaceBoxes([])); });
  await assert.rejects(generateDesign({ prompt: 'A red sculpture' }), (error: unknown) => error instanceof GenerationError && error.status === 422 && error.checks.length === 4 && /four attempts/.test(error.message));
  assert.equal(calls, 5);
});

test('a syntactically invalid first plan requests one complete regeneration because it cannot be patched', async t => {
  isolateCredentials(t);
  const bodies: Record<string, any>[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const classification = originalSubject(init); if (classification) return classification;
    bodies.push(JSON.parse(String(init.body)));
    return bodies.length === 1
      ? new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: '{broken JSON' }] }, finishReason: 'STOP' }] }), { headers: { 'content-type': 'application/json' } })
      : responseFor(validPlan);
  });
  assert.equal(validateDesign(await generateDesign({ prompt: 'A red sculpture' })).valid, true);
  assert.equal(bodies.length, 2);
  assert.ok(bodies[1].generationConfig.responseJsonSchema.properties.boxes);
  assert.equal(bodies[1].generationConfig.responseJsonSchema.properties.edits, undefined);
  assert.equal(bodies[1].generationConfig.maxOutputTokens, 14000);
});

test('provider failures are not retried by the SDK or mistaken for repairable geometry', async t => {
  isolateCredentials(t);
  let calls = 0;
  const events: GenerationProgress[] = [];
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(JSON.stringify({ error: { code: 503, message: 'Test unavailable', status: 'UNAVAILABLE' } }), { status: 503 }); });
  await assert.rejects(generateDesign({ prompt: 'A red sculpture' }, event => events.push(event)), (error: unknown) => error instanceof GenerationError && error.status === 502);
  assert.equal(calls, 1);
  assert.deepEqual(events.map(event => event.stage), ['researching']);
});

test('a provider 504 is identified as a timeout without blaming credentials or retrying it', async t => {
  isolateCredentials(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(JSON.stringify({ error: { code: 504, message: 'Deadline exceeded', status: 'DEADLINE_EXCEEDED' } }), { status: 504 }); });
  await assert.rejects(generateDesign({ prompt: 'A red sculpture' }), (error: unknown) => error instanceof GenerationError && error.status === 504 && /timed out/.test(error.message) && !/key|quota/.test(error.message));
  assert.equal(calls, 1);
});

test('exhausted provider quota is reported as HTTP 429 and is not retried', async t => {
  isolateCredentials(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(JSON.stringify({ error: { code: 429, message: 'Free tier daily requests exhausted', status: 'RESOURCE_EXHAUSTED' } }), { status: 429 }); });
  await assert.rejects(generateDesign({ prompt: 'A coastal observatory' }), (error: unknown) => error instanceof GenerationError && error.status === 429 && /request quota/.test(error.message) && !/key/.test(error.message));
  assert.equal(calls, 1);
});

test('depleted prepaid credits remain an actionable terminal 402 in preflight, construction and inventory estimation', async t => {
  for (const stage of ['preflight', 'construction', 'inventory'] as const) await t.test(stage, async t => {
    isolateCredentials(t);
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
      calls++;
      if (stage === 'construction') { const subject = originalSubject(init); if (subject) return subject; }
      return new Response(JSON.stringify({ error: { code: 402, status: 'RESOURCE_EXHAUSTED', message: 'Your prepayment credits are depleted. See https://ai.studio/projects and billing#prepay' } }), { status: 402 });
    });
    const request = stage === 'inventory'
      ? suggestInventory({ mimeType: 'image/png', data: 'eA==' })
      : generateDesign({ prompt: 'A red sculpture' }, undefined, { continuous: true });
    await assert.rejects(request, error => error instanceof GenerationError && error.status === 402
      && /prepaid credits.*project linked to the current API key/.test(error.message)
      && /https:\/\/ai.studio\/projects/.test(error.message) && /already topped up.*balance updates/.test(error.message)
      && !/replace|invalid.*key|clearer photo|request quota/.test(error.message));
    assert.equal(calls, stage === 'construction' ? 2 : 1, 'Billing depletion must never trigger another paid retry');
  });
});

test('the overall deadline aborts even a stalled subject-identification request at 150 seconds', async t => {
  isolateCredentials(t);
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  let started!: () => void;
  const startedPromise = new Promise<void>(resolve => { started = resolve; });
  let calls = 0;
  let aborted = false;
  t.mock.method(globalThis, 'fetch', (_url: unknown, init: RequestInit) => {
    calls++;
    return new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => { aborted = true; reject(new Error('Request aborted')); }, { once: true });
      started();
    });
  });
  const rejected = assert.rejects(generateDesign({ prompt: 'A red sculpture' }), (error: unknown) => error instanceof GenerationError && error.status === 504 && /150-second/.test(error.message));
  await startedPromise;
  t.mock.timers.tick(150_000);
  await rejected;
  assert.equal(calls, 1);
  assert.equal(aborted, true);
});

test('a late invalid response does not start a repair with only five seconds remaining', async t => {
  isolateCredentials(t);
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  let calls = 0;
  const events: GenerationProgress[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => { calls++; const classification = originalSubject(init); if (classification) return classification; t.mock.timers.tick(145_000); return responseFor(invalidPlan); });
  await assert.rejects(generateDesign({ prompt: 'A red sculpture' }, event => events.push(event)), (error: unknown) => error instanceof GenerationError && error.status === 504 && /not enough time/.test(error.message));
  assert.equal(calls, 2);
  assert.deepEqual(events.map(event => event.stage), ['researching', 'planning', 'checking']);
});

test('classification, first plan, and repair share one deadline without resetting the clock', async t => {
  isolateCredentials(t);
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  let startedRepair!: () => void;
  const startedPromise = new Promise<void>(resolve => { startedRepair = resolve; });
  let calls = 0, aborted = false;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    calls++;
    const classification = originalSubject(init);
    if (classification) { t.mock.timers.tick(20_000); return classification; }
    if (calls === 2) { t.mock.timers.tick(35_000); return responseFor(invalidPlan); }
    return new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => { aborted = true; reject(new Error('Request aborted')); }, { once: true });
      startedRepair();
    });
  });
  const rejected = assert.rejects(generateDesign({ prompt: 'A red sculpture' }), (error: unknown) => error instanceof GenerationError && error.status === 504);
  await startedPromise;
  t.mock.timers.tick(94_999);
  assert.equal(aborted, false);
  t.mock.timers.tick(1);
  await rejected;
  assert.equal(calls, 3);
  assert.equal(aborted, true);
});

test('thinking settings are not imposed on an unverified alternative model', async t => {
  isolateCredentials(t, 'gemini-2.5-flash');
  let requestBody: Record<string, any> = {};
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => { const classification = originalSubject(init); if (classification) return classification; requestBody = JSON.parse(String(init.body)); return responseFor(validPlan); });
  await generateDesign({ prompt: 'A red sculpture' });
  assert.equal(requestBody.generationConfig.thinkingConfig, undefined);
});

test('a deadline reached while arranging bricks becomes a 504 without another provider request', async t => {
  isolateCredentials(t);
  let compiling = false, compileClockReads = 0, calls = 0;
  const events: GenerationProgress[] = [];
  t.mock.method(Date, 'now', () => compiling && ++compileClockReads > 4 ? 150_000 : 0);
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    calls++;
    return originalSubject(init) || responseFor(validPlan);
  });
  await assert.rejects(generateDesign({ prompt: 'A red sculpture' }, event => {
    events.push(event);
    if (event.stage === 'checking') compiling = true;
  }), error => error instanceof GenerationError && error.status === 504 && /while arranging the bricks/.test(error.message));
  assert.ok(compileClockReads > 4, 'Compilation began before its deadline expired');
  assert.equal(calls, 2, 'Only subject identification and the first plan reached the provider');
  assert.deepEqual(events.map(event => event.stage), ['researching', 'planning', 'checking']);
});

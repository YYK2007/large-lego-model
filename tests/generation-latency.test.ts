import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import { generateDesign, GenerationError, type GenerationProgress } from '../server/generation.js';
import { footprint, validateDesign } from '../shared/model.js';

const validPlan = { schemaVersion: 2, coordinateSystem: 'stud-xy-plate-z', title: 'Test sculpture', description: 'A volume for checking request admission.', boxes: [{ x: 0, y: 0, z: 0, width: 4, depth: 4, height: 9, colorId: 4 }], slopes: [] };
const invalidPlan = { ...validPlan, boxes: [] };
const responseFor = (plan: unknown) => new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(plan) }] }, finishReason: 'STOP' }] }), { status: 200, headers: { 'content-type': 'application/json' } });

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
    assert.equal(events.at(-1)?.stage, 'planning', 'planning is visible before the provider request');
    return responseFor(validPlan);
  });
  const result = await generateDesign({ prompt: 'A red sculpture' }, event => events.push(event));
  assert.equal(result.bricks.length, 6);
  assert.equal(calls, 1);
  assert.deepEqual(events, [{ stage: 'planning', attempt: 1, maxAttempts: 2 }, { stage: 'checking', attempt: 1, maxAttempts: 2 }]);
  assert.equal(requestBody.generationConfig.thinkingConfig.thinkingLevel, 'LOW');
  assert.equal(requestBody.generationConfig.maxOutputTokens, 10000);
  const brief = JSON.parse(requestBody.contents[0].parts[0].text.split('\n')[0]);
  assert.equal(Object.hasOwn(brief, 'budget'), false);
  assert.equal(Object.hasOwn(brief, 'maxBricks'), false, 'an omitted user limit must stay omitted at the provider boundary');
});

test('an explicitly requested large piece limit reaches the provider unchanged', async t => {
  isolateCredentials(t);
  let brief: Record<string, unknown> = {};
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const request = JSON.parse(String(init.body));
    brief = JSON.parse(request.contents[0].parts[0].text.split('\n')[0]);
    return responseFor(validPlan);
  });
  await generateDesign({ prompt: 'A red sculpture', maxBricks: 2000 });
  assert.equal(brief.maxBricks, 2000);
  assert.equal(Object.hasOwn(brief, 'budget'), false);
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

test('one rejected plan may be repaired, with checker feedback and distinct progress', async t => {
  isolateCredentials(t);
  const events: GenerationProgress[] = [];
  const bodies: Record<string, any>[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return responseFor(bodies.length === 1 ? invalidPlan : validPlan);
  });
  await generateDesign({ prompt: 'A red sculpture' }, event => events.push(event));
  assert.equal(bodies.length, 2);
  assert.match(JSON.stringify(bodies[1].contents), /Checker feedback.*at least one shape box or slope run/);
  assert.deepEqual(events.map(event => `${event.stage}:${event.attempt}/${event.maxAttempts}`), ['planning:1/2', 'checking:1/2', 'repairing:2/2', 'planning:2/2', 'checking:2/2']);
});

test('two invalid plans stop without launching a third billed request', async t => {
  isolateCredentials(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return responseFor(invalidPlan); });
  await assert.rejects(generateDesign({ prompt: 'A red sculpture' }), (error: unknown) => error instanceof GenerationError && error.status === 422 && error.checks.length === 2 && /two attempts/.test(error.message));
  assert.equal(calls, 2);
});

test('provider failures are not retried by the SDK or mistaken for repairable geometry', async t => {
  isolateCredentials(t);
  let calls = 0;
  const events: GenerationProgress[] = [];
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(JSON.stringify({ error: { code: 503, message: 'Test unavailable', status: 'UNAVAILABLE' } }), { status: 503 }); });
  await assert.rejects(generateDesign({ prompt: 'A red sculpture' }, event => events.push(event)), (error: unknown) => error instanceof GenerationError && error.status === 502);
  assert.equal(calls, 1);
  assert.deepEqual(events.map(event => event.stage), ['planning']);
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

test('the overall deadline aborts a stalled provider request at 60 seconds', async t => {
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
  const rejected = assert.rejects(generateDesign({ prompt: 'A red sculpture' }), (error: unknown) => error instanceof GenerationError && error.status === 504 && /60-second/.test(error.message));
  await startedPromise;
  t.mock.timers.tick(60_000);
  await rejected;
  assert.equal(calls, 1);
  assert.equal(aborted, true);
});

test('a late invalid response does not start a repair with only five seconds remaining', async t => {
  isolateCredentials(t);
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  let calls = 0;
  const events: GenerationProgress[] = [];
  t.mock.method(globalThis, 'fetch', async () => { calls++; t.mock.timers.tick(55_000); return responseFor(invalidPlan); });
  await assert.rejects(generateDesign({ prompt: 'A red sculpture' }, event => events.push(event)), (error: unknown) => error instanceof GenerationError && error.status === 504 && /not enough time/.test(error.message));
  assert.equal(calls, 1);
  assert.deepEqual(events.map(event => event.stage), ['planning', 'checking']);
});

test('the repair shares the original deadline instead of receiving another full minute', async t => {
  isolateCredentials(t);
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  let startedRepair!: () => void;
  const startedPromise = new Promise<void>(resolve => { startedRepair = resolve; });
  let calls = 0, aborted = false;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    if (++calls === 1) { t.mock.timers.tick(35_000); return responseFor(invalidPlan); }
    return new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => { aborted = true; reject(new Error('Request aborted')); }, { once: true });
      startedRepair();
    });
  });
  const rejected = assert.rejects(generateDesign({ prompt: 'A red sculpture' }), (error: unknown) => error instanceof GenerationError && error.status === 504);
  await startedPromise;
  t.mock.timers.tick(24_999);
  assert.equal(aborted, false);
  t.mock.timers.tick(1);
  await rejected;
  assert.equal(calls, 2);
  assert.equal(aborted, true);
});

test('thinking settings are not imposed on an unverified alternative model', async t => {
  isolateCredentials(t, 'gemini-2.5-flash');
  let requestBody: Record<string, any> = {};
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => { requestBody = JSON.parse(String(init.body)); return responseFor(validPlan); });
  await generateDesign({ prompt: 'A red sculpture' });
  assert.equal(requestBody.generationConfig.thinkingConfig, undefined);
});

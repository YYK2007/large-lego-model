import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import dotenv from 'dotenv';
import sharp from 'sharp';
import { generateDesign, GenerationError, type GenerationProgress } from '../server/generation.js';
import { isDesignResearch } from '../shared/references.js';
import { validateDesign, type Design } from '../shared/model.js';
import { ReferenceReview } from '../src/ReferenceReview.js';

const box = { x: 0, y: 0, z: 0, width: 4, depth: 4, height: 9, colorId: 4 };
const observations = { usedImages: [0], silhouette: 'A broad red body.', proportions: 'A squat upright body.', features: ['A broad red body'], colors: ['Red'], limitations: [] };
const plan = { schemaVersion: 2, coordinateSystem: 'stud-xy-plate-z', title: 'Photo specimen', description: 'A connected volume.', boxes: [box], profiles: [], parts: [], slopes: [], observations };
const concept = { title: 'Body study', rationale: 'Retain the broad form.', features: observations.features, limitations: [], components: [{ id: 'body', role: 'Body', parentId: '', featureIndices: [0], connection: 'Ordinary upright studs', geometryJson: JSON.stringify({ boxes: [box] }), partQueries: [] }] };
const matched = { matches: true, summary: 'The requested body is recognizable.', issues: [], identity: { status: 'recognizable', perceivedSubject: 'The uploaded specimen', evidence: 'The broad red body is visible.', correction: '' }, features: [{ index: 0, status: 'present', evidence: 'The broad red body is visible.', correction: '' }] };
const response = (value: unknown) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] }, finishReason: 'STOP' }] }), { headers: { 'content-type': 'application/json' } });

async function flow(t: TestContext, settings: { plans?: unknown[]; classifierStatus?: number; onRequest?: (kind: string) => void } = {}) {
  const keys = ['GEMINI_API_KEY', 'GEMINI_MODEL', 'REBRICKABLE_API_KEY'];
  const old = keys.map(key => process.env[key]);
  t.mock.method(dotenv, 'config', () => ({ parsed: {} }));
  process.env.GEMINI_API_KEY = 'mock-visual-review-option'; process.env.GEMINI_MODEL = 'gemini-3.8-flash'; delete process.env.REBRICKABLE_API_KEY;
  t.after(() => keys.forEach((key, index) => { if (old[index] === undefined) delete process.env[key]; else process.env[key] = old[index]; }));
  const image = { mimeType: 'image/jpeg', data: (await sharp({ create: { width: 24, height: 32, channels: 3, background: '#b52b27' } }).jpeg().toBuffer()).toString('base64') };
  const calls: { kind: string; body: { contents: { parts: { text?: string; inlineData?: typeof image }[] }[]; generationConfig: { responseJsonSchema: { properties: Record<string, unknown> }; thinkingConfig?: { thinkingLevel: string } } } }[] = [];
  let construction = 0;
  t.mock.method(globalThis, 'fetch', async (input: string | URL, init: RequestInit = {}) => {
    assert.equal(new URL(String(input)).hostname, 'generativelanguage.googleapis.com', 'Original uploaded designs must not be forced into web research');
    const body = JSON.parse(String(init.body)), fields = body.generationConfig.responseJsonSchema.properties;
    const kind = fields.kind ? 'subject' : fields.usedImages ? 'requirements' : fields.concepts ? 'concept' : fields.selectedIndex ? 'selection' : fields.matches ? 'critic' : fields.edits ? 'patch' : 'plan';
    calls.push({ kind, body }); settings.onRequest?.(kind);
    if (kind === 'subject' && settings.classifierStatus) return new Response(JSON.stringify({ error: { code: settings.classifierStatus, message: 'Controlled classifier service failure' } }), { status: settings.classifierStatus, headers: { 'content-type': 'application/json' } });
    const value = kind === 'subject' ? { kind: 'original', name: '', location: '', aliases: [] }
      : kind === 'requirements' ? { ...observations, usedImages: body.contents[0].parts.some((part: { inlineData?: unknown }) => part.inlineData) ? [0] : [] }
      : kind === 'concept' ? { concepts: [concept] }
      : kind === 'selection' ? { selectedIndex: 0, summary: 'Preserve this form.', issues: [] }
      : kind === 'critic' ? matched : (settings.plans || [plan])[construction++];
    return value instanceof Response ? value : response(value);
  });
  return { image, calls };
}

test('visualReview false preserves uploaded requirements and structural repair, then saves the first complete draft once', async t => {
  const invalid = { ...plan, boxes: [box, { ...box, x: 12 }] };
  const mock = await flow(t, { plans: [invalid, { edits: [{ op: 'remove', path: '/boxes/1', valueJson: 'null' }] }] });
  const drafts: Design[] = [], attempts: string[] = [], progress: GenerationProgress[] = [];
  const result = await generateDesign({ prompt: 'Build this personal sculpture', image: mock.image, quality: 'quick' }, event => progress.push(event), {
    visualReview: false, continuous: true, stopWhenMatched: false,
    onAttempt: artifact => { attempts.push(artifact.status); }, onDraft: design => { drafts.push(design); },
  });
  assert.equal(validateDesign(result).valid, true);
  assert.equal(result.research?.comparison.status, 'not-reviewed');
  assert.match(result.research!.comparison.summary, /review was skipped.*not been assessed/);
  assert.equal(result.research!.comparison.features, undefined); assert.equal(result.research!.comparison.identity, undefined);
  assert.equal(isDesignResearch(result.research), true);
  assert.deepEqual(attempts, ['invalid', 'valid']); assert.equal(drafts.length, 1); assert.equal(drafts[0].id, result.id);
  assert.deepEqual(mock.calls.map(call => call.kind), ['subject', 'requirements', 'plan', 'patch']);
  for (const call of mock.calls.filter(call => ['requirements', 'plan', 'patch'].includes(call.kind))) assert.ok(call.body.contents[0].parts.some(part => part.inlineData?.data === mock.image.data));
  assert.equal(progress.some(event => event.stage === 'comparing'), false);
  const markup = renderToStaticMarkup(createElement(ReferenceReview, { research: result.research! }));
  assert.match(markup, /Not visually reviewed/); assert.match(markup, /Visual review was skipped/); assert.doesNotMatch(markup, /AI comparison|AI feature checks/);
  assert.equal(isDesignResearch({ ...result.research, comparison: { ...result.research!.comparison, features: matched.features } }), false, 'Skipped status cannot carry a fabricated completed feature review');
});

test('Detailed skips the separate concept study and critic only when visualReview is false', async t => {
  const componentPlan = { ...plan, boxes: [], components: [{ id: 'body', parentId: '', role: 'Body', target: { x: 0, y: 0, z: 0 }, tolerance: { x: 0, y: 0, z: 0 }, rotation: 0, geometryJson: JSON.stringify({ boxes: [box] }) }] };
  for (const visualReview of [false, true, undefined]) await t.test(String(visualReview), async t => {
    const mock = await flow(t, { plans: [componentPlan] });
    const progress: GenerationProgress[] = [];
    let concepts = 0;
    const result = await generateDesign({ prompt: 'Build this personal sculpture', image: mock.image, quality: 'detailed' }, event => progress.push(event), {
      visualReview, stopWhenMatched: true, onConcept: () => { concepts++; },
    });
    assert.equal(validateDesign(result).valid, true);
    assert.deepEqual(result.research?.observations.features, observations.features);
    assert.equal(result.research?.comparison.status, visualReview === false ? 'not-reviewed' : 'matched');
    assert.deepEqual(mock.calls.map(call => call.kind), visualReview === false
      ? ['subject', 'requirements', 'plan'] : ['subject', 'requirements', 'concept', 'selection', 'plan', 'critic']);
    assert.equal(concepts, visualReview === false ? 0 : 1);
    assert.equal(progress.some(event => event.stage === 'outlining'), visualReview !== false);
    assert.equal(progress.some(event => event.stage === 'comparing-outline'), visualReview !== false);
    assert.ok(mock.calls.find(call => call.kind === 'plan')!.body.contents[0].parts.some(part => part.inlineData?.data === mock.image.data));
  });
});

test('skipped review saves the checked draft before awaiting attempt output', async t => {
  const mock = await flow(t);
  const drafts: Design[] = [];
  let beginAttempt!: () => void, finishAttempt!: () => void;
  const started = new Promise<void>(resolve => { beginAttempt = resolve; });
  const preview = new Promise<void>(resolve => { finishAttempt = resolve; });
  let attempts = 0, finished = false;
  const run = generateDesign({ prompt: 'Build this sculpture', image: mock.image, quality: 'quick' }, undefined, {
    visualReview: false, stopWhenMatched: true, continuous: true,
    onDraft: design => { drafts.push(design); },
    onAttempt: async artifact => {
      attempts++;
      beginAttempt();
      assert.equal(drafts.length, 1, 'The checked draft must already be durable before preview work starts');
      assert.deepEqual(artifact.design, drafts[0]);
      await preview;
    },
  }).then(result => { finished = true; return result; });
  try {
    await started;
    assert.equal(drafts.length, 1); assert.equal(finished, false);
  } finally { finishAttempt(); }
  const result = await run;
  assert.deepEqual(result, drafts[0]); assert.equal(attempts, 1); assert.equal(drafts.length, 1);
});

test('failed attempt output preserves the saved draft without duplicate saves or callbacks', async t => {
  for (const timeout of [false, true]) await t.test(timeout ? 'deadline fallback' : 'output failure', async t => {
    const mock = await flow(t);
    const drafts: Design[] = [];
    let attempts = 0;
    const failure = timeout ? new GenerationError('Controlled output timeout', 504) : new Error('Controlled output failure');
    const run = generateDesign({ prompt: 'Build this sculpture', image: mock.image, quality: 'quick' }, undefined, {
      visualReview: false, stopWhenMatched: true, continuous: true,
      onDraft: design => { drafts.push(design); },
      onAttempt: artifact => {
        attempts++;
        assert.equal(drafts.length, 1);
        assert.deepEqual(artifact.design, drafts[0]);
        throw failure;
      },
    });
    if (timeout) {
      const result = await run;
      assert.deepEqual(result.bricks, drafts[0].bricks); assert.equal(result.id, drafts[0].id);
      assert.equal(result.research?.comparison.status, 'not-reviewed');
      assert.match(result.research!.warnings.join(' '), /Attempt output timed out after the checked draft was saved/);
    } else await assert.rejects(run, error => error === failure);
    assert.equal(drafts.length, 1); assert.equal(attempts, 1);
    assert.equal(mock.calls.some(call => call.kind === 'critic'), false);
  });
});

test('an original text-only draft also receives honest not-reviewed metadata', async t => {
  const mock = await flow(t);
  const result = await generateDesign({ prompt: 'An invented red abstract sculpture', quality: 'quick' }, undefined, { visualReview: false });
  assert.equal(result.research?.comparison.status, 'not-reviewed'); assert.equal(isDesignResearch(result.research), true);
  assert.deepEqual(mock.calls.map(call => call.kind), ['subject', 'plan']);
});

test('omitted and true visualReview retain the rendered critic', async t => {
  for (const value of [undefined, true]) await t.test(String(value), async t => {
    const mock = await flow(t);
    const result = await generateDesign({ prompt: 'Build this sculpture', image: mock.image, quality: 'quick' }, undefined, { visualReview: value });
    assert.equal(result.research?.comparison.status, 'matched');
    const critic = mock.calls.find(call => call.kind === 'critic')!;
    assert.equal(critic.body.contents[0].parts.filter(part => part.inlineData?.mimeType === 'image/png').length, 2);
  });
});

test('upload classifier stage failures fall back to the actual upload; billing and quota remain terminal', async t => {
  for (const status of [503, 504, 402, 429]) await t.test(String(status), async t => {
    const mock = await flow(t, { classifierStatus: status });
    const run = generateDesign({ prompt: 'Build this sculpture', image: mock.image, quality: 'quick' }, undefined, { visualReview: false });
    if (status === 503 || status === 504) {
      const result = await run;
      assert.equal(result.research?.comparison.status, 'not-reviewed'); assert.match(result.research!.warnings.join(' '), /temporarily unavailable.*uploaded photo/);
      assert.deepEqual(mock.calls.map(call => call.kind), ['subject', 'requirements', 'plan']);
    } else {
      await assert.rejects(run, (error: unknown) => error instanceof GenerationError && error.status === status);
      assert.deepEqual(mock.calls.map(call => call.kind), ['subject']);
    }
  });
});

test('skipping visual review does not bypass the shared deadline or cancellation', async t => {
  for (const mode of ['deadline', 'cancel'] as const) await t.test(mode, async t => {
    let now = Date.now(); t.mock.method(Date, 'now', () => now);
    const controller = new AbortController();
    const mock = await flow(t, { onRequest: kind => { if (kind === 'plan') { if (mode === 'deadline') now += 150_001; else controller.abort(); } } });
    await assert.rejects(generateDesign({ prompt: 'Build this sculpture', image: mock.image, quality: 'quick' }, undefined, { visualReview: false, signal: controller.signal }),
      (error: unknown) => error instanceof GenerationError && error.status === (mode === 'deadline' ? 504 : 499));
    assert.equal(mock.calls.some(call => call.kind === 'critic'), false);
  });
});

test('a slow Detailed planning call leaves time for a simpler complete checked build', async t => {
  let now = Date.now(), plans = 0;
  t.mock.method(Date, 'now', () => now);
  const timeouts: number[] = [], originalTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', ((callback: (...args: unknown[]) => void, timeout?: number, ...args: unknown[]) => {
    if (timeout !== undefined) timeouts.push(timeout);
    return originalTimeout(callback, timeout, ...args);
  }) as typeof setTimeout);
  const mock = await flow(t, { onRequest: kind => {
    if (kind === 'plan' && ++plans === 1) { now += 90_000; throw new DOMException('Controlled SDK stage timeout', 'AbortError'); }
  } });
  const attempts: { status: string; design?: Design }[] = [], progress: GenerationProgress[] = [];
  const result = await generateDesign({ prompt: 'Build this sculpture', image: mock.image, quality: 'detailed' }, event => progress.push(event), {
    visualReview: false, onAttempt: artifact => { attempts.push(artifact); },
  });
  assert.deepEqual(mock.calls.map(call => call.kind), ['subject', 'requirements', 'plan', 'plan']);
  const [initial, fallback] = mock.calls.filter(call => call.kind === 'plan');
  assert.ok(initial.body.generationConfig.responseJsonSchema.properties.components);
  assert.equal(fallback.body.generationConfig.responseJsonSchema.properties.components, undefined);
  assert.ok(fallback.body.generationConfig.responseJsonSchema.properties.boxes);
  assert.equal(fallback.body.generationConfig.thinkingConfig?.thinkingLevel, 'LOW');
  assert.match(fallback.body.contents[0].parts[0].text!, /SIMPLE GLOBAL REBUILD.*SIMPLER BUILD constraints/s);
  assert.ok(fallback.body.contents[0].parts.some(part => part.inlineData?.data === mock.image.data));
  assert.equal(fallback.body.contents[0].parts.filter(part => part.inlineData?.mimeType === 'image/png').length, 0, 'No candidate exists to render after a planning timeout');
  assert.deepEqual(result.research?.observations.features, observations.features);
  assert.equal(result.research?.comparison.status, 'not-reviewed'); assert.equal(validateDesign(result).valid, true);
  assert.deepEqual(attempts.map(attempt => attempt.status), ['invalid', 'valid']); assert.equal(attempts[0].design, undefined);
  assert.ok(timeouts.includes(90_000)); assert.ok(timeouts.includes(60_000));
  assert.ok(progress.some(event => event.stage === 'repairing' && /timed out.*simpler/.test(event.detail || '')));
});

test('planning-stage recovery never renews the shared deadline or overrides Stop', async t => {
  for (const stop of [false, true]) await t.test(stop ? 'Stop' : 'shared deadline', async t => {
    let now = Date.now(), plans = 0;
    t.mock.method(Date, 'now', () => now);
    const controller = new AbortController();
    const mock = await flow(t, { onRequest: kind => {
      if (kind !== 'plan') return;
      plans++;
      if (plans === 1) now += 90_000;
      else if (stop) controller.abort();
      else now += 210_001;
      throw new DOMException('Controlled SDK timeout or cancellation', 'AbortError');
    } });
    const drafts: Design[] = [];
    await assert.rejects(generateDesign({ prompt: 'Build this sculpture', image: mock.image, quality: 'detailed' }, undefined, {
      visualReview: false, signal: controller.signal, onDraft: draft => { drafts.push(draft); },
    }), (error: unknown) => error instanceof GenerationError && error.status === (stop ? 499 : 504));
    assert.equal(plans, 2); assert.equal(drafts.length, 0);
    assert.deepEqual(mock.calls.map(call => call.kind), ['subject', 'requirements', 'plan', 'plan']);
  });
});

test('a truncated plan cannot renew an exhausted per-call allowance through the LOW retry', async t => {
  let now = Date.now(), plans = 0;
  t.mock.method(Date, 'now', () => now);
  const truncated = new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"components":[' }] }, finishReason: 'MAX_TOKENS' }] }), { headers: { 'content-type': 'application/json' } });
  const mock = await flow(t, { plans: [truncated, plan], onRequest: kind => { if (kind === 'plan' && ++plans === 1) now += 85_000; } });
  const result = await generateDesign({ prompt: 'Build this sculpture', image: mock.image, quality: 'detailed' }, undefined, { visualReview: false });
  const requests = mock.calls.filter(call => call.kind === 'plan');
  assert.equal(requests.length, 2);
  assert.ok(requests[0].body.generationConfig.responseJsonSchema.properties.components);
  assert.equal(requests[1].body.generationConfig.responseJsonSchema.properties.components, undefined, 'Remaining time goes to the simpler whole-model path, not another component response');
  assert.equal(validateDesign(result).valid, true);
});

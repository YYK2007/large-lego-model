import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import sharp from 'sharp';
import { generateDesign, GenerationError, type GenerationProgress } from '../server/generation.js';
import type { GenerationAttempt } from '../server/generation-attempt.js';
import { catalogForDesign, footprint, partHeight, validateDesign } from '../shared/model.js';

const observations = { usedImages: [0], silhouette: 'A broad red body.', proportions: 'A broad three dimensional volume.', features: ['A broad red body'], colors: ['Red'], limitations: [] };
const box = { x: 0, y: 0, z: 0, width: 4, depth: 4, height: 9, colorId: 4 };
const plan = { schemaVersion: 2, coordinateSystem: 'stud-xy-plate-z', title: 'Continuous specimen', description: 'A real connected volume.', boxes: [box], observations };
const invalid = { ...plan, boxes: [box, { ...box, x: 12, width: 1, depth: 1 }] };
const matched = { matches: true, summary: 'The observed form is present.', issues: [], features: [{ index: 0, status: 'present', evidence: 'The actual model has the broad red body.', correction: '' }] };
const patch = (path: string, value: unknown) => ({ edits: [{ op: 'replace', path, valueJson: JSON.stringify(value) }] });
const component = (id: string, parentId: string, geometry: unknown, target = { x: 0, y: 0, z: 0 }) => ({ id, parentId, role: 'Body', target, tolerance: { x: 0, y: 0, z: 0 }, rotation: 0, geometryJson: JSON.stringify(geometry) });
const concept = { title: 'Body study', rationale: 'Preserve its broad form.', features: observations.features, limitations: [], components: [{ id: 'body', featureIndices: [0], role: 'Body', parentId: '', connection: 'Upright studs', geometryJson: JSON.stringify({ boxes: [box] }), partQueries: [] }] };
type Record = { kind: 'plan' | 'patch' | 'critic' | 'outline' | 'choice'; body: { contents: { parts: { text?: string; inlineData?: { mimeType: string; data: string } }[] }[] }; init: RequestInit };
const reviewed = (value: unknown): unknown => value && typeof value === 'object' && 'matches' in value ? { identity: { status: 'recognizable', perceivedSubject: 'The requested specimen', evidence: 'The rendered contours and arrangement distinguish the requested subject.', correction: '' }, ...value } : value;
const response = (value: unknown, raw = false) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: raw ? value : JSON.stringify(reviewed(value)) }] }, finishReason: 'STOP' }] }), { headers: { 'content-type': 'application/json' } });
async function setup(t: TestContext, reply: (record: Record, n: number) => unknown | Promise<unknown>) {
  const keys = ['GEMINI_API_KEY', 'GEMINI_MODEL', 'REBRICKABLE_API_KEY'];
  const previous = keys.map(key => process.env[key]);
  t.mock.method(dotenv, 'config', () => ({ parsed: {} }));
  process.env.GEMINI_API_KEY = 'fake-continuous-test-key'; process.env.GEMINI_MODEL = 'gemini-3.8-flash'; delete process.env.REBRICKABLE_API_KEY;
  t.after(() => keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; }));
  const image = { mimeType: 'image/jpeg', data: (await sharp({ create: { width: 20, height: 20, channels: 3, background: '#b52b27' } }).jpeg().toBuffer()).toString('base64') };
  const records: Record[] = []; let constructions = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit = {}) => {
    assert.equal(new URL(String(url)).hostname, 'generativelanguage.googleapis.com', 'The retained uploaded reference must not trigger online research');
    const body = JSON.parse(String(init.body)), fields = body.generationConfig.responseJsonSchema.properties;
    if (fields.usedImages) return response(observations);
    const kind: Record['kind'] = fields.concepts ? 'outline' : fields.selectedIndex ? 'choice' : fields.matches ? 'critic' : fields.edits ? 'patch' : 'plan';
    const record = { kind, body, init }; records.push(record);
    if (kind === 'plan' || kind === 'patch') constructions++;
    const value = kind === 'outline' ? { concepts: [concept] } : kind === 'choice' ? { selectedIndex: 0, summary: 'The reference form is retained.', issues: [] } : await reply(record, constructions);
    return value instanceof Response ? value : response(value);
  });
  return { image, records };
}
const cancelled = (error: unknown) => error instanceof GenerationError && error.status === 499;
const text = (record: Record) => record.body.contents[0].parts.flatMap(part => part.text ? [part.text] : []).join('\n');

test('Stop during a valid draft save cannot lose or duplicate its completed attempt output', async t => {
  const controller = new AbortController(), attempts: GenerationAttempt[] = [];
  const flow = await setup(t, record => record.kind === 'critic' ? matched : plan);
  await assert.rejects(generateDesign({ prompt: 'Build this sculpture', image: flow.image, quality: 'quick' }, undefined, {
    continuous: true, signal: controller.signal,
    onAttempt: async artifact => { await Promise.resolve(); attempts.push(artifact); },
    onDraft: async () => {
      assert.equal(attempts.length, 1, 'The completed attempt must already be durable before the separate draft save');
      controller.abort();
      await Promise.resolve();
    },
  }), cancelled);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].status, 'valid');
  assert.equal(attempts[0].design?.research?.comparison.status, 'matched');
  assert.deepEqual(flow.records.map(record => record.kind), ['plan', 'critic']);
});

test('continuous retries pass the fourth attempt, retain the complete plan, and await each invalid output before continuing', async t => {
  const controller = new AbortController(), attempts: GenerationAttempt[] = []; let acknowledged = 0;
  const flow = await setup(t, (record, n) => {
    assert.notEqual(record.kind, 'critic');
    assert.equal(acknowledged, n - 1, 'No subsequent paid request starts before its previous output is acknowledged');
    return n === 1 ? invalid : patch('/boxes/1/x', 12);
  });
  const progress: GenerationProgress[] = [];
  await assert.rejects(generateDesign({ prompt: 'Build this sculpture', image: flow.image, quality: 'quick' }, event => progress.push(event), { continuous: true, signal: controller.signal,
    onAttempt: async artifact => { await Promise.resolve(); attempts.push(artifact); acknowledged++; if (artifact.attempt === 6) controller.abort(); },
  }), cancelled);
  assert.deepEqual(attempts.map(a => a.attempt), [1, 2, 3, 4, 5, 6]);
  assert.ok(attempts.every(a => a.status === 'invalid' && a.checks.some(check => /disconnected/.test(check)) && a.plan && a.design));
  assert.ok(attempts.every(a => validateDesign(a.design!).valid === false));
  assert.deepEqual(flow.records.map(r => r.kind), ['plan', 'patch', 'patch', 'patch', 'patch', 'patch']);
  assert.ok(flow.records.slice(1).every(r => text(r).includes('/boxes/1')));
  assert.ok(progress.some(event => event.attempt === 6));
});

test('continuous detailed retries retain the selected concept while rebuilding failed sections into a whole-model plan', async t => {
  const controller = new AbortController(), attempts: GenerationAttempt[] = [];
  const full = { ...plan, boxes: undefined, components: [component('body', '', { boxes: invalid.boxes })] };
  const flow = await setup(t, (_record, n) => n === 1 ? full : n === 2 ? patch('/components/0/boxes/1/x', 12) : n === 3 ? invalid : patch('/boxes/1/x', 12));
  await assert.rejects(generateDesign({ prompt: 'Build this sculpture', image: flow.image }, undefined, { continuous: true, signal: controller.signal,
    onAttempt: artifact => { attempts.push(artifact); if (artifact.attempt === 7) controller.abort(); },
  }), cancelled);
  assert.deepEqual(flow.records.map(r => r.kind), ['outline', 'choice', 'plan', 'patch', 'plan', 'patch', 'patch', 'patch', 'patch']);
  assert.ok(attempts.slice(0, 2).every(a => a.partial && a.design && a.plan?.components?.length === 1));
  assert.ok(attempts.slice(2).every(a => !a.partial && a.design && !a.plan?.components?.length));
  assert.ok(attempts.every(a => a.status === 'invalid'));
  assert.match(text(flow.records[3]), /Only a compiled section is shown; later sections may not appear/);
  assert.match(text(flow.records[4]), /SIMPLE GLOBAL REBUILD/);
  assert.match(text(flow.records[4]), /Previous complete component plan/);
  assert.ok(flow.records.slice(5).every(r => text(r).includes('/boxes/1')));
});

test('a failed component preview retains prior sections and applies the requested target and yaw exactly', async t => {
  const controller = new AbortController(), attempts: GenerationAttempt[] = [];
  const cap = component('cap', 'base', { boxes: [box, { ...box, x: 12, width: 1, depth: 1 }] }, { x: 10, y: 10, z: 9 });
  cap.rotation = 90;
  const full = { ...plan, boxes: undefined, components: [component('base', '', { boxes: [box] }, { x: 10, y: 10, z: 0 }), cap] };
  const flow = await setup(t, () => full);
  await assert.rejects(generateDesign({ prompt: 'Build this sculpture', image: flow.image }, undefined, { continuous: true, signal: controller.signal,
    onAttempt: artifact => { attempts.push(artifact); controller.abort(); },
  }), cancelled);
  const artifact = attempts[0], design = artifact.design!, catalog = catalogForDesign(design);
  assert.equal(artifact.status, 'invalid'); assert.equal(artifact.partial, true); assert.equal(validateDesign(design).valid, false);
  const actual = new Set<string>(), expected = new Set<string>();
  for (const brick of design.bricks) {
    const size = footprint(brick, catalog);
    for (let x = brick.x; x < brick.x + size.width; x++) for (let y = brick.y; y < brick.y + size.depth; y++) for (let z = brick.z; z < brick.z + partHeight(brick, catalog); z++) actual.add(`${x},${y},${z}`);
  }
  for (let x = 10; x < 14; x++) for (let y = 10; y < 14; y++) for (let z = 0; z < 18; z++) expected.add(`${x},${y},${z}`);
  for (let z = 9; z < 18; z++) expected.add(`13,22,${z}`);
  assert.deepEqual(actual, expected, 'The preview contains actual packed cells, never guessed filler or an untransformed local section');
});

test('a matched valid result is published on every attempt and continues until Stop', async t => {
  const controller = new AbortController(), attempts: GenerationAttempt[] = []; let drafts = 0;
  const flow = await setup(t, (record, n) => record.kind === 'critic' ? matched : n === 1 ? plan : patch('/boxes/0/height', 9));
  await assert.rejects(generateDesign({ prompt: 'Build this sculpture', image: flow.image, quality: 'quick' }, undefined, { continuous: true, signal: controller.signal,
    onDraft: () => { drafts++; }, onAttempt: artifact => { attempts.push(artifact); if (artifact.attempt === 3) controller.abort(); },
  }), cancelled);
  assert.equal(drafts, 1, 'The admitted best draft remains separate from the attempt history');
  assert.equal(attempts.length, 3);
  assert.ok(attempts.every(a => a.status === 'valid' && validateDesign(a.design!).valid && a.design!.research?.comparison.status === 'matched'));
  assert.deepEqual(flow.records.map(r => r.kind), ['plan', 'critic', 'patch', 'critic', 'patch', 'critic']);
  assert.match(text(flow.records[2]), /passes geometry and the assessed major reference features/);
});

test('each continuous attempt renews its bounded deadline while keeping the previous plan after a timeout', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const controller = new AbortController(), attempts: GenerationAttempt[] = [];
  const flow = await setup(t, (record, n) => {
    if (record.kind === 'critic') return matched;
    if (n === 2) t.mock.timers.tick(151_000);
    return n === 1 ? invalid : patch('/boxes', [box]);
  });
  await assert.rejects(generateDesign({ prompt: 'Build this sculpture', image: flow.image, quality: 'quick' }, undefined, { continuous: true, signal: controller.signal,
    onAttempt: artifact => { attempts.push(artifact); if (artifact.attempt === 3) controller.abort(); },
  }), cancelled);
  assert.equal(attempts[1].status, 'invalid'); assert.match(attempts[1].checks.join(' '), /time limit/);
  assert.deepEqual(JSON.parse(attempts[1].response!), patch('/boxes', [box]), 'A response arriving at the deadline remains available in the attempt output');
  assert.deepEqual(attempts[1].plan?.boxes, invalid.boxes);
  assert.equal(attempts[2].status, 'valid');
  assert.deepEqual(flow.records.map(r => r.kind), ['plan', 'patch', 'patch', 'critic']);
});

test('valid geometry is emitted when its critic times out and the next attempt retains that plan', async t => {
  const controller = new AbortController(), attempts: GenerationAttempt[] = [];
  const flow = await setup(t, (record, n) => record.kind === 'critic' && n === 1
    ? new Response(JSON.stringify({ error: { code: 504, message: 'Timed out', status: 'DEADLINE_EXCEEDED' } }), { status: 504 })
    : record.kind === 'critic' ? matched : n === 1 ? plan : patch('/boxes/0/height', 9));
  await assert.rejects(generateDesign({ prompt: 'Build this sculpture', image: flow.image, quality: 'quick' }, undefined, { continuous: true, signal: controller.signal,
    onAttempt: artifact => { attempts.push(artifact); if (artifact.attempt === 2) controller.abort(); },
  }), cancelled);
  assert.equal(attempts[0].status, 'valid'); assert.equal(validateDesign(attempts[0].design!).valid, true);
  assert.equal(attempts[0].design!.research, undefined, 'No likeness verdict is fabricated');
  assert.match(attempts[0].checks.join(' '), /timed out/);
  assert.deepEqual(attempts[0].plan?.boxes, plan.boxes);
  assert.equal(attempts[1].design!.research?.comparison.status, 'matched');
  assert.match(text(flow.records[2]), /Retain the last complete plan/);
});

test('a malformed plan emits its exact raw output, then requests a complete corrected plan', async t => {
  const controller = new AbortController(), attempts: GenerationAttempt[] = [];
  const flow = await setup(t, (record, n) => record.kind === 'critic' ? matched : n === 1 ? response('{broken JSON', true) : plan);
  await assert.rejects(generateDesign({ prompt: 'Build this sculpture', image: flow.image, quality: 'quick' }, undefined, { continuous: true, signal: controller.signal,
    onAttempt: artifact => { attempts.push(artifact); if (artifact.attempt === 2) controller.abort(); },
  }), cancelled);
  assert.equal(attempts[0].response, '{broken JSON'); assert.equal(attempts[0].status, 'invalid'); assert.equal(attempts[0].design, undefined);
  assert.deepEqual(flow.records.map(r => r.kind), ['plan', 'plan', 'critic']);
});

test('quota failure after a valid draft remains terminal rather than silently succeeding', async t => {
  const attempts: GenerationAttempt[] = []; let draft = false;
  const flow = await setup(t, (record, n) => n > 1 ? new Response(JSON.stringify({ error: { code: 429, message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' } }), { status: 429 }) : record.kind === 'critic' ? matched : plan);
  await assert.rejects(generateDesign({ prompt: 'Build this sculpture', image: flow.image, quality: 'quick' }, undefined, { continuous: true,
    onDraft: () => { draft = true; }, onAttempt: artifact => { attempts.push(artifact); },
  }), error => error instanceof GenerationError && error.status === 429);
  assert.equal(draft, true); assert.equal(attempts.length, 2);
  assert.equal(attempts[0].status, 'valid'); assert.match(attempts[1].checks.join(' '), /quota/);
  assert.deepEqual(flow.records.map(r => r.kind), ['plan', 'critic', 'patch']);
});

test('depleted prepaid credits after a saved draft preserve that draft and stop instead of retrying or reporting success', async t => {
  const attempts: GenerationAttempt[] = []; let draft = false;
  const flow = await setup(t, (record, n) => n > 1 ? new Response(JSON.stringify({ error: { code: 402, message: 'Your prepayment credits are depleted', status: 'RESOURCE_EXHAUSTED' } }), { status: 402 }) : record.kind === 'critic' ? matched : plan);
  await assert.rejects(generateDesign({ prompt: 'Build this sculpture', image: flow.image, quality: 'quick' }, undefined, { continuous: true,
    onDraft: () => { draft = true; }, onAttempt: artifact => { attempts.push(artifact); },
  }), error => error instanceof GenerationError && error.status === 402 && /already topped up/.test(error.message));
  assert.equal(draft, true); assert.equal(attempts.length, 2);
  assert.equal(attempts[0].status, 'valid'); assert.match(attempts[1].checks.join(' '), /prepaid credits/);
  assert.deepEqual(flow.records.map(r => r.kind), ['plan', 'critic', 'patch']);
});

test('transient provider failure is emitted and retried with a delay; Stop interrupts that delay', async t => {
  for (const stopDuringDelay of [false, true]) await t.test(String(stopDuringDelay), async t => {
    const controller = new AbortController(), attempts: GenerationAttempt[] = []; let failedAt = 0, retriedAt = 0;
    const flow = await setup(t, (record, n) => {
      if (n === 1) {
        failedAt = performance.now();
        return new Response(JSON.stringify({ error: { code: 503, message: 'Temporarily unavailable', status: 'UNAVAILABLE' } }), { status: 503 });
      }
      retriedAt ||= performance.now();
      return record.kind === 'critic' ? matched : plan;
    });
    const started = performance.now();
    await assert.rejects(generateDesign({ prompt: 'Build this sculpture', image: flow.image, quality: 'quick' }, undefined, { continuous: true, signal: controller.signal,
      onAttempt: artifact => { attempts.push(artifact); if (stopDuringDelay || artifact.attempt === 2) controller.abort(); },
    }), cancelled);
    assert.match(attempts[0].checks.join(' '), /temporarily unavailable/);
    if (stopDuringDelay) {
      assert.equal(flow.records.length, 1); assert.ok(performance.now() - started < 800, 'Stop must not wait out the retry backoff');
    } else {
      assert.ok(retriedAt - failedAt >= 900, 'A provider failure must not trigger a paid tight retry loop');
      assert.equal(attempts[1].status, 'valid');
    }
  });
});

test('invalid credentials stop continuous generation with an attempt record and no extra request', async t => {
  const attempts: GenerationAttempt[] = [];
  const flow = await setup(t, () => new Response(JSON.stringify({ error: { code: 403, message: 'Invalid credential', status: 'PERMISSION_DENIED' } }), { status: 403 }));
  await assert.rejects(generateDesign({ prompt: 'Build this sculpture', image: flow.image, quality: 'quick' }, undefined, { continuous: true, onAttempt: artifact => { attempts.push(artifact); } }),
    error => error instanceof GenerationError && error.status === 502);
  assert.equal(flow.records.length, 1); assert.equal(attempts.length, 1); assert.match(attempts[0].checks.join(' '), /API key/);
});

test('Stop cancels an in-flight retry without starting another provider call', async t => {
  const controller = new AbortController(), attempts: GenerationAttempt[] = [];
  const flow = await setup(t, (record, n) => n === 1 ? invalid : new Promise((_resolve, reject) => {
    record.init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    queueMicrotask(() => controller.abort());
  }));
  await assert.rejects(generateDesign({ prompt: 'Build this sculpture', image: flow.image, quality: 'quick' }, undefined, { continuous: true, signal: controller.signal,
    onAttempt: artifact => { attempts.push(artifact); },
  }), cancelled);
  assert.deepEqual(flow.records.map(r => r.kind), ['plan', 'patch']);
  assert.equal(attempts.length, 2); assert.match(attempts[1].checks.join(' '), /cancelled/);
});

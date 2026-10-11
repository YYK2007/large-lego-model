import test, { beforeEach, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import sharp from 'sharp';
import { compileGeneratedPlan, generateDesign, GenerationError } from '../server/generation.js';
import { renderGenerationAttempt, type GenerationAttempt } from '../server/generation-attempt.js';
import { renderLikenessViews } from '../server/likeness.js';
import { resetReferenceStateForTests } from '../server/references.js';
import type { ShapePlanV2 } from '../server/compiler.js';
import { validateDesign, type Design } from '../shared/model.js';

beforeEach(resetReferenceStateForTests);
const observations = { usedImages: [0], silhouette: 'A tall red body.', proportions: 'Tall with a square cross section.', features: ['A tall red body'], colors: ['Red'], limitations: [] };
const box = { x: 0, y: 0, z: 0, width: 4, depth: 4, height: 12, colorId: 4 };
const plan = { schemaVersion: 2, coordinateSystem: 'stud-xy-plate-z', title: 'Feedback specimen', description: 'A connected three dimensional form.', boxes: [box], observations } satisfies ShapePlanV2 & { observations: typeof observations };
const matched = { matches: true, summary: 'The requested proportions are visible.', issues: [], features: [{ index: 0, status: 'present', evidence: 'The actual model has the tall red body.', correction: '' }] };
// The feature evidence must override an inconsistent top-level matches claim.
const unresolved = { matches: true, summary: 'The body still needs height.', issues: [], features: [{ index: 0, status: 'incorrect', evidence: 'The actual body is too short.', correction: 'Increase the body height.' }] };
const patch = (path: string, value: unknown) => ({ edits: [{ op: 'replace', path, valueJson: JSON.stringify(value) }] });
type ImagePart = { mimeType: string; data: string };
type Recorded = { kind: 'target' | 'subject' | 'plan' | 'patch' | 'critic'; body: {
  contents: { parts: { text?: string; inlineData?: ImagePart }[] }[];
  systemInstruction: { parts: { text: string }[] };
  generationConfig: { responseJsonSchema: { properties: Record<string, unknown>; required?: string[] }; maxOutputTokens: number; thinkingConfig?: { thinkingLevel: string } };
} };
const contents = (record: Recorded) => record.body.contents[0].parts;
const pixels = (record: Recorded) => contents(record).flatMap(part => part.inlineData ? [part.inlineData] : []);
const text = (record: Recorded) => contents(record).flatMap(part => part.text ? [part.text] : []).join('\n');
const reviewed = (value: unknown): unknown => value && typeof value === 'object' && 'matches' in value ? { identity: { status: 'recognizable', perceivedSubject: 'The requested specimen', evidence: 'The rendered contours and arrangement distinguish the requested subject.', correction: '' }, ...value } : value;
const providerResponse = (value: unknown) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(reviewed(value)) }] }, finishReason: 'STOP' }] }), { headers: { 'content-type': 'application/json' } });
async function setup(t: TestContext, reply: (record: Recorded, construction: number) => unknown, specific = false, targets?: unknown[]) {
  const keys = ['GEMINI_API_KEY', 'GEMINI_MODEL', 'REBRICKABLE_API_KEY'];
  const old = keys.map(key => process.env[key]);
  t.mock.method(dotenv, 'config', () => ({ parsed: {} }));
  process.env.GEMINI_API_KEY = 'mock-feedback-key'; process.env.GEMINI_MODEL = 'gemini-3.8-flash'; delete process.env.REBRICKABLE_API_KEY;
  t.after(() => keys.forEach((key, index) => { if (old[index] === undefined) delete process.env[key]; else process.env[key] = old[index]; }));
  const image = { mimeType: 'image/jpeg', data: (await sharp({ create: { width: 24, height: 32, channels: 3, background: '#a52825' } }).jpeg().toBuffer()).toString('base64') };
  const records: Recorded[] = [], targetRequests: Recorded[] = [], lookups: string[] = [], controller = new AbortController();
  let construction = 0;
  t.mock.method(globalThis, 'fetch', async (url: string | URL, init: RequestInit = {}) => {
    const host = new URL(String(url)).hostname;
    if (specific && ['en.wikipedia.org', 'commons.wikimedia.org'].includes(host)) {
      lookups.push(String(url)); return new Response('Reference service unavailable', { status: 503 });
    }
    assert.equal(host, 'generativelanguage.googleapis.com', 'Tests must never fetch external pixels or a real catalog');
    const body = JSON.parse(String(init.body)) as Recorded['body'], fields = body.generationConfig.responseJsonSchema.properties;
    if (fields.usedImages) {
      targetRequests.push({ kind: 'target', body });
      return providerResponse(targets?.[targetRequests.length - 1] ?? { ...observations, usedImages: body.contents[0].parts.some(part => part.inlineData) ? [0] : [] });
    }
    const kind: Recorded['kind'] = fields.kind ? 'subject' : fields.matches ? 'critic' : fields.edits ? 'patch' : 'plan';
    const record = { kind, body }; records.push(record);
    if (records.length > 10) { controller.abort(); throw new Error('The feedback loop made an unexpected extra request'); }
    if (kind === 'plan' || kind === 'patch') construction++;
    const value = kind === 'subject' ? { kind: specific ? 'specific' : 'original', name: specific ? 'Example landmark' : 'An invented sculpture', location: '', aliases: [] } : reply(record, construction);
    return value instanceof Response ? value : providerResponse(value);
  });
  return { image, records, targetRequests, lookups, controller };
}

test('continuous feedback stops only at a complete matched review and carries exact renders, reference pixels and the original request into repair', async t => {
  const attempts: GenerationAttempt[] = [], drafts: Design[] = [], order: string[] = [];
  const flow = await setup(t, (record, n) => record.kind === 'critic' ? n === 1 ? unresolved : matched : n === 1 ? plan : patch('/boxes/0/height', 15));
  const previous = compileGeneratedPlan(plan, { prompt: 'Build an original tall red sculpture with a square body' });
  const result = await generateDesign({ prompt: 'Make the body taller', previous, image: flow.image, quality: 'quick' }, undefined, {
    continuous: true, stopWhenMatched: true, signal: flow.controller.signal,
    onAttempt: async artifact => { await Promise.resolve(); attempts.push(artifact); order.push('attempt' + artifact.attempt); },
    onDraft: draft => { drafts.push(draft); order.push('draft'); },
  });
  assert.deepEqual(flow.records.map(record => record.kind), ['plan', 'critic', 'patch', 'critic']);
  assert.deepEqual(order, ['draft', 'attempt1', 'draft', 'attempt2', 'draft']);
  assert.equal(attempts[0].design!.research!.comparison.status, 'needs-work');
  assert.equal(attempts[1].design!.research!.comparison.status, 'matched');
  assert.equal(result.id, attempts[1].design!.id); assert.equal(drafts.length, 3);
  assert.match(drafts[0].research!.comparison.summary, /Visual review has not completed/);
  assert.ok(attempts.every(attempt => validateDesign(attempt.design!).valid));
  const firstViews = (await renderLikenessViews(attempts[0].design!)).map(view => view.inlineData);
  const lastViews = (await renderLikenessViews(result)).map(view => view.inlineData);
  assert.deepEqual(pixels(flow.records[0]), [flow.image]);
  assert.deepEqual(pixels(flow.records[1]), [flow.image, ...firstViews]);
  assert.deepEqual(pixels(flow.records[2]), [flow.image, ...firstViews]);
  assert.deepEqual(pixels(flow.records[3]), [flow.image, ...lastViews]);
  assert.notDeepEqual(firstViews, lastViews, 'The reviewer must see the revised geometry, not stale renders');
  assert.match(text(flow.records[2]), /LAST VALID DRAFT TO IMPROVE/);
  assert.match(text(flow.records[2]), /Increase the body height/);
  assert.match(text(flow.records[2]), /\/boxes\/0/);
  const brief = JSON.parse(contents(flow.records[0])[0].text!.split('\n')[0]);
  assert.equal(brief.originalRequest, previous.prompt);
  for (const critic of [flow.records[1], flow.records[3]]) {
    const context = JSON.parse(contents(critic)[0].text!);
    assert.equal(context.request, 'Make the body taller'); assert.equal(context.originalRequest, previous.prompt);
    assert.deepEqual(context.definingFeatures, [{ index: 0, name: observations.features[0] }]);
  }
});

test('an original text-only target receives an actual rendered critic and stops on its matched verdict', async t => {
  const flow = await setup(t, record => record.kind === 'critic' ? matched : { ...plan, observations: { ...observations, usedImages: [] } });
  const result = await generateDesign({ prompt: 'Invent a tall red sculpture', quality: 'quick' }, undefined, { continuous: true, stopWhenMatched: true, signal: flow.controller.signal });
  assert.deepEqual(flow.records.map(record => record.kind), ['subject', 'plan', 'critic']);
  assert.ok(flow.records[1].body.generationConfig.responseJsonSchema.required!.includes('observations'));
  assert.equal(pixels(flow.records[1]).length, 0);
  assert.deepEqual(pixels(flow.records[2]), (await renderLikenessViews(result)).map(view => view.inlineData));
  assert.equal(JSON.parse(contents(flow.records[2])[0].text!).evidence, 'text request only; no reference photographs');
  assert.match(flow.records[2].body.systemInstruction.parts[0].text, /No reference photographs were available/);
  assert.equal(result.research!.comparison.status, 'matched');
  assert.equal(result.research!.uploadedImage, false); assert.deepEqual(result.research!.sources, []);
  assert.ok(result.research!.warnings.some(warning => /without reference photographs/.test(warning)));
});

test('an independent target needs concrete features before any construction can start', async t => {
  const invalid = { ...observations, usedImages: [], features: [] };
  const flow = await setup(t, () => plan, false, [invalid, invalid]);
  await assert.rejects(generateDesign({ prompt: 'Invent a tall red sculpture', quality: 'quick' }, undefined, {
    continuous: true, stopWhenMatched: true, signal: flow.controller.signal,
  }), error => error instanceof GenerationError && error.status === 502);
  assert.deepEqual(flow.records.map(record => record.kind), ['subject']);
  assert.equal(flow.targetRequests.length, 2);
  assert.match(flow.targetRequests[1].body.systemInstruction.parts[0].text, /Correct the previous reference-brief response/);
});

test('a malformed independent brief is corrected from the source before planning and cannot be diluted by the plan', async t => {
  const required = { ...observations, features: ['Overlapping curved surfaces separated by visible dark channels'] };
  const flow = await setup(t, record => record.kind === 'critic' ? matched : { ...plan, observations: { ...observations, features: ['A generic red mass'] } }, false,
    [{ ...required, features: [] }, required]);
  const previous = compileGeneratedPlan(plan, { prompt: 'An open layered sculpture', quality: 'quick' });
  const result = await generateDesign({ prompt: 'Preserve the folded surfaces and gaps instead of a solid lump', previous, image: flow.image, quality: 'quick' }, undefined, {
    continuous: true, stopWhenMatched: true, signal: flow.controller.signal,
  });
  assert.equal(flow.targetRequests.length, 2);
  for (const request of flow.targetRequests) {
    assert.deepEqual(pixels(request), [flow.image]);
    const context = JSON.parse(contents(request)[0].text!);
    assert.equal(context.originalRequest, previous.prompt);
    assert.match(context.request, /folded surfaces and gaps/);
    assert.equal(context.previous, undefined); assert.equal(context.parts, undefined); assert.equal(context.workspace, undefined);
    assert.match(request.body.systemInstruction.parts[0].text, /BEFORE any LEGO construction/);
    assert.equal(request.body.generationConfig.maxOutputTokens, 2000);
    assert.equal(request.body.generationConfig.thinkingConfig?.thinkingLevel, 'LOW');
  }
  assert.deepEqual(JSON.parse(contents(flow.records[0])[0].text!.split('\n')[0]).referenceRequirements.features, required.features);
  assert.deepEqual(JSON.parse(contents(flow.records[1])[0].text!).definingFeatures, [{ index: 0, name: required.features[0] }]);
  assert.deepEqual(result.research!.observations.features, required.features);
});

test('a recognizable-color lookalike cannot stop the loop and its shape correction reaches the next repair', async t => {
  const ambiguous = { ...matched, identity: { status: 'ambiguous', perceivedSubject: 'A smooth closed fruit', evidence: 'The red head is solid and smooth instead of visibly layered.', correction: 'Separate the curved overlapping surfaces with visible channels.' } };
  const flow = await setup(t, (record, n) => record.kind === 'critic' ? n === 1 ? ambiguous : matched : n === 1 ? plan : patch('/boxes/0/height', 15));
  const attempts: GenerationAttempt[] = [];
  const result = await generateDesign({ prompt: 'Make the layered sculpture distinguishable from a smooth fruit', image: flow.image, quality: 'quick' }, undefined, {
    continuous: true, stopWhenMatched: true, onAttempt: attempt => { attempts.push(attempt); },
  });
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].design!.research!.comparison.status, 'needs-work');
  assert.equal(attempts[0].design!.research!.comparison.identity!.status, 'ambiguous');
  const repair = flow.records.find(record => record.kind === 'patch')!;
  assert.match(text(repair), /Separate the curved overlapping surfaces with visible channels/);
  assert.deepEqual(pixels(repair).slice(1), (await renderLikenessViews(attempts[0].design!)).map(view => view.inlineData));
  assert.equal(result.research!.comparison.status, 'matched');
  assert.equal(result.research!.comparison.identity!.status, 'recognizable');
});

test('planner observation omissions cannot replace or discard independently verified requirements', async t => {
  const flow = await setup(t, record => record.kind === 'critic' ? matched : { ...plan, observations: { features: [] } });
  const result = await generateDesign({ prompt: 'Build this sculpture', image: flow.image, quality: 'quick' }, undefined, { continuous: true, stopWhenMatched: true });
  assert.deepEqual(flow.records.map(record => record.kind), ['plan', 'critic']);
  assert.deepEqual(result.research!.observations.features, observations.features);
});

test('failed actual placements are shown to the repair model as an exact unfinished PNG, never admitted as a draft', async t => {
  const attempts: GenerationAttempt[] = [], drafts: Design[] = [];
  const invalid = { ...plan, boxes: [box, { ...box, x: 12, width: 1, depth: 1 }] };
  const flow = await setup(t, (record, n) => record.kind === 'critic' ? matched : n === 1 ? invalid : patch('/boxes', [box]));
  const result = await generateDesign({ prompt: 'Build this sculpture', image: flow.image, quality: 'quick' }, undefined, {
    continuous: true, stopWhenMatched: true, signal: flow.controller.signal,
    onAttempt: artifact => { attempts.push(artifact); }, onDraft: draft => { drafts.push(draft); },
  });
  assert.deepEqual(flow.records.map(record => record.kind), ['plan', 'patch', 'critic']);
  assert.equal(attempts[0].status, 'invalid'); assert.ok(attempts[0].design); assert.equal(validateDesign(attempts[0].design!).valid, false);
  assert.match(attempts[0].checks.join(' '), /disconnected/);
  const failedSvg = await renderGenerationAttempt(attempts[0]); assert.ok(failedSvg); assert.match(failedSvg, /Unfinished attempt 1/);
  const failedPixels = { mimeType: 'image/png', data: (await sharp(Buffer.from(failedSvg)).png().toBuffer()).toString('base64') };
  assert.deepEqual(pixels(flow.records[1]), [flow.image, failedPixels]);
  assert.match(text(flow.records[1]), /FAILED ACTUAL OUTPUT/); assert.match(text(flow.records[1]), /not an approved build/);
  assert.match(text(flow.records[1]), /disconnected/);
  assert.equal(drafts.length, 2); assert.equal(drafts[0].id, result.id); assert.equal(result.research!.comparison.status, 'matched');
});

test('unavailable photos for a concrete subject fall back to an honestly labeled rendered text review', async t => {
  const flow = await setup(t, record => record.kind === 'critic' ? matched : { ...plan, observations: { ...observations, usedImages: [] } }, true);
  const result = await generateDesign({ prompt: 'Build the Example landmark', quality: 'quick' }, undefined, { continuous: true, stopWhenMatched: true, signal: flow.controller.signal });
  assert.ok(flow.lookups.length > 0, 'Reference retrieval must actually be attempted');
  assert.deepEqual(flow.records.map(record => record.kind), ['subject', 'plan', 'critic']);
  assert.equal(result.research!.subject, 'Example landmark'); assert.deepEqual(result.research!.sources, []);
  assert.ok(result.research!.warnings.some(warning => /photos were unavailable|No usable reference photo/.test(warning)));
  assert.equal(JSON.parse(contents(flow.records[2])[0].text!).evidence, 'text request only; no reference photographs');
  assert.deepEqual(pixels(flow.records[2]), (await renderLikenessViews(result)).map(view => view.inlineData));
});

test('a terminal provider failure after an imperfect reviewed draft preserves that draft without falsely declaring a match', async t => {
  const attempts: GenerationAttempt[] = [], drafts: Design[] = [];
  const flow = await setup(t, (record, n) => n > 1 ? new Response(JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded' } }), { status: 429 }) : record.kind === 'critic' ? unresolved : plan);
  await assert.rejects(generateDesign({ prompt: 'Build this sculpture', image: flow.image, quality: 'quick' }, undefined, {
    continuous: true, stopWhenMatched: true, signal: flow.controller.signal,
    onAttempt: artifact => { attempts.push(artifact); }, onDraft: draft => { drafts.push(draft); },
  }), error => error instanceof GenerationError && error.status === 429);
  assert.deepEqual(flow.records.map(record => record.kind), ['plan', 'critic', 'patch']);
  assert.equal(drafts.length, 2); assert.equal(drafts[1].research!.comparison.status, 'needs-work');
  assert.equal(validateDesign(drafts[0]).valid, true); assert.equal(attempts.length, 2);
  assert.match(attempts[1].checks.join(' '), /quota/);
});

test('quick delivery saves its first checked draft before a slow visual review', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const drafts: Design[] = [], attempts: GenerationAttempt[] = [];
  const flow = await setup(t, record => {
    if (record.kind === 'critic') {
      assert.equal(drafts.length, 1, 'The checked model must be durable before rendering or review can consume its remaining time');
      assert.equal(validateDesign(drafts[0]).valid, true);
      assert.match(drafts[0].research!.comparison.summary, /Visual review has not completed/);
      t.mock.timers.tick(16_000); return matched;
    }
    assert.doesNotMatch(text(record), /SIMPLER BUILD constraints/);
    assert.ok(record.body.generationConfig.responseJsonSchema.properties.boxes);
    assert.equal(record.body.generationConfig.responseJsonSchema.properties.components, undefined);
    t.mock.timers.tick(120_000); return plan;
  });
  const result = await generateDesign({ prompt: 'Build this sculpture', image: flow.image, quality: 'quick' }, undefined, {
    continuous: true, stopWhenMatched: true, signal: flow.controller.signal,
    onDraft: draft => { drafts.push(structuredClone(draft)); }, onAttempt: attempt => { attempts.push(attempt); },
  });
  assert.deepEqual(flow.records.map(record => record.kind), ['plan', 'critic']);
  assert.equal(result.id, drafts[0].id); assert.equal(result.research!.comparison.status, 'needs-work');
  assert.equal(result.research!.comparison.features, undefined, 'An elapsed review cannot fabricate a feature verdict');
  assert.ok(result.research!.warnings.some(warning => /135-second budget.*No further retries/.test(warning)));
  assert.equal(attempts.length, 1); assert.equal(attempts[0].status, 'valid');
  assert.match(attempts[0].checks.join(' '), /135-second time limit/);
});

test('quick delivery permits verified specialty geometry on its first attempt', async t => {
  const attempts: GenerationAttempt[] = [];
  const specialty = { ...plan, parts: [{ partId: '3039', colorId: 4, x: 0, y: 0, z: 12, rotation: 0 }] };
  const flow = await setup(t, record => record.kind === 'critic' ? matched : specialty);
  const result = await generateDesign({ prompt: 'Build this sculpture', image: flow.image, quality: 'quick' }, undefined, {
    continuous: true, stopWhenMatched: true, signal: flow.controller.signal, onAttempt: artifact => { attempts.push(artifact); },
  });
  assert.equal(attempts.length, 1); assert.equal(attempts[0].status, 'valid');
  assert.equal(result.bricks.some(brick => brick.partId === '3039'), true);
  assert.equal(result.research!.comparison.status, 'matched');
});

test('quick delivery shares 135 seconds across structural retries instead of renewing each attempt', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const drafts: Design[] = [];
  const invalid = { ...plan, boxes: [box, { ...box, x: 12, width: 1, depth: 1 }] };
  const flow = await setup(t, (record, n) => {
    if (record.kind === 'critic') { t.mock.timers.tick(16_000); return matched; }
    t.mock.timers.tick(n === 1 ? 100_000 : 20_000);
    return n === 1 ? invalid : patch('/boxes', [box]);
  });
  const result = await generateDesign({ prompt: 'Build this sculpture', image: flow.image, quality: 'quick' }, undefined, {
    continuous: true, stopWhenMatched: true, signal: flow.controller.signal, onDraft: draft => { drafts.push(draft); },
  });
  assert.deepEqual(flow.records.map(record => record.kind), ['plan', 'patch', 'critic']);
  assert.equal(drafts.length, 1); assert.equal(result.id, drafts[0].id);
  assert.equal(result.research!.comparison.status, 'needs-work');
  assert.ok(result.research!.warnings.some(warning => /135-second budget/.test(warning)));
});

test('quick delivery returns its better reviewed draft if a later repair exhausts the shared budget', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const drafts: Design[] = [];
  const flow = await setup(t, (record, n) => {
    if (record.kind === 'critic') return unresolved;
    t.mock.timers.tick(n === 1 ? 20_000 : 116_000);
    return n === 1 ? plan : patch('/boxes/0/height', 15);
  });
  const result = await generateDesign({ prompt: 'Build this sculpture', image: flow.image, quality: 'quick' }, undefined, {
    continuous: true, stopWhenMatched: true, signal: flow.controller.signal, onDraft: draft => { drafts.push(structuredClone(draft)); },
  });
  assert.deepEqual(flow.records.map(record => record.kind), ['plan', 'critic', 'patch']);
  assert.equal(result.id, drafts[1].id); assert.equal(result.research!.comparison.features![0].status, 'incorrect');
  assert.match(result.research!.comparison.issues.join(' '), /Increase the body height/);
  assert.ok(result.research!.warnings.some(warning => /No further retries/.test(warning)));
});

test('quick delivery with no checked model fails at the shared deadline and never saves invalid geometry', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  let drafts = 0;
  const invalid = { ...plan, boxes: [] };
  const flow = await setup(t, (_record, n) => { t.mock.timers.tick(n === 1 ? 100_000 : 36_000); return n === 1 ? invalid : patch('/boxes', []); });
  await assert.rejects(generateDesign({ prompt: 'Build this sculpture', image: flow.image, quality: 'quick' }, undefined, {
    continuous: true, stopWhenMatched: true, signal: flow.controller.signal, onDraft: () => { drafts++; },
  }), error => error instanceof GenerationError && error.status === 504 && /135-second time limit/.test(error.message));
  assert.deepEqual(flow.records.map(record => record.kind), ['plan', 'patch']); assert.equal(drafts, 0);
});

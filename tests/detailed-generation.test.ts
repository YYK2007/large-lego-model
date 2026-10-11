import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import sharp from 'sharp';
import { generateDesign, generationBudget, GenerationError, type GenerationProgress, type GenerationUsage } from '../server/generation.js';
import { parseConcept, renderConceptSvg, renderConceptViews } from '../server/concept.js';
import { selectConstructionConcept } from '../server/detailed-planning.js';
import { compileComponents, decodeComponentPlan } from '../server/component-plan.js';
import { renderLikenessViews } from '../server/likeness.js';
import type { GenerationAttempt } from '../server/generation-attempt.js';
import { footprint, partHeight, validateDesign, type Brick, type Design } from '../shared/model.js';

const features = ['A broad lower body with a narrower centered upper section'];
const box = (width: number, depth: number, height: number) => ({ x: 0, y: 0, z: 0, width, depth, height, colorId: 4 });
const geometry = (width: number, depth: number, height: number) => ({ boxes: [box(width, depth, height)], profiles: [], parts: [], slopes: [] });
const concepts = [8, 6].map((width, index) => ({ title: `Approach ${index + 1}`, rationale: 'Keep the observed lower and upper masses separately connected.', features, limitations: ['The rear is not visible in the upload.'],
  components: [{ id: 'body', featureIndices: [0], role: 'Main body', parentId: '', connection: 'Grounded overlapping upright stud courses.',
    geometryJson: JSON.stringify(geometry(width, 6, 12)), partQueries: [] }] }));
const observations = { usedImages: [0], silhouette: 'A broad body with a narrower upper section.', proportions: 'A twelve-plate-high assembly.', features, colors: ['Red'], limitations: [] };
const component = (id: string, parentId: string, width: number, depth: number, target: { x: number; y: number; z: number }, rotation: Brick['rotation'] = 0) => ({
  id, parentId, role: id === 'base' ? 'Lower body' : 'Upper section', target, tolerance: { x: 0, y: 0, z: 0 }, rotation, geometryJson: JSON.stringify(geometry(width, depth, 6)),
});
const plan = { schemaVersion: 2, coordinateSystem: 'stud-xy-plate-z', title: 'Connected reference specimen', description: 'Two translated upright sections with a real shared connector plane.',
  components: [component('base', '', 6, 6, { x: 8, y: 10, z: 0 }), component('top', 'base', 3, 4, { x: 9, y: 11, z: 6 }, 90)], observations };
const quickPlan = { ...plan, components: undefined, boxes: [box(4, 4, 12)], slopes: [] };
const matched = { matches: true, summary: 'Both visible sections are present.', issues: [], features: [{ index: 0, status: 'present', evidence: 'A broad lower volume supports the narrower upper volume.', correction: '' }] };
const patch = (path: string, value: unknown) => ({ edits: [{ op: 'replace', path, valueJson: JSON.stringify(value) }] });
const reviewed = (value: unknown): unknown => value && typeof value === 'object' && 'matches' in value ? { identity: { status: 'recognizable', perceivedSubject: 'The requested specimen', evidence: 'The rendered contours and arrangement distinguish the requested subject.', correction: '' }, ...value } : value;
const response = (value: unknown) => new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(reviewed(value)) }] }, finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, thoughtsTokenCount: 5, cachedContentTokenCount: 2 } }), { headers: { 'content-type': 'application/json' } });
type RequestBody = { systemInstruction?: { parts: { text?: string }[] }; contents: { parts: { text?: string; inlineData?: { mimeType: string; data: string } }[] }[];
  generationConfig: { responseJsonSchema: { properties: Record<string, unknown> }; thinkingConfig?: { thinkingLevel: string }; maxOutputTokens: number } };
type Recorded = { kind: 'outline' | 'choice' | 'plan' | 'patch' | 'critic'; body: RequestBody; init: RequestInit };

async function setup(t: TestContext, options: { plans?: unknown[]; critics?: unknown[]; model?: string; truncated?: 'outline' | 'plan'; truncateTwice?: boolean; onRequest?: (record: Recorded) => void } = {}) {
  const previous = Object.fromEntries(['GEMINI_API_KEY', 'GEMINI_MODEL', 'REBRICKABLE_API_KEY'].map(key => [key, process.env[key]]));
  t.mock.method(dotenv, 'config', () => ({ parsed: {} }));
  process.env.GEMINI_API_KEY = 'fake-detailed-test-key-never-sent';
  process.env.GEMINI_MODEL = options.model || 'gemini-3.8-flash';
  delete process.env.REBRICKABLE_API_KEY;
  t.after(() => { for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  const bytes = await sharp({ create: { width: 32, height: 48, channels: 3, background: '#b52b27' } }).jpeg().toBuffer();
  const image = { mimeType: 'image/jpeg', data: bytes.toString('base64') }, records: Recorded[] = [];
  let planIndex = 0, criticIndex = 0, truncations = 0;
  t.mock.method(globalThis, 'fetch', async (input: string | URL, init: RequestInit = {}) => {
    assert.equal(new URL(String(input)).hostname, 'generativelanguage.googleapis.com', 'An uploaded image and disabled catalog key must avoid external research/catalog requests');
    const body = JSON.parse(String(init.body)) as RequestBody, fields = body.generationConfig.responseJsonSchema.properties;
    if (body.systemInstruction?.parts.some((part: { text?: string }) => part.text?.includes('Identify the visual subject'))) return response({ kind: 'original', name: '', location: '', aliases: [] });
    if (fields.usedImages) return response(observations);
    const kind: Recorded['kind'] = fields.concepts ? 'outline' : fields.selectedIndex ? 'choice' : fields.matches ? 'critic' : fields.edits ? 'patch' : 'plan';
    const record = { kind, body, init }; records.push(record); options.onRequest?.(record);
    if (kind === options.truncated && truncations++ < (options.truncateTwice ? 2 : 1)) return new Response(JSON.stringify({
      candidates: [{ content: { role: 'model', parts: [{ text: kind === 'outline' ? '{"concepts":[' : '{"components":[' }] }, finishReason: 'MAX_TOKENS' }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 549, thoughtsTokenCount: 13437 },
    }), { headers: { 'content-type': 'application/json' } });
    return response(kind === 'outline' ? { concepts } : kind === 'choice' ? { selectedIndex: 1, summary: 'The second approach better preserves the reference proportions.', issues: [] }
      : kind === 'critic' ? options.critics ? options.critics[criticIndex++] : matched : (options.plans || [plan])[planIndex++]);
  });
  return { image, records };
}

const pixels = (record: Recorded) => record.body.contents[0].parts.flatMap(part => part.inlineData ? [part.inlineData] : []);
const text = (record: Recorded) => record.body.contents[0].parts.flatMap(part => part.text ? [part.text] : []).join('\n');

test('default detailed flow selects actual concept PNGs, checkpoints decoded geometry, and reviews the exact compiled model', async t => {
  const checkpoints: string[] = [], events: GenerationProgress[] = [], usage: GenerationUsage[] = [];
  const flow = await setup(t, { onRequest: record => {
    if (record.kind === 'plan') assert.ok(checkpoints.includes('concept saved'), 'The selected concept checkpoint must complete before construction planning');
  } });
  let draft: Design | undefined;
  const design = await generateDesign({ prompt: 'Build this pictured sculpture', image: flow.image }, event => events.push(event), {
    onConcept: async concept => { assert.deepEqual(concept, parseConcept(concepts[1])); await Promise.resolve(); checkpoints.push('concept saved'); },
    onDraft: async value => { assert.equal(validateDesign(value).valid, true); assert.equal(value.research?.comparison.status, 'matched'); await Promise.resolve(); draft = value; checkpoints.push('draft saved'); },
    onUsage: value => usage.push(value),
  });
  assert.deepEqual(flow.records.map(record => record.kind), ['outline', 'choice', 'plan', 'critic']);
  assert.deepEqual(checkpoints, ['concept saved', 'draft saved']);
  assert.equal(draft, design);
  assert.equal(validateDesign(design).valid, true);
  assert.deepEqual(events.map(event => event.stage), ['researching', 'outlining', 'comparing-outline', 'planning', 'checking', 'comparing']);
  assert.ok(events.filter(event => event.stage !== 'researching').every(event => event.maxAttempts === 10));
  const rendered = await Promise.all(concepts.map(concept => renderConceptViews(parseConcept(concept))));
  assert.deepEqual(pixels(flow.records[0]), [flow.image]);
  assert.deepEqual(pixels(flow.records[1]), [flow.image, ...rendered.flatMap(views => views.map(view => view.inlineData))]);
  assert.deepEqual(pixels(flow.records[2]), [flow.image, ...rendered[1].map(view => view.inlineData)]);
  assert.match(text(flow.records[2]), /CONCEPT ONLY/);
  for (const view of rendered.flat()) assert.equal((await sharp(Buffer.from(view.inlineData.data, 'base64')).metadata()).format, 'png');
  assert.deepEqual(pixels(flow.records[3]), [flow.image, ...(await renderLikenessViews(design)).map(view => view.inlineData)]);
  assert.deepEqual(flow.records.map(record => record.body.generationConfig.thinkingConfig?.thinkingLevel), ['MEDIUM', 'LOW', 'MEDIUM', 'LOW']);
  assert.equal(flow.records[2].body.generationConfig.maxOutputTokens, 24000);
  assert.equal(design.research?.uploadedImage, true);
  assert.deepEqual(design.research?.sources, []);
  assert.deepEqual(usage.at(-1), { requests: 6, inputTokens: 60, outputTokens: 120, thinkingTokens: 30, cachedTokens: 12, elapsedMs: usage.at(-1)!.elapsedMs });
  const occupied = new Set<string>();
  for (const brick of design.bricks) {
    const dimensions = footprint(brick);
    for (let x = brick.x; x < brick.x + dimensions.width; x++) for (let y = brick.y; y < brick.y + dimensions.depth; y++) for (let z = brick.z; z < brick.z + partHeight(brick); z++) occupied.add(`${x},${y},${z}`);
  }
  const expected = new Set<string>();
  for (let x = 8; x < 14; x++) for (let y = 10; y < 16; y++) for (let z = 0; z < 6; z++) expected.add(`${x},${y},${z}`);
  for (let x = 9; x < 13; x++) for (let y = 11; y < 14; y++) for (let z = 6; z < 12; z++) expected.add(`${x},${y},${z}`);
  assert.deepEqual(occupied, expected, 'Encoded local geometry, 90° yaw and target translation preserve the exact physical volume');
});

test('quick generation retains its direct plan path and low thinking, while unverified detailed models receive no thinking override', async t => {
  await t.test('quick', async t => {
    const flow = await setup(t, { plans: [quickPlan] });
    let conceptsSaved = 0;
    const design = await generateDesign({ prompt: 'Build this pictured sculpture', image: flow.image, quality: 'quick' }, undefined, { onConcept: () => { conceptsSaved++; } });
    assert.equal(validateDesign(design).valid, true);
    assert.deepEqual(flow.records.map(record => record.kind), ['plan', 'critic']);
    assert.equal(conceptsSaved, 0);
    assert.ok(flow.records.every(record => record.body.generationConfig.thinkingConfig?.thinkingLevel === 'LOW'));
  });
  await t.test('unverified model', async t => {
    const flow = await setup(t, { model: 'gemini-2.5-flash' });
    await generateDesign({ prompt: 'Build this pictured sculpture', image: flow.image });
    assert.equal(flow.records.length, 4);
    assert.ok(flow.records.every(record => record.body.generationConfig.thinkingConfig === undefined));
  });
});

test('default detailed deadline is 300 seconds and quick deadline is 150 seconds with no implicit reset', async t => {
  assert.equal(generationBudget({}), 300_000);
  assert.equal(generationBudget({ quality: 'detailed' }), 300_000);
  assert.equal(generationBudget({ quality: 'quick' }), 150_000);
  for (const quality of [undefined, 'quick'] as const) await t.test(quality || 'default detailed', async t => {
    const flow = await setup(t);
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
    let started!: () => void, aborted = false, calls = 0;
    const ready = new Promise<void>(resolve => { started = resolve; });
    t.mock.method(globalThis, 'fetch', (_input: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.systemInstruction?.parts.some((part: { text?: string }) => part.text?.includes('Identify the visual subject'))) return response({ kind: 'original', name: '', location: '', aliases: [] });
      if (body.generationConfig.responseJsonSchema.properties.usedImages) return Promise.resolve(response(observations));
      calls++;
      return new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => { aborted = true; reject(new Error('Provider request aborted')); }, { once: true }); started();
      });
    });
    const budget = quality ? 150_000 : 300_000;
    const rejected = assert.rejects(generateDesign({ prompt: 'Build this pictured sculpture', image: flow.image, quality }), error => error instanceof GenerationError && error.status === 504 && error.message.includes(`${budget / 1000}-second`));
    await ready; t.mock.timers.tick(budget - 1); assert.equal(aborted, false); t.mock.timers.tick(1); await rejected;
    assert.equal(aborted, true); assert.equal(calls, 1);
  });
});

test('concept selection time shares the detailed deadline with construction, preventing a late charged planning call', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const flow = await setup(t, { onRequest: record => {
    if (record.kind === 'outline') t.mock.timers.tick(180_000);
    if (record.kind === 'choice') t.mock.timers.tick(115_000);
  } });
  let checkpoint = 0;
  await assert.rejects(generateDesign({ prompt: 'Build this pictured sculpture', image: flow.image }, undefined, { onConcept: () => { checkpoint++; } }), error => error instanceof GenerationError && error.status === 504 && /not enough time/.test(error.message));
  assert.deepEqual(flow.records.map(record => record.kind), ['outline', 'choice']);
  assert.equal(checkpoint, 1);
  assert.equal(Date.now(), 295_000);
});

test('detailed geometry repairs use decoded component paths and preserve the selected feature requirements', async t => {
  const invalid = structuredClone(plan); invalid.components[1].target.z = 7; invalid.observations.features = ['The planner tries to omit the difficult upper section'];
  const flow = await setup(t, { plans: [invalid, patch('/components/1/target/z', 6)] });
  const design = await generateDesign({ prompt: 'Build this pictured sculpture', image: flow.image });
  assert.deepEqual(flow.records.map(record => record.kind), ['outline', 'choice', 'plan', 'patch', 'critic']);
  const repair = flow.records.find(record => record.kind === 'patch')!;
  assert.equal(repair.body.generationConfig.thinkingConfig?.thinkingLevel, 'LOW');
  assert.match(text(repair), /\/components\/1\/boxes\/0/);
  assert.match(text(repair), /"target":\{"x":9,"y":11,"z":7\}/);
  assert.equal(pixels(repair).length, 1, 'A structural patch retains the actual user photo and is not supplied unrelated concept renders');
  assert.deepEqual(design.research?.observations.features, features);
  assert.deepEqual(JSON.parse(flow.records.at(-1)!.body.contents[0].parts[0].text!).definingFeatures, [{ index: 0, name: features[0] }]);
  assert.equal(validateDesign(design).valid, true);
});

test('two failed component attachments rebuild the complete subject globally using simpler parts and fixed features', async t => {
  const invalid = structuredClone(plan); invalid.components[1].target.z = 7;
  const global = { ...quickPlan, observations: { ...observations, features: ['A conveniently easier but incomplete feature list'] } };
  const flow = await setup(t, { plans: [invalid, patch('/components/1/target/z', 7), global] });
  const events: GenerationProgress[] = [];
  const design = await generateDesign({ prompt: 'Build this pictured sculpture', image: flow.image }, event => events.push(event));
  assert.deepEqual(flow.records.map(record => record.kind), ['outline', 'choice', 'plan', 'patch', 'plan', 'critic']);
  const simplified = flow.records[4];
  assert.ok(simplified.body.generationConfig.responseJsonSchema.properties.boxes);
  assert.equal(simplified.body.generationConfig.responseJsonSchema.properties.components, undefined);
  assert.equal(simplified.body.generationConfig.responseJsonSchema.properties.edits, undefined);
  assert.match(text(simplified), /SIMPLER BUILD constraints/);
  assert.match(text(simplified), /SIMPLE GLOBAL REBUILD/);
  assert.match(text(simplified), /"target":\{"x":9,"y":11,"z":7\}/);
  assert.equal(simplified.body.generationConfig.thinkingConfig?.thinkingLevel, 'MEDIUM');
  assert.deepEqual(pixels(simplified), pixels(flow.records[2]), 'The original photo and selected concept pixels remain attached to the new whole-model plan');
  assert.ok(events.some(event => event.stage === 'planning' && event.attempt === 3 && /simpler parts/.test(event.detail || '')));
  assert.equal(Math.max(...events.map(event => event.candidate || 1)), 1);
  assert.deepEqual(design.research!.observations.features, features, 'The new global plan cannot quietly discard difficult original features');
  assert.equal(validateDesign(design).valid, true);
});

test('a partial first section does not erase a later colored main region during the enforced global rebuild', async t => {
  const invalid = structuredClone(plan);
  invalid.components[0].geometryJson = JSON.stringify({ boxes: [{ ...box(4, 4, 6), colorId: 2 }, { ...box(1, 1, 6), x: 12, colorId: 2 }] });
  const global = { ...quickPlan, boxes: [{ ...box(6, 6, 6), colorId: 2 }, { ...box(4, 4, 6), x: 1, y: 1, z: 6, colorId: 4 }] };
  const flow = await setup(t, { plans: [invalid, patch('/components/0/boxes/1/x', 12), invalid, global] });
  const attempts: GenerationAttempt[] = [];
  const design = await generateDesign({ prompt: 'Build the complete pictured two-color sculpture', image: flow.image }, undefined, { onAttempt: artifact => { attempts.push(artifact); } });
  assert.deepEqual(flow.records.map(record => record.kind), ['outline', 'choice', 'plan', 'patch', 'plan', 'plan', 'critic']);
  assert.ok(attempts[0].partial); assert.ok(attempts[0].design!.bricks.every(brick => brick.colorId === 2));
  assert.match(text(flow.records[4]), /reconstruct ALL|Reconstruct ALL/);
  assert.match(text(flow.records[4]), /Only a compiled section is shown/);
  assert.match(attempts[2].checks.join(' '), /top-level global geometry, not separate components/);
  assert.equal(attempts[2].design, undefined, 'The global fallback cannot secretly compile the same partial component plan again');
  assert.deepEqual([...new Set(design.bricks.map(brick => brick.colorId))].sort((a, b) => a - b), [2, 4]);
  assert.deepEqual(design.research!.observations.features, features);
  assert.equal(validateDesign(design).valid, true);
});

test('an earlier better section-based draft remains saved while repair continues from the valid global candidate', async t => {
  const needsWork = { matches: false, summary: 'The upper contour needs refinement.', issues: ['Refine the upper contour.'], features: [{ index: 0, status: 'incorrect', evidence: 'The upper region is too broad.', correction: 'Narrow its upper contour.' }] };
  const worse = { ...needsWork, issues: [...needsWork.issues, 'The lower region also needs its original width.'] };
  const flow = await setup(t, { plans: [plan, patch('/components/1/target/z', 7), patch('/components/1/target/z', 7), quickPlan, patch('/boxes/0/height', 15)], critics: [needsWork, worse, matched] });
  const drafts: Design[] = [];
  const design = await generateDesign({ prompt: 'Build this pictured sculpture', image: flow.image }, undefined, { continuous: true, stopWhenMatched: true, onDraft: draft => { drafts.push(draft); } });
  assert.deepEqual(flow.records.map(record => record.kind), ['outline', 'choice', 'plan', 'critic', 'patch', 'patch', 'plan', 'critic', 'patch', 'critic']);
  assert.equal(drafts.length, 2, 'A worse global candidate must not overwrite the earlier saved draft');
  assert.match(text(flow.records[8]), /CURRENT GLOBAL DRAFT TO IMPROVE/);
  assert.match(text(flow.records[8]), /\/boxes\/0/);
  assert.doesNotMatch(text(flow.records[8]), /\/components\/1/);
  assert.deepEqual(pixels(flow.records[8]).filter(image => image.mimeType === 'image/png'), pixels(flow.records[7]).filter(image => image.mimeType === 'image/png'));
  assert.equal(design.research!.comparison.status, 'matched');
});

test('truncated higher-reasoning outline and construction responses retry once at low reasoning without compiling partial JSON', async t => {
  for (const truncated of ['outline', 'plan'] as const) await t.test(truncated, async t => {
    const flow = await setup(t, { truncated });
    const usage: GenerationUsage[] = []; let conceptsSaved = 0, drafts = 0;
    const design = await generateDesign({ prompt: 'Build this pictured sculpture', image: flow.image }, undefined, {
      onUsage: value => usage.push(value), onConcept: () => { conceptsSaved++; }, onDraft: () => { drafts++; },
    });
    const retried = flow.records.filter(record => record.kind === truncated);
    assert.equal(retried.length, 2);
    assert.deepEqual(retried.map(record => record.body.generationConfig.thinkingConfig?.thinkingLevel), ['MEDIUM', 'LOW']);
    assert.deepEqual(retried[0].body.contents, retried[1].body.contents);
    assert.deepEqual(retried[0].body.generationConfig.responseJsonSchema, retried[1].body.generationConfig.responseJsonSchema);
    assert.equal(validateDesign(design).valid, true);
    assert.equal(flow.records.length, 5);
    assert.equal(conceptsSaved, 1); assert.equal(drafts, 1);
    assert.equal(usage.at(-1)?.requests, 7);
    assert.equal(usage.at(-1)?.thinkingTokens, 13467);
    assert.equal(usage.at(-1)?.outputTokens, 669);
    assert.match(design.research!.warnings.join(' '), /incomplete response was discarded/);
  });
});

test('a second truncated low-reasoning outline fails without selection, planning or another charged retry', async t => {
  const flow = await setup(t, { truncated: 'outline', truncateTwice: true });
  let conceptsSaved = 0;
  await assert.rejects(generateDesign({ prompt: 'Build this pictured sculpture', image: flow.image }, undefined, { onConcept: () => { conceptsSaved++; } }),
    error => error instanceof GenerationError && error.status === 502 && /before completing/.test(error.message));
  assert.deepEqual(flow.records.map(record => record.kind), ['outline', 'outline']);
  assert.equal(conceptsSaved, 0);
});

test('truncation cannot launch a low-reasoning retry with less than fifteen seconds remaining', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const flow = await setup(t, { truncated: 'outline', onRequest: () => t.mock.timers.tick(286_000) });
  await assert.rejects(generateDesign({ prompt: 'Build this pictured sculpture', image: flow.image }),
    error => error instanceof GenerationError && error.status === 502 && /before completing/.test(error.message));
  assert.deepEqual(flow.records.map(record => record.kind), ['outline']);
});

test('rejected alternative concepts cannot leak into selection after the correction also fails', async () => {
  const wrongFeatures = structuredClone(concepts); wrongFeatures[1].features = ['A different defining feature'];
  let calls = 0;
  await assert.rejects(selectConstructionConcept({ brief: 'A reference-backed shape.', images: [], progress: () => {}, request: async () => {
    calls++; return calls === 1 ? JSON.stringify({ concepts: wrongFeatures }) : 'not valid JSON';
  } }), /shape study could not be read/);
  assert.equal(calls, 2, 'No rejected concept reaches the image-selection request');
});

test('compact concepts allow omitted empty arrays but reject explicit null or malformed geometry arrays', () => {
  const profile = { shape: 'ellipse', colorId: 4, sections: [
    { cx: 3, cy: 3, z: 0, width: 4, depth: 4 }, { cx: 3, cy: 3, z: 6, width: 4, depth: 4 },
  ] };
  for (const [input, missing] of [[{ boxes: [box(4, 4, 6)] }, 'profiles'], [{ profiles: [profile] }, 'boxes']] as const) {
    const value = structuredClone(concepts[0]);
    value.components[0].geometryJson = JSON.stringify(input);
    const parsed = parseConcept(value);
    assert.deepEqual(parsed.components[0][missing], []);
    for (const malformed of [null, {}, '']) {
      value.components[0].geometryJson = JSON.stringify({ ...input, [missing]: malformed });
      assert.throws(() => parseConcept(value), /geometry/);
    }
  }
});

test('component decoding permits profile-only or part-only geometry without inventing boxes, while null boxes fail', () => {
  const profile = { shape: 'ellipse', colorId: 4, sections: [
    { cx: 3, cy: 3, z: 0, width: 4, depth: 4 }, { cx: 3, cy: 3, z: 6, width: 4, depth: 4 },
  ] };
  for (const geometry of [{ profiles: [profile] }, { parts: [{ partId: '3003', colorId: 4, x: 0, y: 0, z: 0, rotation: 0 }] }]) {
    const value = { ...plan, schemaVersion: 2 as const, coordinateSystem: 'stud-xy-plate-z' as const, boxes: [],
      components: [{ ...component('base', '', 4, 4, { x: 0, y: 0, z: 0 }), boxes: [], geometryJson: JSON.stringify(geometry) }] };
    const before = JSON.stringify(value), decoded = decodeComponentPlan(value);
    assert.deepEqual(decoded.components[0].boxes, []);
    for (const [field, values] of Object.entries(geometry)) assert.deepEqual(Reflect.get(decoded.components[0], field), values);
    assert.equal(JSON.stringify(value), before);
    for (const malformed of [null, {}, '']) {
      value.components[0].geometryJson = JSON.stringify({ ...geometry, boxes: malformed });
      assert.throws(() => decodeComponentPlan(value), /local boxes/);
    }
  }
});

test('component compilation retains measured structural failure counts for repair-progress decisions', () => {
  const value = decodeComponentPlan({ ...plan, schemaVersion: 2 as const, coordinateSystem: 'stud-xy-plate-z' as const, boxes: [],
    components: plan.components.map(section => ({ ...section, boxes: [] })) });
  for (const failures of [22, 3]) {
    assert.throws(() => compileComponents(value, { prompt: 'A connected reference specimen' }, () => {
      throw Object.assign(new Error('Packed geometry has disconnected groups.'), { failures });
    }), error => error instanceof Error && /\/components\/0 \(base\)/.test(error.message) && Reflect.get(error, 'failures') === failures);
  }
  for (const failures of [0, -1, 1.5, Infinity]) {
    assert.throws(() => compileComponents(value, { prompt: 'A connected reference specimen' }, () => {
      throw Object.assign(new Error('Malformed diagnostic count.'), { failures });
    }), error => error instanceof Error && !Object.hasOwn(error, 'failures'));
  }
});

test('solid quarter-ellipse concepts include both radial faces and the center in each visible cap', () => {
  const concept = structuredClone(concepts[0]);
  concept.components[0].geometryJson = JSON.stringify({ boxes: [], profiles: [{ shape: 'ellipse', colorId: 4,
    arc: { startDegrees: 0, sweepDegrees: 90 }, sections: [{ z: 0, cx: 4, cy: 4, width: 4, depth: 4 }, { z: 6, cx: 4, cy: 4, width: 4, depth: 4 }] }] });
  const polygons = [...renderConceptSvg(parseConcept(concept)).matchAll(/<polygon[^>]*points="([^"]+)"/g)].map(match => match[1].split(' '));
  const caps = polygons.filter(points => points.length === 26);
  assert.equal(caps.length, 2, 'A sector cap needs its 25 sampled arc points plus the center, not a chord-only circular segment');
  for (const cap of caps) {
    const center = cap[0], [centerX, centerY] = center.split(',').map(Number);
    const [firstX, firstY] = cap[1].split(',').map(Number), [lastX, lastY] = cap.at(-1)!.split(',').map(Number);
    assert.ok(Math.abs(centerX - (firstX + lastX) / 2) < 0.02);
    assert.ok(centerY < Math.min(firstY, lastY) - 20, 'The missing interior triangle is present in the radial quarter-sector');
    assert.equal(polygons.filter(points => points.includes(center)).length, 3, 'The center meets the cap and the two radial side faces');
  }
});

test('bounded detailed generation stops after its allowed simpler-part repairs without admitting invalid geometry', async t => {
  const invalid = structuredClone(plan); invalid.components[1].target.z = 7;
  const unchanged = patch('/components/1/target/z', 7);
  const emptyGlobal = { ...quickPlan, boxes: [] };
  const flow = await setup(t, { plans: [invalid, unchanged, emptyGlobal, ...Array.from({ length: 7 }, () => patch('/boxes', []))] });
  const events: GenerationProgress[] = []; let drafts = 0;
  await assert.rejects(generateDesign({ prompt: 'Build this pictured sculpture', image: flow.image }, event => events.push(event), { onDraft: () => { drafts++; } }),
    error => error instanceof GenerationError && error.status === 422 && error.checks.length === 4 && error.checks.slice(0, 2).every(check => /cannot attach/.test(check)) && error.checks.slice(2).every(check => /at least one shape/.test(check)));
  assert.deepEqual(flow.records.map(record => record.kind), ['outline', 'choice', 'plan', 'patch', 'plan', 'patch']);
  assert.ok(flow.records.slice(4).every(record => /SIMPLER BUILD constraints/.test(text(record))));
  assert.equal(Math.max(...events.map(event => event.candidate || 1)), 1);
  assert.equal(drafts, 0);
});

test('cancellation after a selected-concept checkpoint prevents construction and draft callbacks', async t => {
  const controller = new AbortController(), flow = await setup(t);
  let drafts = 0;
  await assert.rejects(generateDesign({ prompt: 'Build this pictured sculpture', image: flow.image }, undefined, {
    signal: controller.signal, onConcept: () => { controller.abort(new Error('User cancelled')); }, onDraft: () => { drafts++; },
  }), error => error instanceof GenerationError && error.status === 499);
  assert.deepEqual(flow.records.map(record => record.kind), ['outline', 'choice']);
  assert.equal(drafts, 0);
});

test('cancellation aborts an in-flight detailed outline request and produces no later provider calls', async t => {
  const controller = new AbortController(), flow = await setup(t);
  let started!: () => void, calls = 0, aborted = false;
  const ready = new Promise<void>(resolve => { started = resolve; });
  t.mock.method(globalThis, 'fetch', (_input: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (body.systemInstruction?.parts.some((part: { text?: string }) => part.text?.includes('Identify the visual subject'))) return response({ kind: 'original', name: '', location: '', aliases: [] });
    calls++;
    return new Promise<Response>((_resolve, reject) => { init.signal!.addEventListener('abort', () => { aborted = true; reject(new Error('Aborted')); }, { once: true }); started(); });
  });
  const rejected = assert.rejects(generateDesign({ prompt: 'Build this pictured sculpture', image: flow.image }, undefined, { signal: controller.signal }), error => error instanceof GenerationError && error.status === 499);
  await ready; controller.abort(); await rejected;
  assert.equal(aborted, true); assert.equal(calls, 1);
});

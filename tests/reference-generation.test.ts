import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import sharp from 'sharp';
import { generateDesign, GenerationError, type GenerationProgress } from '../server/generation.js';
import { validateDesign } from '../shared/model.js';

const observations = { usedImages: [0], silhouette: 'A slender tower.', proportions: 'Height is several shaft widths.', features: ['Clock below belfry'], colors: ['Red'], limitations: ['Hidden rear details unknown'] };
const plan = { schemaVersion: 2, coordinateSystem: 'stud-xy-plate-z', title: 'Reference specimen', description: 'A supported solid specimen for provider-flow tests.',
  boxes: [{ x: 0, y: 0, z: 0, width: 4, depth: 4, height: 9, colorId: 4 }], slopes: [], observations };
const matched = { matches: true, summary: 'Major visible features match the reference.', issues: [] };
const mismatch = { matches: false, summary: 'The tower proportions differ.', issues: ['Increase shaft height relative to width.'] };
const repair = (path: string, value: unknown) => ({ edits: [{ op: 'replace', path, valueJson: JSON.stringify(value) }] });
const providerResponse = (value: unknown) => new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(value) }] }, finishReason: 'STOP' }] }), { headers: { 'content-type': 'application/json' } });
type RequestBody = { contents: { parts: { text?: string; inlineData?: { mimeType: string; data: string } }[] }[]; generationConfig: { responseJsonSchema: { properties: Record<string, unknown> }; maxOutputTokens: number } };
type Recorded = { kind: 'subject' | 'plan' | 'critic'; body: RequestBody };

async function mockedFlow(t: TestContext, settings: { plans?: unknown[]; critics?: unknown[]; failReferences?: boolean; onRequest?: (kind: Recorded['kind'], request: RequestBody, init: RequestInit) => void; onLookup?: (url: URL) => void } = {}) {
  const key = process.env.GEMINI_API_KEY, model = process.env.GEMINI_MODEL;
  t.mock.method(dotenv, 'config', () => ({ parsed: {} }));
  process.env.GEMINI_API_KEY = 'fake-test-key-never-sent'; process.env.GEMINI_MODEL = 'gemini-3.8-flash';
  t.after(() => {
    if (key === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = key;
    if (model === undefined) delete process.env.GEMINI_MODEL; else process.env.GEMINI_MODEL = model;
  });
  const originals = await Promise.all(['#a01010', '#1060a0', '#109030'].map(background => sharp({ create: { width: 80, height: 120, channels: 3, background } }).jpeg().toBuffer()));
  const records: Recorded[] = [], lookups: URL[] = [];
  let planIndex = 0, criticIndex = 0;
  t.mock.method(globalThis, 'fetch', async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    if (url.hostname === 'generativelanguage.googleapis.com') {
      const body = JSON.parse(String(init.body)) as RequestBody;
      const properties = body.generationConfig.responseJsonSchema.properties;
      const kind = properties.kind ? 'subject' : properties.matches ? 'critic' : 'plan';
      records.push({ kind, body }); settings.onRequest?.(kind, body, init);
      if (kind === 'subject') return providerResponse({ kind: 'specific', name: 'Example Tower', location: 'Example City', aliases: [] });
      if (kind === 'plan') return providerResponse((settings.plans || [plan])[planIndex++]);
      return providerResponse((settings.critics || [matched])[criticIndex++]);
    }
    lookups.push(url);
    settings.onLookup?.(url);
    if (url.hostname === 'en.wikipedia.org') return new Response(JSON.stringify({ query: { pages: [] } }));
    if (url.hostname === 'commons.wikimedia.org') {
      if (settings.failReferences) return new Response('Unavailable', { status: 503 });
      return new Response(JSON.stringify({ query: { pages: originals.map((_photo, index) => ({ title: `File:Example Tower ${index}.jpg`, imageinfo: [{
        mime: 'image/jpeg', url: `https://upload.wikimedia.org/test-${index}.jpg`, width: 80, height: 120,
        extmetadata: { ImageDescription: { value: `View ${index} of Example Tower` }, Artist: { value: `Photographer ${index}` }, Credit: { value: 'Own work' },
          LicenseShortName: { value: 'CC BY 4.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by/4.0/' }, AttributionRequired: { value: 'true' } },
      }] })) } }));
    }
    if (url.hostname === 'upload.wikimedia.org') return new Response(new Uint8Array(originals[Number(url.pathname.match(/test-(\d)/)?.[1])]), { headers: { 'content-type': 'image/jpeg' } });
    throw new Error('Unexpected network destination in mocked test');
  });
  return { records, lookups, uploadedImage: { mimeType: 'image/jpeg', data: originals[0].toString('base64') } };
}

const images = (record: Recorded) => record.body.contents[0].parts.flatMap(part => part.inlineData ? [part.inlineData] : []);

test('downloaded pixels reach planning and actual-render comparison; only confirmed sources are compared and credited', async t => {
  const flow = await mockedFlow(t, { plans: [{ ...plan, observations: { ...observations, usedImages: [0, 2] } }] });
  const events: GenerationProgress[] = [];
  const result = await generateDesign({ prompt: 'Build the Example Tower in Example City' }, event => events.push(event));
  assert.deepEqual(flow.records.map(record => record.kind), ['subject', 'plan', 'critic']);
  const plannerImages = images(flow.records[1]), criticImages = images(flow.records[2]);
  assert.equal(plannerImages.length, 3);
  for (const image of plannerImages) assert.equal((await sharp(Buffer.from(image.data, 'base64')).metadata()).format, 'jpeg');
  assert.deepEqual(criticImages.filter(image => image.mimeType === 'image/jpeg'), [plannerImages[0], plannerImages[2]], 'Excluded image1 must not steer the critic');
  const rendered = criticImages.filter(image => image.mimeType === 'image/png');
  assert.equal(rendered.length, 2);
  for (const image of rendered) {
    const metadata = await sharp(Buffer.from(image.data, 'base64')).metadata();
    assert.equal(metadata.width, 1024); assert.equal(metadata.height, 1024);
  }
  assert.deepEqual(result.research?.sources.map(source => source.artist), ['Photographer 0', 'Photographer 2']);
  assert.equal(result.research?.comparison.status, 'matched');
  assert.ok(result.research?.sources.every(source => source.sha256.length === 64 && source.licenseUrl && source.sourcePageUrl));
  assert.equal(JSON.stringify(result.research).includes(plannerImages[0].data), false, 'Source bytes never enter saved design metadata');
  assert.deepEqual(events.map(event => event.stage), ['researching', 'planning', 'checking', 'comparing']);
});

test('user image pixels skip online identity lookup but still receive a visual comparison', async t => {
  const flow = await mockedFlow(t);
  const result = await generateDesign({ prompt: 'Build this object', image: flow.uploadedImage });
  assert.deepEqual(flow.records.map(record => record.kind), ['plan', 'critic']);
  assert.equal(flow.lookups.length, 0);
  assert.deepEqual(images(flow.records[0]), [flow.uploadedImage]);
  assert.deepEqual(images(flow.records[1])[0], flow.uploadedImage);
  assert.equal(result.research?.uploadedImage, true);
  assert.deepEqual(result.research?.sources, []);
});

test('unconfirmed subjects and out-of-range image citations fail before visual comparison', async t => {
  for (const usedImages of [[], [-1], [3], [0.5], [0, 999]]) await t.test(JSON.stringify(usedImages), async subtest => {
    const flow = await mockedFlow(subtest, { plans: [{ ...plan, observations: { ...observations, usedImages } }] });
    await assert.rejects(generateDesign({ prompt: 'The Example Tower' }), (error: unknown) => error instanceof GenerationError && error.status === 422 && /reference photos could not be confirmed/i.test(error.message));
    assert.equal(flow.records.some(record => record.kind === 'critic'), false);
  });
});

test('failed reference lookup stops with an actionable photo request instead of an ungrounded substitute', async t => {
  const flow = await mockedFlow(t, { failReferences: true });
  await assert.rejects(generateDesign({ prompt: 'The Example Tower' }), (error: unknown) => error instanceof GenerationError && error.status === 422 && /Attach a clear photo/.test(error.message));
  assert.deepEqual(flow.records.map(record => record.kind), ['subject']);
});

test('likeness feedback reaches one repair attempt, whose new renders are checked again', async t => {
  const flow = await mockedFlow(t, { plans: [plan, repair('/boxes/0/height', 15)], critics: [mismatch, matched] });
  const events: GenerationProgress[] = [];
  const result = await generateDesign({ prompt: 'The Example Tower' }, event => events.push(event));
  assert.deepEqual(flow.records.map(record => record.kind), ['subject', 'plan', 'critic', 'plan', 'critic']);
  assert.match(flow.records[3].body.contents[0].parts[0].text || '', /Increase shaft height relative to width/);
  assert.ok(flow.records[3].body.generationConfig.responseJsonSchema.properties.edits);
  assert.equal(flow.records[3].body.generationConfig.maxOutputTokens, 6000);
  assert.notEqual(images(flow.records[2]).at(-1)?.data, images(flow.records[4]).at(-1)?.data, 'Critic receives newly rendered geometry after repair');
  assert.equal(result.research?.comparison.status, 'matched');
  assert.equal(validateDesign(result).valid, true);
  assert.equal(result.source, 'ai');
  assert.equal(result.title, plan.title, 'The retained draft is the generated result, not a sample fallback');
  assert.deepEqual(events.map(event => `${event.stage}:${event.attempt}`), ['researching:1', 'planning:1', 'checking:1', 'comparing:1', 'repairing:2', 'planning:2', 'checking:2', 'comparing:2']);
});

test('an invalid final repair returns only the earlier valid needs-work draft with its warning', async t => {
  const flow = await mockedFlow(t, { plans: [plan, repair('/boxes', []), repair('/boxes', []), repair('/boxes', [])], critics: [mismatch] });
  const result = await generateDesign({ prompt: 'The Example Tower' });
  assert.equal(validateDesign(result).valid, true);
  assert.equal(result.research?.comparison.status, 'needs-work');
  assert.deepEqual(result.research?.comparison.issues, mismatch.issues);
  assert.ok(result.research?.warnings.some(warning => /earlier valid draft/.test(warning)));
  assert.equal(flow.records.filter(record => record.kind === 'plan').length, 4);
  assert.equal(flow.records.filter(record => record.kind === 'critic').length, 1, 'An invalid model is not rendered or assessed');
});

test('a failed patch preserves the full base plan and patch schema for the next repair', async t => {
  const badPatch = { edits: [...repair('/boxes/0/height', 12).edits, ...repair('/boxes/0/missing/z', 0).edits] };
  const flow = await mockedFlow(t, { plans: [plan, badPatch, repair('/boxes/0/height', 15)], critics: [mismatch, matched] });
  const result = await generateDesign({ prompt: 'Build this object', image: flow.uploadedImage });
  const requests = flow.records.filter(record => record.kind === 'plan');
  assert.equal(requests.length, 3);
  assert.ok(requests[2].body.generationConfig.responseJsonSchema.properties.edits);
  assert.equal(requests[2].body.generationConfig.maxOutputTokens, 6000);
  const correction = requests[2].body.contents[0].parts[0].text || '';
  assert.match(correction, /Repair parent path does not exist.*\/boxes\/0\/missing\/z/);
  assert.deepEqual(JSON.parse(correction.split('. Previous plan: ')[1]), plan, 'The partial edit and failed patch never replace the full base plan');
  assert.equal(validateDesign(result).valid, true);
  assert.equal(result.research?.comparison.status, 'matched');
  assert.ok(result.bricks.some(brick => brick.z === 12), 'The final successful patch raises the original shaft');
});

test('four visual mismatches return a clearly marked valid draft without claiming resemblance passed', async t => {
  const flow = await mockedFlow(t, { plans: [plan, repair('/boxes/0/height', 9), repair('/boxes/0/height', 9), repair('/boxes/0/height', 9)], critics: [mismatch, mismatch, mismatch, mismatch] });
  const result = await generateDesign({ prompt: 'The Example Tower' });
  assert.equal(validateDesign(result).valid, true);
  assert.equal(result.research?.comparison.status, 'needs-work');
  assert.equal(flow.records.filter(record => record.kind === 'plan').length, 4);
  assert.equal(flow.records.filter(record => record.kind === 'critic').length, 4);
});

test('photo-backed geometry gets at most three patches, with current support feedback, then comparison', async t => {
  const floating = { ...plan, boxes: [...plan.boxes, { x: 0, y: 0, z: 13, width: 1, depth: 1, height: 3, colorId: 15 }] };
  const flow = await mockedFlow(t, { plans: [floating, repair('/boxes/1/z', 12), repair('/boxes/1/z', 10), repair('/boxes/1/z', 9)], critics: [matched] });
  const events: GenerationProgress[] = [];
  const result = await generateDesign({ prompt: 'The Example Tower' }, event => events.push(event));
  assert.equal(validateDesign(result).valid, true);
  assert.equal(result.research?.comparison.status, 'matched');
  assert.deepEqual(flow.records.map(record => record.kind), ['subject', 'plan', 'plan', 'plan', 'plan', 'critic']);
  const plans = flow.records.filter(record => record.kind === 'plan');
  for (const [index, gap] of [4, 3, 1].entries()) {
    assert.ok(plans[index + 1].body.generationConfig.responseJsonSchema.properties.edits);
    assert.match(plans[index + 1].body.contents[0].parts[0].text || '', new RegExp(`"nearestAlignedStudGapPlates":${gap}`));
  }
  assert.deepEqual(events.filter(event => event.stage === 'planning').map(event => [event.attempt, event.maxAttempts]), [[1, 4], [2, 4], [3, 4], [4, 4]]);
  assert.equal(result.bricks.find(brick => brick.colorId === 15)?.z, 9);
});

test('the time budget returns a valid needs-work draft before spending on another visual repair', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const flow = await mockedFlow(t, { critics: [mismatch], onRequest: kind => t.mock.timers.tick(kind === 'plan' ? 60_000 : 17_000) });
  const result = await generateDesign({ prompt: 'Build this object', image: flow.uploadedImage });
  assert.equal(validateDesign(result).valid, true);
  assert.equal(result.research?.comparison.status, 'needs-work');
  assert.deepEqual(flow.records.map(record => record.kind), ['plan', 'critic']);
});

test('a late geometry-repair timeout preserves the earlier reviewed draft and warns about the time limit', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  let plans = 0;
  const flow = await mockedFlow(t, {
    plans: [plan, repair('/boxes', [])], critics: [mismatch],
    onRequest: kind => t.mock.timers.tick(kind === 'critic' ? 15_000 : ++plans === 1 ? 45_000 : 24_000),
  });
  const result = await generateDesign({ prompt: 'Build this object', image: flow.uploadedImage });
  assert.equal(validateDesign(result).valid, true);
  assert.equal(result.research?.comparison.status, 'needs-work');
  assert.deepEqual(result.research?.comparison.issues, mismatch.issues);
  assert.equal(result.research?.comparison.summary, mismatch.summary);
  assert.ok(result.research?.warnings.some(warning => /time limit/.test(warning) && /earlier valid draft/.test(warning)));
  assert.ok(result.bricks.every(brick => brick.z < 9), 'Only the reviewed original geometry is returned');
  assert.deepEqual(flow.records.map(record => record.kind), ['plan', 'critic', 'plan']);
});

test('malformed critic output cannot become a false matched verdict', async t => {
  for (const issues of ['The roof is wrong.', undefined, null, [false]]) await t.test(JSON.stringify(issues) || 'missing', async subtest => {
    const flow = await mockedFlow(subtest, { critics: [{ matches: true, summary: 'Shape differs.', issues }] });
    await assert.rejects(generateDesign({ prompt: 'The Example Tower', image: flow.uploadedImage }), (error: unknown) => error instanceof GenerationError && error.status === 502);
  });
});

test('reference retrieval shares the overall deadline and cannot start planning after it expires', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const flow = await mockedFlow(t, { onRequest: () => t.mock.timers.tick(80_000), onLookup: () => t.mock.timers.tick(10_000) });
  await assert.rejects(generateDesign({ prompt: 'The Example Tower' }), (error: unknown) => error instanceof GenerationError && error.status === 504 && /90-second/.test(error.message));
  assert.deepEqual(flow.records.map(record => record.kind), ['subject']);
});

test('visual comparison shares the original deadline after planning has used eighty seconds', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const flow = await mockedFlow(t, { onRequest: kind => t.mock.timers.tick(kind === 'plan' ? 80_000 : 10_000) });
  await assert.rejects(generateDesign({ prompt: 'Build this object', image: flow.uploadedImage }), (error: unknown) => error instanceof GenerationError && error.status === 504 && /90-second/.test(error.message));
  assert.deepEqual(flow.records.map(record => record.kind), ['plan', 'critic']);
});

test('less than ten seconds remaining stops before sending a paid comparison request', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const flow = await mockedFlow(t, { onRequest: () => t.mock.timers.tick(82_000) });
  await assert.rejects(generateDesign({ prompt: 'Build this object', image: flow.uploadedImage }), (error: unknown) => error instanceof GenerationError && error.status === 504 && /not enough time left/.test(error.message));
  assert.deepEqual(flow.records.map(record => record.kind), ['plan']);
});

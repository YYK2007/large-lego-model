import test, { beforeEach, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import dotenv from 'dotenv';
import sharp from 'sharp';
import { generateDesign as generateWithPolicy, compileGeneratedPlan, GenerationError, type GenerationProgress } from '../server/generation.js';

// Preserve the fast-path regressions; detailed staged generation is tested separately.
const generateDesign: typeof generateWithPolicy = (input, progress, options) => generateWithPolicy({ ...input, quality: 'quick' }, progress, options);
import { footprint, partHeight, validateDesign } from '../shared/model.js';
import { renderLikenessViews } from '../server/likeness.js';
import type { ShapePlanV2 } from '../server/compiler.js';
import { resetReferenceStateForTests } from '../server/references.js';

beforeEach(resetReferenceStateForTests);

const observations = { usedImages: [0], silhouette: 'A slender tower.', proportions: 'Height is several shaft widths.', features: ['Clock below belfry'], colors: ['Red'], limitations: ['Hidden rear details unknown'] };
const plan = { schemaVersion: 2, coordinateSystem: 'stud-xy-plate-z', title: 'Reference specimen', description: 'A supported solid specimen for provider-flow tests.',
  boxes: [{ x: 0, y: 0, z: 0, width: 4, depth: 4, height: 9, colorId: 4 }], slopes: [], observations } satisfies ShapePlanV2 & { observations: typeof observations };
const matched = { matches: true, summary: 'Major visible features match the reference.', issues: [], features: [{ index: 0, status: 'present', evidence: 'The clock is below the belfry in the rendered model.', correction: '' }] };
const mismatch = { matches: false, summary: 'The tower proportions differ.', issues: ['Increase shaft height relative to width.'], features: matched.features };
const repair = (path: string, value: unknown) => ({ edits: [{ op: 'replace', path, valueJson: JSON.stringify(value) }] });
const reviewed = (value: unknown): unknown => value && typeof value === 'object' && 'matches' in value ? { identity: { status: 'recognizable', perceivedSubject: 'The requested specimen', evidence: 'The rendered contours and arrangement distinguish the requested subject.', correction: '' }, ...value } : value;
const providerResponse = (value: unknown) => new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(reviewed(value)) }] }, finishReason: 'STOP' }] }), { headers: { 'content-type': 'application/json' } });
type RequestBody = { contents: { parts: { text?: string; inlineData?: { mimeType: string; data: string } }[] }[]; generationConfig: { responseJsonSchema: { properties: Record<string, unknown> }; maxOutputTokens: number } };
type Recorded = { kind: 'subject' | 'plan' | 'critic'; body: RequestBody };

async function mockedFlow(t: TestContext, settings: { plans?: unknown[]; critics?: unknown[]; viewLabels?: string[]; failReferences?: boolean; onRequest?: (kind: Recorded['kind'], request: RequestBody, init: RequestInit) => void; onLookup?: (url: URL) => void } = {}) {
  const key = process.env.GEMINI_API_KEY, model = process.env.GEMINI_MODEL;
  t.mock.method(dotenv, 'config', () => ({ parsed: {} }));
  process.env.GEMINI_API_KEY = 'fake-test-key-never-sent'; process.env.GEMINI_MODEL = 'gemini-3.8-flash';
  t.after(() => {
    if (key === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = key;
    if (model === undefined) delete process.env.GEMINI_MODEL; else process.env.GEMINI_MODEL = model;
  });
  const originals = await Promise.all(['#a01010', '#1060a0', '#109030'].map(background => sharp({ create: { width: 80, height: 120, channels: 3, background } }).jpeg().toBuffer()));
  const records: Recorded[] = [], targets: RequestBody[] = [], lookups: URL[] = [];
  let planIndex = 0, criticIndex = 0;
  t.mock.method(globalThis, 'fetch', async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    if (url.hostname === 'generativelanguage.googleapis.com') {
      const body = JSON.parse(String(init.body)) as RequestBody;
      const properties = body.generationConfig.responseJsonSchema.properties;
      if (properties.usedImages) { targets.push(body); return providerResponse((settings.plans?.[0] as { observations?: unknown } | undefined)?.observations || observations); }
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
        extmetadata: { ImageDescription: { value: `${settings.viewLabels?.[index] || `View ${index}`} of Example Tower` }, Artist: { value: `Photographer ${index}` }, Credit: { value: 'Own work' },
          LicenseShortName: { value: 'CC BY 4.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by/4.0/' }, AttributionRequired: { value: 'true' } },
      }] })) } }));
    }
    if (url.hostname === 'upload.wikimedia.org') return new Response(new Uint8Array(originals[Number(url.pathname.match(/test-(\d)/)?.[1])]), { headers: { 'content-type': 'image/jpeg' } });
    throw new Error('Unexpected network destination in mocked test');
  });
  return { records, targets, lookups, uploadedImage: { mimeType: 'image/jpeg', data: originals[0].toString('base64') } };
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

test('Quick passes actual distinct-angle pixels and unverified hints through independent requirements, planning and review', async t => {
  const flow = await mockedFlow(t, { viewLabels: ['front', 'rear', 'side view'], plans: [{ ...plan, observations: { ...observations, usedImages: [0, 1, 2] } }] });
  const result = await generateDesign({ prompt: 'Build Example Tower using views from several sides' });
  const planned = images(flow.records[1]);
  assert.equal(new Set(planned.map(image => image.data)).size, 3);
  assert.deepEqual(flow.targets[0].contents[0].parts.flatMap(part => part.inlineData ? [part.inlineData] : []), planned);
  assert.deepEqual(images(flow.records[2]).filter(image => image.mimeType === 'image/jpeg'), planned);
  const labels = flow.records[1].body.contents[0].parts.filter(part => part.text?.startsWith('REFERENCE IMAGE')).map(part => part.text!);
  assert.ok(labels.some(label => label.includes('"viewHints":["rear"]')));
  assert.ok(labels.every(label => label.includes('metadata only; verify the actual pixels')));
  assert.match(result.research!.warnings.join(' '), /metadata suggests front, rear, side views.*unseen sides remain uncertain/);
  assert.equal(result.research!.sources.length, 3);
  assert.ok(flow.lookups.some(url => url.searchParams.get('gsrsearch')?.includes(' rear filetype:bitmap')));
  assert.ok(flow.lookups.some(url => url.searchParams.get('gsrsearch')?.includes('side view')));
});

test('user image pixels skip online identity lookup but still receive a visual comparison', async t => {
  const flow = await mockedFlow(t);
  const result = await generateDesign({ prompt: 'Build this object', image: flow.uploadedImage });
  assert.deepEqual(flow.records.map(record => record.kind), ['plan', 'critic']);
  assert.equal(flow.lookups.length, 0);
  assert.deepEqual(images(flow.records[0]), [flow.uploadedImage]);
  assert.deepEqual(images(flow.records[1])[0], flow.uploadedImage);
  assert.equal(result.research?.uploadedImage, true);
  assert.match(result.research!.warnings.join(' '), /Only the supplied reference image.*angles.*unverified/);
  assert.deepEqual(result.research?.sources, []);
});

test('unconfirmed subjects and out-of-range image citations fail before visual comparison', async t => {
  for (const usedImages of [[], [-1], [3], [0.5], [0, 999]]) await t.test(JSON.stringify(usedImages), async subtest => {
    const flow = await mockedFlow(subtest, { plans: [{ ...plan, observations: { ...observations, usedImages } }] });
    await assert.rejects(generateDesign({ prompt: 'The Example Tower' }), (error: unknown) => error instanceof GenerationError && error.status === 422 && /independent reference check could not confirm/i.test(error.message));
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
  assert.deepEqual(images(flow.records[3]).filter(image => image.mimeType === 'image/png'), images(flow.records[2]).filter(image => image.mimeType === 'image/png'), 'The repair planner sees the exact draft being criticized, not just a verbal critique');
  assert.equal(result.research?.comparison.status, 'matched');
  assert.equal(validateDesign(result).valid, true);
  assert.equal(result.source, 'ai');
  assert.equal(result.title, plan.title, 'The retained draft is the generated result, not a sample fallback');
  assert.deepEqual(events.map(event => `${event.stage}:${event.attempt}`), ['researching:1', 'planning:1', 'checking:1', 'comparing:1', 'repairing:2', 'planning:2', 'checking:2', 'comparing:2']);
});

test('an invalid final repair returns only the earlier valid needs-work draft with its warning', async t => {
  const flow = await mockedFlow(t, { plans: [plan, ...Array.from({ length: 4 }, () => repair('/boxes', []))], critics: [mismatch] });
  const result = await generateDesign({ prompt: 'The Example Tower' });
  assert.equal(validateDesign(result).valid, true);
  assert.equal(result.research?.comparison.status, 'needs-work');
  assert.deepEqual(result.research?.comparison.issues, mismatch.issues);
  assert.ok(result.research?.warnings.some(warning => /earlier valid draft/.test(warning)));
  assert.equal(flow.records.filter(record => record.kind === 'plan').length, 5, 'Two failed repairs permit the bounded simpler-parts fallback');
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
  const boxContext = correction.split('\n').find(line => line.startsWith('/boxes/0: '))!;
  assert.deepEqual(JSON.parse(boxContext.slice('/boxes/0: '.length)), plan.boxes[0], 'The partially applied patch never replaces the original geometry');
  assert.equal(result.research?.observations.silhouette, plan.observations.silhouette);
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

test('worse visual revisions and an exact tie retain the earlier best plan and its actual repair views', async t => {
  const initial = { ...plan, observations: { ...observations, features: ['Correct body height relative to width.', 'A narrower top cap.'] } };
  const firstReview = { matches: false, summary: 'The body proportions are correct but the cap needs shaping.', issues: [], features: [
    { index: 0, status: 'present', evidence: 'The visible body has the expected height-to-width ratio.', correction: '' },
    { index: 1, status: 'incorrect', evidence: 'The cap is as wide as the body.', correction: 'Narrow the top cap while retaining the body proportions.' },
  ] };
  const worseReview = { matches: false, summary: 'The revised body is too tall and its cap is still wrong.', issues: [], features: [
    { index: 0, status: 'incorrect', evidence: 'The body is taller than the reference proportion.', correction: 'Restore the earlier body height.' },
    { index: 1, status: 'incorrect', evidence: 'The cap remains as wide as the body.', correction: 'Make the cap narrower.' },
  ] };
  const tiedReview = { ...firstReview, summary: 'This later draft ties the original unresolved-feature count.' };
  const flow = await mockedFlow(t, { plans: [initial, ...[12, 15, 18].map(height => repair('/boxes/0/height', height))], critics: [firstReview, worseReview, worseReview, tiedReview] });
  const input = { prompt: 'An object with clear body proportions and a narrower cap', image: flow.uploadedImage };
  const result = await generateDesign(input);
  assert.equal(validateDesign(result).valid, true);
  assert.equal(result.research?.comparison.status, 'needs-work');
  assert.equal(result.research?.comparison.summary, firstReview.summary);
  assert.deepEqual(result.research?.comparison.features, firstReview.features);
  assert.equal(Math.max(...result.bricks.map(brick => brick.z + partHeight(brick))), 9, 'A later valid model cannot replace a better or exactly tied earlier model');
  const requests = flow.records.filter(record => record.kind === 'plan');
  assert.equal(requests.length, 4);
  assert.equal(flow.records.filter(record => record.kind === 'critic').length, 4, 'Every revision was valid enough to receive its own visual review');
  const hashes = (data: { mimeType: string; data: string }[]) => data.filter(image => image.mimeType === 'image/png').map(image => createHash('sha256').update(Buffer.from(image.data, 'base64')).digest('hex'));
  const originalViews = hashes((await renderLikenessViews(compileGeneratedPlan(initial, input))).map(view => view.inlineData));
  for (const request of requests.slice(2)) {
    const correction = request.body.contents[0].parts[0].text || '';
    const box = correction.split('\n').find(line => line.startsWith('/boxes/0: '))!;
    assert.deepEqual(JSON.parse(box.slice('/boxes/0: '.length)), initial.boxes[0], 'Repair context returns to the retained earlier geometry');
    assert.deepEqual(hashes(images(request)), originalViews, 'Repair receives the retained draft pixels, not the latest worse render');
  }
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

const lateReviewPlans = [
  { ...plan, boxes: [...plan.boxes, { x: 0, y: 0, z: 13, width: 1, depth: 1, height: 3, colorId: 15 }] },
  repair('/boxes/1/z', 12), repair('/boxes/1/z', 10), repair('/boxes/1/z', 9), repair('/boxes/1/width', 2),
];

test('a first valid review on attempt four can use a fifth visual repair within the original deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const flow = await mockedFlow(t, { plans: lateReviewPlans, critics: [mismatch, matched], onRequest: kind => t.mock.timers.tick(kind === 'plan' ? 10_000 : 12_300) });
  const events: GenerationProgress[] = [];
  const result = await generateDesign({ prompt: 'A real object with a shaped top detail', image: flow.uploadedImage }, event => events.push(event));
  assert.equal(validateDesign(result).valid, true);
  assert.equal(result.research?.comparison.status, 'matched');
  assert.deepEqual(flow.records.map(record => record.kind), ['plan', 'plan', 'plan', 'plan', 'critic', 'plan', 'critic']);
  assert.deepEqual(events.filter(event => event.stage === 'planning').map(event => [event.attempt, event.maxAttempts]), [[1, 4], [2, 4], [3, 4], [4, 4], [5, 5]]);
  assert.ok(events.some(event => event.stage === 'repairing' && event.attempt === 5 && event.maxAttempts === 5));
  assert.equal(Date.now(), 74_600, 'The first comparison ends at 52.3 seconds, leaving time for one visual repair');
  const white = result.bricks.filter(brick => brick.colorId === 15);
  assert.equal(Math.max(...white.map(brick => brick.x + footprint(brick).width)), 2, 'The fifth patch is present in the reviewed returned model');
});

test('a repeated visual verdict on the fifth attempt stops despite enough time for another call', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const flow = await mockedFlow(t, { plans: lateReviewPlans, critics: [mismatch, mismatch], onRequest: () => t.mock.timers.tick(5_000) });
  const events: GenerationProgress[] = [];
  const result = await generateDesign({ prompt: 'A real object with a shaped top detail', image: flow.uploadedImage }, event => events.push(event));
  assert.equal(result.research?.comparison.status, 'needs-work');
  assert.equal(flow.records.filter(record => record.kind === 'plan').length, 5);
  assert.equal(flow.records.filter(record => record.kind === 'critic').length, 2);
  assert.equal(Date.now(), 35_000, 'Stalled improvement, not the deadline, prevents a sixth call');
  assert.ok(events.some(event => event.attempt === 5 && event.maxAttempts === 5));
  assert.equal(events.some(event => event.attempt === 6), false);
  assert.equal(Math.max(...result.bricks.filter(brick => brick.colorId === 15).map(brick => brick.x + footprint(brick).width)), 1, 'An exactly tied later draft does not replace the earlier reviewed one');
});

test('fewer unresolved features can extend visual repair to six attempts but never beyond that bound', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const initial = { ...plan, boxes: [...plan.boxes, { x: 0, y: 0, z: 13, width: 1, depth: 1, height: 3, colorId: 15 }],
    observations: { ...observations, features: ['Top width.', 'Top depth.', 'Top silhouette.'] } };
  const review = (present: number) => ({ matches: false, summary: `${present} visible details have improved.`, issues: [], features: initial.observations.features.map((feature, index) => ({
    index, status: index < present ? 'present' : 'incorrect', evidence: `${feature} is ${index < present ? 'correct in' : 'different from the reference in'} the model.`, correction: index < present ? '' : `Correct ${feature.toLowerCase()}`,
  })) });
  const flow = await mockedFlow(t, { plans: [initial, ...lateReviewPlans.slice(1), repair('/boxes/1/depth', 2)], critics: [review(0), review(1), review(2)], onRequest: () => t.mock.timers.tick(3_000) });
  const events: GenerationProgress[] = [];
  const result = await generateDesign({ prompt: 'A real object with three distinctive top details', image: flow.uploadedImage }, event => events.push(event));
  assert.equal(validateDesign(result).valid, true);
  assert.equal(result.research?.comparison.status, 'needs-work');
  assert.equal(result.research?.comparison.features?.filter(feature => feature.status !== 'present').length, 1);
  assert.equal(flow.records.filter(record => record.kind === 'plan').length, 6);
  assert.equal(flow.records.filter(record => record.kind === 'critic').length, 3);
  assert.ok(events.some(event => event.stage === 'planning' && event.attempt === 6 && event.maxAttempts === 6));
  assert.equal(events.some(event => event.attempt > 6 || event.maxAttempts > 6), false);
  assert.equal(Date.now(), 27_000, 'The attempt bound remains binding even with 123 seconds left and continued improvement');
});

test('a fifth visual repair cannot reset the deadline or return a candidate whose comparison has no time left', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  let plans = 0;
  const flow = await mockedFlow(t, { plans: lateReviewPlans, critics: [mismatch], onRequest: kind => t.mock.timers.tick(kind === 'critic' ? 12_300 : ++plans === 5 ? 90_000 : 10_000) });
  const result = await generateDesign({ prompt: 'A real object with a shaped top detail', image: flow.uploadedImage });
  assert.equal(validateDesign(result).valid, true);
  assert.equal(result.research?.comparison.status, 'needs-work');
  assert.equal(flow.records.filter(record => record.kind === 'plan').length, 5);
  assert.equal(flow.records.filter(record => record.kind === 'critic').length, 1, 'The remaining 7.7 seconds cannot fund another comparison call');
  assert.equal(Date.now(), 142_300);
  assert.ok(result.research?.warnings.some(warning => /time limit/i.test(warning) && /earlier valid draft/i.test(warning)));
  assert.equal(Math.max(...result.bricks.filter(brick => brick.colorId === 15).map(brick => brick.x + footprint(brick).width)), 1, 'Only the earlier reviewed geometry survives');
});

test('the time budget returns a valid needs-work draft before spending on another visual repair', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const flow = await mockedFlow(t, { critics: [mismatch], onRequest: kind => t.mock.timers.tick(kind === 'plan' ? 120_000 : 17_000) });
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
    onRequest: kind => t.mock.timers.tick(kind === 'critic' ? 15_000 : ++plans === 1 ? 105_000 : 24_000),
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
    const flow = await mockedFlow(subtest, { critics: [{ ...matched, summary: 'Shape differs.', issues }] });
    await assert.rejects(generateDesign({ prompt: 'The Example Tower', image: flow.uploadedImage }), (error: unknown) => error instanceof GenerationError && error.status === 502);
  });
});

test('a malformed later feature review returns only the earlier reviewed draft with its warning', async t => {
  const malformed = { matches: true, summary: 'This unreviewed candidate must not replace the earlier draft.', issues: [], features: [] };
  const flow = await mockedFlow(t, { plans: [plan, repair('/boxes/0/height', 12)], critics: [mismatch, malformed] });
  const input = { prompt: 'An object with a narrow upright body', image: flow.uploadedImage };
  const result = await generateDesign(input);
  assert.equal(validateDesign(result).valid, true);
  assert.deepEqual(result.bricks, compileGeneratedPlan(plan, input).bricks, 'The later geometrically valid candidate was never successfully reviewed');
  assert.equal(result.research?.comparison.status, 'needs-work');
  assert.equal(result.research?.comparison.summary, mismatch.summary);
  assert.deepEqual(result.research?.comparison.issues, mismatch.issues);
  assert.deepEqual(result.research?.comparison.features, mismatch.features);
  assert.ok(result.research?.warnings.some(warning => /later revision could not be reviewed/i.test(warning) && /earlier valid draft/i.test(warning)));
  assert.deepEqual(flow.records.map(record => record.kind), ['plan', 'critic', 'plan', 'critic']);
});

test('an initial malformed feature review still fails without claiming an unreviewed model is a usable draft', async t => {
  const flow = await mockedFlow(t, { critics: [{ ...matched, features: [] }] });
  await assert.rejects(generateDesign({ prompt: 'A real object', image: flow.uploadedImage }), (error: unknown) => error instanceof GenerationError && error.status === 502 && /incomplete feature review/i.test(error.message));
  assert.deepEqual(flow.records.map(record => record.kind), ['plan', 'critic']);
});

test('reference retrieval shares the overall deadline and cannot start planning after it expires', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const flow = await mockedFlow(t, { onRequest: () => t.mock.timers.tick(140_000), onLookup: () => t.mock.timers.tick(10_000) });
  await assert.rejects(generateDesign({ prompt: 'The Example Tower' }), (error: unknown) => error instanceof GenerationError && error.status === 504 && /150-second/.test(error.message));
  assert.deepEqual(flow.records.map(record => record.kind), ['subject']);
});

test('visual comparison shares the original deadline after planning has used 140 seconds', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const flow = await mockedFlow(t, { onRequest: kind => t.mock.timers.tick(kind === 'plan' ? 140_000 : 10_000) });
  await assert.rejects(generateDesign({ prompt: 'Build this object', image: flow.uploadedImage }), (error: unknown) => error instanceof GenerationError && error.status === 504 && /150-second/.test(error.message));
  assert.deepEqual(flow.records.map(record => record.kind), ['plan', 'critic']);
});

test('less than ten seconds remaining stops before sending a paid comparison request', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const flow = await mockedFlow(t, { onRequest: () => t.mock.timers.tick(142_000) });
  await assert.rejects(generateDesign({ prompt: 'Build this object', image: flow.uploadedImage }), (error: unknown) => error instanceof GenerationError && error.status === 504 && /not enough time left/.test(error.message));
  assert.deepEqual(flow.records.map(record => record.kind), ['plan']);
});

test('curved profile plans reach compiled render review and can be repaired without replacing their structure', async t => {
  const curvedPlan = { ...plan, boxes: [{ x: 0, y: 0, z: 0, width: 6, depth: 6, height: 6, colorId: 4 }], profiles: [{ shape: 'ellipse', colorId: 4,
    sections: [{ z: 6, cx: 3, cy: 3, width: 6, depth: 6 }, { z: 21, cx: 3, cy: 3, width: 6, depth: 6 }] }] };
  const flow = await mockedFlow(t, { plans: [curvedPlan, repair('/profiles/0/sections/1/z', 24)], critics: [mismatch, matched] });
  const result = await generateDesign({ prompt: 'A rounded real-world object', image: flow.uploadedImage });
  assert.equal(validateDesign(result).valid, true);
  assert.equal(result.research?.comparison.status, 'matched');
  assert.ok(result.bricks.some(brick => brick.z >= 21), 'The second plan extends the existing curved body');
  assert.ok(flow.records.filter(record => record.kind === 'critic').every(record => images(record).filter(image => image.mimeType === 'image/png').length === 2));
  assert.ok(flow.records.find(record => record.kind === 'plan')!.body.generationConfig.responseJsonSchema.properties.profiles,
    'The provider can express the same profiles accepted by compilation');
});

test('a polygon coordinate repair preserves exact cells and sends the actual compiled views to critic and repair', async t => {
  const polygonPlan: ShapePlanV2 & { observations: typeof observations } = { ...plan, schemaVersion: 2, coordinateSystem: 'stud-xy-plate-z',
    observations: { ...observations, silhouette: 'A broad body with an asymmetric notch.', proportions: 'The 8-stud-wide base and body together are 12 plates tall.', features: ['A concave upper body with a recessed slanted boundary.'], colors: ['Red base', 'White body'] },
    boxes: [{ x: 0, y: 0, z: 0, width: 8, depth: 8, height: 6, colorId: 4 }],
    profiles: [{ shape: 'polygon', colorId: 15,
      outline: [{ u: -1, v: -1 }, { u: 1, v: -1 }, { u: 1, v: 0 }, { u: 0, v: 0 }, { u: 0, v: 1 }, { u: -1, v: 1 }],
      sections: [{ z: 6, cx: 4, cy: 4, width: 8, depth: 8 }, { z: 12, cx: 4, cy: 4, width: 8, depth: 8 }],
    }],
  };
  const polygonMismatch = { matches: false, summary: 'The notch needs a slanted boundary.', issues: ['The recessed boundary is vertical rather than slanted.'], features: [{ index: 0, status: 'incorrect', evidence: 'The model has a rectangular notch with a straight vertical boundary.', correction: 'Move the inner outline vertex left to form a slanted recessed boundary.' }] };
  const polygonMatched = { matches: true, summary: 'The asymmetric contour matches the reference.', issues: [], features: [{ index: 0, status: 'present', evidence: 'The upper body has an open concave notch with a slanted recessed boundary.', correction: '' }] };
  const flow = await mockedFlow(t, { plans: [polygonPlan, repair('/profiles/0/outline/3/u', -0.5)], critics: [polygonMismatch, polygonMatched] });
  const input = { prompt: 'An asymmetric object with a recessed contour', image: flow.uploadedImage };
  const result = await generateDesign(input);
  assert.equal(validateDesign(result).valid, true);
  assert.equal(result.research?.comparison.status, 'matched');
  assert.deepEqual(flow.records.map(record => record.kind), ['plan', 'critic', 'plan', 'critic']);

  const occupied = new Map<string, number>();
  for (const brick of result.bricks) {
    const size = footprint(brick);
    for (let z = brick.z; z < brick.z + partHeight(brick); z++) for (let y = brick.y; y < brick.y + size.depth; y++) for (let x = brick.x; x < brick.x + size.width; x++) {
      const key = `${x},${y},${z}`;
      assert.equal(occupied.has(key), false, 'Compiled parts must not overlap');
      occupied.set(key, brick.colorId);
    }
  }
  const expected = new Map<string, number>();
  for (let z = 0; z < 12; z++) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    if (z < 6 || y < 4 || x + 0.5 < (y + 0.5) / 2) expected.set(`${x},${y},${z}`, z < 6 ? 4 : 15);
  }
  assert.deepEqual(occupied, expected, 'The repaired slanted notch is rasterized rather than replaced by a rectangular envelope');

  const plans = flow.records.filter(record => record.kind === 'plan'), critics = flow.records.filter(record => record.kind === 'critic');
  const schema = plans[0].body.generationConfig.responseJsonSchema.properties.profiles as { items: { properties: { shape: { enum: string[] }; outline?: unknown } } };
  assert.ok(schema.items.properties.shape.enum.includes('polygon'));
  assert.ok(schema.items.properties.outline);
  assert.ok(plans[1].body.generationConfig.responseJsonSchema.properties.edits);
  assert.match(plans[1].body.contents[0].parts[0].text || '', /\/profiles\/0\/outline\/3/);
  const hashes = (data: { mimeType: string; data: string }[]) => data.filter(image => image.mimeType === 'image/png').map(image => createHash('sha256').update(Buffer.from(image.data, 'base64')).digest('hex'));
  const before = await renderLikenessViews(compileGeneratedPlan(polygonPlan, input));
  const after = await renderLikenessViews(result);
  const beforeHashes = hashes(before.map(view => view.inlineData)), afterHashes = hashes(after.map(view => view.inlineData));
  assert.equal(beforeHashes.length, 2);
  assert.equal(afterHashes.length, 2);
  assert.deepEqual(hashes(images(critics[0])), beforeHashes, 'The first critic sees exact original compiled parts');
  assert.deepEqual(hashes(images(plans[1])), beforeHashes, 'Visual repair receives those same actual draft pixels');
  assert.deepEqual(hashes(images(critics[1])), afterHashes, 'The final critic sees exact returned compiled parts');
  assert.notDeepEqual(beforeHashes, afterHashes, 'The coordinate repair visibly changes the actual model');
  assert.deepEqual(images(plans[1]).filter(image => image.mimeType === 'image/jpeg'), [flow.uploadedImage]);
});

test('an improving structural repair gets one extra attempt within the existing deadline', async t => {
  const staged = { ...plan, boxes: [{ x: 0, y: 0, z: 0, width: 12, depth: 4, height: 9, colorId: 4 },
    ...[0, 3, 6, 9].map(x => ({ x, y: 1, z: 12, width: 1, depth: 1, height: 3, colorId: 15 }))] };
  const flow = await mockedFlow(t, { plans: [staged, ...[1, 2, 3, 4].map(index => repair(`/boxes/${index}/z`, 9))], critics: [matched] });
  const events: GenerationProgress[] = [];
  const result = await generateDesign({ prompt: 'A building with four raised details', image: flow.uploadedImage }, event => events.push(event));
  assert.equal(validateDesign(result).valid, true);
  assert.equal(result.bricks.filter(brick => brick.colorId === 15).length, 4, 'All four details survive the repairs');
  assert.equal(flow.records.filter(record => record.kind === 'plan').length, 5);
  assert.ok(events.some(event => event.stage === 'planning' && event.attempt === 5 && event.maxAttempts === 5));
});

test('stalled structural repairs still stop after four attempts', async t => {
  const floating = { ...plan, boxes: [...plan.boxes, { x: 0, y: 0, z: 12, width: 1, depth: 1, height: 3, colorId: 15 }] };
  const flow = await mockedFlow(t, { plans: [floating, ...Array.from({ length: 3 }, () => repair('/boxes/1/z', 12))] });
  await assert.rejects(generateDesign({ prompt: 'A real sculpture', image: flow.uploadedImage }), /after four attempts/);
  assert.equal(flow.records.filter(record => record.kind === 'plan').length, 4);
});

test('a final valid draft does not describe earlier rejected attempts as a later failed repair', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const floating = { ...plan, boxes: [...plan.boxes, { x: 0, y: 0, z: 12, width: 1, depth: 1, height: 3, colorId: 15 }] };
  const flow = await mockedFlow(t, { plans: [floating, repair('/boxes/1/z', 12), repair('/boxes/1/z', 12), repair('/boxes/1/z', 9)], critics: [mismatch], onRequest: kind => t.mock.timers.tick(kind === 'plan' ? 31_000 : 12_000) });
  const result = await generateDesign({ prompt: 'A real sculpture', image: flow.uploadedImage });
  assert.equal(result.research?.comparison.status, 'needs-work');
  assert.equal(result.research?.warnings.some(warning => /later repair/.test(warning)), false);
  assert.equal(flow.records.filter(record => record.kind === 'plan').length, 4);
  assert.equal(validateDesign(result).valid, true);
  assert.equal(Date.now(), 136_000, 'Fewer than 15 seconds remain after the first valid review, so there is no visual extension');
});

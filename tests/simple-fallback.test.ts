import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import dotenv from 'dotenv';
import sharp from 'sharp';
import { generateDesign, compileGeneratedPlan, GenerationError } from '../server/generation.js';
import { compilePlan, repairCompiledPlan, type ShapePlanV2 } from '../server/compiler.js';
import { SIMPLE_PART_IDS } from '../server/simple-fallback.js';
import type { GenerationAttempt } from '../server/generation-attempt.js';
import { PARTS, allocateInventory, footprint, partHeight, validateDesign, type CatalogManifest, type Design, type InventoryItem } from '../shared/model.js';

const observed = { usedImages: [0], silhouette: 'A tall broad red body.', proportions: 'Tall and broad, with real depth.', features: ['The tall broad red body'], colors: ['Red'], limitations: [] };
const box = { x: 0, y: 0, z: 0, width: 4, depth: 4, height: 12, colorId: 4 };
const plan = { schemaVersion: 2, coordinateSystem: 'stud-xy-plate-z', title: 'Reference specimen', description: 'The target form for a fallback regression.', boxes: [box], observations: observed } satisfies ShapePlanV2 & { observations: typeof observed };
const invalidBoxes = [box, { ...box, x: 12, width: 1, depth: 1 }];
const invalid = { ...plan, boxes: invalidBoxes };
const patch = (boxes: unknown) => ({ edits: [{ op: 'replace', path: '/boxes', valueJson: JSON.stringify(boxes) }] });
const matched = { matches: true, summary: 'The defining form matches.', issues: [], features: [{ index: 0, status: 'present', evidence: 'The actual model has the tall red body.', correction: '' }] };
const mismatch = { matches: false, summary: 'The body needs refining.', issues: ['Refine the upper contour.'], features: [{ index: 0, status: 'incorrect', evidence: 'The upper contour differs.', correction: 'Refine the upper contour.' }] };
const reviewed = (value: unknown): unknown => value && typeof value === 'object' && 'matches' in value ? { identity: { status: 'recognizable', perceivedSubject: 'The requested specimen', evidence: 'The rendered contours and arrangement distinguish the requested subject.', correction: '' }, ...value } : value;
const response = (value: unknown) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(reviewed(value)) }] }, finishReason: 'STOP' }] }), { headers: { 'content-type': 'application/json' } });
type Request = { kind: 'plan' | 'patch' | 'critic'; body: { contents: { parts: { text?: string; inlineData?: { mimeType: string; data: string } }[] }[] } };
async function flow(t: TestContext, plans: unknown[], critics: unknown[] = [matched]) {
  const keys = ['GEMINI_API_KEY', 'GEMINI_MODEL', 'REBRICKABLE_API_KEY'], original = keys.map(key => process.env[key]);
  t.mock.method(dotenv, 'config', () => ({ parsed: {} }));
  process.env.GEMINI_API_KEY = 'fake-simple-fallback-key'; process.env.GEMINI_MODEL = 'gemini-3.8-flash'; delete process.env.REBRICKABLE_API_KEY;
  t.after(() => keys.forEach((key, i) => { if (original[i] === undefined) delete process.env[key]; else process.env[key] = original[i]; }));
  const image = { mimeType: 'image/jpeg', data: (await sharp({ create: { width: 24, height: 32, channels: 3, background: '#a52825' } }).jpeg().toBuffer()).toString('base64') };
  const requests: Request[] = []; let pi = 0, ci = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit = {}) => {
    assert.equal(new URL(String(url)).hostname, 'generativelanguage.googleapis.com', 'The fallback keeps the original uploaded pixels without restarting research');
    const body = JSON.parse(String(init.body)), fields = body.generationConfig.responseJsonSchema.properties;
    if (body.systemInstruction?.parts.some((part: { text?: string }) => part.text?.includes('Identify the visual subject'))) return response({ kind: 'original', name: '', location: '', aliases: [] });
    if (fields.usedImages) return response(observed);
    const kind = fields.matches ? 'critic' : fields.edits ? 'patch' : 'plan';
    requests.push({ kind, body });
    const value = kind === 'critic' ? critics[ci++] : plans[pi++];
    assert.notEqual(value, undefined, 'Unexpected extra provider call');
    return value instanceof Response ? value : response(value);
  });
  return { image, requests };
}
const text = (request: Request) => request.body.contents[0].parts.flatMap(part => part.text ? [part.text] : []).join('\n');
const pixels = (request: Request) => request.body.contents[0].parts.flatMap(part => part.inlineData?.mimeType === 'image/jpeg' ? [part.inlineData] : []);
const cancelled = (error: unknown) => error instanceof GenerationError && error.status === 499;

test('after two structural failures the third attempt simplifies parts while retaining the plan, reference pixels and identity', async t => {
  const f = await flow(t, [invalid, patch(invalidBoxes), patch([box])]);
  const controller = new AbortController(), attempts: GenerationAttempt[] = [];
  await assert.rejects(generateDesign({ prompt: 'Build this exact pictured form', image: f.image, quality: 'quick' }, undefined, { continuous: true, signal: controller.signal,
    onAttempt: attempt => { attempts.push(attempt); if (attempt.attempt === 3) controller.abort(); },
  }), cancelled);
  const constructions = f.requests.filter(request => request.kind !== 'critic');
  assert.deepEqual(constructions.map(request => request.kind), ['plan', 'patch', 'patch']);
  assert.doesNotMatch(text(constructions[0]), /SIMPLER BUILD/); assert.doesNotMatch(text(constructions[1]), /SIMPLER BUILD/);
  assert.match(text(constructions[2]), /SIMPLER BUILD/); assert.match(text(constructions[2]), /\/boxes\/1/);
  assert.ok(constructions.every(request => JSON.stringify(pixels(request)) === JSON.stringify([f.image])));
  assert.deepEqual(attempts.map(attempt => attempt.status), ['invalid', 'invalid', 'valid']);
  const result = attempts[2].design!;
  assert.equal(validateDesign(result).valid, true); assert.equal(result.research?.comparison.status, 'matched');
  assert.deepEqual(result.research?.observations.features, observed.features);
  assert.ok(result.bricks.every(brick => SIMPLE_PART_IDS.has(brick.partId)));
});

test('Quick delivery starts with specialties available and still enforces the simpler palette after two construction failures', async t => {
  const f = await flow(t, [invalid, patch(invalidBoxes), patch([box])]);
  const attempts: GenerationAttempt[] = [];
  const result = await generateDesign({ prompt: 'Build this exact pictured form', image: f.image, quality: 'quick' }, undefined, {
    continuous: true, stopWhenMatched: true, onAttempt: attempt => { attempts.push(attempt); },
  });
  const constructions = f.requests.filter(request => request.kind !== 'critic');
  assert.doesNotMatch(text(constructions[0]), /SIMPLER BUILD constraints/);
  assert.doesNotMatch(text(constructions[1]), /SIMPLER BUILD constraints/);
  assert.match(text(constructions[2]), /SIMPLER BUILD constraints/);
  assert.deepEqual(attempts.map(attempt => attempt.status), ['invalid', 'invalid', 'valid']);
  assert.ok(result.bricks.every(brick => SIMPLE_PART_IDS.has(brick.partId)));
  assert.deepEqual(result.research!.observations.features, observed.features);
});

test('response-format failures do not masquerade as two structural failures', async t => {
  const malformed = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{unfinished JSON' }] }, finishReason: 'STOP' }] }), { headers: { 'content-type': 'application/json' } });
  const f = await flow(t, [malformed(), malformed(), plan]);
  const controller = new AbortController(), attempts: GenerationAttempt[] = [];
  await assert.rejects(generateDesign({ prompt: 'Build this exact pictured form', image: f.image, quality: 'quick' }, undefined, { continuous: true, signal: controller.signal,
    onAttempt: attempt => { attempts.push(attempt); if (attempt.attempt === 3) controller.abort(); },
  }), cancelled);
  const constructions = f.requests.filter(request => request.kind !== 'critic');
  assert.deepEqual(constructions.map(request => request.kind), ['plan', 'plan', 'plan']);
  assert.ok(constructions.every(request => !text(request).includes('SIMPLER BUILD')));
  assert.equal(attempts[0].response, '{unfinished JSON'); assert.equal(attempts[1].response, '{unfinished JSON');
  assert.equal(attempts[2].status, 'valid');
});

test('a simpler but worse valid draft cannot replace the earlier reviewed best or its repair source', async t => {
  const worse = { ...mismatch, issues: ['Refine the upper contour.', 'Restore the lost height.'] };
  const f = await flow(t, [plan, patch(invalidBoxes), patch(invalidBoxes), patch([{ ...box, height: 9 }]), patch(invalidBoxes)], [mismatch, worse]);
  const controller = new AbortController(), drafts: Design[] = [], attempts: GenerationAttempt[] = [];
  await assert.rejects(generateDesign({ prompt: 'Build this exact pictured form', image: f.image, quality: 'quick' }, undefined, { continuous: true, signal: controller.signal,
    onDraft: design => { drafts.push(design); }, onAttempt: attempt => { attempts.push(attempt); if (attempt.attempt === 5) controller.abort(); },
  }), cancelled);
  assert.equal(drafts.length, 1); assert.equal(attempts[3].status, 'valid');
  assert.ok(drafts[0].research?.comparison.issues.includes('Refine the upper contour.'));
  assert.ok(!drafts[0].research?.comparison.issues.includes('Restore the lost height.'));
  const constructions = f.requests.filter(request => request.kind !== 'critic');
  assert.match(text(constructions[3]), /SIMPLER BUILD/); assert.match(text(constructions[4]), /SIMPLER BUILD/);
  assert.match(text(constructions[4]), /\/boxes\/0: .*"height":12/);
});

test('simple compilation rejects disallowed explicit parts and slope runs even when the ordinary build accepts them', () => {
  const common = { prompt: 'A flat part specimen' };
  for (const partId of ['3039', '3040b', '3062b', '6141', '4589']) {
    const specimen: ShapePlanV2 = { ...plan, boxes: [], parts: [{ partId, colorId: 15, x: 0, y: 0, z: 0, rotation: 0 }] };
    assert.equal(compileGeneratedPlan(specimen, common).bricks[0].partId, partId);
    assert.throws(() => compileGeneratedPlan(specimen, common, undefined, undefined, { simpleParts: true }), /simpler|specialty|allowed|restricted/i);
  }
  const slope: ShapePlanV2 = { ...plan, boxes: [], slopes: [{ kind: 'upright45', x: 0, y: 0, z: 0, width: 2, rotation: 0, colorId: 4 }] };
  assert.throws(() => compileGeneratedPlan(slope, common, undefined, undefined, { simpleParts: true }), /simpler|slope|allowed|restricted/i);
});

test('simple constraints reach repeated and component-local geometry, while surface tiles remain available', () => {
  const disallowed = { partId: '4589', colorId: 15, x: 0, y: 0, z: 0, rotation: 0 as const };
  const repeat: ShapePlanV2 = { ...plan, boxes: [], repeats: [{ count: 1, dx: 0, dy: 0, dz: 0, parts: [disallowed] }] };
  assert.throws(() => compileGeneratedPlan(repeat, { prompt: 'Flat specimen' }, undefined, undefined, { simpleParts: true }), /simpler|specialty|allowed|restricted/i);
  const component: ShapePlanV2 = { ...plan, boxes: [], components: [{ id: 'body', parentId: '', role: 'Body', target: { x: 0, y: 0, z: 0 }, tolerance: { x: 0, y: 0, z: 0 }, rotation: 0, boxes: [], parts: [disallowed] }] };
  assert.throws(() => compileGeneratedPlan(component, { prompt: 'Flat specimen' }, undefined, undefined, { simpleParts: true }), /simpler|specialty|allowed|restricted/i);
  const tiled: ShapePlanV2 = { ...plan, boxes: [{ ...box, width: 2, depth: 2, height: 3 }], parts: [{ ...disallowed, partId: '3068b', z: 3 }] };
  const built = compileGeneratedPlan(tiled, { prompt: 'Flat tiled specimen' }, undefined, undefined, { simpleParts: true });
  assert.ok(built.bricks.some(brick => brick.partId === '3068b')); assert.equal(validateDesign(built).valid, true);
});

test('the simple fallback rejects expanded colors rather than silently recoloring the requested volume', () => {
  const catalog: CatalogManifest = { schemaVersion: 1, parts: {}, colors: { 18: { id: 18, name: 'Test light blue', hex: '#A8D1E7', ldrawId: 9 } },
    partColors: { '3005': { allowedColors: [18], source: { url: 'https://rebrickable.com/api/v3/lego/parts/3005/colors/', sha256: '0'.repeat(64), license: 'Mock catalog evidence' } } } };
  const colored: ShapePlanV2 = { ...plan, boxes: [{ ...box, width: 1, depth: 1, height: 3, colorId: 18 }] };
  assert.equal(compileGeneratedPlan(colored, { prompt: 'Flat color specimen' }, undefined, catalog).bricks[0].colorId, 18);
  assert.throws(() => compileGeneratedPlan(colored, { prompt: 'Flat color specimen' }, undefined, catalog, { simpleParts: true }), /simpler|standard color|simpleColorIds/i);
});

test('simple filler and local repair retain the requested part allowlist', () => {
  const allowedPartIds = new Set(['3023']);
  const specimen: ShapePlanV2 = { ...plan, boxes: [{ ...box, width: 2, depth: 2, height: 2 }] };
  const before = compilePlan(specimen, { prompt: 'Flat interlocking plates', repair: false, allowedPartIds });
  assert.ok(before.bricks.every(brick => allowedPartIds.has(brick.partId)));
  const after = repairCompiledPlan(before);
  assert.ok(after.bricks.every(brick => allowedPartIds.has(brick.partId)));
  assert.equal(validateDesign(after).valid, true);
  const curved: ShapePlanV2 = { ...plan, boxes: [], profiles: [{ shape: 'ellipse', colorId: 15, sections: [
    { z: 0, cx: 8, cy: 8, width: 8, depth: 5 }, { z: 9, cx: 8, cy: 8, width: 8, depth: 5 },
  ] }] };
  const plateIds = new Set(['3024', '3023', '3022', '3020']);
  const disconnected = compilePlan(curved, { prompt: 'Curved body', repair: false, allowedPartIds: plateIds });
  assert.equal(validateDesign(disconnected).connectedComponents, 2, 'This case requires actual seam repair');
  const repaired = repairCompiledPlan(disconnected);
  assert.equal(validateDesign(repaired).valid, true);
  assert.ok(repaired.bricks.every(brick => plateIds.has(brick.partId)), 'Repair cannot escape the original allowlist to use a longer plate or full brick');
  const cells = (design: Design) => {
    const result = new Set<string>();
    for (const brick of design.bricks) {
      const size = footprint(brick);
      for (let x = brick.x; x < brick.x + size.width; x++) for (let y = brick.y; y < brick.y + size.depth; y++) for (let z = brick.z; z < brick.z + partHeight(brick); z++) result.add(`${x},${y},${z},${brick.colorId}`);
    }
    return result;
  };
  assert.deepEqual(cells(repaired), cells(disconnected));
  assert.deepEqual([...SIMPLE_PART_IDS].filter(id => !['brick', 'plate', 'tile'].includes(PARTS[id].kind)), []);
});

test('simple compilation preserves exact owned stock, provenance and the explicit user piece budget', () => {
  const inventory: InventoryItem[] = [{ partId: '3001', colorId: 4, quantity: 3, source: 'My red lot A' }, { partId: '3001', colorId: 4, quantity: 3, source: 'My red lot B' },
    { partId: '4589', colorId: 4, quantity: 20, source: 'Specialty lot' }];
  const owned = { ...plan, boxes: [{ ...box, height: 9 }] };
  const input = { prompt: 'A solid specimen', inventoryMode: 'owned' as const, inventory, maxBricks: 6 };
  const result = compileGeneratedPlan(owned, input, undefined, undefined, { simpleParts: true });
  assert.equal(result.bricks.length, 6); assert.equal(allocateInventory(result, inventory).totalMissing, 0);
  assert.deepEqual(allocateInventory(result, inventory).items[0].sources, [{ source: 'My red lot A', quantity: 3 }, { source: 'My red lot B', quantity: 3 }]);
  assert.throws(() => compileGeneratedPlan(owned, { ...input, maxBricks: 5 }, undefined, undefined, { simpleParts: true }), /budget/);
  assert.throws(() => compileGeneratedPlan(owned, { ...input, inventory: [{ ...inventory[0], quantity: 5 }] }, undefined, undefined, { simpleParts: true }), /inventory/);
  assert.throws(() => compileGeneratedPlan(owned, { ...input, inventory: [{ ...inventory[0], colorId: 1, quantity: 6 }] }, undefined, undefined, { simpleParts: true }), /inventory/);
});

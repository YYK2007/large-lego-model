import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { BoxGeometry } from 'three';
import sharp from 'sharp';
import { parseReferenceStl, renderReferenceStl, REFERENCE_STL_BYTES } from '../server/reference-model.js';
import { loadReferenceModel, discoverReferences, resetReferenceStateForTests } from '../server/references.js';
import { researchReferences } from '../server/reference-research.js';
import { isDesignResearch, isReferenceResearchBrief, type DesignResearch } from '../shared/references.js';

beforeEach(resetReferenceStateForTests);
function boxStl() {
  const box = new BoxGeometry(4, 2, 3).translate(2, 1, 1.5).toNonIndexed(), p = box.getAttribute('position');
  const bytes = Buffer.alloc(84 + p.count / 3 * 50); bytes.writeUInt32LE(p.count / 3, 80);
  for (let triangle = 0; triangle < p.count / 3; triangle++) for (let vertex = 0; vertex < 3; vertex++) for (let axis = 0; axis < 3; axis++) bytes.writeFloatLE(p.array[triangle * 9 + vertex * 3 + axis], 84 + triangle * 50 + 12 + vertex * 12 + axis * 4);
  box.dispose(); return bytes;
}
const pages = (items: unknown[]) => Response.json({ query: { pages: items } });
const modelPage = { title: 'File:Test pavilion.stl', imageinfo: [{ url: 'https://upload.wikimedia.org/Test_pavilion.stl', thumburl: 'https://upload.wikimedia.org/Test_pavilion.png', mime: 'application/sla', size: 684,
  extmetadata: { ImageDescription: { value: 'An external test pavilion model' }, Artist: { value: '<b>Model Author</b>' }, Credit: { value: 'Own work' }, LicenseShortName: { value: 'CC BY 4.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by/4.0/' } } }] };

test('bounded numeric STL parsing retains source dimensions and renders three distinct axis projections', async () => {
  const bytes = boxStl(), mesh = parseReferenceStl(bytes);
  assert.equal(mesh.triangleCount, 12); assert.deepEqual(mesh.bounds, { min: [0, 0, 0], max: [4, 2, 3] });
  const views = await renderReferenceStl(mesh);
  assert.deepEqual(views.map(view => view.label), ['Source X-Z view', 'Source Y-Z view', 'Source X-Y view']);
  const extents = [];
  for (const view of views) {
    const { data, info } = await sharp(view.bytes).raw().toBuffer({ resolveWithObject: true });
    const xs: number[] = [], ys: number[] = [];
    for (let y = 23; y < 299; y++) for (let x = 0; x < 320; x++) if (data[(y * 320 + x) * info.channels] < 210) { xs.push(x); ys.push(y); }
    extents.push([Math.max(...xs) - Math.min(...xs) + 1, Math.max(...ys) - Math.min(...ys) + 1]);
  }
  for (const [index, expected] of [[0, [276, 207]], [1, [138, 207]], [2, [276, 138]]] as const) assert.ok(extents[index].every((value, axis) => Math.abs(value - expected[axis]) <= 2), `Projection ${index}: ${extents[index]}`);
  assert.deepEqual(mesh.bounds, { min: [0, 0, 0], max: [4, 2, 3] }, 'Rendering cannot modify source geometry');
});

test('STL limits reject oversized, malformed, nonfinite, flat and cancelled inputs without executing other formats', async () => {
  assert.throws(() => parseReferenceStl(Buffer.alloc(REFERENCE_STL_BYTES + 1)), /byte limit/);
  assert.throws(() => parseReferenceStl(Buffer.from('BLENDER untrusted script')), /invalid/);
  const malicious = Buffer.alloc(84); malicious.writeUInt32LE(0xffffffff, 80);
  assert.throws(() => parseReferenceStl(malicious), /invalid/);
  const infinite = boxStl(); infinite.writeFloatLE(Infinity, 96);
  assert.throws(() => parseReferenceStl(infinite), /coordinates/);
  const flat = boxStl(); for (let offset = 104; offset < flat.length; offset += 50) for (let vertex = 0; vertex < 3; vertex++) flat.writeFloatLE(0, offset + vertex * 12);
  assert.throws(() => parseReferenceStl(flat), /three-dimensional/);
  await assert.rejects(renderReferenceStl(parseReferenceStl(boxStl()), { signal: AbortSignal.abort() }), /abort/i);
  await assert.rejects(renderReferenceStl(parseReferenceStl(boxStl()), { deadline: 0 }), /time budget/);
});

test('optional Commons STL uses one bounded source with credits, actual geometry and clearly labeled model renders', async t => {
  const bytes = boxStl(), calls: URL[] = [];
  t.mock.method(globalThis, 'fetch', async (input: URL) => {
    const url = new URL(String(input)); calls.push(url);
    return url.hostname === 'commons.wikimedia.org' ? pages([modelPage]) : new Response(new Uint8Array(bytes), { headers: { 'content-type': 'application/sla' } });
  });
  const result = await loadReferenceModel({ name: 'Test pavilion' }, { signal: AbortSignal.timeout(3000), deadline: Date.now() + 3000 });
  assert.ok(result); assert.equal(calls.length, 2); assert.match(calls[0].searchParams.get('gsrsearch')!, /filetype:3d filesize:/);
  assert.equal(result.model.sha256, createHash('sha256').update(bytes).digest('hex')); assert.equal(result.model.artist, 'Model Author');
  assert.equal(result.model.geometryRead, true); assert.equal(result.model.units, 'unspecified'); assert.equal(result.model.triangleCount, 12);
  assert.ok(result.images.every(image => image.metadata.mediaType === 'model-render' && image.metadata.viewLabel && /not a photograph/.test(image.metadata.description)));
});

test('unsupported or unlicensed model candidates are not downloaded; Quick photo discovery never searches for models', async t => {
  const calls: URL[] = [];
  t.mock.method(globalThis, 'fetch', async (input: URL) => {
    const url = new URL(String(input)); calls.push(url); assert.notEqual(url.hostname, 'upload.wikimedia.org');
    return pages([{ ...modelPage, title: 'File:Test pavilion.blend' }, { ...modelPage, imageinfo: [{ ...modelPage.imageinfo[0], extmetadata: {} }] }]);
  });
  assert.equal(await loadReferenceModel({ name: 'Test pavilion' }, { signal: AbortSignal.timeout(3000), deadline: Date.now() + 3000 }), undefined);
  calls.length = 0;
  await discoverReferences({ name: 'Test pavilion' });
  assert.ok(calls.every(url => !/filetype:3d/.test(url.searchParams.get('gsrsearch') || '')));
});

test('Quick reference ranking prefers available different view hints without extra queries', async t => {
  const calls: URL[] = [];
  t.mock.method(globalThis, 'fetch', async (input: URL) => {
    const url = new URL(String(input)); calls.push(url);
    if (url.hostname === 'en.wikipedia.org') return pages([]);
    return pages(['front one', 'front two', 'rear'].map(view => ({ title: `File:Test pavilion ${view}.jpg`, imageinfo: [{ ...modelPage.imageinfo[0], mime: 'image/jpeg' }] })));
  });
  const found = await discoverReferences({ name: 'Test pavilion' });
  assert.equal(calls.length, 6); assert.deepEqual(found.candidates[0].viewHints, ['front']); assert.deepEqual(found.candidates[1].viewHints, ['rear']);
});

test('Detailed research keeps photos distinct from optional source-mesh views and preserves auditable metadata', async t => {
  const jpeg = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#dd3322' } }).jpeg().toBuffer();
  const photo = { title: 'File:Test pavilion front.jpg', imageinfo: [{ ...modelPage.imageinfo[0], url: 'https://upload.wikimedia.org/front.jpg', thumburl: 'https://upload.wikimedia.org/front.jpg', mime: 'image/jpeg' }] };
  const calls: URL[] = [];
  t.mock.method(globalThis, 'fetch', async (input: URL) => {
    const url = new URL(String(input)); calls.push(url);
    if (url.hostname === 'upload.wikimedia.org') return new Response(new Uint8Array(url.pathname.endsWith('.stl') ? boxStl() : jpeg), { headers: { 'content-type': url.pathname.endsWith('.stl') ? 'application/sla' : 'image/jpeg' } });
    if (url.hostname === 'en.wikipedia.org') return pages([]);
    return pages(/filetype:3d/.test(url.searchParams.get('gsrsearch') || '') ? [modelPage] : [photo]);
  });
  const result = await researchReferences({ name: 'Test pavilion' }, { complexity: 'complex' });
  assert.equal(result.images.length, 4); assert.equal(result.brief.photos.length, 1); assert.deepEqual(result.brief.models?.[0].viewImageIndices, [1, 2, 3]);
  assert.ok(calls.some(url => /front filetype:bitmap/.test(url.searchParams.get('gsrsearch') || ''))); assert.ok(calls.some(url => /"side view" filetype:bitmap/.test(url.searchParams.get('gsrsearch') || '')));
  assert.equal(isReferenceResearchBrief(result.brief), true);
  const saved: DesignResearch = { subject: result.brief.subject, sources: result.images.map(image => image.metadata), uploadedImage: false, observations: { silhouette: '', proportions: '', features: [], colors: [], limitations: [] }, comparison: { status: 'needs-work', summary: '', issues: [] }, warnings: result.warnings, brief: result.brief };
  assert.equal(isDesignResearch(saved), true);
  const bad = structuredClone(result.brief); bad.models![0].geometryRead = false as true;
  assert.equal(isReferenceResearchBrief(bad), false);
  const overlapping = structuredClone(result.brief); overlapping.models![0].viewImageIndices = [0];
  assert.equal(isReferenceResearchBrief(overlapping), false);
});

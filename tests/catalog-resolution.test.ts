import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PARTS, validateDesign, exportLDraw, type CatalogPart } from '../shared/model.js';

// A separate test process owns this temporary cache. No network or real key is
// used; the only uncached HTTP request deliberately waits for cancellation.
const originalCwd = process.cwd(), originalFetch = globalThis.fetch;
const temporary = await mkdtemp(join(tmpdir(), 'sprout-catalog-'));
process.chdir(temporary); process.env.REBRICKABLE_API_KEY = 'mock-key-not-a-credential';
const { loadCachedCatalog, resolveGenerationCatalog, verifyCatalogManifest, rankCatalogParts, searchCatalog, expandFullCatalog } = await import('../server/catalog-resolver.js');
const root = join(temporary, 'data/catalog');
const fixture: CatalogPart = JSON.parse(await readFile(new URL('./fixtures/catalog-3021.json', import.meta.url), 'utf8'));
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
async function save(path: string, data: unknown) { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, JSON.stringify(data)); }
await save(join(root, 'colors.json'), { 4: { id: 4, name: 'Red', hex: '#C91A09', ldrawId: 4 } });
await save(join(root, 'resolved/3021.json'), fixture);
const rounded = JSON.parse(await readFile(new URL('./fixtures/catalog-specialties.json', import.meta.url), 'utf8'))['66857'] as CatalogPart;
await save(join(root, 'resolved/66857.json'), rounded);
await save(join(root, 'parts-index.json'), { parts: [
  { partId: '3021', name: 'Plate 2 x 3', categoryId: 14, partUrl: 'https://rebrickable.com/parts/3021/', status: 'discovered' },
  { partId: 'uncached', name: 'Plate waiting for source', categoryId: 14, partUrl: 'https://rebrickable.com/parts/uncached/', status: 'discovered' },
] });
for (const id of Object.keys(PARTS)) {
  const url = `https://rebrickable.com/api/v3/lego/parts/${id}/colors/?page_size=1000`;
  const source = { url, sha256: hash(url), license: 'Mock source for deterministic resolver test' };
  await save(join(root, 'rebrickable', hash(url) + '.json'), { data: { results: [{ color_id: 4 }], next: null }, source });
  await save(join(root, 'part-colors', id + '.json'), { allowedColors: [4], source });
}
after(async () => { globalThis.fetch = originalFetch; process.chdir(originalCwd); await rm(temporary, { recursive: true, force: true }); });

test('bounded discovery preserves verified successes, searches with empty explicit IDs, and rejects invented snapshots', async t => {
  const budget = new AbortController(), timeout = AbortSignal.timeout;
  // Expire discovery at the pending request, independent of cache I/O speed.
  t.mock.method(AbortSignal, 'timeout', (delay: number) => delay === 500 ? budget.signal : timeout(delay));
  let requests = 0;
  globalThis.fetch = async (input, init) => {
    requests++; assert.equal(String(input), 'https://rebrickable.com/api/v3/lego/parts/uncached/');
    queueMicrotask(() => budget.abort(new DOMException('Discovery allowance exhausted', 'TimeoutError')));
    return new Promise((_, reject) => { const signal = init!.signal!; if (signal.aborted) reject(signal.reason); else signal.addEventListener('abort', () => reject(signal.reason), { once: true }); });
  };
  const result = await resolveGenerationCatalog({ query: 'Plate', partIds: [], limit: 2, budgetMs: 500 });
  assert.equal(requests, 1); assert.equal(result.discovered.find(row => row.partId === '3021')!.status, 'assembly-supported');
  assert.equal(result.discovered.find(row => row.partId === 'uncached')!.status, 'discovered');
  assert.ok(result.catalog.parts['3021']); assert.equal(result.warnings.length, 1);
  await verifyCatalogManifest(result.catalog);
  assert.deepEqual([result.catalog.parts['66857'].width, result.catalog.parts['66857'].depth], [2, 4]);
  await verifyCatalogManifest({ ...result.catalog, parts: { ...result.catalog.parts, '66857': rounded } });
  const invented = structuredClone(result.catalog); invented.parts['3021'].geometry!.body.vertices[0][0] += 0.001;
  await assert.rejects(verifyCatalogManifest(invented), /not a trusted resolved catalog snapshot/);
});

test('global cancellation aborts even after one candidate is already verified', async () => {
  const controller = new AbortController();
  globalThis.fetch = async () => { controller.abort(new Error('User canceled request')); throw controller.signal.reason; };
  await assert.rejects(resolveGenerationCatalog({ query: 'Plate', signal: controller.signal, budgetMs: 5000 }), /User canceled request/);
});


test('cache-only catalog loading returns verified specialty meshes and colors with no discovery or credential requirement', async () => {
  const originalKey = process.env.REBRICKABLE_API_KEY;
  delete process.env.REBRICKABLE_API_KEY;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error('Cache-only loading must never fetch'); };
  try {
    const result = await loadCachedCatalog();
    assert.ok(result.parts['3021']); assert.ok(result.parts['66857']);
    assert.deepEqual(result.parts['3021'].geometry, fixture.geometry);
    assert.ok(result.partColors!['3001'].allowedColors.includes(4));
    assert.equal(requests, 0);
    const stopped = new AbortController(); stopped.abort(new Error('Manual Stop'));
    await assert.rejects(loadCachedCatalog(stopped.signal), /Manual Stop/);
  } finally { process.env.REBRICKABLE_API_KEY = originalKey; }
});

test('Quick uses a source-backed cached curved part on its first plan and preserves its actual geometry, stock and export', async t => {
  const { default: dotenv } = await import('dotenv');
  const { default: sharp } = await import('sharp');
  const { generateDesign } = await import('../server/generation.js');
  t.mock.method(dotenv, 'config', () => ({ parsed: {} }));
  const keys = ['GEMINI_API_KEY', 'GEMINI_MODEL', 'REBRICKABLE_API_KEY'], prior = keys.map(key => process.env[key]);
  process.env.GEMINI_API_KEY = 'fake-cached-parts-test'; process.env.GEMINI_MODEL = 'gemini-3.8-flash'; delete process.env.REBRICKABLE_API_KEY;
  t.after(() => keys.forEach((key, index) => { if (prior[index] === undefined) delete process.env[key]; else process.env[key] = prior[index]; }));
  const curved: CatalogPart = JSON.parse(await readFile(new URL('./fixtures/catalog-specialties.json', import.meta.url), 'utf8'))['47457'];
  await save(join(root, 'resolved/47457.json'), curved);
  const image = { mimeType: 'image/jpeg', data: (await sharp({ create: { width: 20, height: 20, channels: 3, background: '#aa2222' } }).jpeg().toBuffer()).toString('base64') };
  const observations = { usedImages: [0], silhouette: 'A red tall body with a curved upper surface.', proportions: 'A broad body with a curved end.', features: ['A curved upper surface'], colors: ['Red'], limitations: [] };
  const plan = { schemaVersion: 2, coordinateSystem: 'stud-xy-plate-z', title: 'Curved surface test', description: 'Uses an actual catalog curve.', observations,
    boxes: [{ x: 0, y: 0, z: 0, width: 4, depth: 4, height: 12, colorId: 4 }], parts: [{ partId: '47457', colorId: 4, x: 0, y: 0, z: 12, rotation: 0 }] };
  const stages: string[] = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(new URL(String(url)).hostname, 'generativelanguage.googleapis.com', 'Quick must not perform catalog discovery');
    const body = JSON.parse(String(init!.body)), fields = body.generationConfig.responseJsonSchema.properties;
    if (fields.kind) return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ kind: 'original', name: '', location: '', aliases: [] }) }] }, finishReason: 'STOP' }] }), { headers: { 'content-type': 'application/json' } });
    const kind = fields.usedImages ? 'target' : fields.matches ? 'critic' : 'plan'; stages.push(kind);
    if (kind === 'plan') {
      const brief = JSON.parse(body.contents[0].parts[0].text.split('\n')[0]);
      const part = brief.parts.find((item: { id: string }) => item.id === curved.id);
      assert.deepEqual(part.receivers, curved.geometry!.receivers); assert.deepEqual(part.topStuds, curved.geometry!.studs.map(stud => stud.position));
      assert.match(body.systemInstruction.parts[0].text, /Use verified specialty surface parts/);
      assert.match(body.systemInstruction.parts[0].text, /Prefer ordinary rectangular bricks and plates/);
      assert.ok(brief.parts.some((item: { id: string }) => item.id === '24866'), 'Real flowers are available to Quick without discovery');
      assert.doesNotMatch(body.contents[0].parts[0].text, /SIMPLER BUILD constraints/);
    }
    const value = kind === 'target' ? observations : kind === 'plan' ? plan : {
      matches: true, summary: 'The actual curved top is visible.', issues: [],
      identity: { status: 'recognizable', perceivedSubject: 'The requested curved sculpture', evidence: 'Its surface bends over the tall body.', correction: '' },
      features: [{ index: 0, status: 'present', evidence: 'The curved catalog part is visibly present on top.', correction: '' }],
    };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] }, finishReason: 'STOP' }] }), { headers: { 'content-type': 'application/json' } });
  };
  const design = await generateDesign({ prompt: 'Use an actual curved piece for the upper visible surface', image, quality: 'quick', maxBricks: 9,
    inventoryCatalog: await loadCachedCatalog(), inventoryMode: 'owned', inventory: [{ partId: '3001', colorId: 4, quantity: 8, source: 'Owned bricks' }, { partId: '47457', colorId: 4, quantity: 1, source: 'Owned curve' }] }, undefined, { continuous: true, stopWhenMatched: true });
  assert.deepEqual(stages, ['target', 'plan', 'critic']);
  assert.equal(validateDesign(design).valid, true); assert.equal(design.bricks.length, 9);
  assert.equal(design.bricks.filter(brick => brick.partId === curved.id).length, 1);
  assert.deepEqual(design.catalog!.parts[curved.id].geometry, curved.geometry);
  assert.match(exportLDraw(design), /0 FILE 47457.dat/);
});

test('search prefers real flower shapes, preserves other families and exact IDs, and paginates', async () => {
  const row = (partId: string, name: string) => ({ partId, name, categoryId: 1, partUrl: '', status: 'discovered' as const });
  const index = [row('print', 'Tile Flower Print'), row('duplo', 'Duplo Flower'), row('24866', 'Plant Flower Plate Round 1 x 1 with 5 Petals')];
  assert.equal(rankCatalogParts(index, 'flowers')[0].partId, '24866');
  assert.equal(rankCatalogParts(index, 'duplo')[0].partId, 'duplo');
  assert.equal(rankCatalogParts(index, 'print')[0].partId, 'print');
  assert.equal(rankCatalogParts(index, 'flowers').length, 3);
  assert.deepEqual((await searchCatalog('Plate', { limit: 1, offset: 1 })).map(row => row.partId), ['uncached']);
});

test('full expansion resumes, records unsupported geometry and retries source outages', async () => {
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  const first = await expandFullCatalog({ budgetMs: 2000 });
  assert.equal(first.total, 2); assert.equal(first.next, 1); assert.equal(first.complete, false);
  assert.equal(first.supported, 1); assert.equal(first.unsupported, 0); assert.equal(first.pending!.partId, 'uncached');
  globalThis.fetch = async () => new Response(JSON.stringify({ part_num: 'uncached', name: 'An unmapped part', external_ids: {} }), { headers: { 'content-type': 'application/json' } });
  const next = await expandFullCatalog({ budgetMs: 3000 });
  assert.equal(next.examined, 1); assert.equal(next.next, 2); assert.equal(next.complete, true); assert.equal(next.unsupported, 1);
  assert.equal((await expandFullCatalog({ budgetMs: 1000 })).examined, 0);
  const stopped = new AbortController(); stopped.abort(new Error('Stop catalog expansion'));
  await assert.rejects(expandFullCatalog({ budgetMs: 1000, signal: stopped.signal }), /Stop catalog expansion/);
});

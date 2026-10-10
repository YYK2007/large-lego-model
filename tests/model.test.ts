import assert from 'node:assert/strict';
import test from 'node:test';
import { SAMPLE_DESIGNS } from '../shared/examples.js';
import { allocateInventory, billOfMaterials, buildSteps, exportCsv, exportLDraw, footprint, validateDesign, type Brick, type Design } from '../shared/model.js';

const brick = (id: string, overrides: Partial<Brick> = {}): Brick => ({ id, partId: '3005', colorId: 4, x: 0, y: 0, z: 0, rotation: 0, ...overrides });
const design = (bricks: Brick[]): Design => ({ id: 'test', title: 'Test build', description: 'A test build.', bricks, source: 'ai', prompt: 'Build a test.', createdAt: '2026-10-10T12:00:00.000Z' });

test('all curated samples have a connected supported model and truthful provenance', () => {
  assert.equal(SAMPLE_DESIGNS.length, 6);
  for (const sample of SAMPLE_DESIGNS) {
    const result = validateDesign(sample);
    assert.equal(result.valid, true, `${sample.id}: ${result.errors.join('; ')}`);
    assert.equal(sample.source, 'sample');
    assert.ok(sample.bricks.length >= 30);
    assert.match(result.warnings.join(' '), /stability has not been verified/);
    assert.equal(billOfMaterials(sample).reduce((sum, item) => sum + item.quantity, 0), sample.bricks.length);
  }
});

test('rejects malformed designs without crashing on unknown or prototype-named parts', () => {
  for (const value of [null, {}, { bricks: {} }, { ...design([]), bricks: [null] }]) {
    const check = validateDesign(value as Design);
    assert.equal(check.valid, false);
    assert.equal(check.connectedComponents, undefined, 'Pre-geometry rejections do not report a connection count');
  }
  for (const overrides of [
    { partId: 'no-such-part' }, { partId: 'toString' }, { colorId: 999999 },
    { x: 0.5 }, { y: NaN }, { z: -1 }, { rotation: 180 }, { id: '' },
  ]) assert.equal(validateDesign(design([brick('a', overrides as Partial<Brick>)])).valid, false);
  assert.equal(validateDesign({ ...design([brick('a')]), source: 'generated' } as unknown as Design).valid, false);
  assert.equal(validateDesign({ ...design([brick('a')]), createdAt: 'yesterday' }).valid, false);
  assert.equal(validateDesign(design([])).valid, false);
  assert.match(validateDesign(design(Array.from({ length: 161 }, (_, i) => brick(String(i))))).errors.join(' '), /overlap/);
});

test('metadata accepts documented limits and rejects oversized strings before export', () => {
  const base = design([brick('a')]);
  for (const [key, maximum] of [['id', 80], ['title', 90], ['description', 600], ['prompt', 4000]] as const) {
    assert.equal(validateDesign({ ...base, [key]: 'A'.repeat(maximum) }).valid, true, `${key} at limit`);
    const rejected = validateDesign({ ...base, [key]: 'A'.repeat(maximum + 1) });
    assert.equal(rejected.valid, false, `${key} beyond limit`);
    assert.ok(rejected.errors.some(error => error.includes(`${key} exceeds ${maximum}`)));
  }
  const boundaryDate = '2026-10-10T12:00:00.' + '0'.repeat(43) + 'Z';
  assert.equal(validateDesign({ ...base, createdAt: boundaryDate }).valid, true);
  assert.match(validateDesign({ ...base, createdAt: boundaryDate.replace('Z', '0Z') }).errors.join(' '), /createdAt exceeds 64/);
  assert.equal(validateDesign({ ...base, title: 'A'.repeat(8000) }).valid, false, 'oversized PDF title regression');
});

test('design IDs reject path syntax and brick IDs have a bounded length', () => {
  const base = design([brick('a')]);
  for (const id of ['../escape', '/tmp/escape', 'folder/file', 'folder\\file', '.', '..', 'has spaces']) {
    assert.match(validateDesign({ ...base, id }).errors.join(' '), /ID contains unsupported characters/);
  }
  assert.equal(validateDesign({ ...base, id: 'valid_ID-123' }).valid, true);
  assert.equal(validateDesign(design([brick('b'.repeat(80))])).valid, true);
  assert.match(validateDesign(design([brick('b'.repeat(81))])).errors.join(' '), /ID of at most 80/);
});

test('bounds include the final stud and take rotated footprints into account', () => {
  assert.deepEqual(footprint(brick('a', { partId: '3001' })), { width: 2, depth: 4 });
  assert.deepEqual(footprint(brick('a', { partId: '3001', rotation: 90 })), { width: 4, depth: 2 });
  assert.equal(validateDesign(design([brick('a', { x: 23, y: 23 })])).valid, true);
  assert.equal(validateDesign(design([brick('a', { partId: '3001', x: 20, y: 22, rotation: 90 })])).valid, true);
  assert.match(validateDesign(design([brick('a', { partId: '3001', x: 21, rotation: 90 })])).errors.join(' '), /beyond/);
  assert.match(validateDesign(design([brick('a', { z: 24 })])).errors.join(' '), /0 to 23/);
});

test('detects overlaps and duplicate brick IDs', () => {
  const overlap = design([brick('a', { partId: '3001', rotation: 90 }), brick('b', { x: 3, y: 1 })]);
  assert.match(validateDesign(overlap).errors.join(' '), /overlap/);
  assert.match(validateDesign(design([brick('a'), brick('a', { z: 1 })])).errors.join(' '), /repeats ID/);
});

test('a support must be on the immediately preceding layer with stud overlap', () => {
  assert.match(validateDesign(design([brick('a'), brick('b', { z: 2 })])).errors.join(' '), /no stud support/);
  assert.match(validateDesign(design([brick('a'), brick('b', { x: 1, z: 1 })])).errors.join(' '), /no stud support/);
  const overhang = design([brick('a'), brick('b', { partId: '3004', rotation: 90, z: 1 })]);
  assert.equal(validateDesign(overhang).valid, true, 'one stud can connect an overhang without asserting its physical strength');
});

test('side contact is disconnected; a later bridging brick can join separate ground bricks', () => {
  const loose = [brick('a'), brick('b', { x: 1 })];
  assert.match(validateDesign(design(loose)).errors.join(' '), /disconnected/);
  const connected = design([...loose, brick('bridge', { partId: '3004', rotation: 90, z: 1 })]);
  assert.equal(validateDesign(connected).valid, true);
  assert.match(buildSteps(connected)[0].instruction, /loose bricks/);
  const separateTowers = design([brick('a'), brick('b', { z: 1 }), brick('c', { x: 5 }), brick('d', { x: 5, z: 1 })]);
  assert.match(validateDesign(separateTowers).errors.join(' '), /disconnected/);
});

test('steps are ordered, contain each original brick exactly once, and preserve the final BOM', () => {
  const sample = { ...SAMPLE_DESIGNS[0], bricks: [...SAMPLE_DESIGNS[0].bricks].reverse() };
  const before = sample.bricks.map((b) => b.id);
  const steps = buildSteps(sample);
  assert.deepEqual(steps.map((step) => step.index), steps.map((_, index) => index + 1));
  assert.ok(steps.every((step, i) => i === 0 || step.z >= steps[i - 1].z));
  assert.ok(steps.every(step => step.bricks.length <= 12));
  assert.deepEqual(steps.flatMap((step) => step.bricks.map((b) => b.id)).sort(), [...before].sort());
  assert.deepEqual(billOfMaterials({ ...sample, bricks: steps.flatMap((step) => step.bricks) }), billOfMaterials(sample));
  assert.deepEqual(sample.bricks.map((b) => b.id), before, 'building steps does not mutate the saved design');
});

test('inventory allocates exact colors and part IDs across sources without inventing quantities', () => {
  const target = design([brick('a'), brick('b'), brick('c'), brick('d', { colorId: 1 }), brick('e', { partId: '3004' })]);
  const allocation = allocateInventory(target, [
    { partId: '3005', colorId: 4, quantity: 1, source: 'Set 1' },
    { partId: '3005', colorId: 4, quantity: 8, source: 'Set 2' },
    { partId: '3005', colorId: 4, quantity: 2, source: 'Set 3' },
    { partId: '3005', colorId: 2, quantity: 99, source: 'Wrong color' },
    { partId: '3004', colorId: 4, quantity: -2, source: 'Invalid quantity' },
  ]);
  assert.equal(allocation.totalMissing, 2);
  const red = allocation.items.find((row) => row.partId === '3005' && row.colorId === 4)!;
  assert.equal(red.owned, 3);
  assert.equal(red.missing, 0);
  assert.deepEqual(red.sources, [{ source: 'Set 1', quantity: 1 }, { source: 'Set 2', quantity: 2 }]);
  for (const row of allocation.items) {
    assert.equal(row.owned + row.missing, row.quantity);
    assert.equal(row.sources.reduce((sum, source) => sum + source.quantity, 0), row.owned);
  }
});

test('LDraw uses verified DAT orientation, top-center origin, physical units, and step boundaries', () => {
  const target = design([
    brick('base', { partId: '3001', x: 2, y: 3 }),
    brick('top', { partId: '3004', x: 2, y: 4, z: 1, rotation: 90, colorId: 1 }),
  ]);
  const output = exportLDraw(target);
  assert.ok(output.includes('1 4 60 -24 100 0 0 1 0 1 0 -1 0 0 3001.dat\r\n'));
  assert.ok(output.includes('1 1 60 -48 90 1 0 0 0 1 0 0 0 1 3004.dat\r\n'));
  assert.equal(output.split('\r\n').filter((line) => line === '0 STEP').length, 1);
  assert.equal(output.split('\r\n').filter((line) => line.startsWith('1 ')).length, target.bricks.length);
  assert.equal(exportLDraw({ ...target, title: 'Title\n1 injected command' }).split('\r\n').filter((line) => line.startsWith('1 ')).length, 2);
});

test('CSV retains provenance and safely quotes commas, quotes, and spreadsheet formulas', () => {
  const target = design([brick('a')]);
  const csv = exportCsv(target, [{ partId: '3005', colorId: 4, quantity: 1, source: '=SUM(1,2) "set"' }]);
  assert.match(csv, /"Required","Owned","Missing","Sources"/);
  assert.ok(csv.includes('"1","1","0"'));
  assert.ok(csv.includes('"\'=SUM(1,2) ""set"": 1"'));
});

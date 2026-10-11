import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js';
import { createMobileModel, generateMobileUsdz } from '../server/mobile-model.js';
import { generateUsdz } from '../server/native-model.js';
import { addUsdzAttribution, compactUsdz } from '../server/usdz-package.js';
import type { CatalogPart, Design } from '../shared/model.js';
import type { CatalogAsset } from '../shared/catalog.js';
import { archiveFiles, verifyBatchedUsdz } from './usdz-artifact.js';

const run = promisify(execFile);
const part: CatalogPart = JSON.parse(await readFile(new URL('./fixtures/catalog-recessed-petal.json', import.meta.url), 'utf8'));
const unused: CatalogPart = JSON.parse(await readFile(new URL('./fixtures/catalog-3021.json', import.meta.url), 'utf8'));
const design: Design = {
  id: 'attribution-fixture', title: 'Petal', description: 'Imported geometry credits.', source: 'sample', prompt: 'Do not export this private request.',
  createdAt: '2026-10-11', schemaVersion: 2, coordinateSystem: 'stud-xy-plate-z', catalogVersion: 'upright-architecture-2',
  catalog: { schemaVersion: 1, parts: { [part.id]: part, [unused.id]: unused }, colors: {} },
  bricks: [{ id: 'petal', partId: part.id, colorId: 4, x: 0, y: 0, z: 0, rotation: 0 }],
};
function credits(stage: string) {
  const literal = stage.match(/string largeLegoModelAttribution = ("(?:\\.|[^"\\])*")/)?.[1];
  assert.ok(literal, 'Root stage contains attribution metadata');
  return JSON.parse(JSON.parse(literal)) as { modifications: string; viewingOnly?: string; parts: { partId: string; sources: CatalogAsset[] }[] };
}

test('USD metadata preserves exact used-part credits without changing mesh layers or adding files', async () => {
  const prepared = createMobileModel(design);
  try {
    const original = Buffer.from(await new USDZExporter().parseAsync(prepared.model, { quickLookCompatible: true }));
    const attributed = addUsdzAttribution(original, design, true);
    const before = archiveFiles(original), after = archiveFiles(attributed);
    assert.deepEqual([...after.keys()], [...before.keys()], 'No unsupported TXT/JSON ZIP entries');
    for (const [name, contents] of before) {
      const actual = after.get(name)!;
      assert.equal(name === 'model.usda' ? actual.replace(/^\t\tstring largeLegoModelAttribution = .*\n/m, '') : actual, contents);
    }
    const data = credits(after.get('model.usda')!);
    assert.deepEqual(data.parts, [{ partId: part.id, ldrawId: part.ldrawId, sources: part.geometry!.assets }]);
    assert.match(data.modifications, /triangulated/); assert.match(data.viewingOnly!, /Covered ordinary studs/);
    assert.ok(!JSON.stringify(data).includes(design.prompt));
  } finally { prepared.dispose(); }
});

test('both exact and portable mobile exports include imported credits and retain canonical geometry', async () => {
  const before = structuredClone(design), path = process.env.PATH;
  try {
    process.env.PATH = '/nonexistent-openusd-tools';
    const exact = archiveFiles(await generateUsdz(design));
    const mobile = archiveFiles((await generateMobileUsdz(design)).bytes);
    for (const layers of [exact, mobile]) {
      assert.deepEqual(credits(layers.get('model.usda')!).parts[0].sources, part.geometry!.assets);
      assert.equal(verifyBatchedUsdz(layers, design).bodies, 1);
    }
    assert.equal(credits(exact.get('model.usda')!).viewingOnly, undefined);
    assert.ok(credits(mobile.get('model.usda')!).viewingOnly);
    assert.deepEqual(design, before);
  } finally { if (path === undefined) delete process.env.PATH; else process.env.PATH = path; }
});

test('real binary packing keeps quoted attribution intact, including literal at-signs and escaped newlines', async t => {
  try { await run('usdcat', ['--version']); await run('usdzip', ['--help']); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return t.skip('OpenUSD CLI tools are not installed'); throw error; }
  const escaped = structuredClone(design);
  // Exercise metadata as data, not an executable USD field or an asset path.
  escaped.catalog!.parts[part.id].geometry!.assets[0].author = 'Test "author" @not-an-asset@\nsecond line';
  const original = await generateUsdz(escaped), compact = await compactUsdz(original);
  const directory = await mkdtemp(join(tmpdir(), 'usdz-attribution-'));
  try {
    const stages: string[] = [];
    for (const [name, bytes] of [['original', original], ['compact', compact]] as const) {
      const input = join(directory, `${name}.usdz`), output = join(directory, `${name}.usda`);
      await writeFile(input, bytes);
      await run('usdcat', ['-l', input], { timeout: 30_000 });
      await run('usdcat', ['-f', '--skipSourceFileComment', input, '-o', output], { timeout: 30_000 });
      stages.push(await readFile(output, 'utf8'));
      if (name === 'compact') {
        try { await run('usdchecker', ['--arkit', input], { timeout: 30_000 }); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; t.diagnostic('Optional usdchecker is not installed.'); }
      }
    }
    assert.match(stages[1], /largeLegoModelAttribution/);
    assert.equal(stages[1], stages[0], 'Complete decoded stage preserves metadata and exact geometry');
    assert.deepEqual(credits(archiveFiles(original).get('model.usda')!).parts[0].sources, escaped.catalog!.parts[part.id].geometry!.assets);
    assert.ok(compact.length < original.length, 'Actual binary encoding succeeded');
    t.diagnostic(`Attributed USDZ: ${original.length} -> ${compact.length} bytes; OpenUSD accepted the package.`);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { compactUsdz } from '../server/usdz-package.js';
import { generateUsdz } from '../server/native-model.js';
import type { CatalogPart, Design } from '../shared/model.js';
import { archiveFiles, verifyBatchedUsdz } from './usdz-artifact.js';

const run = promisify(execFile);
const petal: CatalogPart = JSON.parse(await readFile(new URL('./fixtures/catalog-recessed-petal.json', import.meta.url), 'utf8'));
const design: Design = {
  id: 'binary-usdz-test', title: 'Curved petal', description: 'Two exact source shapes and colors.',
  source: 'sample', prompt: 'Lossless binary packaging test', createdAt: '2026-10-11', schemaVersion: 2,
  coordinateSystem: 'stud-xy-plate-z', catalogVersion: 'upright-plates-slopes-1',
  catalog: { schemaVersion: 1, colors: {}, parts: { [petal.id]: petal } },
  bricks: [{ id: 'base', partId: '3020', colorId: 2, x: 2, y: 3, z: 0, rotation: 0 },
    { id: 'petal', partId: petal.id, colorId: 4, x: 2, y: 3, z: 1, rotation: 90 }],
};

test('platforms without OpenUSD tools retain the original export bytes', async () => {
  const path = process.env.PATH;
  try {
    process.env.PATH = '/nonexistent-openusd-tools';
    const bytes = Buffer.from('Original export is returned without lossy re-encoding');
    assert.equal(await compactUsdz(bytes), bytes);
  } finally {
    if (path === undefined) delete process.env.PATH; else process.env.PATH = path;
  }
});

test('real binary USDZ preserves canonical triangles, normals, transforms and materials', async t => {
  try {
    await run('usdcat', ['--help']); await run('usdzip', ['--help']);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return t.skip('OpenUSD CLI tools are not installed');
    throw error;
  }
  const original = await generateUsdz(design);
  const exact = verifyBatchedUsdz(archiveFiles(original), design);
  assert.equal(exact.bodies, 2); assert.equal(exact.studs, 8);
  const compact = await compactUsdz(original);
  assert.ok(compact.length < original.length, 'Actual binary encoding reduces this detailed curved geometry');
  assert.equal(compact.readUInt16LE(8), 0, 'USDZ remains an uncompressed archive');
  const start = 30 + compact.readUInt16LE(26) + compact.readUInt16LE(28);
  assert.equal(start % 64, 0);
  assert.equal(compact.subarray(start, start + 8).toString(), 'PXR-USDC');
  const directory = await mkdtemp(join(tmpdir(), 'usdz-roundtrip-test-'));
  try {
    const texts: string[] = [];
    for (const [name, bytes] of [['original', original], ['compact', compact]] as const) {
      const input = join(directory, `${name}.usdz`), output = join(directory, `${name}.usda`);
      await writeFile(input, bytes);
      await run('usdcat', ['-f', '--skipSourceFileComment', input, '-o', output], { timeout: 30_000 });
      texts.push(await readFile(output, 'utf8'));
    }
    assert.equal(texts[1], texts[0], 'Entire decoded USD stage is identical, including all typed mesh arrays, transforms and material values');
    t.diagnostic(`Real USDZ: ${original.length} -> ${compact.length} bytes; ${exact.triangles} canonical triangles preserved.`);
    await assert.rejects(compactUsdz(Buffer.from('not a USD archive')), /Could not package/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

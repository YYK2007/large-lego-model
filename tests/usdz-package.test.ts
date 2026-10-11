import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
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
  const bytes = await generateUsdz(design);
  const path = process.env.PATH;
  try {
    process.env.PATH = '/nonexistent-openusd-tools';
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

test('binary packaging preserves shared layers instead of expanding repeated detailed geometry', async t => {
  try { await run('usdcat', ['--version']); await run('usdzip', ['--help']); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return t.skip('OpenUSD CLI tools are not installed');
    throw error;
  }
  const repeated: Design = { ...design, bricks: [
    ...Array.from({ length: 52 }, (_, z) => ({ id: `plate-${z}`, partId: '91405', colorId: z % 2 ? 71 : 15,
      x: 0, y: 0, z, rotation: 0 as const })),
    { ...design.bricks[1], id: 'petal-a', x: 2, y: 3, z: 52 },
    { ...design.bricks[1], id: 'petal-b', x: 10, y: 8, z: 52, colorId: 15 },
  ] };
  const original = await generateUsdz(repeated);
  const layers = archiveFiles(original);
  const exact = verifyBatchedUsdz(layers, repeated, false);
  assert.equal(exact.meshes, 54);
  assert.equal(exact.studs, 52 * 256);
  assert.equal(layers.size, 3, 'Root plus two unique shared shapes');
  const compact = await compactUsdz(original);
  assert.ok(compact.length < original.length / 2, 'Actual binary shared layers substantially shrink this repeated model');
  assert.equal(await compactUsdz(compact), compact, 'Already binary packages are preserved');
  const path = process.env.PATH;
  try {
    process.env.PATH = '/nonexistent-openusd-tools';
    assert.equal(await compactUsdz(compact), compact, 'Binary output needs no tools on a later delivery');
  } finally {
    if (path === undefined) delete process.env.PATH; else process.env.PATH = path;
  }
  const binaryLayers = new Map<string, Buffer>();
  for (let offset = 0; compact.readUInt32LE(offset) === 0x04034b50;) {
    const size = compact.readUInt32LE(offset + 18), length = compact.readUInt16LE(offset + 26);
    const start = offset + 30 + length + compact.readUInt16LE(offset + 28);
    assert.equal(start % 64, 0);
    assert.equal(compact.readUInt16LE(offset + 8), 0);
    const bytes = compact.subarray(start, start + size);
    assert.equal(bytes.subarray(0, 8).toString(), 'PXR-USDC', 'Every layer uses binary crate encoding');
    binaryLayers.set(compact.subarray(offset + 30, offset + 30 + length).toString(), bytes);
    offset = start + size;
  }
  assert.equal(binaryLayers.size, layers.size, 'No geometry copies were baked into the root');
  const directory = await mkdtemp(join(tmpdir(), 'usdz-shared-roundtrip-'));
  try {
    const originalPath = join(directory, 'original.usdz'), compactPath = join(directory, 'compact.usdz');
    await writeFile(originalPath, original); await writeFile(compactPath, compact);
    const normalizeRefs = (text: string) => text.replace(/@([^@]+)@/g, (_, path: string) => `@${basename(path).replace(/\.usdc?$/, '.usda')}@`);
    for (const name of layers.keys()) {
      const binaryName = [...binaryLayers.keys()].find(path => basename(path) === basename(name).replace(/\.usda$/, '.usdc'))!;
      assert.ok(binaryName, 'Every original layer still has a corresponding binary layer');
      const texts: string[] = [];
      for (const [archive, layer] of [[originalPath, name], [compactPath, binaryName]]) {
        const output = join(directory, 'decoded.usda');
        await run('usdcat', [`${archive}[${layer}]`, '-o', output], { timeout: 30_000 });
        texts.push(normalizeRefs(await readFile(output, 'utf8')));
      }
      assert.equal(texts[1], texts[0], `${name}: every authored value is identical apart from relocated internal references`);
    }
    t.diagnostic(`Shared USDZ: ${original.length} -> ${compact.length} bytes; ${exact.triangles} placed triangles, ${layers.size - 1} unique shapes.`);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { Box3, InstancedMesh, Matrix4, Mesh, Vector3 } from 'three';
import sharp from 'sharp';
import { allocateInventory, billOfMaterials, buildSteps, CATALOG_VERSION, catalogForDesign, COORDINATE_SYSTEM, exportCsv, exportLDraw, mergeCatalogManifests, normalizeDesign, PARTS, partBottomSites, partTopStuds, resolveCatalog, validateDesign, type CatalogManifest, type CatalogPart, type Design } from '../shared/model.js';
import { createBrickModel, createInstancedBrickModel } from '../shared/brick-geometry.js';
import { partSurfaces } from '../shared/part-surfaces.js';
import { renderDesignSvg } from '../shared/illustration.js';
import { generateUsdz } from '../server/native-model.js';
import { generateManualPdf } from '../server/manual.js';
import { parseCatalogCsv, resolveGenerationCatalog } from '../server/catalog-resolver.js';
import { parseUprightSnaps, uprightEnvelope, tightenCatalogEnvelope } from '../server/ldraw-resolver.js';
import { loadDesign, saveDesign } from '../server/store.js';
import { archiveFiles, verifyBatchedUsdz } from './usdz-artifact.js';

const imported: CatalogPart = JSON.parse(await readFile(new URL('./fixtures/catalog-3021.json', import.meta.url), 'utf8'));
const manifest: CatalogManifest = { schemaVersion: 1, parts: { [imported.id]: imported }, colors: JSON.parse(await readFile(new URL('./fixtures/catalog-colors.json', import.meta.url), 'utf8')) };
const design: Design = {
  id: 'dynamic-plate-test', title: 'Imported plate study', description: 'Pinned LDraw geometry fixture, not AI generation.', source: 'sample', prompt: 'Catalog export regression', createdAt: '2026-10-10',
  schemaVersion: 2, catalogVersion: CATALOG_VERSION, coordinateSystem: COORDINATE_SYSTEM, catalog: manifest,
  bricks: [{ id: 'plate', partId: '3021', colorId: 3, x: 0, y: 0, z: 0, rotation: 0 }, { id: 'cap', partId: '3005', colorId: 4, x: 0, y: 0, z: 1, rotation: 0 }],
};

function pdfText(pdf: Buffer) {
  const raw = pdf.toString('latin1'); let text = ''; const starts = /(?:^|\n)stream\r?\n/g;
  for (let match; (match = starts.exec(raw));) {
    const dict = raw.slice(raw.lastIndexOf(' obj', match.index) + 4, match.index);
    const size = Number(dict.match(/\/Length\s+(\d+)\b/)![1]);
    const start = match.index + match[0].length, bytes = pdf.subarray(start, start + size);
    const data = (/\/Filter\s+\/FlateDecode/.test(dict) ? inflateSync(bytes) : bytes).toString('latin1');
    text += [...data.matchAll(/<([\da-f]+)>/gi)].map(v => Buffer.from(v[1], 'hex').toString('latin1')).join(''); starts.lastIndex = start + size;
  }
  return text;
}

test('unlisted pinned part and new produced color validate, assemble, allocate and persist without global registration', async () => {
  assert.equal(PARTS['3021'], undefined); assert.ok(validateDesign(design).valid);
  assert.deepEqual(buildSteps(design).flatMap(step => step.bricks.map(brick => brick.id)), ['plate', 'cap']);
  assert.deepEqual(billOfMaterials(design).find(row => row.partId === '3021'), { partId: '3021', colorId: 3, quantity: 1 });
  const allocation = allocateInventory(design, [{ partId: '3021', colorId: 3, quantity: 2, source: 'Confirmed collection' }]);
  assert.equal(allocation.totalMissing, 1); assert.deepEqual(allocation.items.find(row => row.partId === '3021')!.sources, [{ source: 'Confirmed collection', quantity: 1 }]);
  assert.match(exportCsv(design), /Dark Turquoise/);
  assert.equal(resolveCatalog().parts['3021'], undefined);
  assert.equal(validateDesign({ ...design, catalog: undefined }).valid, false);
  const unproduced = { ...design, bricks: [{ ...design.bricks[0], colorId: 9999 }], catalog: { ...manifest, colors: { ...manifest.colors, 9999: { id: 9999, name: 'Test-only unproduced', hex: '#abcdef', ldrawId: 9999 } } } };
  assert.match(validateDesign(unproduced).errors.join(' '), /part\/color pair absent from the verified catalog/i);
  const revision = { ...design, id: `test-catalog-${randomUUID()}` };
  try { await saveDesign(revision); assert.deepEqual(await loadDesign(revision.id), normalizeDesign(revision)); }
  finally { await unlink(new URL(`../data/designs/${revision.id}.json`, import.meta.url)).catch(() => {}); }
});

test('pinned catalog refuses malformed meshes, builtin replacement and conflicting same-ID snapshots', () => {
  const malformed = structuredClone(manifest); malformed.parts['3021'].geometry!.body.faces[0][0] = 999999;
  assert.throws(() => resolveCatalog(malformed), /Invalid/);
  const replacement = structuredClone(manifest); replacement.parts['3005'] = { ...replacement.parts['3021'], id: '3005' };
  assert.throws(() => resolveCatalog(replacement), /replace|override|built-in/i);
  const conflict = structuredClone(manifest); conflict.parts['3021'].name += ' changed';
  assert.throws(() => mergeCatalogManifests(manifest, conflict), /Conflicting/);
  assert.deepEqual(mergeCatalogManifests(manifest, manifest).parts, manifest.parts);
});

test('body contact cannot invent a missing receiver even when another exact mate supports the part', () => {
  const partial = structuredClone(manifest); partial.parts['3021'].geometry!.receivers.shift();
  const supported: Design = { ...design, catalog: partial, bricks: [
    { id: 'first', partId: '3005', colorId: 4, x: 0, y: 0, z: 0, rotation: 0 },
    { id: 'second', partId: '3005', colorId: 4, x: 1, y: 0, z: 0, rotation: 0 },
    { ...design.bricks[0], z: 3 },
  ] };
  assert.match(validateDesign(supported).errors.join(' '), /Studs on first intersect plate without a matching underside/);
  assert.ok(validateDesign({ ...supported, catalog: manifest }).valid);
});

test('imported mesh is identical in native and instanced rendering at every yaw, including actual lattice sites', () => {
  for (const rotation of [0, 90, 180, 270] as const) {
    const one = { ...design, bricks: [{ ...design.bricks[0], rotation }] }, catalog = catalogForDesign(one);
    const native = createBrickModel(one); native.updateMatrixWorld(true);
    const batched = createInstancedBrickModel(one); batched.model.updateMatrixWorld(true);
    const meshes = native.children[0].children as Mesh[];
    assert.equal(meshes.length, 7); assert.equal(partTopStuds(one.bricks[0], catalog).length, 6); assert.equal(partBottomSites(one.bricks[0], catalog).length, 6);
    const size = new Box3().setFromObject(native).getSize(new Vector3());
    assert.ok(Math.abs(size.x - (rotation % 180 ? 2 : 3)) < 1e-6); assert.ok(Math.abs(size.z - (rotation % 180 ? 3 : 2)) < 1e-6); assert.ok(Math.abs(size.y - 0.6) < 1e-6);
    const expected = meshes.flatMap(mesh => {
      const p = mesh.geometry.getAttribute('position'); return Array.from({ length: p.count }, (_, i) => new Vector3().fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld));
    });
    const batch = batched.model.children.find(child => child instanceof InstancedMesh && child.visible) as InstancedMesh;
    const matrix = new Matrix4(); batch.getMatrixAt(0, matrix); matrix.premultiply(batch.matrixWorld);
    const actual = batch.geometry.getAttribute('position'); assert.equal(actual.count, expected.length);
    for (let i = 0; i < actual.count; i++) assert.ok(new Vector3().fromBufferAttribute(actual, i).applyMatrix4(matrix).distanceTo(expected[i]) < 1e-5);
    assert.equal(partSurfaces(one.bricks[0], catalog).faces.length, imported.geometry!.body.faces.length);
    batched.dispose();
  }
});

test('imported LDraw definitions and all four placement transforms reproduce canonical mesh vertices', () => {
  for (const rotation of [0, 90, 180, 270] as const) {
    const one = { ...design, bricks: [{ ...design.bricks[0], rotation }] };
    const output = exportLDraw(one), placement = output.split('\r\n').find(line => line.startsWith('1 '))!.split(' ');
    const n = placement.slice(2, 14).map(Number), face = output.split('\r\n').find(line => /^[34] 16 /.test(line))!.split(' ').slice(2).map(Number);
    const transformed = [0, 1, 2].map(row => n[row] + face.slice(0, 3).reduce((sum, v, col) => sum + n[3 + row * 3 + col] * v, 0));
    const surfaces = partSurfaces(one.bricks[0], catalogForDesign(one)), p = surfaces.vertices[surfaces.faces[0].indices[0]];
    assert.ok(Math.abs(transformed[0] - p[0] * 20) < 1e-5); assert.ok(Math.abs(transformed[1] + p[2] * 8) < 1e-5); assert.ok(Math.abs(transformed[2] - p[1] * 20) < 1e-5);
    assert.match(output, /0 FILE 3021.dat/); assert.match(output, /SHA256 [a-f0-9]{64}/); assert.match(output, /CC BY 4.0/);
  }
});

test('actual SVG, PDF and USDZ exports contain imported geometry and catalog names', async () => {
  const svg = renderDesignSvg(design, { width: 400, height: 400 });
  assert.match(svg, /data-brick-id="plate"/);
  const pixels = await sharp(Buffer.from(svg)).png().toBuffer(); assert.ok(pixels.length > 2000);
  const text = pdfText(await generateManualPdf(design));
  assert.match(text, /Imported plate study/); assert.match(text, /Plate 2 x 3/); assert.match(text, /Dark Turquoise/); assert.match(text, /Pinned catalog sources/); assert.match(text, /LDCad Shadow Library/);
  const verified = verifyBatchedUsdz(archiveFiles(await generateUsdz(design)), design);
  assert.equal(verified.bodies, 2); assert.equal(verified.studs, 7);
  assert.equal(verified.meshes, 2, 'Exact geometry is batched by the two catalog colors');
});

test('connector parser accepts ordinary lattice snaps only and retains unsupported semantics', () => {
  const snaps = parseUprightSnaps('0 !LDCAD SNAP_CYL [gender=F] [pos=0 8 0] [secs=R 6 4] [grid=C 3 C 2 20 20]');
  assert.equal(snaps.length, 6); assert.deepEqual(snaps[0].position, [-20, 8, -10]); assert.ok(snaps.every(snap => snap.ordinary && snap.upright));
  assert.equal(parseUprightSnaps('0 !LDCAD SNAP_CYL [secs=R 4 20]')[0].ordinary, false);
  assert.equal(parseUprightSnaps('0 !LDCAD SNAP_CYL [secs=R 6 4] [ori=1 0 0 0 0 -1 0 1 0]')[0].upright, false);
  assert.equal(parseUprightSnaps('0 !LDCAD SNAP_CYL [secs=R 6 4] [ori=2 0 0 0 1 0 0 0 1]')[0].ordinary, false);
  assert.throws(() => parseUprightSnaps('0 !LDCAD SNAP_CLEAR'), /inheritance/);
  assert.throws(() => parseUprightSnaps('0 !LDCAD SNAP_CYL [secs=R 6 4] [grid=C -1 2 20 20]'), /grid/);
});

test('bulk CSV names retain commas, escaped quotes and newlines', () => {
  assert.deepEqual(parseCatalogCsv('part_num,name\r\n12,"A, B"\r\n13,"say ""hi""\nnext"'), [{ part_num: '12', name: 'A, B' }, { part_num: '13', name: 'say "hi"\nnext' }]);
});

test('compound flower sockets admit only a full-depth ordinary stud seat', () => {
  const socket = (secs: string, extras = '') => parseUprightSnaps(`0 !LDCAD SNAP_CYL [gender=F] [caps=none] [secs=${secs}] [pos=0 8 0] ${extras}`)[0];
  assert.equal(socket('R 6 6 R 2 2 R 4 4').ordinary, true);
  assert.equal(socket('R 6 4').ordinary, true);
  for (const secs of ['R 6 3 R 2 2', 'R 4 6 R 6 4', 'R 8 2 R 6 16 R 8 2', 'A 6 6', 'R 6 6 R 2 -2', 'R 6 6 garbage', 'R 6 NaN']) {
    assert.equal(socket(secs).ordinary, false, secs);
  }
  for (const extras of ['[caps=A]', '[caps=two]', '[center=true]', '[slide=true]', '[group=pin]']) {
    assert.equal(socket('R 6 6 R 2 2', extras).ordinary, false, extras);
  }
  assert.equal(parseUprightSnaps('0 !LDCAD SNAP_CYL [gender=M] [caps=none] [secs=R 6 4]')[0].ordinary, false);
});

test('cached catalog resolution never overrides explicit user cancellation', async () => {
  const controller = new AbortController(); controller.abort(new Error('User stopped'));
  await assert.rejects(resolveGenerationCatalog({ query: '', signal: controller.signal }), /User stopped/);
});

test('source-backed curved, wedge, arch, round-tile and cheese-slope imports preserve their geometry and mates', async () => {
  const parts: Record<string, CatalogPart> = JSON.parse(await readFile(new URL('./fixtures/catalog-specialties.json', import.meta.url), 'utf8'));
  for (const part of Object.values(parts)) for (const rotation of [0, 90, 180, 270] as const) {
    const one: Design = { ...design, catalog: { ...manifest, parts: { [part.id]: part } }, bricks: [{ ...design.bricks[0], partId: part.id, colorId: part.allowedColors.find(color => !!resolveCatalog(manifest).colors[color])!, rotation }] };
    assert.ok(validateDesign(one).valid, `${part.id} at ${rotation}: ${validateDesign(one).errors.join('; ')}`);
    const model = createBrickModel(one), group = model.children[0], body = group.children[0] as Mesh;
    assert.equal(group.children.length, 1 + part.geometry!.studs.length);
    const faces = partSurfaces(one.bricks[0], catalogForDesign(one));
    assert.equal(body.geometry.getAttribute('position').count, faces.faces.reduce((count, face) => count + (face.indices.length - 2) * 3, 0));
    const svg = renderDesignSvg(one, { width: 180, height: 180 });
    assert.ok((await sharp(Buffer.from(svg)).png().toBuffer()).length > 500);
    assert.match(exportLDraw(one), new RegExp(`0 FILE ${part.ldrawId.replace('.', '\\.')}`));
    const verified = verifyBatchedUsdz(archiveFiles(await generateUsdz(one)), one);
    assert.equal(verified.bodies, 1); assert.equal(verified.studs, part.geometry!.studs.length);
  }
  assert.equal(parts['54200'].geometry!.studs.length, 0, 'A cheese slope must not grow invented studs');
  assert.ok(parts['4743'].geometry!.body.vertices.some(point => point[2] > 0 && point[2] < parts['4743'].heightPlates), 'Arch interior mesh remains present');
});

test('sub-micrometer tessellation noise keeps nominal reservations while real protrusions still reserve space', async () => {
  const nominal = uprightEnvelope([-20.0005, 0, -40.0005], [20.0005, 8, 40.0005], [-10, 8, -30]);
  assert.deepEqual(nominal, { minX: -20, minY: -40, width: 2, depth: 4, heightPlates: 1 });
  const protruding = uprightEnvelope([-20.004, 0, -40], [20.004, 8, 40], [-10, 8, -30]);
  assert.equal(protruding.minX, -40); assert.equal(protruding.width, 4);
  const original = JSON.parse(await readFile(new URL('./fixtures/catalog-specialties.json', import.meta.url), 'utf8'))['66857'] as CatalogPart;
  const corrected = tightenCatalogEnvelope(original);
  assert.deepEqual([corrected.width, corrected.depth], [2, 4]); assert.deepEqual([original.width, original.depth], [4, 6]);
  const before = original.geometry!, after = corrected.geometry!;
  for (let i = 0; i < before.body.vertices.length; i++) for (let axis = 0; axis < 3; axis++) {
    assert.ok(Math.abs((before.body.vertices[i][axis] - before.ldraw.offset[axis]) - (after.body.vertices[i][axis] - after.ldraw.offset[axis])) < 1e-12, 'No source-space vertex changes');
  }
  assert.deepEqual(after.body.faces, before.body.faces);
  assert.ok(validateDesign({ ...design, catalog: { ...manifest, parts: { '66857': corrected } }, bricks: [{ ...design.bricks[0], partId: '66857', colorId: 4 }] }).valid);
  assert.equal(tightenCatalogEnvelope(corrected), corrected, 'Re-reservation is idempotent');
});

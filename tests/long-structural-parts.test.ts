import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Mesh, Vector3 } from 'three';
import { compilePlan, type ShapePlanV2 } from '../server/compiler.js';
import { generateUsdz } from '../server/native-model.js';
import { PARTS, COLORS, CATALOG_VERSION, COORDINATE_SYSTEM, allocateInventory, billOfMaterials, exportLDraw, footprint, normalizeDesign, partBottomSites, partHeight, partTopStuds, validateDesign, type Brick, type Design, type InventoryItem } from '../shared/model.js';
import { partSurfaces } from '../shared/part-surfaces.js';
import { createBrickModel } from '../shared/brick-geometry.js';
import { ROOF_SAMPLE } from '../shared/roof-sample.js';
import partColors from '../shared/part-colors.json';

// Verified 2026-10-10 against Rebrickable part/colour API records and official
// https://library.ldraw.org/library/official/parts/<id>.dat (CC BY 4.0).
// DAT body bounds: X=±10*length, Y=0..8*heightPlates, Z=±10*width.
const additions = [
  { id: '3008', width: 1, length: 8, height: 3, absent: [] },
  { id: '6111', width: 1, length: 10, height: 3, absent: [28] },
  { id: '6112', width: 1, length: 12, height: 3, absent: [28, 320] },
  { id: '2465', width: 1, length: 16, height: 3, absent: [28, 320] },
  { id: '2445', width: 2, length: 12, height: 1, absent: [] },
  { id: '4282', width: 2, length: 16, height: 1, absent: [] },
  { id: '3028', width: 6, length: 12, height: 1, absent: [] },
  { id: '3027', width: 6, length: 16, height: 1, absent: [25] },
  { id: '92438', width: 8, length: 16, height: 1, absent: [70, 320] },
  { id: '91405', width: 16, length: 16, height: 1, absent: [14, 70, 320] },
];
const rotations = [0, 90, 180, 270] as const;
const piece = (partId: string, changes: Partial<Brick> = {}): Brick => ({ id: 'piece', partId, colorId: 15, x: 5, y: 7, z: 0, rotation: 0, ...changes });
const design = (bricks: Brick[]): Design => ({ ...ROOF_SAMPLE, bricks });
const plan = (changes: Partial<ShapePlanV2>): ShapePlanV2 => ({ schemaVersion: 2, coordinateSystem: COORDINATE_SYSTEM, title: 'Long structural span', description: 'Exact real pieces with ordinary upright studs.', boxes: [], ...changes });

test('long part identities and allowed colors match the independently retrieved catalog records', () => {
  for (const item of additions) {
    const part = PARTS[item.id], record = partColors.parts[item.id as keyof typeof partColors.parts];
    assert.deepEqual([part.width, part.depth, part.heightPlates, part.kind, part.ldrawId], [item.width, item.length, item.height, item.height === 3 ? 'brick' : 'plate', `${item.id}.dat`]);
    assert.deepEqual(part.allowedColors, Object.keys(COLORS).map(Number).filter(color => !item.absent.includes(color)));
    assert.equal(record.source, `https://rebrickable.com/api/v3/lego/parts/${item.id}/colors/?page_size=1000`);
    for (const colorId of item.absent) assert.equal(validateDesign(design([piece(item.id, { colorId })])).valid, false);
  }
});

test('all longer pieces retain exact solid bounds and full connector grids at four yaws', () => {
  for (const item of additions) for (const rotation of rotations) {
    const brick = piece(item.id, { rotation, z: 11 }), size = footprint(brick);
    assert.deepEqual(size, rotation % 180 ? { width: item.length, depth: item.width } : { width: item.width, depth: item.length });
    const { vertices } = partSurfaces(brick);
    assert.deepEqual([0, 1, 2].map(axis => [Math.min(...vertices.map(point => point[axis])), Math.max(...vertices.map(point => point[axis]))]), [[5, 5 + size.width], [7, 7 + size.depth], [11, 11 + item.height]]);
    for (const [sites, z] of [[partBottomSites(brick), 11], [partTopStuds(brick), 11 + item.height]] as const) {
      const expected = new Set<string>();
      for (let y = 0; y < size.depth; y++) for (let x = 0; x < size.width; x++) expected.add(`${5.5 + x},${7.5 + y},${z}`);
      assert.deepEqual(new Set(sites.map(site => `${site.x},${site.y},${site.z}`)), expected);
    }
    const stack = design([piece(item.id, { rotation }), piece(item.id, { id: 'upper', rotation, z: item.height })]);
    assert.equal(validateDesign(stack).valid, true);
    stack.bricks[1].z--;
    assert.match(validateDesign(stack).errors.join(' '), /overlap/);
  }
});

test('LDraw exports map the verified native long axis and thickness without scaling at every yaw', () => {
  for (const item of additions) for (const rotation of rotations) {
    const brick = piece(item.id, { rotation, z: 11 }), size = footprint(brick);
    const line = exportLDraw(design([brick])).split(/\r?\n/).find(line => line.startsWith('1 '))!.split(' ');
    assert.equal(line.at(-1), `${item.id}.dat`);
    const origin = line.slice(2, 5).map(Number), matrix = line.slice(5, 14).map(Number), points: number[][] = [];
    for (const x of [-10 * item.length, 10 * item.length]) for (const y of [0, 8 * item.height]) for (const z of [-10 * item.width, 10 * item.width]) points.push([0, 1, 2].map(axis => origin[axis] + matrix[axis * 3] * x + matrix[axis * 3 + 1] * y + matrix[axis * 3 + 2] * z));
    assert.deepEqual([0, 1, 2].map(axis => [Math.min(...points.map(point => point[axis])), Math.max(...points.map(point => point[axis]))]), [[100, (5 + size.width) * 20], [-(11 + item.height) * 8, -88], [140, (7 + size.depth) * 20]]);
  }
});

test('real sixteen-stud beams and slabs connect distant supports without filling the air below', () => {
  const beamPlan = plan({ parts: [piece('3005', { id: 'left', x: 0, y: 0 }), piece('3005', { id: 'right', x: 15, y: 0 }), piece('2465', { x: 0, y: 0, z: 3, rotation: 90 })] });
  const beam = compilePlan(beamPlan, { prompt: 'Bridge the supports' });
  assert.equal(validateDesign(beam).valid, true);
  assert.equal(beam.bricks.length, 3);
  assert.equal(beam.bricks.filter(brick => brick.z === 0).length, 2);
  assert.ok(validateDesign(beam).warnings.some(warning => /Physical stability has not been verified/.test(warning)));
  const slab = compilePlan(plan({ parts: [piece('91405', { x: 0, y: 0, z: 3 }), ...[[0, 0], [14, 0], [0, 14], [14, 14]].map(([x, y]) => piece('3003', { x, y }))] }), { prompt: 'A supported structural slab' });
  assert.equal(validateDesign(slab).valid, true);
  assert.equal(slab.bricks.length, 5);
  assert.deepEqual(billOfMaterials(slab), [{ partId: '3003', colorId: 15, quantity: 4 }, { partId: '91405', colorId: 15, quantity: 1 }]);
});

test('owned longer parts preserve exact type, quantity, color and provenance and respect explicit budgets', () => {
  for (const item of additions) {
    const inventory: InventoryItem[] = [{ partId: item.id, colorId: 15, quantity: 1, source: 'Confirmed set' }, { partId: item.id, colorId: 15, quantity: 1, source: 'Loose lot' }, { partId: item.id, colorId: 0, quantity: 10, source: 'Other color' }];
    const original = structuredClone(inventory), shape = plan({ boxes: [{ x: 0, y: 0, z: 0, width: item.width, depth: item.length, height: item.height * 2, colorId: 15 }] });
    const compiled = compilePlan(shape, { prompt: 'Use confirmed pieces', inventory, ownedOnly: true });
    assert.equal(validateDesign(compiled).valid, true);
    assert.deepEqual(billOfMaterials(compiled), [{ partId: item.id, colorId: 15, quantity: 2 }]);
    const allocation = allocateInventory(compiled, inventory);
    assert.equal(allocation.totalMissing, 0);
    assert.deepEqual(allocation.items[0].sources, [{ source: 'Confirmed set', quantity: 1 }, { source: 'Loose lot', quantity: 1 }]);
    assert.deepEqual(inventory, original);
    assert.throws(() => compilePlan(shape, { prompt: '', inventory: inventory.filter(row => row.source !== 'Loose lot'), ownedOnly: true }), /available inventory/);
    assert.throws(() => compilePlan(shape, { prompt: '', inventory, ownedOnly: true, maxBricks: 1 }), /requested 1-brick budget/);
  }
});

test('web and native-export geometry keep long dimensions, stud spacing and real slab piece count', async () => {
  for (const item of additions) for (const rotation of rotations) {
    const brick = piece(item.id, { rotation }), size = footprint(brick), model = createBrickModel(design([brick]));
    const meshes = model.children[0].children as Mesh[], bodySize = new Box3().setFromObject(meshes[0]).getSize(new Vector3());
    assert.ok(Math.abs(bodySize.x - (size.width - 0.04)) < 1e-5);
    assert.ok(Math.abs(bodySize.z - (size.depth - 0.04)) < 1e-5);
    assert.ok(Math.abs(bodySize.y - (item.height * 0.4 - 0.03)) < 1e-5);
    assert.equal(meshes.length - 1, item.width * item.length);
    for (const mesh of meshes) { mesh.geometry.dispose(); const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]; materials.forEach(material => material.dispose()); }
  }
  const archive = await generateUsdz(design([piece('91405')]));
  const text = archive.toString('utf8');
  assert.equal((text.match(/def Xform "Body_/g) || []).length, 1);
  assert.equal((text.match(/def Xform "Stud_/g) || []).length, 256);
  assert.match(text, /metersPerUnit = 1/);
});

test('additive long parts preserve saved V2 coordinates and the legacy seven-brick restriction', () => {
  assert.equal(CATALOG_VERSION, 'upright-architecture-2');
  assert.deepEqual(normalizeDesign(ROOF_SAMPLE), ROOF_SAMPLE);
  for (const item of additions) {
    const current = design([piece(item.id)]), original = structuredClone(current);
    assert.deepEqual(normalizeDesign(current), original);
    delete current.schemaVersion; delete current.catalogVersion; delete current.coordinateSystem;
    assert.throws(() => normalizeDesign(current), /Legacy design contains an unsupported part/);
  }
  const legacy = compilePlan({ title: 'Legacy long bar', description: 'Seven original brick types only.', boxes: [{ x: 0, y: 0, z: 0, width: 1, depth: 16, height: 2, colorId: 15 }] }, { prompt: 'Old plan' });
  assert.ok(legacy.bricks.every(brick => !additions.some(item => item.id === brick.partId)));
  assert.equal(legacy.bricks.reduce((n, brick) => n + footprint(brick).width * footprint(brick).depth * partHeight(brick), 0), 96);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { Raycaster, Vector3 } from 'three';
import { compilePlan, type ShapePart, type ShapePlanV2 } from '../server/compiler.js';
import { PARTS, COLORS, CATALOG_VERSION, PREVIOUS_CATALOG_VERSION, WORKSPACE, allocateInventory, billOfMaterials, buildSteps, exportLDraw, footprint, normalizeDesign, partBottomSites, partTopStuds, validateDesign, type Brick, type Design } from '../shared/model.js';
import { partSurfaces } from '../shared/part-surfaces.js';
import { createBrickModel } from '../shared/brick-geometry.js';
import { renderDesignSvg } from '../shared/illustration.js';
import partColors from '../shared/part-colors.json';

const piece = (partId: string, changes: Partial<Brick> = {}): Brick => ({ id: 'piece', partId, colorId: 4, x: 0, y: 0, z: 0, rotation: 0, ...changes });
const design = (bricks: Brick[]): Design => ({ schemaVersion: 2, catalogVersion: CATALOG_VERSION, coordinateSystem: 'stud-xy-plate-z', id: 'architecture-test', title: 'Architectural parts', description: 'Exact part families.', bricks, source: 'sample', prompt: 'Check architectural details.', createdAt: '2026-10-10T12:00:00Z' });
const plan = (changes: Partial<ShapePlanV2> = {}): ShapePlanV2 => ({ schemaVersion: 2, coordinateSystem: 'stud-xy-plate-z', title: 'Architectural detail', description: 'Explicit real parts on a connected plate.', boxes: [], parts: [], ...changes });
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} vs ${expected}`);
const part = (partId: string, changes: Partial<ShapePart> = {}): ShapePart => ({ partId, colorId: 4, x: 0, y: 0, z: 0, rotation: 0, ...changes });

export const architecturePlan = plan({ parts: [
  part('3036'), part('3068b', { z: 1 }), part('3069b', { x: 2, z: 1 }),
  part('3040b', { x: 3, z: 1 }), part('3062b', { x: 5, z: 1 }),
  part('6141', { x: 5, z: 4 }), part('4589', { x: 5, z: 5 }),
] });

test('catalog metadata has a verified nonempty color list and correct round-plate identity', () => {
  assert.equal(Object.keys(PARTS).length, 36);
  assert.equal(Object.keys(COLORS).length, 13);
  assert.deepEqual(Object.keys(PARTS).sort(), Object.keys(partColors.parts).sort());
  for (const item of Object.values(PARTS)) {
    assert.ok(item.allowedColors.length > 0);
    assert.ok(item.allowedColors.every(id => Object.hasOwn(COLORS, id)));
  }
  assert.equal(PARTS['6141'].ldrawId, '6141.dat');
  assert.equal(PARTS['4073'], undefined, 'BrickLink alias must not become a nonexistent Rebrickable inventory ID');
  for (const id of ['3007', '3062b', '4589']) assert.equal(PARTS[id].allowedColors.includes(28), false);
});

test('tiles attach from below, never support an upper part, and retain their base groove', () => {
  for (const id of ['3069b', '3068b']) for (const rotation of [0, 90, 180, 270] as const) {
    const tile = piece(id, { rotation, z: 1 });
    const base = piece('3036', { id: 'base' });
    assert.equal(validateDesign(design([base, tile])).valid, true);
    assert.deepEqual(partTopStuds(tile), []);
    assert.equal(partBottomSites(tile).length, PARTS[id].width * PARTS[id].depth);
    assert.match(validateDesign(design([base, tile, piece('3005', { id: 'above', z: 2 })])).errors.join(' '), /no stud support/);
    const { vertices } = partSurfaces(tile), { width, depth } = footprint(tile);
    const bottom = vertices.filter(p => p[2] === 1);
    close(Math.min(...bottom.map(p => p[0])), 0.05); close(Math.max(...bottom.map(p => p[0])), width - 0.05);
    close(Math.min(...bottom.map(p => p[1])), 0.05); close(Math.max(...bottom.map(p => p[1])), depth - 0.05);
    assert.equal(vertices.filter(p => p[2] === 1.125).length, 8);
  }
});

test('round column, plate and cone preserve official neck, shoulder, and centered clutch sites', () => {
  // Official LDraw 3062bs01, 6141, 4589: neck radius8LDU, shoulder10LDU,
  // shoulder5LDU above underside; cone narrows to radius6LDU at its top.
  for (const id of ['3062b', '6141', '4589']) {
    const brick = piece(id), h = PARTS[id].heightPlates;
    assert.deepEqual(partBottomSites(brick), [{ x: 0.5, y: 0.5, z: 0 }]);
    assert.deepEqual(partTopStuds(brick), [{ x: 0.5, y: 0.5, z: h }]);
    const { vertices, faces } = partSurfaces(brick);
    const radiiAt = (z: number) => vertices.filter(p => Math.abs(p[2] - z) < 1e-8).map(p => Math.hypot(p[0] - 0.5, p[1] - 0.5));
    close(Math.max(...radiiAt(0)), 0.4); close(Math.max(...radiiAt(0.625)), 0.5);
    close(Math.max(...radiiAt(h)), id === '4589' ? 0.3 : 0.5);
    assert.ok(faces.every(face => face.normal.every(Number.isFinite)));
    const edges = new Map<string, number>();
    for (const face of faces) face.indices.forEach((a, i) => { const b = face.indices[(i + 1) % face.indices.length], key = [a, b].sort((x, y) => x - y).join(','); edges.set(key, (edges.get(key) || 0) + 1); });
    assert.ok([...edges.values()].every(count => count === 2), 'Exterior shell has no missing face edges');
    assert.equal(validateDesign(design([brick, piece('3005', { id: 'above', z: h })])).valid, true);
  }
});

test('hollow stud geometry has an open center down to the recessed body, in both round families', () => {
  for (const id of ['3062b', '4589']) {
    const model = createBrickModel(design([piece(id)])); model.updateMatrixWorld(true);
    const hit = new Raycaster(new Vector3(0, 4, 0), new Vector3(0, -1, 0)).intersectObject(model, true)[0];
    assert.ok(hit, 'The recessed hole has a floor');
    assert.ok(hit.point.y < (id === '3062b' ? 1.05 : 0.65), `${id} must not have a solid stud cap or solid body top`);
    assert.match(renderDesignSvg(design([piece(id)])), /data-hollow-stud="true"/);
  }
  assert.doesNotMatch(renderDesignSvg(design([piece('6141')])), /data-hollow-stud/);
});

test('narrow slope has only one rear stud through all four yaws', () => {
  for (const rotation of [0, 90, 180, 270] as const) {
    const slope = piece('3040b', { rotation });
    const top = partTopStuds(slope);
    assert.equal(top.length, 1);
    assert.equal(validateDesign(design([slope, piece('3005', { id: 'upper', x: top[0].x - 0.5, y: top[0].y - 0.5, z: 3 })])).valid, true);
    const { width, depth } = footprint(slope);
    const frontX = width - top[0].x - 0.5, frontY = depth - top[0].y - 0.5;
    assert.equal(validateDesign(design([slope, piece('3005', { id: 'bad', x: frontX, y: frontY, z: 3 })])).valid, false);
  }
});

test('new LDraw placements preserve official body bounds under all four canonical transforms', () => {
  for (const id of ['3009', '3007', '3666', '3460', '3034', '3036', '3069b', '3068b', '3040b', '3062b', '6141', '4589']) for (const rotation of [0, 90, 180, 270] as const) {
    const brick = piece(id, { x: 7, y: 11, z: 5, rotation }), metadata = PARTS[id], { width, depth } = footprint(brick);
    const line = exportLDraw(design([brick])).split(/\r?\n/).find(line => line.startsWith('1 '))!.split(' ');
    assert.equal(line.at(-1), metadata.ldrawId);
    const [ox, oy, oz] = line.slice(2, 5).map(Number), matrix = line.slice(5, 14).map(Number);
    const xs = metadata.kind === 'slope' ? [-10, 10] : [-10 * metadata.depth, 10 * metadata.depth];
    const zs = metadata.kind === 'slope' ? [-30, 10] : [-10 * metadata.width, 10 * metadata.width];
    const points = xs.flatMap(x => [0, metadata.heightPlates * 8].flatMap(y => zs.map(z => [ox + matrix[0] * x + matrix[1] * y + matrix[2] * z, oy + matrix[3] * x + matrix[4] * y + matrix[5] * z, oz + matrix[6] * x + matrix[7] * y + matrix[8] * z])));
    assert.deepEqual([0, 1, 2].map(axis => [Math.min(...points.map(p => p[axis])), Math.max(...points.map(p => p[axis]))]), [[140, (7 + width) * 20], [-(5 + metadata.heightPlates) * 8, -40], [220, (11 + depth) * 20]], `${id} yaw${rotation}`);
  }
});

test('explicit mixed parts compile with an exact BOM, inventory sources and usable step sequence', () => {
  const stock = architecturePlan.parts!.map(part => ({ partId: part.partId, colorId: part.colorId, quantity: 1, source: `Confirmed ${part.partId}` }));
  const original = structuredClone(architecturePlan);
  const result = compilePlan(architecturePlan, { prompt: 'Use these architectural details', inventory: stock, ownedOnly: true });
  assert.equal(validateDesign(result).valid, true);
  assert.deepEqual(architecturePlan, original);
  assert.equal(result.bricks.length, 7);
  assert.equal(allocateInventory(result, stock).totalMissing, 0);
  assert.ok(allocateInventory(result, stock).items.every(item => item.sources[0].source === `Confirmed ${item.partId}`));
  assert.deepEqual(billOfMaterials(result).map(row => row.partId).sort(), architecturePlan.parts!.map(part => part.partId).sort());
  const studs = new Set<string>();
  for (const step of buildSteps(result)) for (const brick of step.bricks) {
    if (brick.z > 0) assert.ok(partBottomSites(brick).some(site => studs.has(`${site.x},${site.y},${site.z}`)));
    for (const site of partTopStuds(brick)) studs.add(`${site.x},${site.y},${site.z}`);
  }
  assert.throws(() => compilePlan(architecturePlan, { prompt: '', inventory: stock.filter(row => row.partId !== '4589'), ownedOnly: true }), /missing Red 4589/);
});

test('fixed parts repeat exactly and reject overlapping envelopes, malformed placement and impossible color', () => {
  const repeated = plan({ repeats: [{ parts: [part('3062b')], count: 50, dx: 0, dy: 0, dz: 3 }] });
  const result = compilePlan(repeated, { prompt: 'A tall column' });
  assert.equal(result.bricks.length, 50); assert.equal(validateDesign(result).valid, true);
  assert.deepEqual(result.bricks.map(p => p.z), Array.from({ length: 50 }, (_, i) => i * 3));
  for (const raw of [null, part('unknown'), part('4073'), part('3062b', { x: 0.5 }), part('3062b', { rotation: 45 as never }), part('3062b', { colorId: 28 }), part('4589', { z: 383 })]) {
    assert.throws(() => compilePlan(plan({ parts: [raw] as ShapePart[] }), { prompt: 'Reject invalid part' }));
  }
  assert.throws(() => compilePlan(plan({ parts: [part('3062b'), part('3005')] }), { prompt: '' }), /envelope overlaps/);
  assert.throws(() => compilePlan(plan({ parts: [part('6141')], boxes: [{ x: 0, y: 0, z: 0, width: 1, depth: 1, height: 1, colorId: 4 }] }), { prompt: '' }), /envelope overlaps/);
  assert.throws(() => compilePlan(plan({ parts: [part('3040b')], slopes: [{ kind: 'upright45', x: 0, y: 0, z: 0, width: 2, colorId: 4, rotation: 0 }] }), { prompt: '' }), /envelope overlaps/);
});

test('greedy packing uses only rectangular structural pieces and verified colors', () => {
  const shape = plan({ boxes: [{ x: 0, y: 0, z: 0, width: 8, depth: 2, height: 6, colorId: 28 }] });
  const result = compilePlan(shape, { prompt: 'Dark-tan beam' });
  assert.equal(validateDesign(result).valid, true);
  assert.ok(result.bricks.every(brick => ['brick', 'plate'].includes(PARTS[brick.partId].kind) && PARTS[brick.partId].allowedColors.includes(brick.colorId)));
  assert.ok(result.bricks.every(brick => brick.partId !== '3007'));
  assert.equal(validateDesign(design([piece('3007', { colorId: 28 })])).valid, false);
  assert.throws(() => compilePlan(plan({ boxes: [{ x: 0, y: 0, z: 0, width: 2, depth: 2, height: 1, colorId: 4 }] }), { prompt: '', ownedOnly: true, inventory: [{ partId: '3068b', colorId: 4, quantity: 1, source: 'Tile only' }] }), /available inventory/);
});

test('expanded physical workspace preserves old V2 coordinates and keeps legacy limits unchanged', () => {
  const pieces = Array.from({ length: WORKSPACE.heightPlates / 3 }, (_, i) => piece('3005', { id: `p${i}`, x: 95, y: 95, z: i * 3 }));
  assert.equal(validateDesign(design(pieces)).valid, true);
  assert.equal(validateDesign(design([...pieces, piece('3024', { id: 'too-high', x: 95, y: 95, z: 384 })])).valid, false);
  assert.equal(validateDesign(design([piece('3004', { y: 95 })])).valid, false);
  const prior: Design = { ...design([piece('3005')]), catalogVersion: PREVIOUS_CATALOG_VERSION };
  assert.deepEqual(normalizeDesign(prior).bricks, prior.bricks);
  assert.equal(normalizeDesign(prior).catalogVersion, CATALOG_VERSION);
  const legacy = { ...design([piece('3005', { z: 23 })]), schemaVersion: undefined, catalogVersion: undefined, coordinateSystem: undefined };
  assert.equal(normalizeDesign(legacy).bricks[0].z, 69);
  assert.throws(() => normalizeDesign({ ...legacy, bricks: [piece('3005', { z: 24 })] }), /0 to 23/);
  assert.throws(() => normalizeDesign({ ...legacy, bricks: [piece('3009')] }), /unsupported part/);
});

test('malformed saved reference evidence is rejected before UI or export consumption', () => {
  for (const research of [null, {}, { subject: 'Tower', sources: [] }, { sources: 'not-an-array' }]) {
    assert.match(validateDesign({ ...design([piece('3005')]), research } as unknown as Design).errors.join(' '), /reference evidence is invalid/);
  }
});

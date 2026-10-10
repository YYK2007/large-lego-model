import assert from 'node:assert/strict';
import test from 'node:test';
import { compilePlan, type ShapePlanV2 } from '../server/compiler.js';
import { PARTS, CATALOG_VERSION, COORDINATE_SYSTEM, allocateInventory, billOfMaterials, exportLDraw, footprint, normalizeDesign, partBottomSites, partHeight, partTopStuds, validateDesign, type Brick, type Design, type InventoryItem } from '../shared/model.js';
import { partSurfaces } from '../shared/part-surfaces.js';
import { ROOF_SAMPLE } from '../shared/roof-sample.js';
import { REJECTED_BELL_TOWER_PLAN } from './fixtures/rejected-bell-tower-plan.js';

// Official DAT bounds: body X = ±10*length, Y = 0..8, Z = ±10.
// library.ldraw.org/parts/{4211,31684,6319,6777}; 3023b is Rebrickable 3023.
const narrow = [
  { id: '3024', length: 1, brick: '3005', dat: '3024.dat' },
  { id: '3023', length: 2, brick: '3004', dat: '3023b.dat' },
  { id: '3623', length: 3, brick: '3622', dat: '3623.dat' },
  { id: '3710', length: 4, brick: '3010', dat: '3710.dat' },
];
const rotations = [0, 90, 180, 270] as const;
const piece = (partId: string, rotation: Brick['rotation'] = 0, z = 0): Brick => ({ id: `p${z}`, partId, colorId: 15, x: 5, y: 7, z, rotation });
const design = (bricks: Brick[]): Design => ({ ...ROOF_SAMPLE, bricks });
const plan = (boxes: ShapePlanV2['boxes']): ShapePlanV2 => ({ schemaVersion: 2, coordinateSystem: COORDINATE_SYSTEM, title: 'Narrow clock details', description: 'Real one-stud-wide plate details.', boxes });
const box = (width: number, depth: number, height: number) => ({ x: 0, y: 0, z: 0, width, depth, height, colorId: 15 });

function cells(design: Design) {
  const result = new Map<string, number>();
  for (const brick of design.bricks) {
    const { width, depth } = footprint(brick);
    for (let z = brick.z; z < brick.z + partHeight(brick); z++) for (let y = brick.y; y < brick.y + depth; y++) for (let x = brick.x; x < brick.x + width; x++) {
      const key = `${x},${y},${z}`;
      assert.equal(result.has(key), false, `No overlapping cell at ${key}`);
      result.set(key, brick.colorId);
    }
  }
  return result;
}

test('four narrow plates have exact body bounds and connector grids at every yaw', () => {
  for (const part of narrow) for (const rotation of rotations) {
    const brick = piece(part.id, rotation, 11), { width, depth } = footprint(brick);
    assert.deepEqual([PARTS[part.id].width, PARTS[part.id].depth, partHeight(brick), PARTS[part.id].kind], [1, part.length, 1, 'plate']);
    assert.deepEqual([width, depth], rotation % 180 ? [part.length, 1] : [1, part.length]);
    const { vertices, faces } = partSurfaces(brick);
    assert.equal(faces.length, 6);
    assert.deepEqual([0, 1, 2].map(axis => [Math.min(...vertices.map(p => p[axis])), Math.max(...vertices.map(p => p[axis]))]), [[5, 5 + width], [7, 7 + depth], [11, 12]]);
    const expected = Array.from({ length: part.length }, (_, i) => rotation % 180 ? `${5.5 + i},7.5` : `5.5,${7.5 + i}`).sort();
    for (const [sites, z] of [[partTopStuds(brick), 12], [partBottomSites(brick), 11]] as const) {
      assert.deepEqual(sites.map(site => `${site.x},${site.y}`).sort(), expected);
      assert.ok(sites.every(site => site.z === z));
    }
    const stack = design([0, 1, 2].map(z => piece(part.id, rotation, z)).concat(piece(part.brick, rotation, 3)));
    assert.equal(validateDesign(stack).valid, true, `${part.id} stack at ${rotation}`);
    stack.bricks[2].z = 1;
    assert.match(validateDesign(stack).errors.join(' '), /overlap/);
  }
});

test('narrow plate LDraw placements transform official DAT body bounds without shifting or scaling', () => {
  for (const part of narrow) for (const rotation of rotations) {
    const brick = piece(part.id, rotation, 11), { width, depth } = footprint(brick);
    const line = exportLDraw(design([brick])).split(/\r?\n/).find(line => line.startsWith('1 '))!.split(' ');
    assert.equal(line.at(-1), part.dat);
    const [ox, oy, oz] = line.slice(2, 5).map(Number), m = line.slice(5, 14).map(Number);
    const points: number[][] = [];
    for (const x of [-10 * part.length, 10 * part.length]) for (const y of [0, 8]) for (const z of [-10, 10]) points.push([
      ox + m[0] * x + m[1] * y + m[2] * z,
      oy + m[3] * x + m[4] * y + m[5] * z,
      oz + m[6] * x + m[7] * y + m[8] * z,
    ]);
    assert.deepEqual([0, 1, 2].map(axis => [Math.min(...points.map(p => p[axis])), Math.max(...points.map(p => p[axis]))]), [[100, (5 + width) * 20], [-96, -88], [140, (7 + depth) * 20]]);
  }
});

test('one-stud-wide four-plate-high clock details preserve all cells, including black one-cell marks', () => {
  for (const part of narrow) for (const swapped of [false, true]) {
    const shape = plan([box(swapped ? part.length : 1, swapped ? 1 : part.length, 4)]);
    const result = compilePlan(shape, { prompt: shape.title });
    assert.equal(validateDesign(result).valid, true);
    assert.equal(cells(result).size, part.length * 4);
    assert.ok(result.bricks.some(brick => brick.partId === part.id));
    assert.equal(billOfMaterials(result).reduce((n, row) => n + row.quantity, 0), result.bricks.length);
  }
  const shape = plan([box(4, 1, 4), { x: 1, y: 0, z: 3, width: 1, depth: 1, height: 1, colorId: 0 }]);
  const result = compilePlan(shape, { prompt: 'Black clock hand on white detail' });
  assert.equal(validateDesign(result).valid, true);
  const occupied = cells(result);
  assert.equal(occupied.size, 16);
  assert.equal(occupied.get('1,0,3'), 0);
  assert.equal(occupied.get('0,0,3'), 15);
  assert.ok(result.bricks.some(brick => brick.partId === '3024' && brick.colorId === 0));
});

test('owned narrow plates spend exact part/color stock, preserve provenance, and honor an explicit budget', () => {
  for (const part of narrow) {
    const inventory: InventoryItem[] = [
      { partId: part.id, colorId: 15, quantity: 1, source: 'Confirmed set A' },
      { partId: part.id, colorId: 15, quantity: 2, source: 'Confirmed loose lot' },
      { partId: part.id, colorId: 0, quantity: 99, source: 'Other color' },
    ];
    const shape = plan([box(1, part.length, 3)]), original = structuredClone(inventory);
    const result = compilePlan(shape, { prompt: 'Use my plates', inventory, ownedOnly: true });
    assert.deepEqual(result.bricks.map(brick => [brick.partId, brick.z, brick.colorId]), [0, 1, 2].map(z => [part.id, z, 15]));
    assert.equal(validateDesign(result).valid, true);
    assert.deepEqual(allocateInventory(result, inventory).items[0].sources, [{ source: 'Confirmed set A', quantity: 1 }, { source: 'Confirmed loose lot', quantity: 2 }]);
    assert.equal(allocateInventory(result, inventory).totalMissing, 0);
    assert.deepEqual(inventory, original);
    assert.throws(() => compilePlan(shape, { prompt: '', inventory: inventory.filter(row => row.source !== 'Confirmed loose lot'), ownedOnly: true }), /available inventory/);
    assert.throws(() => compilePlan(shape, { prompt: '', inventory, ownedOnly: true, maxBricks: 2 }), /requested 2-brick budget/);
  }
});

test('the original live Bell Tower clock details become tileable without concealing their support gap', () => {
  const original = structuredClone(REJECTED_BELL_TOWER_PLAN);
  const result = compilePlan(original, { prompt: original.title });
  assert.deepEqual(original, REJECTED_BELL_TOWER_PLAN, 'Compilation never moves the clock details');
  const occupied = cells(result);
  const expected = new Map<string, number>();
  for (const box of original.boxes) {
    for (let z = 0; z < box.height; z++) for (let y = 0; y < box.depth; y++) for (let x = 0; x < box.width; x++) {
      if (box.cutouts?.some(cut => x >= cut.x && x < cut.x + cut.width && y >= cut.y && y < cut.y + cut.depth && z >= cut.z && z < cut.z + cut.height)) continue;
      expected.set(`${box.x + x},${box.y + y},${box.z + z}`, box.colorId);
    }
  }
  for (const slope of result.bricks.filter(brick => brick.partId === '3039')) {
    for (const [key, color] of cells(design([slope]))) expected.set(key, color);
  }
  assert.deepEqual(occupied, expected);
  assert.deepEqual(billOfMaterials(result).filter(row => narrow.some(part => part.id === row.partId)), [{ partId: '3023', colorId: 15, quantity: 4 }]);
  const check = validateDesign(result);
  assert.equal(check.valid, false, 'The original plan has a one-plate air gap below all four clocks');
  const unsupported = result.bricks.filter(brick => check.errors.includes(`Brick ${brick.id} has no stud support directly below it.`));
  assert.equal(unsupported.length, 4);
  assert.ok(unsupported.every(brick => brick.colorId === 15 && brick.z === 61));
  assert.ok(unsupported.every(brick => partBottomSites(brick).every(site => !occupied.has(`${site.x - 0.5},${site.y - 0.5},${site.z - 1}`))));
});

test('additive narrow plates retain existing V2 metadata and never enter legacy brick-only plans', () => {
  assert.equal(CATALOG_VERSION, 'upright-architecture-2');
  const original = structuredClone(ROOF_SAMPLE);
  assert.deepEqual(normalizeDesign(ROOF_SAMPLE), original);
  assert.equal(validateDesign(ROOF_SAMPLE).valid, true);
  const legacy = { title: 'Legacy beam', description: 'Two brick layers.', boxes: [box(1, 4, 2)] };
  const compiled = compilePlan(legacy, { prompt: '' });
  assert.deepEqual(compiled.bricks.map(brick => [brick.partId, brick.z]), [['3010', 0], ['3010', 3]]);
  for (const part of narrow) {
    const unversioned = design([piece(part.id)]);
    delete unversioned.schemaVersion; delete unversioned.catalogVersion; delete unversioned.coordinateSystem;
    assert.throws(() => normalizeDesign(unversioned), /Legacy design contains an unsupported part/);
  }
});

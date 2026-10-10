import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePlan, type ShapePlan, type ShapePlanV2, type SlopeRun } from '../server/compiler.js';
import { allocateInventory, billOfMaterials, buildSteps, footprint, partHeight, partTopStuds, partBottomSites, validateDesign, type Design, type InventoryItem } from '../shared/model.js';
import { BIRDHOUSE_SAMPLE } from '../shared/birdhouse-sample.js';
import { COMPLEX_PLAN } from '../shared/complex-plan.js';
import { COMPLEX_SAMPLE } from '../shared/complex-sample.js';

const v2 = (overrides: Partial<ShapePlanV2> = {}): ShapePlanV2 => ({ schemaVersion: 2, coordinateSystem: 'stud-xy-plate-z', title: 'Mixed parts', description: 'A plate and slope assembly.', boxes: [], slopes: [], ...overrides });
const run = (overrides: Partial<SlopeRun> = {}): SlopeRun => ({ kind: 'upright45', x: 0, y: 0, z: 3, width: 4, rotation: 0, colorId: 4, ...overrides });
const roof = () => v2({
  boxes: [
    { x: 0, y: 0, z: 0, width: 4, depth: 4, height: 3, colorId: 71 },
    { x: 0, y: 0, z: 3, width: 4, depth: 4, height: 2, colorId: 15 },
    { x: 0, y: 1, z: 8, width: 4, depth: 2, height: 1, colorId: 15 },
  ],
  slopes: [run({ z: 5 }), run({ y: 2, z: 5, rotation: 180 })],
});
const roofInventory: InventoryItem[] = [
  { partId: '3001', colorId: 71, quantity: 2, source: 'Base set' },
  { partId: '3020', colorId: 15, quantity: 1, source: 'Plate set A' },
  { partId: '3020', colorId: 15, quantity: 2, source: 'Plate set B' },
  { partId: '3022', colorId: 15, quantity: 4, source: 'Plate set B' },
  { partId: '3039', colorId: 4, quantity: 4, source: 'Roof set' },
];

function solidCells(design: Design) {
  const cells = new Map<string, number>();
  for (const brick of design.bricks) {
    const { width, depth } = footprint(brick);
    for (let z = brick.z; z < brick.z + partHeight(brick); z++) for (let y = brick.y; y < brick.y + depth; y++) for (let x = brick.x; x < brick.x + width; x++) {
      const key = `${x},${y},${z}`;
      assert.equal(cells.has(key), false, `Overlap at ${key}`);
      cells.set(key, brick.colorId);
    }
  }
  return cells;
}

test('legacy plans preserve brick geometry while always returning explicit V2 plate coordinates', () => {
  const legacy: ShapePlan = { title: 'Old shape', description: 'Legacy full-brick coordinates.', boxes: [{ x: 0, y: 0, z: 0, width: 2, depth: 4, height: 2, colorId: 4 }] };
  const result = compilePlan(legacy, { prompt: 'Same shape' });
  assert.equal(result.schemaVersion, 2);
  assert.equal(result.coordinateSystem, 'stud-xy-plate-z');
  assert.equal(result.catalogVersion, 'upright-plates-slopes-1');
  assert.deepEqual(result.bricks.map(brick => [brick.partId, brick.z]), [['3001', 0], ['3001', 3]]);
  assert.equal(solidCells(result).size, 48);
  assert.equal(legacy.boxes[0].height, 2, 'migration does not mutate the plan');
});

test('V2 packs a genuine plate-height band without losing colored cells', () => {
  const plan = v2({ boxes: [
    { x: 0, y: 0, z: 0, width: 4, depth: 4, height: 3, colorId: 71 },
    { x: 0, y: 0, z: 3, width: 4, depth: 4, height: 1, colorId: 15 },
    { x: 2, y: 0, z: 3, width: 2, depth: 2, height: 1, colorId: 4 },
  ] });
  const result = compilePlan(plan, { prompt: 'A colored plate band' });
  assert.equal(validateDesign(result).valid, true);
  const expected = new Map<string, number>();
  for (const box of plan.boxes) for (let z = box.z; z < box.z + box.height; z++) for (let y = box.y; y < box.y + box.depth; y++) for (let x = box.x; x < box.x + box.width; x++) expected.set(`${x},${y},${z}`, box.colorId);
  assert.deepEqual(solidCells(result), expected);
  assert.ok(result.bricks.filter(brick => brick.z === 3).every(brick => partHeight(brick) === 1));
  assert.ok(result.bricks.some(brick => brick.partId === '3022' && brick.colorId === 4));
});

test('three owned plates fill one full-brick volume without spending an unavailable brick', () => {
  const inventory: InventoryItem[] = [{ partId: '3020', colorId: 4, quantity: 3, source: 'My plates' }];
  const plan = v2({ boxes: [{ x: 0, y: 0, z: 0, width: 2, depth: 4, height: 3, colorId: 4 }] });
  const result = compilePlan(plan, { prompt: 'Use three plates', inventory, ownedOnly: true });
  assert.deepEqual(result.bricks.map(brick => [brick.partId, brick.z]), [['3020', 0], ['3020', 1], ['3020', 2]]);
  assert.equal(validateDesign(result).valid, true);
  assert.equal(solidCells(result).size, 24);
  assert.equal(allocateInventory(result, inventory).totalMissing, 0);
  assert.throws(() => compilePlan(plan, { prompt: 'Two plates cannot fill this', inventory: [{ ...inventory[0], quantity: 2 }], ownedOnly: true }), /available inventory/);
});

test('the 13-piece roof uses real opposing slopes and seats its ridge on all eight high-row studs', () => {
  const original = JSON.stringify(roofInventory);
  const result = compilePlan(roof(), { prompt: 'A gable roof', inventory: roofInventory, ownedOnly: true });
  const check = validateDesign(result);
  assert.equal(check.valid, true, check.errors.join('; '));
  assert.equal(result.bricks.length, 13);
  assert.deepEqual(billOfMaterials(result), [
    { partId: '3001', colorId: 71, quantity: 2 }, { partId: '3020', colorId: 15, quantity: 3 },
    { partId: '3022', colorId: 15, quantity: 4 }, { partId: '3039', colorId: 4, quantity: 4 },
  ]);
  const slopes = result.bricks.filter(brick => brick.partId === '3039');
  assert.deepEqual(slopes.map(brick => brick.rotation).sort((a, b) => a - b), [0, 0, 180, 180]);
  const studs = slopes.flatMap(partTopStuds);
  const capSites = result.bricks.filter(brick => brick.z === 8).flatMap(partBottomSites);
  assert.equal(capSites.length, 8);
  assert.ok(capSites.every(site => studs.some(stud => site.x === stud.x && site.y === stud.y && site.z === stud.z)));
  const allocation = allocateInventory(result, roofInventory);
  assert.equal(allocation.totalMissing, 0);
  assert.deepEqual(allocation.items.find(item => item.partId === '3020')?.sources, [{ source: 'Plate set A', quantity: 1 }, { source: 'Plate set B', quantity: 2 }]);
  assert.equal(JSON.stringify(roofInventory), original, 'failed or successful compilation does not debit saved inventory');
});

test('all four slope yaws are retained even with a square part footprint', () => {
  for (const rotation of [0, 90, 180, 270] as const) {
    const sideways = rotation % 180 !== 0;
    const plan = v2({ boxes: [{ x: 0, y: 0, z: 0, width: sideways ? 2 : 4, depth: sideways ? 4 : 2, height: 3, colorId: 71 }], slopes: [run({ rotation })] });
    const result = compilePlan(plan, { prompt: 'A directional slope' });
    assert.equal(validateDesign(result).valid, true);
    const slopes = result.bricks.filter(brick => brick.partId === '3039');
    assert.equal(slopes.length, 2);
    assert.ok(slopes.every(brick => brick.rotation === rotation));
    const studs = slopes.flatMap(partTopStuds);
    const expected = rotation === 0 || rotation === 270 ? 1.5 : 0.5;
    assert.ok(studs.every(site => (sideways ? site.x : site.y) === expected));
  }
});

test('repeated box and slope motifs compile identically to explicit copies without mutating the source', () => {
  const feature = roof();
  const repeated = v2({ repeats: [{ boxes: feature.boxes, slopes: feature.slopes, count: 3, dx: 6, dy: 0, dz: 0 }] });
  const explicit = v2({
    boxes: [0, 6, 12].flatMap(dx => feature.boxes.map(box => ({ ...box, x: box.x + dx }))),
    slopes: [0, 6, 12].flatMap(dx => feature.slopes!.map(slope => ({ ...slope, x: slope.x + dx }))),
  });
  const before = JSON.stringify(repeated);
  const actual = compilePlan(repeated, { prompt: 'Three exact roof motifs' });
  const expected = compilePlan(explicit, { prompt: 'Three explicit roofs' });
  assert.deepEqual(actual.bricks, expected.bricks);
  assert.equal(actual.bricks.filter(brick => brick.partId === '3039').length, 12);
  assert.equal(JSON.stringify(repeated), before);
  const backwards = v2({ repeats: [{ boxes: feature.boxes.map(box => ({ ...box, x: box.x + 12 })), slopes: feature.slopes!.map(slope => ({ ...slope, x: slope.x + 12 })), count: 3, dx: -6, dy: 0, dz: 0 }] });
  assert.deepEqual(solidCells(compilePlan(backwards, { prompt: 'Reverse-order motifs' })), solidCells(expected));
});

test('repeat admission rejects nested, coincident, malformed, and out-of-workspace expansions before looping', () => {
  const feature = { boxes: roof().boxes, count: 2, dx: 6, dy: 0, dz: 0 };
  const invalid = [
    null, { ...feature, count: 0 }, { ...feature, count: 1.5 }, { ...feature, count: Number.MAX_SAFE_INTEGER },
    { ...feature, dx: 0 }, { ...feature, dx: 0.5 }, { ...feature, dx: -6 }, { ...feature, dx: 22 },
    { ...feature, repeats: [] }, { ...feature, boxes: [] }, { ...feature, boxes: null }, { ...feature, slopes: {} },
  ];
  for (const repeat of invalid) assert.throws(() => compilePlan(v2({ repeats: [repeat] as never }), { prompt: 'Invalid motif' }));
  assert.throws(() => compilePlan({ title: 'Old plan', description: 'Ambiguous repetition units.', boxes: [], repeats: [feature] }, { prompt: 'No implicit repeat units' }), /require a V2 plan/);
});

test('strict slope inventory rejects missing quantity or color instead of substituting a rectangular brick', () => {
  for (const inventory of [roofInventory.filter(item => item.partId !== '3039'), roofInventory.map(item => item.partId === '3039' ? { ...item, quantity: 3 } : item), roofInventory.map(item => item.partId === '3039' ? { ...item, colorId: 2 } : item), [...roofInventory.filter(item => item.partId !== '3039'), { partId: '3003', colorId: 4, quantity: 4, source: 'Wrong part' }]]) {
    assert.throws(() => compilePlan(roof(), { prompt: 'Use my slopes', inventory, ownedOnly: true }), /missing Red 3039/);
  }
});

test('new plans reject ambiguous units, invalid slope dimensions, and reserved-envelope overlaps', () => {
  const invalid: unknown[] = [
    { ...roof(), schemaVersion: undefined }, { ...roof(), coordinateSystem: undefined },
    { ...roof(), schemaVersion: 3 }, { ...roof(), coordinateSystem: 'full-brick' },
    { title: 'Legacy', description: 'Ambiguous slopes.', boxes: [], slopes: [] },
    v2(), v2({ slopes: null as unknown as SlopeRun[] }), v2({ slopes: [null as unknown as SlopeRun] }),
    ...[{ width: 3 }, { width: 0 }, { width: 26 }, { z: 70 }, { x: -1 }, { rotation: 45 }, { kind: 'wedge' }, { colorId: '4' }, { colorId: 999 }].map(value => v2({ slopes: [{ ...run(), ...value } as SlopeRun] })),
    v2({ boxes: [{ x: 0, y: 0, z: 3, width: 1, depth: 1, height: 1, colorId: 4 }], slopes: [run()] }),
    v2({ slopes: [run(), run({ rotation: 180 })] }),
  ];
  for (const value of invalid) assert.throws(() => compilePlan(value as ShapePlan, { prompt: 'Invalid new plan' }));
  assert.throws(() => compilePlan(v2({ slopes: [run({ width: 24, z: 0 })] }), { prompt: 'Too many slopes', maxBricks: 10 }), /10-brick budget/);
});

test('the curated lookout uses all three new parts around a hollow interior and an actual open doorway', () => {
  const design = BIRDHOUSE_SAMPLE;
  assert.equal(design.source, 'sample');
  assert.equal(design.schemaVersion, 2);
  const check = validateDesign(design);
  assert.equal(check.valid, true, check.errors.join('; '));
  assert.equal(design.bricks.length, 54);
  for (const partId of ['3020', '3022', '3039']) assert.ok(design.bricks.some(brick => brick.partId === partId));
  const cells = solidCells(design); // Roof envelopes do not affect the wall/interior probes below.
  for (let z = 4; z < 15; z++) for (let y = 2; y < 4; y++) for (let x = 2; x < 6; x++) assert.equal(cells.has(`${x},${y},${z}`), false, 'The enclosure is hollow, not a solid box');
  for (let z = 4; z < 9; z++) for (let x = 3; x < 5; x++) assert.equal(cells.has(`${x},4,${z}`), false, 'The front doorway is open above its plate doorstep');
  assert.ok(design.bricks.filter(brick => brick.partId === '3039').every(brick => brick.z === 16 || brick.z === 19));
  assert.equal(design.bricks.filter(brick => brick.partId === '3039').length, 16);
});

test('the frozen 1345-piece courtyard castle recompiles with identical shape, colors and roof slopes', () => {
  const design = COMPLEX_SAMPLE;
  assert.equal(design.source, 'sample');
  assert.equal(design.bricks.length, 1345);
  const check = validateDesign(design);
  assert.equal(check.valid, true, check.errors.join('; '));
  const recompiled = compilePlan(COMPLEX_PLAN, { prompt: design.prompt });
  assert.equal(validateDesign(recompiled).valid, true);
  assert.deepEqual(solidCells(recompiled), solidCells(design));
  const slopes = (model: Design) => model.bricks.filter(brick => brick.partId === '3039').map(({ id, ...placement }) => placement);
  assert.deepEqual(slopes(recompiled), slopes(design));
  const cells = solidCells(design);
  for (const x of [0, 18]) for (const y of [0, 18]) for (let floor = 4; floor <= 43; floor += 13) {
    for (let z = floor + 1; z < floor + 13; z++) assert.equal(cells.has(`${x + 1},${y + 1},${z}`), false, 'Tower rooms remain hollow between floors');
    for (let z = floor + 4; z < floor + 10; z++) for (const u of [2, 3]) {
      assert.equal(cells.has(`${x + u},${y},${z}`), false, 'North window remains open');
      assert.equal(cells.has(`${x + u},${y + 5},${z}`), false, 'South window remains open');
      assert.equal(cells.has(`${x},${y + u},${z}`), false, 'West window remains open');
      assert.equal(cells.has(`${x + 5},${y + u},${z}`), false, 'East window remains open');
    }
    assert.equal(cells.get(`${x + 1},${y + 1},${floor}`), 70, 'Every room has a real included floor');
    assert.equal(cells.get(`${x + 2},${y + 2},${floor + 4}`), 14, 'Each room includes its table top');
  }
  for (let z = 4; z < 19; z++) for (let x = 10; x < 14; x++) for (const y of [21, 22]) assert.equal(cells.has(`${x},${y},${z}`), false, 'The front gate is open');
  for (let z = 4; z < 34; z++) assert.equal(cells.has(`6,6,${z}`), false, 'Courtyard lanes remain empty');
  assert.equal(design.bricks.filter(brick => brick.partId === '3039').length, 72);
  for (const partId of ['3020', '3022', '3039']) assert.ok(design.bricks.some(brick => brick.partId === partId));
  const steps = buildSteps(design);
  assert.equal(new Set(steps.flatMap(step => step.bricks.map(brick => brick.id))).size, design.bricks.length);
  assert.ok(steps.every(step => step.bricks.length <= 12), 'Large builds retain readable assembly batches');
  const earlierStuds = new Set<string>();
  for (const step of steps) for (const brick of step.bricks) {
    if (brick.z > 0) assert.ok(partBottomSites(brick).some(site => earlierStuds.has(`${site.x},${site.y},${site.z}`)), `${brick.id} must connect to a piece already placed`);
    for (const stud of partTopStuds(brick)) earlierStuds.add(`${stud.x},${stud.y},${stud.z}`);
  }
  assert.equal(billOfMaterials(design).reduce((sum, row) => sum + row.quantity, 0), design.bricks.length);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePlan, type ShapeBox, type ShapePlanV2 } from '../server/compiler.js';
import { compileGeneratedPlan } from '../server/generation.js';
import { PARTS, allocateInventory, footprint, partHeight, validateDesign, type Design } from '../shared/model.js';
import { HOLLOW_ROOM_PLAN } from './fixtures/hollow-room-plan.js';

function brickCells(design: Design) {
  const cells = new Map<string, number>();
  for (const brick of design.bricks) {
    const { width, depth } = footprint(brick);
    for (let z = brick.z; z < brick.z + partHeight(brick); z++) for (let y = brick.y; y < brick.y + depth; y++) for (let x = brick.x; x < brick.x + width; x++) cells.set(`${x},${y},${z}`, brick.colorId);
  }
  return cells;
}

test('compact local cutouts retain the exact hollow room, windows, header and later furnishings', () => {
  // Independently authored positive wall segments describe the same room.
  const box = (x: number, y: number, z: number, width: number, depth: number, height: number): ShapeBox => ({ x, y, z, width, depth, height, colorId: 15 });
  const walls = [box(0, 0, 0, 12, 10, 6),
    box(0, 0, 6, 5, 1, 12), box(7, 0, 6, 5, 1, 12), box(5, 0, 12, 2, 1, 6),
    box(0, 9, 6, 5, 1, 12), box(7, 9, 6, 5, 1, 12), box(5, 9, 6, 2, 1, 3), box(5, 9, 12, 2, 1, 6),
    ...[0, 11].flatMap(x => [box(x, 1, 6, 1, 3, 12), box(x, 6, 6, 1, 3, 12), box(x, 4, 6, 1, 2, 3), box(x, 4, 12, 1, 2, 6)]),
  ];
  const positive = { ...HOLLOW_ROOM_PLAN, boxes: [...walls, ...HOLLOW_ROOM_PLAN.boxes.slice(1)] };
  const compact = compileGeneratedPlan(HOLLOW_ROOM_PLAN, { prompt: 'An architectural room with real openings and a furnished interior' });
  const cells = brickCells(compact);
  assert.deepEqual(cells, brickCells(compilePlan(positive, { prompt: 'The same explicit wall segments' })));
  assert.equal(cells.size, 1177);
  for (const empty of ['4,4,6', '5,0,6', '0,4,9', '11,4,9', '5,9,9']) assert.equal(cells.has(empty), false, `opening filled at ${empty}`);
  assert.equal(cells.get('5,0,12'), 15, 'the doorway retains its supported header');
  assert.equal(cells.get('2,2,5'), 15, 'the foundation is not carved');
  assert.equal(cells.get('2,2,6'), 70, 'the later table leg survives');
  assert.equal(cells.get('2,2,9'), 14, 'the supported plate tabletop survives');
  assert.equal(validateDesign(compact).valid, true);
  assert.ok(JSON.stringify(HOLLOW_ROOM_PLAN.boxes).length < JSON.stringify(positive.boxes).length * 0.6);
});

test('a cutout omits its own box contribution without erasing earlier boxes or changing later color order', () => {
  const [room, leg, top] = HOLLOW_ROOM_PLAN.boxes;
  const earlier = { ...HOLLOW_ROOM_PLAN, boxes: [leg, room, top] };
  const before = JSON.stringify(earlier);
  assert.deepEqual(brickCells(compilePlan(earlier, { prompt: 'Keep earlier interior furniture' })), brickCells(compilePlan(HOLLOW_ROOM_PLAN, { prompt: 'Keep later interior furniture' })));
  assert.equal(JSON.stringify(earlier), before);
  const repainted = compilePlan({ ...earlier, boxes: [...earlier.boxes, { ...leg, colorId: 4 }] }, { prompt: 'Repaint the existing table leg' });
  assert.equal(brickCells(repainted).get('2,2,6'), 4);
});

test('repeated parents carry unchanged local cutouts and match explicit translated rooms', () => {
  const repeated: ShapePlanV2 = { ...HOLLOW_ROOM_PLAN, boxes: [], repeats: [{ boxes: HOLLOW_ROOM_PLAN.boxes, count: 2, dx: 12, dy: 0, dz: 0 }] };
  const explicit = { ...HOLLOW_ROOM_PLAN, boxes: [...HOLLOW_ROOM_PLAN.boxes, ...HOLLOW_ROOM_PLAN.boxes.map(box => ({ ...box, x: box.x + 12 }))] };
  const before = JSON.stringify(repeated);
  const design = compileGeneratedPlan(repeated, { prompt: 'Two joined hollow rooms with openings and tables' });
  assert.deepEqual(brickCells(design), brickCells(compilePlan(explicit, { prompt: 'The same two rooms' })));
  const cells = brickCells(design);
  assert.equal(cells.has('5,0,6'), false);
  assert.equal(cells.has('17,0,6'), false);
  assert.equal(cells.get('14,2,9'), 14);
  assert.equal(JSON.stringify(repeated), before);
});

test('cutouts reject malformed or nonlocal bounds and ambiguous legacy units', () => {
  const cut = HOLLOW_ROOM_PLAN.boxes[0].cutouts![0];
  const malformed = [null, [], {}, { ...cut, x: -1 }, { ...cut, x: 0.5 }, { ...cut, z: Infinity }, { ...cut, depth: NaN },
    { ...cut, width: 0 }, { ...cut, height: -1 }, { ...cut, x: 3 }, { ...cut, y: 3 }, { ...cut, z: 7 }, { ...cut, cutouts: [] }];
  for (const value of malformed) {
    const plan = { ...HOLLOW_ROOM_PLAN, boxes: [{ ...HOLLOW_ROOM_PLAN.boxes[0], cutouts: [value] }] } as ShapePlanV2;
    assert.throws(() => compilePlan(plan, { prompt: 'Invalid cutout' }), /cutout/);
  }
  for (const cutouts of [null, {}, 'hole']) assert.throws(() => compilePlan({ ...HOLLOW_ROOM_PLAN, boxes: [{ ...HOLLOW_ROOM_PLAN.boxes[0], cutouts }] } as unknown as ShapePlanV2, { prompt: 'Invalid cuts array' }), /cutouts must be an array/);
  const legacy = { title: 'Ambiguous cuts', description: 'Legacy z cannot describe new plate-height cutouts.', boxes: [{ ...HOLLOW_ROOM_PLAN.boxes[0], height: 6 }] };
  assert.throws(() => compilePlan(legacy, { prompt: 'Ambiguous legacy units' }), /cutouts require a V2/);
});

test('cutouts leave slopes whole and slope envelopes still reject remaining box material', () => {
  const roof: ShapePlanV2 = { ...HOLLOW_ROOM_PLAN, boxes: [{ x: 0, y: 0, z: 0, width: 4, depth: 4, height: 9, colorId: 15,
    cutouts: [{ x: 0, y: 0, z: 6, width: 2, depth: 2, height: 3 }],
  }], slopes: [{ kind: 'upright45', x: 0, y: 0, z: 6, width: 2, rotation: 0, colorId: 4 }] };
  const design = compilePlan(roof, { prompt: 'A whole real slope in a box recess' });
  assert.equal(design.bricks.filter(brick => brick.partId === '3039').length, 1);
  assert.equal(validateDesign(design).valid, true);
  const shallowRecess = { ...roof, boxes: [{ ...roof.boxes[0], cutouts: [{ ...roof.boxes[0].cutouts![0], width: 1 }] }] };
  assert.throws(() => compilePlan(shallowRecess, { prompt: 'A cut cannot trim half of a slope' }), /slope envelope overlaps/);
});

test('cutout designs use only exact confirmed part quantities and colors in owned mode', () => {
  const design = compileGeneratedPlan(HOLLOW_ROOM_PLAN, { prompt: 'A hollow furnished room' });
  const inventory = Object.keys(PARTS).flatMap(partId => [15, 70, 14].filter(colorId => PARTS[partId].allowedColors.includes(colorId)).map(colorId => ({ partId, colorId, quantity: 200, source: 'Confirmed fixture collection' })));
  const owned = compileGeneratedPlan(HOLLOW_ROOM_PLAN, { prompt: 'The same room using only my parts', inventoryMode: 'owned', inventory });
  assert.equal(allocateInventory(owned, inventory).totalMissing, 0);
  assert.deepEqual(brickCells(owned), brickCells(design));
  assert.throws(() => compileGeneratedPlan(HOLLOW_ROOM_PLAN, { prompt: 'Unavailable tabletop color', inventoryMode: 'owned', inventory: inventory.map(item => item.colorId === 14 ? { ...item, quantity: 0 } : item) }), /Cannot pack color Yellow.*available inventory/);
});

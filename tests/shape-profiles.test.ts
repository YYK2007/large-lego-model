import test from 'node:test';
import assert from 'node:assert/strict';
import { expandProfile, translateProfile, type ProfileBox, type ShapeProfile } from '../server/shape-profiles.js';
import { compilePlan, type ShapePlanV2 } from '../server/compiler.js';
import { diagnosePlanSupport } from '../server/plan-diagnostics.js';
import { footprint, partHeight, validateDesign, allocateInventory, billOfMaterials, WORKSPACE } from '../shared/model.js';

const ellipse: ShapeProfile = { shape: 'ellipse', colorId: 15, sections: [
  { z: 0, cx: 8, cy: 8, width: 8, depth: 6 },
  { z: 9, cx: 8, cy: 8, width: 8, depth: 6 },
] };
function cells(expanded: ProfileBox[]) {
  const result = new Map<string, number>();
  for (const { box } of expanded) for (let z = box.z; z < box.z + box.height; z++) for (let y = box.y; y < box.y + box.depth; y++) for (let x = box.x; x < box.x + box.width; x++) {
    assert.equal(result.has(`${x},${y},${z}`), false, 'A profile must not emit overlapping row runs');
    result.set(`${x},${y},${z}`, box.colorId);
  }
  return result;
}
function plan(profiles: ShapeProfile[], boxes: ShapePlanV2['boxes'] = []): ShapePlanV2 {
  return { schemaVersion: 2, coordinateSystem: 'stud-xy-plate-z', title: 'Generic profile specimen', description: 'A deterministic shape-grammar test, not a generated subject.', boxes: [...profiles.flatMap(profile => expandProfile(profile).map(run => run.box)), ...boxes] };
}

test('elliptic cell centers match the analytic contour and reflect across both center axes', () => {
  const expanded = expandProfile(ellipse, '/profiles/3');
  const actual = cells(expanded);
  for (let z = 0; z < 9; z++) for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const expected = ((x + 0.5 - 8) / 4) ** 2 + ((y + 0.5 - 8) / 3) ** 2 <= 1;
    assert.equal(actual.has(`${x},${y},${z}`), expected);
    if (expected) {
      assert.ok(actual.has(`${15 - x},${y},${z}`));
      assert.ok(actual.has(`${x},${15 - y},${z}`));
    }
  }
  assert.equal(expanded.length, 6, 'Identical row runs merge vertically rather than creating a box for every plate');
  assert.ok(expanded.every(run => run.box.height === 9 && run.source.path === '/profiles/3' && run.source.sections.join(',') === '0,1'));
});

test('plate-z boundaries retain physical proportions and explicit section provenance', () => {
  const column: ShapeProfile = { shape: 'rectangle', colorId: 4, sections: [
    { z: 6, cx: 5, cy: 5, width: 4, depth: 4 },
    { z: 12, cx: 5, cy: 5, width: 4, depth: 4 },
    { z: 16, cx: 5, cy: 5, width: 4, depth: 4 },
  ] };
  const expanded = expandProfile(column);
  const occupied = [...cells(expanded).keys()].map(key => key.split(',').map(Number));
  assert.equal(occupied.length, 4 * 4 * 10);
  assert.equal(Math.min(...occupied.map(point => point[2])), 6);
  assert.equal(Math.max(...occupied.map(point => point[2])) + 1, 16);
  assert.equal(10 * 8 / (4 * 20), 1, 'Ten plates are physically as tall as four studs are wide, without unit rescaling');
  assert.deepEqual([...new Set(expanded.map(run => run.source.sections.join(',')))], ['0,1', '1,2']);
});

test('interpolated centers bend a contour without inventing arbitrary brick rotations or support', () => {
  const bent: ShapeProfile = { shape: 'rectangle', colorId: 4, sections: [
    { z: 0, cx: 2, cy: 2, width: 2, depth: 2 },
    { z: 6, cx: 4, cy: 2, width: 2, depth: 2 },
    { z: 12, cx: 2, cy: 4, width: 2, depth: 2 },
  ] };
  const occupied = cells(expandProfile(bent));
  for (let z = 0; z < 12; z++) {
    const i = z < 6 ? 0 : 1, a = bent.sections[i], b = bent.sections[i + 1], t = (z + 0.5 - a.z) / 6;
    const cx = a.cx + (b.cx - a.cx) * t, cy = a.cy + (b.cy - a.cy) * t;
    for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) assert.equal(occupied.has(`${x},${y},${z}`), x + 0.5 >= cx - 1 && x + 0.5 < cx + 1 && y + 0.5 >= cy - 1 && y + 0.5 < cy + 1);
  }
  const floating = translateProfile(ellipse, { x: 0, y: 0, z: 9 });
  const design = compilePlan(plan([floating]), { prompt: 'A floating specimen' });
  assert.equal(validateDesign(design).valid, false, 'Expansion never inserts a hidden pedestal');
  assert.ok(design.bricks.every(brick => brick.z >= 9));
});

test('hollow interiors omit only the profile material and preserve shell thickness', () => {
  for (const shape of ['ellipse', 'rectangle'] as const) {
    const hollow = { ...ellipse, shape, wall: 1 };
    const outer = cells(expandProfile({ ...hollow, wall: undefined }));
    const shell = cells(expandProfile(hollow));
    for (const [key] of outer) {
      const [x, y] = key.split(',').map(Number);
      const inner = shape === 'ellipse' ? ((x + 0.5 - 8) / 3) ** 2 + ((y + 0.5 - 8) / 2) ** 2 <= 1 : x + 0.5 >= 5 && x + 0.5 < 11 && y + 0.5 >= 6 && y + 0.5 < 10;
      assert.equal(shell.has(key), !inner);
    }
    assert.equal(shell.has('8,8,0'), false);
    assert.ok(shell.size < outer.size);
  }
  assert.equal(cells(expandProfile({ ...ellipse, wall: 8 })).size, cells(expandProfile(ellipse)).size, 'A wall thicker than the radius leaves a solid profile without negative inner dimensions');
});

test('terminal zero tips are sampled without filling missing cap cells or leaving the workspace', () => {
  const pointed: ShapeProfile = { shape: 'ellipse', colorId: 15, sections: [
    { z: 0, cx: 4.5, cy: 4.5, width: 0, depth: 0 },
    { z: 6, cx: 4.5, cy: 4.5, width: 5, depth: 5 },
    { z: 12, cx: 4.5, cy: 4.5, width: 0, depth: 0 },
  ] };
  const occupied = cells(expandProfile(pointed));
  assert.ok(occupied.has('4,4,0'));
  assert.ok(occupied.has('4,4,11'));
  assert.equal(occupied.has('3,3,0'), false);
  for (const key of occupied.keys()) {
    const [x, y, z] = key.split(',').map(Number);
    assert.ok(occupied.has(`${x},${y},${11 - z}`));
  }
  assert.throws(() => expandProfile({ ...pointed, sections: [pointed.sections[0], { ...pointed.sections[2], z: 1 }] }), /no occupied cells/);
});

test('five sections retain a hollow bulging contour and a tapered tip in a compact plan', () => {
  const bulb: ShapeProfile = { shape: 'ellipse', colorId: 15, wall: 2, sections: [
    { z: 6, cx: 12, cy: 12, width: 12, depth: 12 },
    { z: 12, cx: 12, cy: 12, width: 16, depth: 16 },
    { z: 20, cx: 12, cy: 12, width: 14, depth: 14 },
    { z: 29, cx: 12, cy: 12, width: 4, depth: 4 },
    { z: 34, cx: 12, cy: 12, width: 0, depth: 0 },
  ] };
  const expanded = expandProfile(bulb), occupied = cells(expanded);
  const widthAt = (z: number) => new Set([...occupied.keys()].filter(key => Number(key.split(',')[2]) === z).map(key => key.split(',')[0])).size;
  assert.ok(widthAt(12) > widthAt(6) && widthAt(12) > widthAt(25));
  assert.equal(occupied.has('12,12,6'), false, 'The open lower interior is not automatically filled');
  assert.equal(occupied.has('12,12,29'), true, 'The taper naturally becomes solid once no inner diameter remains');
  assert.equal(occupied.has('12,12,34'), false, 'No extra cap is added above the last boundary');
  assert.ok(JSON.stringify(expanded.map(run => run.box)).length > JSON.stringify(bulb).length * 10, 'The planner describes the contour, not hundreds of row boxes');
  assert.deepEqual([...new Set(expanded.map(run => run.source.sections.join(',')))], ['0,1', '1,2', '2,3', '3,4']);
});

test('translations preserve exact cells, colors, hollow interiors and caller data', () => {
  const original = { ...ellipse, wall: 1 };
  const before = JSON.stringify(original), offset = { x: 7, y: -3, z: 12 };
  const translated = translateProfile(original, offset);
  const shifted = cells(expandProfile(translated, '/repeats/1/profiles/0'));
  const expected = new Map([...cells(expandProfile(original))].map(([key, color]) => {
    const [x, y, z] = key.split(',').map(Number);
    return [`${x + offset.x},${y + offset.y},${z + offset.z}`, color];
  }));
  assert.deepEqual(shifted, expected);
  assert.equal(JSON.stringify(original), before);
  assert.notEqual(translated.sections[0], original.sections[0]);
  assert.throws(() => translateProfile(original, { x: 0.5, y: 0, z: 0 }), /integer/);
  assert.throws(() => translateProfile(original, { x: WORKSPACE.width, y: 0, z: 0 }), /workspace/);
});

test('ordinary compilation unions overlapping profiles and keeps detail colors and exact stock rules', () => {
  const raised = translateProfile(ellipse, { x: 0, y: 0, z: 6 });
  const expandedPlan = plan([raised, raised], [
    { x: 4, y: 5, z: 0, width: 8, depth: 6, height: 6, colorId: 15 },
    { x: 7, y: 7, z: 12, width: 2, depth: 2, height: 3, colorId: 4 },
  ]);
  const design = compilePlan(expandedPlan, { prompt: 'An elliptic column with a red center' });
  assert.equal(validateDesign(design).valid, true);
  const expected = cells(expandProfile(raised));
  for (let z = 0; z < 6; z++) for (let y = 5; y < 11; y++) for (let x = 4; x < 12; x++) expected.set(`${x},${y},${z}`, 15);
  for (let z = 12; z < 15; z++) for (let y = 7; y < 9; y++) for (let x = 7; x < 9; x++) expected.set(`${x},${y},${z}`, 4);
  const actual = new Map<string, number>();
  for (const brick of design.bricks) {
    const size = footprint(brick);
    for (let z = brick.z; z < brick.z + partHeight(brick); z++) for (let y = brick.y; y < brick.y + size.depth; y++) for (let x = brick.x; x < brick.x + size.width; x++) actual.set(`${x},${y},${z}`, brick.colorId);
  }
  assert.deepEqual(actual, expected);
  const inventory = billOfMaterials(design).map(item => ({ ...item, source: 'Test stock' }));
  assert.equal(allocateInventory(design, inventory).totalMissing, 0);
  assert.throws(() => compilePlan(expandedPlan, { prompt: 'No red stock', inventory: inventory.filter(item => item.colorId !== 4), ownedOnly: true }), /inventory|stock|owned|tile/i);
});

test('invalid coordinates, dimensions, bounds and nested profiles fail before rasterization', () => {
  const first = ellipse.sections[0], last = ellipse.sections[1];
  const invalid: unknown[] = [null, [], { ...ellipse, shape: 'spline' }, { ...ellipse, colorId: -100 }, { ...ellipse, wall: 0 }, { ...ellipse, wall: 0.5 }, { ...ellipse, wall: Infinity },
    { ...ellipse, sections: [] }, { ...ellipse, sections: [first] }, { ...ellipse, repeats: [] },
    ...[{ cx: '8' }, { cy: NaN }, { cx: 0.25 }, { cx: Number.MAX_SAFE_INTEGER }, { width: 1.5 }, { depth: Infinity }, { width: 0 }, { width: -1 }, { z: -1 }, { z: 0.5 }, { cx: 1 }, { cy: WORKSPACE.depth }, { sections: [] }].map(change => ({ ...ellipse, sections: [{ ...first, ...change }, last] })),
    { ...ellipse, sections: [first, { ...last, z: WORKSPACE.heightPlates + 1 }] },
    { ...ellipse, sections: [first, { ...last, z: 0 }] },
    { ...ellipse, sections: [first, { ...last, z: 4, width: 0, depth: 0 }, last] },
  ];
  for (const value of invalid) assert.throws(() => expandProfile(value as ShapeProfile, '/profiles/7'), /\/profiles\/7:/);
  const empty = { ...ellipse, sections: [{ z: 0, cx: 8, cy: 8, width: 1, depth: 1 }, { z: 1, cx: 8, cy: 8, width: 1, depth: 1 }] };
  assert.throws(() => expandProfile(empty), /no occupied cells/);
});

test('ellipse sectors keep exact quarter and wrapped angular cells, with full sweeps unchanged', () => {
  const full = cells(expandProfile(ellipse));
  const quarter = cells(expandProfile({ ...ellipse, arc: { startDegrees: 0, sweepDegrees: 90 } }));
  const wrapped = cells(expandProfile({ ...ellipse, arc: { startDegrees: 315, sweepDegrees: 90 } }));
  for (const key of full.keys()) {
    const [x, y] = key.split(',').map(Number), dx = x + 0.5 - 8, dy = y + 0.5 - 8;
    assert.equal(quarter.has(key), dx >= 0 && dy >= 0);
    assert.equal(wrapped.has(key), dx >= Math.abs(dy), 'The sector wraps through zero toward +Y, using actual XY angles rather than scaled ellipse coordinates');
  }
  assert.equal(quarter.size * 4, full.size);
  for (const startDegrees of [0, 12.5, 359.9]) assert.deepEqual(expandProfile({ ...ellipse, arc: { startDegrees, sweepDegrees: 360 } }), expandProfile(ellipse));
});

test('arc centers and radial boundaries remain included as the contour moves', () => {
  const moving: ShapeProfile = { shape: 'ellipse', colorId: 4, arc: { startDegrees: 90, sweepDegrees: 90 }, sections: [
    { z: 0, cx: 4, cy: 4, width: 4, depth: 4 },
    { z: 2, cx: 6, cy: 6, width: 4, depth: 4 },
  ] };
  const full = cells(expandProfile({ ...moving, arc: undefined })), sector = cells(expandProfile(moving));
  for (const key of full.keys()) {
    const [x, y, z] = key.split(',').map(Number), center = 4 + z + 0.5;
    assert.equal(sector.has(key), x + 0.5 <= center && y + 0.5 >= center);
  }
  assert.ok(sector.has('4,4,0') && sector.has('5,5,1'), 'The center belongs to every solid sector, where its polar angle is undefined');
});

test('hollow arc repeats preserve empty gaps, real-part cells, exact inventory and source attribution', () => {
  const petal = translateProfile({ ...ellipse, wall: 1, arc: { startDegrees: 0, sweepDegrees: 90 } }, { x: 0, y: 0, z: 6 });
  const before = JSON.stringify(petal), shifted = translateProfile(petal, { x: 12, y: 0, z: 0 });
  assert.deepEqual(shifted.arc, petal.arc);
  assert.equal(JSON.stringify(petal), before);
  const specimen: ShapePlanV2 = { ...plan([]), boxes: [{ x: 4, y: 5, z: 0, width: 20, depth: 6, height: 6, colorId: 15 }],
    repeats: [{ profiles: [petal], count: 2, dx: 12, dy: 0, dz: 0 }] };
  const design = compilePlan(specimen, { prompt: 'Two separated curved shell segments on a connected base' });
  assert.equal(validateDesign(design).valid, true);
  const expected = new Map([...cells(expandProfile(petal)), ...cells(expandProfile(shifted))]);
  for (let z = 0; z < 6; z++) for (let y = 5; y < 11; y++) for (let x = 4; x < 24; x++) expected.set(`${x},${y},${z}`, 15);
  const actual = new Map<string, number>();
  for (const brick of design.bricks) {
    const size = footprint(brick);
    for (let z = brick.z; z < brick.z + partHeight(brick); z++) for (let y = brick.y; y < brick.y + size.depth; y++) for (let x = brick.x; x < brick.x + size.width; x++) {
      assert.equal(actual.has(`${x},${y},${z}`), false);
      actual.set(`${x},${y},${z}`, brick.colorId);
    }
  }
  assert.deepEqual(actual, expected);
  assert.equal(actual.has('8,8,6'), false, 'The inner cup is not filled');
  assert.equal(actual.has('7,10,6'), false, 'The unselected angular region stays empty');
  const inventory = [{ partId: '3024', colorId: 15, quantity: expected.size, source: 'Exact voxel stock' }];
  const owned = compilePlan(specimen, { prompt: 'The same exact shape using owned plates', inventory, ownedOnly: true });
  assert.equal(owned.bricks.length, expected.size);
  assert.equal(allocateInventory(owned, inventory).totalMissing, 0);
  assert.throws(() => compilePlan(specimen, { prompt: 'Insufficient owned plates', inventory: [{ ...inventory[0], quantity: expected.size - 1 }], ownedOnly: true }), /inventory|stock|owned|tile/i);
  const floating = { ...specimen, boxes: [] }, disconnected = compilePlan(floating, { prompt: 'Diagnostic-only floating sectors' });
  assert.equal(validateDesign(disconnected).valid, false, 'An angular profile does not add support');
  const sources = diagnosePlanSupport(floating, disconnected).groups.flatMap(group => group.sources);
  for (const copy of [0, 1]) assert.ok(sources.some(source => source.path === '/repeats/0/profiles/0' && source.copy === copy && source.sections?.join(',') === '0,1'));
});

test('invalid or empty angular sectors reject before admitting profile geometry', () => {
  const invalid = [null, [], {}, { startDegrees: '0', sweepDegrees: 90 }, { startDegrees: NaN, sweepDegrees: 90 },
    { startDegrees: -1, sweepDegrees: 90 }, { startDegrees: 360, sweepDegrees: 90 }, { startDegrees: 361, sweepDegrees: 90 }, { startDegrees: Infinity, sweepDegrees: 90 },
    { startDegrees: 0, sweepDegrees: 0 }, { startDegrees: 0, sweepDegrees: -1 }, { startDegrees: 0, sweepDegrees: 361 },
    { startDegrees: 0, sweepDegrees: NaN }, { startDegrees: 0, sweepDegrees: Infinity }];
  for (const arc of invalid) assert.throws(() => expandProfile({ ...ellipse, arc } as ShapeProfile, '/profiles/7'), /\/profiles\/7: An ellipse arc/);
  assert.throws(() => expandProfile({ ...ellipse, shape: 'rectangle', arc: { startDegrees: 0, sweepDegrees: 90 } }), /ellipse arc/);
  assert.throws(() => expandProfile({ ...ellipse, arc: { startDegrees: 0, sweepDegrees: 0.001 } }), /no occupied cells/);
});

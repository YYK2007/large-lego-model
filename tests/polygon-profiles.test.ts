import test from 'node:test';
import assert from 'node:assert/strict';
import { expandProfile, translateProfile, type ProfileBox, type ShapeProfile, type ProfilePoint } from '../server/shape-profiles.js';
import { compilePlan, type ShapePlanV2 } from '../server/compiler.js';
import { diagnosePlanSupport } from '../server/plan-diagnostics.js';
import { footprint, partHeight, validateDesign, allocateInventory, WORKSPACE } from '../shared/model.js';

const square = [{ u: -1, v: -1 }, { u: 1, v: -1 }, { u: 1, v: 1 }, { u: -1, v: 1 }];
const outline = [{ u: -1, v: -1 }, { u: 1, v: -1 }, { u: 1, v: 0 }, { u: 0, v: 0 }, { u: 0, v: 1 }, { u: -1, v: 1 }];
const specimen: ShapeProfile = { shape: 'polygon', outline, colorId: 15, sections: [
  { z: 0, cx: 8, cy: 8, width: 8, depth: 8 },
  { z: 6, cx: 8, cy: 8, width: 8, depth: 8 },
] };
function cells(rows: ProfileBox[]) {
  const result = new Map<string, number>();
  for (const { box } of rows) for (let z = box.z; z < box.z + box.height; z++) for (let y = box.y; y < box.y + box.depth; y++) for (let x = box.x; x < box.x + box.width; x++) {
    const key = `${x},${y},${z}`;
    assert.equal(result.has(key), false, 'Profile row runs cannot overlap');
    result.set(key, box.colorId);
  }
  return result;
}

function compiledCells(design: ReturnType<typeof compilePlan>) {
  const actual = new Map<string, number>();
  for (const brick of design.bricks) {
    const size = footprint(brick);
    for (let z = brick.z; z < brick.z + partHeight(brick); z++) for (let y = brick.y; y < brick.y + size.depth; y++) for (let x = brick.x; x < brick.x + size.width; x++) {
      const key = `${x},${y},${z}`;
      assert.equal(actual.has(key), false, 'Compiled pieces cannot overlap');
      actual.set(key, brick.colorId);
    }
  }
  return actual;
}

test('concave polygon emits the exact asymmetric cell contour instead of a bounding rectangle', () => {
  const actual = cells(expandProfile(specimen));
  assert.equal(actual.size, 48 * 6);
  for (let z = 0; z < 6; z++) for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    assert.equal(actual.has(`${x},${y},${z}`), x >= 4 && x < 12 && y >= 4 && y < 12 && (x < 8 || y < 8));
  }
  assert.deepEqual(cells(expandProfile({ ...specimen, outline: [...outline].reverse() })), actual, 'Vertex winding cannot change material');
});

test('polygon rectangle matches existing rectangle sampling including half-stud edge ties', () => {
  for (const cx of [8, 8.5]) for (const cy of [8, 8.5]) for (const width of [5, 6]) for (const depth of [5, 6]) {
    const sections = [{ z: 0, cx, cy, width, depth }, { z: 3, cx, cy, width, depth }];
    assert.deepEqual(cells(expandProfile({ ...specimen, outline: square, sections })), cells(expandProfile({ shape: 'rectangle', colorId: 15, sections })));
  }
});

test('a concave loft interpolates actual stud/plate coordinates, with tips and section provenance', () => {
  const loft = { ...specimen, sections: [specimen.sections[0], { z: 6, cx: 9, cy: 7, width: 4, depth: 6 }, { z: 12, cx: 9.5, cy: 7.5, width: 0, depth: 0 }] };
  const rows = expandProfile(loft, '/profiles/4'), actual = cells(rows);
  for (let z = 0; z < 12; z++) {
    const a = loft.sections[z < 6 ? 0 : 1], b = loft.sections[z < 6 ? 1 : 2], t = (z + 0.5 - a.z) / (b.z - a.z);
    const cx = a.cx + (b.cx - a.cx) * t, cy = a.cy + (b.cy - a.cy) * t;
    const width = a.width + (b.width - a.width) * t, depth = a.depth + (b.depth - a.depth) * t;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const px = x + 0.5, py = y + 0.5;
      const expected = px >= cx - width / 2 && px < cx + width / 2 && py >= cy - depth / 2 && py < cy + depth / 2 && (px < cx || py < cy);
      assert.equal(actual.has(`${x},${y},${z}`), expected, `cell ${x},${y},${z}`);
    }
  }
  assert.ok(rows.every(row => row.source.path === '/profiles/4'));
  assert.deepEqual([...new Set(rows.map(row => row.source.sections.join(',')))], ['0,1', '1,2']);
  assert.ok([...actual.keys()].every(key => Number(key.split(',')[2]) < 12), 'A terminal tip adds no extra cap');
});

test('polygon walls use physical horizontal distance and keep open interiors and concave notches', () => {
  const shell = cells(expandProfile({ ...specimen, wall: 1 }));
  assert.ok(shell.has('4,6,0'));
  assert.ok(shell.has('7,7,0'), 'The reentrant corner lies within one stud of the inner boundary');
  assert.equal(shell.has('5,5,0'), false);
  assert.equal(shell.has('9,9,0'), false, 'The original notch remains empty');
  const stretched = { ...specimen, outline: square, wall: 1, sections: [{ z: 0, cx: 8, cy: 8, width: 12, depth: 4 }, { z: 3, cx: 8, cy: 8, width: 12, depth: 4 }] };
  assert.deepEqual(cells(expandProfile(stretched)), cells(expandProfile({ ...stretched, shape: 'rectangle', outline: undefined })), 'Wall thickness is in studs, not normalized coordinate space');
  assert.deepEqual(cells(expandProfile({ ...specimen, wall: 20 })), cells(expandProfile(specimen)));
});

test('translation preserves polygon cells and shell shape without aliasing the input outline', () => {
  const source = { ...specimen, wall: 1 }, before = JSON.stringify(source), offset = { x: 9, y: -2, z: 12 };
  const moved = translateProfile(source, offset);
  const expected = new Map([...cells(expandProfile(source))].map(([key, color]) => {
    const [x, y, z] = key.split(',').map(Number);
    return [`${x + offset.x},${y + offset.y},${z + offset.z}`, color];
  }));
  assert.deepEqual(cells(expandProfile(moved)), expected);
  assert.equal(JSON.stringify(source), before);
  assert.notEqual(moved.outline![0], source.outline![0]);
});

test('slanted boundaries retain half-open cell ties after integer translations', () => {
  for (const u of [-1, -0.4, -0.2, 0.4, 0.7]) for (const width of [7, 11, 13]) {
    const profile: ShapeProfile = { ...specimen, outline: [{ u: -1, v: -1 }, { u: 1, v: -1 }, { u, v: 1 }], sections: [
      { z: 0, cx: 12.5, cy: 12, width, depth: 13 },
      { z: 9, cx: 15, cy: 13.5, width: width - 2, depth: 7 },
    ] };
    const expected = new Map([...cells(expandProfile(profile))].map(([key, color]) => {
      const [x, y, z] = key.split(',').map(Number);
      return [`${x + 23},${y + 17},${z}`, color];
    }));
    assert.deepEqual(cells(expandProfile(translateProfile(profile, { x: 23, y: 17, z: 0 }))), expected);
  }
});

test('an outline inside its coordinate frame retains its exact shape without forced stretching', () => {
  const sections = [{ z: 0, cx: 8, cy: 8, width: 8, depth: 8 }, { z: 12, cx: 8, cy: 8, width: 8, depth: 8 }];
  const inset = { ...specimen, outline: square.map(point => ({ ...point, u: point.u / 2 })), sections };
  const expected = { shape: 'rectangle' as const, colorId: specimen.colorId, sections: sections.map(section => ({ ...section, width: 4 })) };
  assert.deepEqual(cells(expandProfile(inset)), cells(expandProfile(expected)));
  const plan: ShapePlanV2 = { schemaVersion: 2, coordinateSystem: 'stud-xy-plate-z', title: 'Inset contour', description: 'Exact coordinates within a larger frame.', boxes: [], profiles: [inset] };
  const design = compilePlan(plan, { prompt: 'Inset contour' });
  assert.equal(validateDesign(design).valid, true);
  assert.deepEqual(compiledCells(design), cells(expandProfile(expected)));
});

test('polygon outline rejects malformed, crossing, overlapping, touching and degenerate boundaries', () => {
  const points = (values: number[][]): ProfilePoint[] => values.map(([u, v]) => ({ u, v }));
  const invalid: unknown[] = [undefined, null, [], square.slice(0, 2), [...square, square[0]],
    square.map((point, i) => i === 0 ? { u: NaN, v: -1 } : point),
    square.map((point, i) => i === 0 ? { u: -Infinity, v: -1 } : point),
    square.map((point, i) => i === 0 ? { u: '-1', v: -1 } : point),
    square.map(point => ({ ...point, u: point.u * 2 })),
    points([[-1, -1], [0, 0], [1, 1]]),
    points([[-1, -1], [1, 1], [-1, 1], [1, -1]]),
    points([[-1, -1], [1, 1], [-1, 1], [1, -0.5], [1, -1]]),
    points([[-1, -1], [1, -1], [0, -1], [1, 1], [-1, 1]]),
    points([[-1, -1], [1, -1], [1, 1], [0, -1], [-1, 1]]),
    Array.from({ length: 33 }, (_, i) => ({ u: Math.cos(i * Math.PI / 16), v: Math.sin(i * Math.PI / 16) })),
  ];
  for (const outline of invalid) assert.throws(() => expandProfile({ ...specimen, outline } as ShapeProfile, '/profiles/9'), /\/profiles\/9:.*outline/);
  assert.throws(() => expandProfile({ ...specimen, arc: { startDegrees: 0, sweepDegrees: 90 } }), /ellipse arc/);
  assert.throws(() => expandProfile({ ...specimen, shape: 'ellipse' }), /Only polygon/);
  assert.throws(() => translateProfile(specimen, { x: WORKSPACE.width, y: 0, z: 0 }), /workspace/);
});

test('a shifted concave taper compiles as a connected build with exactly the requested colored cells', () => {
  const profile: ShapeProfile = { ...specimen, sections: [
    { z: 6, cx: 8, cy: 8, width: 8, depth: 8 },
    { z: 18, cx: 8.5, cy: 7.5, width: 4, depth: 4 },
    { z: 21, cx: 8.5, cy: 7.5, width: 0, depth: 0 },
  ] };
  const base = { x: 4, y: 4, z: 0, width: 8, depth: 8, height: 6, colorId: 15 };
  const plan: ShapePlanV2 = { schemaVersion: 2, coordinateSystem: 'stud-xy-plate-z', title: 'Tapered contour specimen', description: 'A deterministic asymmetric loft fixture.', boxes: [base], profiles: [profile] };
  const design = compilePlan(plan, { prompt: 'A shifting concave taper with a supported pointed end' });
  assert.equal(validateDesign(design).valid, true, JSON.stringify(validateDesign(design).errors));
  const expected = cells(expandProfile(profile));
  for (let z = 0; z < 6; z++) for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) expected.set(`${x},${y},${z}`, 15);
  assert.deepEqual(compiledCells(design), expected);
});

test('repeated hollow polygons compile to exact real-part cells with later details and binding inventory', () => {
  const raised = translateProfile({ ...specimen, wall: 1 }, { x: 0, y: 0, z: 6 });
  const shifted = translateProfile(raised, { x: 12, y: 0, z: 0 });
  const base = { x: 4, y: 4, z: 0, width: 20, depth: 8, height: 6, colorId: 15 };
  const detail = { x: 6, y: 5, z: 6, width: 1, depth: 1, height: 3, colorId: 4 };
  const plan: ShapePlanV2 = { schemaVersion: 2, coordinateSystem: 'stud-xy-plate-z', title: 'Concave shell specimen', description: 'Deterministic grammar fixture, not an AI-generated subject.', boxes: [base, detail], repeats: [{ profiles: [raised], count: 2, dx: 12, dy: 0, dz: 0 }] };
  const design = compilePlan(plan, { prompt: 'Two asymmetric shells on a connected plinth' });
  assert.equal(validateDesign(design).valid, true, JSON.stringify(validateDesign(design).errors));
  const expected = new Map([...cells(expandProfile(raised)), ...cells(expandProfile(shifted))]);
  for (const box of [base, detail]) for (let z = box.z; z < box.z + box.height; z++) for (let y = box.y; y < box.y + box.depth; y++) for (let x = box.x; x < box.x + box.width; x++) expected.set(`${x},${y},${z}`, box.colorId);
  assert.deepEqual(compiledCells(design), expected);
  assert.equal(expected.has('5,5,6'), false, 'No fill is added to an open interior');
  assert.equal(expected.has('9,9,6'), false, 'The asymmetric exterior notch stays empty');
  const quantities = new Map<number, number>();
  for (const color of expected.values()) quantities.set(color, (quantities.get(color) || 0) + 1);
  const inventory = [...quantities].map(([colorId, quantity]) => ({ partId: '3024', colorId, quantity, source: 'Checked fixture stock' }));
  const owned = compilePlan(plan, { prompt: 'The same contour using only the stated real plates', inventory, ownedOnly: true });
  assert.deepEqual(compiledCells(owned), expected);
  assert.equal(allocateInventory(owned, inventory).totalMissing, 0);
  assert.throws(() => compilePlan(plan, { prompt: 'The same contour without its red plates', inventory: inventory.filter(item => item.colorId !== 4), ownedOnly: true }), /stock|inventory|owned|tile/i);
});

test('polygon diagnostics retain repeated source and section paths without adding support or filling holes', () => {
  const unsupported = translateProfile({ ...specimen, wall: 1 }, { x: 0, y: 0, z: 9 });
  const plan: ShapePlanV2 = { schemaVersion: 2, coordinateSystem: 'stud-xy-plate-z', title: 'Floating contour fixture', description: 'Intentionally invalid geometry for source attribution.', boxes: [], repeats: [{ profiles: [unsupported], count: 2, dx: 12, dy: 0, dz: 0 }] };
  const design = compilePlan(plan, { prompt: 'Intentionally unsupported polygons' });
  assert.equal(validateDesign(design).valid, false);
  assert.ok(design.bricks.every(brick => brick.z >= 9));
  const sources = diagnosePlanSupport(plan, design).groups.flatMap(group => group.sources);
  for (const copy of [0, 1]) assert.ok(sources.some(source => source.path === '/repeats/0/profiles/0' && source.copy === copy && source.sections?.join(',') === '0,1'));
});

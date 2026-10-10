import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeDesign, validateDesign, partTopStuds, exportLDraw, billOfMaterials, type Brick, type Design } from '../shared/model.js';
import { ROOF_SAMPLE } from '../shared/roof-sample.js';

const brick = (id: string, changes: Partial<Brick> = {}): Brick => ({ id, partId: '3003', colorId: 4, x: 0, y: 0, z: 0, rotation: 0, ...changes });
const design = (bricks: Brick[]): Design => ({ ...ROOF_SAMPLE, bricks });

test('three plates reach the same supported height as one brick', () => {
  const stacked = design([0, 1, 2].map(z => brick(`plate-${z}`, { partId: '3022', z })));
  stacked.bricks.push(brick('upper', { z: 3 }));
  assert.equal(validateDesign(stacked).valid, true);
  assert.deepEqual(partTopStuds(stacked.bricks[2]), partTopStuds(brick('full')));
  stacked.bricks[2].z = 1;
  assert.equal(validateDesign(stacked).valid, false, 'overlapping plates must not count as a stack');
});

test('every slope orientation supports only its high stud row', () => {
  for (const rotation of [0, 90, 180, 270] as const) {
    const slope = brick('slope', { partId: '3039', rotation });
    const studs = partTopStuds(slope);
    assert.equal(studs.length, 2);
    for (const [x, y] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
      const upper = brick('upper', { partId: '3005', x, y, z: 3 });
      const expected = studs.some(stud => stud.x === x + 0.5 && stud.y === y + 0.5);
      assert.equal(validateDesign(design([slope, upper])).valid, expected, `${rotation} degrees at ${x},${y}`);
    }
  }
});

test('legacy conversion is repeatable, preserves physical LDraw positions and rejects ambiguous versions', () => {
  const legacy = design([brick('base'), brick('upper', { z: 1 })]);
  delete legacy.schemaVersion;
  delete legacy.coordinateSystem;
  delete legacy.catalogVersion;
  const original = structuredClone(legacy);
  const converted = normalizeDesign(legacy);
  assert.deepEqual(converted.bricks.map(item => item.z), [0, 3]);
  assert.deepEqual(normalizeDesign(converted), converted);
  assert.deepEqual(legacy, original);
  assert.equal(exportLDraw(legacy), exportLDraw(converted));
  for (const metadata of [{ schemaVersion: 1 }, { coordinateSystem: 'stud-xy-plate-z' }, { schemaVersion: 2, catalogVersion: 'unknown' }]) {
    assert.equal(validateDesign({ ...legacy, ...metadata } as Design).valid, false);
  }
});

test('height bounds include body height and the roof retains its exact real-parts BOM', () => {
  assert.equal(validateDesign(design(Array.from({ length: 24 }, (_, i) => brick(`layer-${i}`, { z: i * 3 })))).valid, true);
  const tooTall = Array.from({ length: 24 }, (_, i) => brick(`layer-${i}`, { z: i * 3 }));
  tooTall.push(brick('overflow', { partId: '3022', z: 72 }));
  assert.equal(validateDesign(design(tooTall)).valid, false);
  assert.equal(validateDesign(ROOF_SAMPLE).valid, true);
  assert.deepEqual(Object.fromEntries(billOfMaterials(ROOF_SAMPLE).map(item => [`${item.partId}:${item.colorId}`, item.quantity])), { '3001:71': 2, '3020:15': 3, '3022:15': 4, '3039:4': 4 });
});

test('thousands of connected pieces validate without a piece-count ceiling', () => {
  const pieces: Brick[] = [];
  for (const z of [0, 3, 6, 9]) {
    const vertical = z >= 6, offset = z === 3 || z === 9;
    for (let row = 0; row < 24; row++) {
      for (let col = 0; col < 24;) {
        const single = offset && (col === 0 || col === 23);
        pieces.push(brick(`bond-${z}-${row}-${col}`, { partId: single ? '3005' : '3004', x: vertical ? row : col, y: vertical ? col : row, z, rotation: vertical ? 0 : 90 }));
        col += single ? 1 : 2;
      }
    }
  }
  for (const z of [12, 15]) for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) pieces.push(brick(`detail-${x}-${y}-${z}`, { partId: '3005', x, y, z }));
  assert.equal(pieces.length, 2352);
  const checked = validateDesign(design(pieces));
  assert.equal(checked.valid, true, checked.errors.join('; '));
  assert.equal(billOfMaterials(design(pieces)).reduce((total, row) => total + row.quantity, 0), 2352);
  const overlapping = [...pieces, brick('duplicate-volume', { x: 0, y: 0, z: 6 })];
  assert.match(validateDesign(design(overlapping)).errors.join(' '), /overlap/);
});

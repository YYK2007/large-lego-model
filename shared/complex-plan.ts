import type { ShapeBox, ShapePlanV2, ShapeRepeat, SlopeRun } from '../server/compiler';

// Curated architectural source, compiled by the same pipeline as generated plans.
const boxes: ShapeBox[] = [{ x: 0, y: 0, z: 0, width: 24, depth: 24, height: 4, colorId: 2 }];
const slopes: SlopeRun[] = [];
const repeats: ShapeRepeat[] = [];
const box = (target: ShapeBox[], x: number, y: number, z: number, width: number, depth: number, height: number, colorId: number) =>
  target.push({ x, y, z, width, depth, height, colorId });

function room(x: number, y: number, width: number, depth: number, floor: number): ShapeBox[] {
  const result: ShapeBox[] = [];
  box(result, x, y, floor, width, depth, 1, 70);
  const z = floor + 1;
  for (const u of [0, width - 1]) for (const v of [0, depth - 1]) box(result, x + u, y + v, z, 1, 1, 12, 15);
  // Each facade has two full-height piers, a sill and a lintel around its open window.
  for (const v of [0, depth - 1]) {
    for (const u of [1, width / 2 + 1]) box(result, x + u, y + v, z, width / 2 - 2, 1, 12, 71);
    for (const level of [z, z + 9]) box(result, x + width / 2 - 1, y + v, level, 2, 1, 3, 71);
  }
  for (const u of [0, width - 1]) {
    for (const v of [1, depth / 2 + 1]) box(result, x + u, y + v, z, 1, depth / 2 - 2, 12, 71);
    for (const level of [z, z + 9]) box(result, x + u, y + depth / 2 - 1, level, 1, 2, 3, 71);
  }
  // A small table inside each room makes the internal floors useful to inspect.
  box(result, x + 2, y + 2, floor + 1, 1, 1, 3, 70);
  box(result, x + 2, y + 2, floor + 4, 2, 2, 1, 14);
  return result;
}

function roof(x: number, y: number, width: number, depth: number, z: number) {
  box(boxes, x, y, z, width, depth, 1, 15);
  for (let inset = 0; inset < depth / 2 - 1; inset++) {
    const level = z + 1 + inset * 3;
    slopes.push({ kind: 'upright45', x, y: y + inset, z: level, width, rotation: 0, colorId: 4 });
    slopes.push({ kind: 'upright45', x, y: y + depth - 2 - inset, z: level, width, rotation: 180, colorId: 4 });
    const middleDepth = depth - 4 - inset * 2;
    if (middleDepth > 0) box(boxes, x, y + inset + 2, level, width, middleDepth, 3, 4);
  }
  box(boxes, x, y + depth / 2 - 1, z + 1 + (depth / 2 - 1) * 3, width, 2, 1, 4);
}

for (const x of [0, 18]) for (const y of [0, 18]) {
  repeats.push({ boxes: room(x, y, 6, 6, 4), count: 4, dx: 0, dy: 0, dz: 13 });
  roof(x, y, 6, 6, 56);
  // Each corner tower has a small contrasting rooftop finial.
  box(boxes, x + 2, y + 2, 64, 2, 2, 6, 14);
}

// A three-storey central keep is separated from the towers by open courtyard lanes.
repeats.push({ boxes: room(8, 8, 8, 8, 4), count: 3, dx: 0, dy: 0, dz: 13 });
roof(8, 8, 8, 8, 43);

// Four curtain walls: narrow window slits and an actual open front gate.
for (let course = 0; course < 10; course++) {
  const segments = (front: boolean) => {
    const result: [number, number][] = [];
    let start = -1;
    for (let position = 0; position <= 12; position++) {
      const gap = position === 12 || (course >= 2 && course <= 4 && [2, 6, 9].includes(position)) ||
        (front && course < 5 && position >= 4 && position < 8);
      if (gap && start >= 0) { result.push([start, position - start]); start = -1; }
      if (!gap && start < 0) start = position;
    }
    return result;
  };
  const color = course === 5 || course === 9 ? 15 : 71;
  for (const [position, length] of segments(false)) {
    box(boxes, 6 + position, 1, 4 + course * 3, length, 2, 3, color);
    box(boxes, 1, 6 + position, 4 + course * 3, 2, length, 3, color);
    box(boxes, 21, 6 + position, 4 + course * 3, 2, length, 3, color);
  }
  for (const [position, length] of segments(true)) box(boxes, 6 + position, 21, 4 + course * 3, length, 2, 3, color);
}
// Parapets leave visible gaps instead of filling the courtyard with extra volume.
for (const position of [6, 10, 14]) {
  box(boxes, position, 1, 34, 2, 2, 3, 15);
  box(boxes, position, 21, 34, 2, 2, 3, 15);
  box(boxes, 1, position, 34, 2, 2, 3, 15);
  box(boxes, 21, position, 34, 2, 2, 3, 15);
}

export const COMPLEX_PLAN: ShapePlanV2 = {
  schemaVersion: 2, coordinateSystem: 'stud-xy-plate-z', title: 'Courtyard castle',
  description: 'A curated castle with four hollow four-storey towers, a three-storey keep, furnished rooms, open windows, a front gate, courtyard lanes, and five real sloped roofs. Geometric checks do not establish physical stability.',
  boxes, slopes, repeats,
};

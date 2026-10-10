import type { ShapePlanV2 } from '../../server/compiler.js';

// Curated compiler fixture, not a live AI-generated design or a fallback sample.
export const HOLLOW_ROOM_PLAN: ShapePlanV2 = {
  schemaVersion: 2, coordinateSystem: 'stud-xy-plate-z',
  title: 'Hollow room fixture', description: 'An open-topped room with a doorway, three windows, a joined floor and a small table.',
  boxes: [
    { x: 0, y: 0, z: 0, width: 12, depth: 10, height: 18, colorId: 15, cutouts: [
      { x: 1, y: 1, z: 6, width: 10, depth: 8, height: 12 },
      { x: 5, y: 0, z: 6, width: 2, depth: 1, height: 6 },
      { x: 0, y: 4, z: 9, width: 1, depth: 2, height: 3 },
      { x: 11, y: 4, z: 9, width: 1, depth: 2, height: 3 },
      { x: 5, y: 9, z: 9, width: 2, depth: 1, height: 3 },
    ] },
    { x: 2, y: 2, z: 6, width: 1, depth: 1, height: 3, colorId: 70 },
    { x: 2, y: 2, z: 9, width: 2, depth: 2, height: 1, colorId: 14 },
  ], slopes: [],
};

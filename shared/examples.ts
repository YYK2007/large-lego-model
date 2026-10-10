import type { Brick, Design } from './model.js';
import { ROCKET_SAMPLE } from './rocket-sample.js';

function sample(id: string, title: string, description: string, draw: (row: (x: number, z: number, segments: [number, number][], y?: number) => void, add: (partId: string, colorId: number, x: number, y: number, z: number, rotation?: 0 | 90) => void) => void): Design {
  const bricks: Brick[] = [];
  const add = (partId: string, colorId: number, x: number, y: number, z: number, rotation: 0 | 90 = 0) => {
    bricks.push({ id: `${id}-${bricks.length + 1}`, partId, colorId, x, y, z, rotation });
  };
  const row = (x: number, z: number, segments: [number, number][], y = 10) => {
    for (const [width, color] of segments) {
      let left = width;
      while (left > 0) {
        const length = Math.min(left, 3);
        add(length === 3 ? '3002' : length === 2 ? '3003' : '3004', color, x, y, z, length === 3 ? 90 : 0);
        x += length;
        left -= length;
      }
    }
  };
  // A two-layer plinth: the second layer overlaps the seams and joins all ground bricks.
  for (let x = 7; x < 17; x += 2) add('3001', 71, x, 9, 0);
  row(7, 1, [[3, 71], [2, 71], [2, 71], [3, 71]], 9);
  row(7, 1, [[3, 71], [2, 71], [2, 71], [3, 71]], 11);
  draw(row, add);
  return {
    id, title, description, bricks, source: 'sample',
    prompt: `Sample design: ${title}. ${description}`,
    createdAt: '2026-10-10T12:00:00.000Z',
  };
}

const flower = sample('sample-flower', 'Sunshine bloom', 'A standing pixel flower with red petals, a sunny center, two leaves, and a broad brick plinth. A curated sample, not an AI-generated result.', (row) => {
  row(11, 2, [[2, 2]]);
  row(11, 3, [[2, 2]]);
  row(9, 4, [[4, 2]]);
  row(11, 5, [[1, 2], [3, 2]]);
  row(11, 6, [[2, 2]]);
  row(11, 7, [[2, 2]]);
  row(9, 8, [[6, 4]]);
  row(8, 9, [[3, 4], [2, 14], [3, 4]]);
  row(7, 10, [[3, 4], [4, 14], [3, 4]]);
  row(8, 11, [[3, 4], [2, 14], [3, 4]]);
  row(9, 12, [[6, 4]]);
  row(10, 13, [[4, 4]]);
});

const tree = sample('sample-tree', 'Little evergreen', 'A stepped evergreen with a reddish-brown trunk, a green canopy, and a broad brick plinth. A curated sample.', (row) => {
  row(11, 2, [[2, 70]]);
  row(11, 3, [[2, 70]]);
  row(11, 4, [[2, 70]]);
  row(9, 5, [[6, 2]]);
  row(7, 6, [[3, 2], [2, 2], [2, 2], [3, 2]]);
  row(8, 7, [[8, 2]]);
  row(8, 8, [[8, 2]]);
  row(9, 9, [[6, 2]]);
  row(10, 10, [[4, 2]]);
  row(11, 11, [[2, 2]]);
});

const duck = sample('sample-duck', 'Puddle pal', 'A bright yellow duck silhouette with an orange beak and a black eye, standing on a broad brick plinth. A curated sample.', (row, add) => {
  row(8, 2, [[8, 25]]);
  row(7, 3, [[3, 14], [2, 14], [2, 14], [3, 14]]);
  row(7, 4, [[10, 14]]);
  row(8, 5, [[8, 14]]);
  row(10, 6, [[6, 14]]);
  row(12, 7, [[4, 14]]);
  row(12, 8, [[3, 14], [3, 25]]);
  row(12, 9, [[2, 14]]);
  add('3004', 0, 14, 10, 9);
  add('3004', 14, 15, 10, 9);
  row(12, 10, [[4, 14]]);
});

export const SAMPLE_DESIGNS: Design[] = [flower, ROCKET_SAMPLE, tree, duck];

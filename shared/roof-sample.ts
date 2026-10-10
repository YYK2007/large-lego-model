import { SCHEMA_VERSION, CATALOG_VERSION, COORDINATE_SYSTEM, type Design, type Brick } from './model.js';

const bricks: Brick[] = [
  ...[0, 2].map((x, index) => ({ id: `base-${index}`, partId: '3001', colorId: 71, x, y: 0, z: 0, rotation: 0 as const })),
  ...[0, 2].map((y, index) => ({ id: `bond-${index}`, partId: '3020', colorId: 15, x: 0, y, z: 3, rotation: 90 as const })),
  ...[0, 2].flatMap(x => [0, 2].map(y => ({ id: `eave-${x}-${y}`, partId: '3022', colorId: 15, x, y, z: 4, rotation: 0 as const }))),
  ...[0, 2].flatMap(x => [0, 2].map(y => ({ id: `slope-${x}-${y}`, partId: '3039', colorId: 4, x, y, z: 5, rotation: (y === 0 ? 0 : 180) as 0 | 180 }))),
  { id: 'ridge', partId: '3020', colorId: 15, x: 0, y: 1, z: 8, rotation: 90 },
];

/** A small connection fixture; broader sample models demonstrate object complexity. */
export const ROOF_SAMPLE: Design = {
  id: 'sample-roof', title: 'Plates and pitched roof', description: 'A 13-piece connection specimen with crossed plate seams, opposing real slopes, and a ridge plate seated on their high studs. Physical assembly is untested.',
  schemaVersion: SCHEMA_VERSION, coordinateSystem: COORDINATE_SYSTEM, catalogVersion: CATALOG_VERSION,
  source: 'sample', prompt: 'Demonstrate plates and upright 45-degree slopes with exact connections.', createdAt: '2026-10-10T19:00:00.000Z', bricks,
};

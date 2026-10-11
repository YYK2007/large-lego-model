import { CATALOG_VERSION, COORDINATE_SYSTEM, type Brick, type Design } from '../../shared/model';

export const hangingBrick = (id: string, x: number, y: number, z: number, partId = '3005', rotation: Brick['rotation'] = 0): Brick => ({ id, partId, colorId: 4, x, y, z, rotation });
export const hangingDesign: Design = {
  id: 'hanging-chain-test', title: 'Hanging chain', description: 'A grounded column and two pieces attached underneath an overhang.',
  source: 'sample', prompt: 'Test the checked upward assembly path.', createdAt: '2026-10-10T12:00:00Z',
  schemaVersion: 2, catalogVersion: CATALOG_VERSION, coordinateSystem: COORDINATE_SYSTEM,
  bricks: [hangingBrick('ground', 0, 0, 0), hangingBrick('column1', 0, 0, 3), hangingBrick('column2', 0, 0, 6),
    hangingBrick('beam', 0, 0, 9, '3710', 90), hangingBrick('hanging1', 3, 0, 6), hangingBrick('hanging2', 3, 0, 3)],
};

export function cavityDesign(open: boolean, obstructWithStud = false): Design {
  const bricks = [hangingBrick('floor', 0, 0, 0, '3036')];
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
    if ((x === 1 && y === 1) || (open && x === 2 && y === 1)) continue;
    bricks.push(hangingBrick(`wall-${x}-${y}`, x, y, 1));
  }
  bricks.push(hangingBrick('roof', 0, 0, 4, '3036'), hangingBrick('inside', 1, 1, 3, '3024'));
  if (obstructWithStud) bricks.push(hangingBrick('entry-stud', 2, 1, 1, '3024'));
  return { ...hangingDesign, id: 'cavity-test', bricks };
}

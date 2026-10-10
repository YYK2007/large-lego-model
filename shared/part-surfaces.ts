import { PARTS, partPoint, type Brick } from './model';

export type PartPoint = [number, number, number];
export type PartSurface = { indices: number[]; normal: PartPoint };

/** Convex body only, in canonical stud XY / plate Z. Studs are separate connectors. */
export function partSurfaces(brick: Brick): { vertices: PartPoint[]; faces: PartSurface[] } {
  const part = PARTS[brick.partId];
  const w = part.width, d = part.depth, h = part.heightPlates;
  const vertices: PartPoint[] = part.kind === 'slope'
    ? [[0, 0, 0], [w, 0, 0], [w, d, 0], [0, d, 0],
      [0, 0, 0.5], [w, 0, 0.5], [w, 1, h], [0, 1, h], [w, d, h], [0, d, h]]
    : [[0, 0, 0], [w, 0, 0], [w, d, 0], [0, d, 0],
      [0, 0, h], [w, 0, h], [w, d, h], [0, d, h]];
  const indices = part.kind === 'slope'
    ? [[3, 2, 1, 0], [0, 1, 5, 4], [1, 2, 8, 6, 5], [2, 3, 9, 8], [3, 0, 4, 7, 9], [4, 5, 6, 7], [7, 6, 8, 9]]
    : [[3, 2, 1, 0], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [4, 5, 6, 7]];
  for (const point of vertices) {
    const { x, y } = partPoint(brick, point[0], point[1]);
    point[0] = x;
    point[1] = y;
    point[2] += brick.z;
  }
  const faces = indices.map((face) => {
    const [a, b, c] = face.map((index) => vertices[index]);
    const u = b.map((value, axis) => value - a[axis]);
    const v = c.map((value, axis) => value - a[axis]);
    const normal: PartPoint = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const length = Math.hypot(...normal);
    return { indices: face, normal: normal.map((value) => value / length) as PartPoint };
  });
  return { vertices, faces };
}

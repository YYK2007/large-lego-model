import { resolveCatalog, partPoint, type Brick, type CatalogContext } from './model';
import type { CatalogMesh } from './catalog';

export type PartPoint = [number, number, number];
export type PartSurface = { indices: number[]; normal: PartPoint };

/** Exterior body in canonical stud XY / plate Z; top studs are separate.
 * Neck/groove profiles and hollow top openings follow the linked LDraw parts.
 * Underside tubes are connection metadata, not rendered internal detail. */
export function meshSurfaces(brick: Brick, mesh: CatalogMesh, catalog: CatalogContext): { vertices: PartPoint[]; faces: PartSurface[] } {
  const vertices = mesh.vertices.map(([u, v, z]): PartPoint => {
    const { x, y } = partPoint(brick, u, v, catalog); return [x, y, z + brick.z];
  });
  const faces = mesh.faces.flatMap(indices => {
    const [a, b, c] = indices.map(i => vertices[i]);
    const u = b.map((v, i) => v - a[i]), v = c.map((v, i) => v - a[i]);
    const n: PartPoint = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const length = Math.hypot(...n);
    return length > 1e-10 ? [{ indices, normal: n.map(value => value / length) as PartPoint }] : [];
  });
  return { vertices, faces };
}

export function partSurfaces(brick: Brick, catalog: CatalogContext = resolveCatalog()): { vertices: PartPoint[]; faces: PartSurface[] } {
  const part = catalog.parts[brick.partId];
  if (part.geometry) return meshSurfaces(brick, part.geometry.body, catalog);
  const w = part.width, d = part.depth, h = part.heightPlates;
  let vertices: PartPoint[] = part.kind === 'slope'
    ? [[0, 0, 0], [w, 0, 0], [w, d, 0], [0, d, 0],
      [0, 0, 0.5], [w, 0, 0.5], [w, 1, h], [0, 1, h], [w, d, h], [0, d, h]]
    : [[0, 0, 0], [w, 0, 0], [w, d, 0], [0, d, 0],
      [0, 0, h], [w, 0, h], [w, d, h], [0, d, h]];
  let indices = part.kind === 'slope'
    ? [[3, 2, 1, 0], [0, 1, 5, 4], [1, 2, 8, 6, 5], [2, 3, 9, 8], [3, 0, 4, 7, 9], [4, 5, 6, 7], [7, 6, 8, 9]]
    : [[3, 2, 1, 0], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [4, 5, 6, 7]];
  if (part.kind === 'round-brick' || part.kind === 'round-plate' || part.kind === 'cone') {
    // LDraw 3062bs01 / 6141 / 4589: 8-LDU neck, 10-LDU shoulder,
    // shoulder at Y=19 (brick/cone) or Y=3 (plate). One LDU is .05 stud / .125 plate.
    // https://library.ldraw.org/library/official/parts/4589.dat
    const profile: [number, number][] = [[0.4, 0], [0.4, 0.625], [0.5, 0.625], [part.kind === 'cone' ? 0.3 : 0.5, h]];
    if (part.topStudStyle === 'hollow') profile.push([0.2, h], [0.2, h - (part.kind === 'cone' ? 1.5 : 0.5)]);
    const segments = 32;
    vertices = profile.flatMap(([radius, z]) => Array.from({ length: segments }, (_, i): PartPoint => {
      const angle = i / segments * Math.PI * 2;
      return [w / 2 + Math.cos(angle) * radius, d / 2 + Math.sin(angle) * radius, z];
    }));
    indices = [Array.from({ length: segments }, (_, i) => segments - 1 - i)];
    for (let ring = 0; ring < profile.length - 1; ring++) for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments, start = ring * segments;
      indices.push([start + i, start + next, start + segments + next, start + segments + i]);
    }
    indices.push(Array.from({ length: segments }, (_, i) => (profile.length - 1) * segments + i));
  } else if (part.kind === 'tile') {
    // The groove is a 1-LDU inset in the bottommost 1 LDU of the body.
    // https://library.ldraw.org/library/official/parts/s/3069bs01.dat
    // https://library.ldraw.org/library/official/parts/s/3068bs01.dat
    vertices = [[0.05, 0], [0.05, 0.125], [0, 0.125], [0, h]].flatMap(([inset, z]): PartPoint[] =>
      [[inset, inset, z], [w - inset, inset, z], [w - inset, d - inset, z], [inset, d - inset, z]]);
    indices = [[3, 2, 1, 0]];
    for (let ring = 0; ring < 3; ring++) for (let i = 0; i < 4; i++) {
      const start = ring * 4, next = (i + 1) % 4;
      indices.push([start + i, start + next, start + 4 + next, start + 4 + i]);
    }
    indices.push([12, 13, 14, 15]);
  }
  for (const point of vertices) {
    const { x, y } = partPoint(brick, point[0], point[1], catalog);
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

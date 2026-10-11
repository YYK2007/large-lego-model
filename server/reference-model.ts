import sharp from 'sharp';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

export const REFERENCE_STL_BYTES = 5_000_000;
export const REFERENCE_STL_TRIANGLES = 100_000;
type Point = [number, number, number];
export type ReferenceMesh = { positions: Float32Array; triangleCount: number; bounds: { min: Point; max: Point } };

/** Data-only STL parsing. No scene scripts, external resources or materials run. */
export function parseReferenceStl(bytes: Buffer): ReferenceMesh {
  if (!bytes.length || bytes.length > REFERENCE_STL_BYTES) throw new Error('Reference STL exceeds its 5 MB byte limit.');
  const count = bytes.length >= 84 ? bytes.readUInt32LE(80) : 0;
  const binary = bytes.length >= 84 && 84 + count * 50 === bytes.length;
  if (binary ? count < 1 || count > REFERENCE_STL_TRIANGLES : !/^\s*solid\b/i.test(bytes.toString('utf8', 0, 100)) || (bytes.toString('utf8').match(/\bfacet\s+normal\b/g) || []).length > REFERENCE_STL_TRIANGLES) throw new Error('Reference STL is invalid or exceeds 100,000 triangles.');
  const geometry = new STLLoader().parse(Uint8Array.from(bytes).buffer);
  try {
    const positions = geometry.getAttribute('position')?.array as Float32Array | undefined;
    if (!positions?.length || positions.length % 9 || positions.length / 9 > REFERENCE_STL_TRIANGLES) throw new Error('Reference STL has no bounded triangle mesh.');
    const min: Point = [Infinity, Infinity, Infinity], max: Point = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i++) {
      const value = positions[i], axis = i % 3;
      if (!Number.isFinite(value) || Math.abs(value) > 1e9) throw new Error('Reference STL contains invalid coordinates.');
      min[axis] = Math.min(min[axis], value); max[axis] = Math.max(max[axis], value);
    }
    if (max.some((value, axis) => value - min[axis] <= 1e-9)) throw new Error('Reference STL has no three-dimensional extent.');
    return { positions, triangleCount: positions.length / 9, bounds: { min, max } };
  } finally { geometry.dispose(); }
}

/** Orthographic depth-buffer views of every source triangle, with known source
 * axes rather than invented front/rear labels. STL units/orientation are unknown. */
export async function renderReferenceStl(mesh: ReferenceMesh, options: { signal?: AbortSignal; deadline?: number } = {}) {
  const size = 320, { min, max } = mesh.bounds;
  const center = min.map((value, axis) => (value + max[axis]) / 2);
  const scale = (size - 44) / Math.max(...max.map((value, axis) => value - min[axis]));
  const views: { label: string; axes: Point }[] = [
    { label: 'Source X-Z view', axes: [0, 2, 1] },
    { label: 'Source Y-Z view', axes: [1, 2, 0] },
    { label: 'Source X-Y view', axes: [0, 1, 2] },
  ];
  const output: { label: string; bytes: Buffer }[] = [];
  const check = () => { options.signal?.throwIfAborted(); if (options.deadline !== undefined && Date.now() >= options.deadline) throw new Error('Reference model reached its research time budget.'); };
  for (const { label, axes } of views) {
    const pixels = Buffer.alloc(size * size * 3, 245), depth = new Float32Array(size * size).fill(-Infinity);
    let visits = 0;
    for (let i = 0; i < mesh.positions.length; i += 9) {
      if (i % (9 * 256) === 0) check();
      const points = [0, 3, 6].map(offset => axes.map((axis, dim) => dim === 2 ? mesh.positions[i + offset + axis] : size / 2 + (mesh.positions[i + offset + axis] - center[axis]) * scale * (dim === 1 ? -1 : 1)));
      const [a, b, c] = points;
      const area = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      if (Math.abs(area) < 1e-8) continue;
      const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), x1 = Math.min(size - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
      const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), y1 = Math.min(size - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
      visits += (x1 - x0 + 1) * (y1 - y0 + 1);
      if (visits > 12_000_000) throw new Error('Reference model exceeds the bounded preview raster budget.');
      const normal = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), area];
      const shade = Math.round(95 + 90 * Math.abs(normal[2]) / Math.hypot(...normal));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const u = ((b[1] - c[1]) * (x + .5 - c[0]) + (c[0] - b[0]) * (y + .5 - c[1])) / area;
        const v = ((c[1] - a[1]) * (x + .5 - c[0]) + (a[0] - c[0]) * (y + .5 - c[1])) / area, w = 1 - u - v;
        if (u < 0 || v < 0 || w < 0) continue;
        const z = u * a[2] + v * b[2] + w * c[2], pixel = y * size + x;
        if (z <= depth[pixel]) continue;
        depth[pixel] = z; pixels.fill(shade, pixel * 3, pixel * 3 + 3);
      }
    }
    check();
    const caption = Buffer.from(`<svg width="320" height="320"><rect width="320" height="21" fill="white"/><text x="9" y="15" font-family="sans-serif" font-size="12">External STL reference · ${label}</text><rect y="301" width="320" height="19" fill="white"/><text x="9" y="314" font-family="sans-serif" font-size="10">Uncolored source mesh · orientation/units unverified</text></svg>`);
    output.push({ label, bytes: await sharp(pixels, { raw: { width: size, height: size, channels: 3 } }).composite([{ input: caption }]).jpeg({ quality: 86 }).toBuffer() });
  }
  return output;
}

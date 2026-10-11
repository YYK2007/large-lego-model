import { resolveCatalog, type CatalogContext, WORKSPACE } from '../shared/model.js';
import type { ShapeBox } from './compiler.js';

export type ProfileSection = { z: number; cx: number; cy: number; width: number; depth: number };
export type ProfilePoint = { u: number; v: number };
export type ShapeProfile = { shape: 'ellipse' | 'rectangle' | 'polygon'; colorId: number; wall?: number; outline?: ProfilePoint[]; arc?: { startDegrees: number; sweepDegrees: number }; sections: ProfileSection[] };
export type ProfileBox = { box: ShapeBox; source: { path: string; sections: [number, number] } };

const epsilon = 1e-12;
function cross(a: ProfilePoint, b: ProfilePoint, c: ProfilePoint) {
  return (b.u - a.u) * (c.v - a.v) - (b.v - a.v) * (c.u - a.u);
}

function validateOutline(outline: ShapeProfile['outline'], fail: (message: string) => never) {
  if (!Array.isArray(outline) || outline.length < 3 || outline.length > 32) fail('A polygon outline needs 3–32 vertices, with implicit closure.');
  const points = outline!;
  for (const point of points) if (!point || Array.isArray(point) || ![point.u, point.v].every(value => Number.isFinite(value) && Math.abs(value) <= 1)) fail('Polygon outline coordinates u/v must be finite numbers from -1 through 1.');
  if (new Set(points.map(point => `${point.u},${point.v}`)).size !== points.length) fail('Polygon outline vertices must be distinct; do not repeat the closing vertex.');
  const area = points.reduce((sum, a, i) => { const b = points[(i + 1) % points.length]; return sum + a.u * b.v - b.u * a.v; }, 0);
  if (Math.abs(area) <= epsilon) fail('Polygon outline must have nonzero area.');
  const onSegment = (a: ProfilePoint, b: ProfilePoint, p: ProfilePoint) => Math.abs(cross(a, b, p)) <= epsilon && p.u >= Math.min(a.u, b.u) - epsilon && p.u <= Math.max(a.u, b.u) + epsilon && p.v >= Math.min(a.v, b.v) - epsilon && p.v <= Math.max(a.v, b.v) + epsilon;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], c = points[(i + 2) % points.length];
    if (Math.abs(cross(a, b, c)) <= epsilon && (a.u - b.u) * (c.u - b.u) + (a.v - b.v) * (c.v - b.v) > 0) fail('Polygon outline edges cannot overlap or backtrack.');
    for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue;
      const c = points[j], d = points[(j + 1) % points.length];
      const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
      if ((abC * abD < 0 && cdA * cdB < 0) || onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b)) fail('Polygon outline must be simple: nonadjacent edges cannot intersect or touch.');
    }
  }
}

export function validateProfile(profile: ShapeProfile, path: string, catalog: CatalogContext = resolveCatalog()) {
  const fail = (message: string): never => { throw new Error(`${path}: ${message}`); };
  if (!profile || Array.isArray(profile) || !['ellipse', 'rectangle', 'polygon'].includes(profile.shape) || !Number.isSafeInteger(profile.colorId) || !Object.hasOwn(catalog.colors, profile.colorId)) fail('A profile needs ellipse, rectangle or polygon shape and a supported color.');
  if ('profiles' in profile || 'repeats' in profile) fail('Profiles cannot contain nested profiles or repeats.');
  if (profile.shape === 'polygon') validateOutline(profile.outline, fail);
  else if (profile.outline !== undefined) fail('Only polygon profiles may define an outline.');
  if (profile.wall !== undefined && (!Number.isSafeInteger(profile.wall) || profile.wall < 1)) fail('Profile wall must be a positive integer thickness in studs.');
  if (profile.arc !== undefined && (profile.shape !== 'ellipse' || !profile.arc || Array.isArray(profile.arc) ||
    !Number.isFinite(profile.arc.startDegrees) || profile.arc.startDegrees < 0 || profile.arc.startDegrees >= 360 ||
    !Number.isFinite(profile.arc.sweepDegrees) || profile.arc.sweepDegrees <= 0 || profile.arc.sweepDegrees > 360)) fail('An ellipse arc needs finite startDegrees from 0 inclusive to 360 exclusive and sweepDegrees greater than 0 through 360.');
  if (!Array.isArray(profile.sections) || profile.sections.length < 2) fail('A profile needs at least two sections.');
  profile.sections.forEach((section, index) => {
    if (!section || Array.isArray(section) || ![section.z, section.width, section.depth].every(Number.isSafeInteger) || ![section.cx, section.cy].every(value => typeof value === 'number' && Number.isSafeInteger(value * 2))) fail(`Section ${index} needs integer plate-z and diameters, and half-stud center coordinates.`);
    if ('sections' in section || 'profiles' in section || 'repeats' in section) fail(`Section ${index} cannot contain nested geometry.`);
    const tip = section.width === 0 && section.depth === 0 && (index === 0 || index === profile.sections.length - 1);
    if (!tip && (section.width < 1 || section.depth < 1)) fail(`Section ${index} needs positive diameters; only terminal tips may have both diameters zero.`);
    if (section.z < 0 || section.z > WORKSPACE.heightPlates || (index > 0 && section.z <= profile.sections[index - 1].z)) fail(`Section ${index} needs increasing plate-z boundaries inside the workspace.`);
    if (section.cx - section.width / 2 < 0 || section.cy - section.depth / 2 < 0 || section.cx + section.width / 2 > WORKSPACE.width || section.cy + section.depth / 2 > WORKSPACE.depth) fail(`Section ${index} exceeds the stud workspace.`);
  });
}

/** Translate a repeated profile in stud-x/y and plate-z units without changing its contour. */
export function translateProfile(profile: ShapeProfile, offset: { x: number; y: number; z: number }, catalog: CatalogContext = resolveCatalog()): ShapeProfile {
  validateProfile(profile, 'Profile', catalog);
  if (!offset || ![offset.x, offset.y, offset.z].every(Number.isSafeInteger)) throw new Error('Profile translation needs integer stud-x/y and plate-z offsets.');
  const translated = { ...profile, ...(profile.outline ? { outline: profile.outline.map(point => ({ ...point })) } : {}), sections: profile.sections.map(section => ({ ...section, cx: section.cx + offset.x, cy: section.cy + offset.y, z: section.z + offset.z })) };
  validateProfile(translated, 'Translated profile', catalog);
  return translated;
}

/**
 * Rasterize a linear loft at cell centers (x+.5, y+.5, z+.5). Section z values
 * bound the volume, so a final z of 30 never produces cells at z=30. Coordinates
 * retain the model's physical ratio: one stud is 20 LDU, one plate is 8 LDU
 * (https://www.ldraw.org/article/218.html). This is occupied brick volume, not a mesh.
 *
 * Ellipse boundaries are included; rectangle upper edges are excluded. Hollow
 * interiors omit only this profile's contribution. No support or closure is added.
 * Optional ellipse arcs start at +X and sweep toward +Y about each interpolated
 * center. Both radial boundaries and the center are included; 360 is a full ellipse.
 * Polygon outlines use the same normalized vertices at every section, transformed
 * by its center and diameters. Half-open scanline intervals include their left and
 * exclude their right boundaries, matching rectangular cell sampling. Polygon wall
 * is the horizontal Euclidean distance from an occupied cell center to its closest
 * boundary segment, measured in studs. No inner contour, cap or support is invented.
 * Adjacent identical row runs merge vertically within the same section interval.
 */
export function expandProfile(profile: ShapeProfile, path = '/profiles/0', catalog: CatalogContext = resolveCatalog()): ProfileBox[] {
  validateProfile(profile, path, catalog);
  const output: ProfileBox[] = [];
  for (let index = 0; index < profile.sections.length - 1; index++) {
    const lower = profile.sections[index], upper = profile.sections[index + 1];
    const priorRuns = new Map<string, ShapeBox>();
    for (let z = lower.z; z < upper.z; z++) {
      const t = (z + 0.5 - lower.z) / (upper.z - lower.z);
      const interpolate = (key: 'cx' | 'cy' | 'width' | 'depth') => lower[key] + (upper[key] - lower[key]) * t;
      const cx = interpolate('cx'), cy = interpolate('cy'), width = interpolate('width'), depth = interpolate('depth');
      const polygon = profile.shape === 'polygon' ? profile.outline!.map(point => ({ x: cx + point.u * width / 2, y: cy + point.v * depth / 2 })) : undefined;
      const inside = (x: number, y: number, w: number, d: number) => {
        if (w <= 0 || d <= 0) return false;
        if (profile.shape === 'rectangle') return x >= cx - w / 2 && x < cx + w / 2 && y >= cy - d / 2 && y < cy + d / 2;
        return ((x - cx) * 2 / w) ** 2 + ((y - cy) * 2 / d) ** 2 <= 1 + 1e-12;
      };
      const inArc = (x: number, y: number) => {
        if (!profile.arc || profile.arc.sweepDegrees === 360 || (x === cx && y === cy)) return true;
        const angle = Math.atan2(y - cy, x - cx) * 180 / Math.PI;
        const delta = ((angle - profile.arc.startDegrees) % 360 + 360) % 360;
        return delta <= profile.arc.sweepDegrees + 1e-12 || 360 - delta <= 1e-12;
      };
      const occupied = (x: number, y: number) => inside(x + 0.5, y + 0.5, width, depth) &&
        inArc(x + 0.5, y + 0.5) &&
        !(profile.wall !== undefined && inside(x + 0.5, y + 0.5, width - 2 * profile.wall, depth - 2 * profile.wall));
      const minX = Math.max(0, Math.floor(cx - width / 2)), maxX = Math.min(WORKSPACE.width, Math.ceil(cx + width / 2));
      const minY = Math.max(0, Math.floor(cy - depth / 2)), maxY = Math.min(WORKSPACE.depth, Math.ceil(cy + depth / 2));
      for (let y = minY; y < maxY; y++) {
        // Intersect edges once per row instead of testing every edge at every cell.
        const crossings = polygon?.flatMap((a, i) => {
          const b = polygon[(i + 1) % polygon.length], py = y + 0.5;
          return (a.y > py + epsilon) !== (b.y > py + epsilon) ? [a.x + (py - a.y) * (b.x - a.x) / (b.y - a.y)] : [];
        }).sort((a, b) => a - b);
        const filled = (x: number) => {
          if (!polygon) return occupied(x, y);
          const px = x + 0.5, py = y + 0.5;
          // Treat floating-point roundoff at a cell center consistently after translation.
          if (!crossings!.some((left, i) => i % 2 === 0 && px >= left - epsilon && px < crossings![i + 1] - epsilon)) return false;
          if (profile.wall === undefined) return true;
          return polygon.some((a, i) => {
            const b = polygon[(i + 1) % polygon.length], dx = b.x - a.x, dy = b.y - a.y;
            const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / (dx * dx + dy * dy)));
            return (px - a.x - t * dx) ** 2 + (py - a.y - t * dy) ** 2 <= profile.wall! ** 2 + epsilon;
          });
        };
        let x = minX;
        while (x < maxX) {
          if (!filled(x)) { x++; continue; }
          const start = x++;
          while (x < maxX && filled(x)) x++;
          const key = `${start},${y},${x - start}`;
          const previous = priorRuns.get(key);
          if (previous && previous.z + previous.height === z) previous.height++;
          else {
            const box: ShapeBox = { x: start, y, z, width: x - start, depth: 1, height: 1, colorId: profile.colorId };
            output.push({ box, source: { path, sections: [index, index + 1] } });
            priorRuns.set(key, box);
          }
        }
      }
    }
  }
  if (!output.length) throw new Error(`${path}: Profile produces no occupied cells at this stud/plate resolution.`);
  return output;
}

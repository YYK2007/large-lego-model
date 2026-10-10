import { COLORS, WORKSPACE } from '../shared/model.js';
import type { ShapeBox } from './compiler.js';

export type ProfileSection = { z: number; cx: number; cy: number; width: number; depth: number };
export type ShapeProfile = { shape: 'ellipse' | 'rectangle'; colorId: number; wall?: number; arc?: { startDegrees: number; sweepDegrees: number }; sections: ProfileSection[] };
export type ProfileBox = { box: ShapeBox; source: { path: string; sections: [number, number] } };

function validateProfile(profile: ShapeProfile, path: string) {
  const fail = (message: string): never => { throw new Error(`${path}: ${message}`); };
  if (!profile || Array.isArray(profile) || !['ellipse', 'rectangle'].includes(profile.shape) || !Number.isSafeInteger(profile.colorId) || !Object.hasOwn(COLORS, profile.colorId)) fail('A profile needs ellipse or rectangle shape and a supported color.');
  if ('profiles' in profile || 'repeats' in profile) fail('Profiles cannot contain nested profiles or repeats.');
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
export function translateProfile(profile: ShapeProfile, offset: { x: number; y: number; z: number }): ShapeProfile {
  validateProfile(profile, 'Profile');
  if (!offset || ![offset.x, offset.y, offset.z].every(Number.isSafeInteger)) throw new Error('Profile translation needs integer stud-x/y and plate-z offsets.');
  const translated = { ...profile, sections: profile.sections.map(section => ({ ...section, cx: section.cx + offset.x, cy: section.cy + offset.y, z: section.z + offset.z })) };
  validateProfile(translated, 'Translated profile');
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
 * Adjacent identical row runs merge vertically within the same section interval.
 */
export function expandProfile(profile: ShapeProfile, path = '/profiles/0'): ProfileBox[] {
  validateProfile(profile, path);
  const output: ProfileBox[] = [];
  for (let index = 0; index < profile.sections.length - 1; index++) {
    const lower = profile.sections[index], upper = profile.sections[index + 1];
    const priorRuns = new Map<string, ShapeBox>();
    for (let z = lower.z; z < upper.z; z++) {
      const t = (z + 0.5 - lower.z) / (upper.z - lower.z);
      const interpolate = (key: 'cx' | 'cy' | 'width' | 'depth') => lower[key] + (upper[key] - lower[key]) * t;
      const cx = interpolate('cx'), cy = interpolate('cy'), width = interpolate('width'), depth = interpolate('depth');
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
        let x = minX;
        while (x < maxX) {
          if (!occupied(x, y)) { x++; continue; }
          const start = x++;
          while (x < maxX && occupied(x, y)) x++;
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

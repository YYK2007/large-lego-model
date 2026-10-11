import { catalogForDesign, type CatalogContext, footprint, partHeight, partTopStuds, partBottomSites, type Brick, type Design } from '../shared/model.js';
import type { ShapeBox, ShapePlanV2 } from './compiler.js';
import { expandProfile, translateProfile, type ShapeProfile } from './shape-profiles.js';

type Point = { x: number; y: number; z: number };
export type PlanSource = { path: string; sections?: [number, number]; copy?: number; translation?: Point };
type Bounds = { x: number; y: number; z: number; width: number; depth: number; height: number };
type Primitive = { source: PlanSource; bounds: Bounds; cutouts?: ShapeBox['cutouts'] };
const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
const contains = (box: Bounds, point: Point) => point.x >= box.x && point.x < box.x + box.width && point.y >= box.y && point.y < box.y + box.depth && point.z >= box.z && point.z < box.z + box.height;
const sourceKey = (source: PlanSource) => `${source.path}:${source.copy ?? ''}:${source.sections?.join(',') ?? ''}`;

function primitives(plan: ShapePlanV2, catalog: CatalogContext): Primitive[] {
  const result: Primitive[] = [];
  const addProfiles = (profiles: ShapeProfile[], prefix: string, translation: Point, copy?: number) => {
    profiles.forEach((profile, index) => {
      for (const row of expandProfile(translateProfile(profile, translation, catalog), `${prefix}/${index}`, catalog)) {
        result.push({ source: { ...row.source, ...(copy === undefined ? {} : { copy, translation }) }, bounds: row.box });
      }
    });
  };
  addProfiles(plan.profiles || [], '/profiles', { x: 0, y: 0, z: 0 });
  plan.repeats?.forEach((repeat, index) => {
    for (let copy = 0; copy < repeat.count; copy++) addProfiles(repeat.profiles || [], `/repeats/${index}/profiles`, { x: copy * repeat.dx, y: copy * repeat.dy, z: copy * repeat.dz }, copy);
  });
  // Match compiler order: profiles, direct boxes, repeated boxes, then fixed
  // slopes and parts. Fixed envelopes never overlap boxes in a compiled plan.
  for (const field of ['boxes', 'slopes', 'parts'] as const) {
    const add = (items: NonNullable<ShapePlanV2[typeof field]>, prefix: string, translation: Point, copy?: number) => {
      items.forEach((item, index) => {
        const source: PlanSource = { path: `${prefix}/${index}`, ...(copy === undefined ? {} : { copy, translation }) };
        const position = { x: item.x + translation.x, y: item.y + translation.y, z: item.z + translation.z };
        if ('depth' in item) result.push({ source, bounds: { ...position, width: item.width, depth: item.depth, height: item.height }, cutouts: item.cutouts });
        else if ('kind' in item) result.push({ source, bounds: { ...position, width: item.rotation % 180 ? 2 : item.width, depth: item.rotation % 180 ? item.width : 2, height: 3 } });
        else { const brick = { ...item, ...position, id: '' }; result.push({ source, bounds: { ...position, ...footprint(brick, catalog), height: partHeight(brick, catalog) } }); }
      });
    };
    add(plan[field] || [], `/${field}`, { x: 0, y: 0, z: 0 });
    plan.repeats?.forEach((repeat, index) => {
      for (let copy = 0; copy < repeat.count; copy++) add(repeat[field] || [], `/repeats/${index}/${field}`, { x: copy * repeat.dx, y: copy * repeat.dy, z: copy * repeat.dz }, copy);
    });
  }
  return result;
}

/** Explain a compiled V2 plan without recompiling, changing volume or relaxing checks. */
export function diagnosePlanSupport(plan: ShapePlanV2, design: Design, options: { assemblyBlockedIds?: ReadonlySet<string> } = {}) {
  const catalog = catalogForDesign(design), PARTS = catalog.parts;
  const shapes = primitives(plan, catalog);
  const shapesByHeight = new Map<number, Primitive[]>();
  for (const shape of shapes) for (let z = shape.bounds.z; z < shape.bounds.z + shape.bounds.height; z++) {
    const level = shapesByHeight.get(z) || [];
    level.push(shape); shapesByHeight.set(z, level);
  }
  const cutsAt = (shape: Primitive, point: Point) => shape.cutouts?.flatMap((cut, index) => contains({ ...cut, x: cut.x + shape.bounds.x, y: cut.y + shape.bounds.y, z: cut.z + shape.bounds.z }, point) ? [index] : []) || [];
  const ownerAt = (point: Point): Primitive | undefined => {
    const level = shapesByHeight.get(point.z) || [];
    for (let i = level.length - 1; i >= 0; i--) if (contains(level[i].bounds, point) && !cutsAt(level[i], point).length) return level[i];
  };
  const sourcesFor = (brick: Brick): PlanSource[] => {
    const size = footprint(brick, catalog), height = partHeight(brick, catalog), sources = new Map<string, PlanSource>();
    for (let z = brick.z; z < brick.z + height; z++) for (let y = brick.y; y < brick.y + size.depth; y++) for (let x = brick.x; x < brick.x + size.width; x++) {
      const owner = ownerAt({ x, y, z });
      if (owner) sources.set(sourceKey(owner.source), owner.source);
    }
    return [...sources.values()].sort((a, b) => sourceKey(a).localeCompare(sourceKey(b)));
  };
  // The assembly checker supplies these IDs. Locate their source geometry without
  // inferring which surrounding part blocks a particular checked entry path.
  const blocked = design.bricks.filter(brick => options.assemblyBlockedIds?.has(brick.id));
  const assemblyBlockedPieces = blocked.slice(0, 8).map(brick => {
    const sources = sourcesFor(brick);
    return { ...brick, bounds: { x: brick.x, y: brick.y, z: brick.z, ...footprint(brick, catalog), height: partHeight(brick, catalog) },
      sources: sources.slice(0, 8), omittedSources: Math.max(0, sources.length - 8) };
  });
  const studOwners = new Map<string, number>();
  const studsByHeight = new Map<number, Point[]>();
  const heightsByXY = new Map<string, number[]>();
  design.bricks.forEach((brick, index) => {
    for (const stud of partTopStuds(brick, catalog)) {
      studOwners.set(key(stud.x, stud.y, stud.z), index);
      if (!studsByHeight.has(stud.z)) studsByHeight.set(stud.z, []);
      studsByHeight.get(stud.z)!.push(stud);
      const xy = key(stud.x, stud.y, 0);
      if (!heightsByXY.has(xy)) heightsByXY.set(xy, []);
      heightsByXY.get(xy)!.push(stud.z);
    }
  });
  const parents = design.bricks.map((_, index) => index);
  const root = (index: number): number => { while (parents[index] !== index) { parents[index] = parents[parents[index]]; index = parents[index]; } return index; };
  const withoutLower: { brick: Brick; index: number }[] = [];
  design.bricks.forEach((brick, index) => {
    let supported = brick.z === 0;
    for (const site of partBottomSites(brick, catalog)) {
      const below = studOwners.get(key(site.x, site.y, site.z));
      if (below !== undefined && below !== index) { supported = true; parents[root(index)] = root(below); }
    }
    if (!supported) withoutLower.push({ brick, index });
  });
  const groundedRoots = new Set(design.bricks.flatMap((brick, index) => brick.z === 0 ? [root(index)] : []));
  // A hanging piece may connect to the table through studs above it. Do not
  // tell the repair planner to fill beneath a legal hanging feature.
  const unsupported = withoutLower.filter(({ index }) => !groundedRoots.has(root(index))).map(({ brick }) => brick);
  type Group = { sources: PlanSource[]; bottomZ: number; colorId: number; pieceCount: number; bounds: Bounds; examples: Omit<Brick, 'id' | 'colorId'>[];
    attachmentSites: number; occupiedBodyEnvelopeSitesBelow: number; nearestAlignedStudGapPlates: number | null; nearestSameHeightStudDistance: number | null;
    cutoutsBelow: { source: PlanSource; path: string }[] };
  const groups = new Map<string, Group>();
  for (const brick of unsupported) {
    const size = footprint(brick, catalog), height = partHeight(brick, catalog), sourceList = sourcesFor(brick);
    const id = `${sourceList.map(sourceKey).join('|')}:${brick.z}:${brick.colorId}`;
    if (!groups.has(id)) groups.set(id, { sources: sourceList, bottomZ: brick.z, colorId: brick.colorId, pieceCount: 0,
      bounds: { x: brick.x, y: brick.y, z: brick.z, ...size, height }, examples: [], attachmentSites: 0, occupiedBodyEnvelopeSitesBelow: 0,
      nearestAlignedStudGapPlates: null, nearestSameHeightStudDistance: null, cutoutsBelow: [] });
    const group = groups.get(id)!;
    const maxX = Math.max(group.bounds.x + group.bounds.width, brick.x + size.width), maxY = Math.max(group.bounds.y + group.bounds.depth, brick.y + size.depth);
    group.bounds.x = Math.min(group.bounds.x, brick.x); group.bounds.y = Math.min(group.bounds.y, brick.y);
    group.bounds.width = maxX - group.bounds.x; group.bounds.depth = maxY - group.bounds.y; group.bounds.height = Math.max(group.bounds.height, height);
    group.pieceCount++;
    if (group.examples.length < 2) { const { id: _id, colorId: _color, ...example } = brick; group.examples.push(example); }
    for (const site of partBottomSites(brick, catalog)) {
      group.attachmentSites++;
      const below = { x: Math.floor(site.x), y: Math.floor(site.y), z: site.z - 1 };
      const occupiedBelow = ownerAt(below);
      if (occupiedBelow) group.occupiedBodyEnvelopeSitesBelow++;
      const lowerHeights = (heightsByXY.get(key(site.x, site.y, 0)) || []).filter(z => z < brick.z);
      for (const z of lowerHeights) group.nearestAlignedStudGapPlates = Math.min(group.nearestAlignedStudGapPlates ?? Infinity, brick.z - z);
      for (const stud of studsByHeight.get(brick.z) || []) group.nearestSameHeightStudDistance = Math.min(group.nearestSameHeightStudDistance ?? Infinity, Math.abs(site.x - stud.x) + Math.abs(site.y - stud.y));
      for (const shape of occupiedBelow ? [] : shapesByHeight.get(below.z) || []) if (contains(shape.bounds, below)) for (const cut of cutsAt(shape, below)) {
        const path = `${shape.source.path}/cutouts/${cut}`;
        if (!group.cutoutsBelow.some(item => item.path === path && item.source.copy === shape.source.copy)) group.cutoutsBelow.push({ source: shape.source, path });
      }
    }
  }
  const ordered = [...groups.values()].sort((a, b) => a.bottomZ - b.bottomZ || b.pieceCount - a.pieceCount);
  // Separate assemblies can all touch the table and therefore have no missing
  // lower studs. Give repairs locations for that failure too, without treating
  // side contact as a legal connection or recommending arbitrary infill.
  const components = new Map<number, { grounded: boolean; pieceCount: number; bounds: Bounds; examples: Brick[] }>();
  const roots = new Set(parents.map((_, index) => root(index)));
  if (roots.size > 1) design.bricks.forEach((brick, index) => {
    const id = root(index), size = footprint(brick, catalog), height = partHeight(brick, catalog);
    const group = components.get(id) || { grounded: groundedRoots.has(id), pieceCount: 0,
      bounds: { x: brick.x, y: brick.y, z: brick.z, ...size, height }, examples: [] };
    const maxX = Math.max(group.bounds.x + group.bounds.width, brick.x + size.width);
    const maxY = Math.max(group.bounds.y + group.bounds.depth, brick.y + size.depth);
    const maxZ = Math.max(group.bounds.z + group.bounds.height, brick.z + height);
    group.bounds.x = Math.min(group.bounds.x, brick.x); group.bounds.y = Math.min(group.bounds.y, brick.y); group.bounds.z = Math.min(group.bounds.z, brick.z);
    group.bounds.width = maxX - group.bounds.x; group.bounds.depth = maxY - group.bounds.y; group.bounds.height = maxZ - group.bounds.z;
    group.pieceCount++;
    if (group.examples.length < 3) group.examples.push({ ...brick });
    components.set(id, group);
  });
  return { unsupportedPieceCount: unsupported.length, disconnectedComponents: roots.size,
    assemblyBlockedPieceCount: blocked.length, assemblyBlockedPieces, omittedAssemblyBlockedPieces: Math.max(0, blocked.length - 8),
    disconnectedGroups: [...components.values()].sort((a, b) => b.pieceCount - a.pieceCount).slice(0, 8), omittedDisconnectedGroups: Math.max(0, components.size - 8),
    catalogMaxHorizontalSpanStuds: Math.max(...Object.values(PARTS).map(part => Math.max(part.width, part.depth))),
    groups: ordered.slice(0, 8), omittedGroups: Math.max(0, ordered.length - 8),
    note: 'These are current-packing observations. Groups list missing lower studs in assemblies that do not reach the table; a grounded piece may legally hang from a connector above it. Disconnected groups are separate stud-connected assemblies even when each touches the table; use their bounds and piece positions to join them with legal stud connections. Assembly-blocked pieces failed the supported placement-path search: their sources identify editable geometry, not a proven obstructing neighbor. A missing path may require different packing, order or entry clearance; do not add support solely because a grounded piece is blocked. Body envelopes are conservative. A lower stud can be enclosed by another part; an aligned gap is not proof of empty air. A missing connection may be a plan or packing issue. Preserve the requested silhouette and do not silently fill cutouts.' };
}

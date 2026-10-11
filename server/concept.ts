import sharp from 'sharp';
import { COLORS, WORKSPACE } from '../shared/model.js';
import { validateProfile, type ShapeProfile } from './shape-profiles.js';
import type { ShapeBox } from './compiler.js';
import type { LikenessView } from './likeness.js';

export type ConceptComponent = {
  id: string; featureIndices: number[]; role: string; parentId: string; connection: string;
  boxes: ShapeBox[]; profiles: ShapeProfile[]; partQueries: string[];
};
export type ConstructionConcept = {
  title: string; rationale: string; features: string[]; limitations: string[]; components: ConceptComponent[];
};
export const conceptBundleSchema = { type: 'object', required: ['concepts'], properties: {
  concepts: { type: 'array', items: { type: 'object', required: ['title', 'rationale', 'features', 'limitations', 'components'], properties: {
    title: { type: 'string' }, rationale: { type: 'string' },
    features: { type: 'array', items: { type: 'string' } }, limitations: { type: 'array', items: { type: 'string' } },
    components: { type: 'array', items: { type: 'object', required: ['id', 'featureIndices', 'role', 'parentId', 'connection', 'geometryJson', 'partQueries'], properties: {
      id: { type: 'string' }, featureIndices: { type: 'array', items: { type: 'integer' } }, role: { type: 'string' }, parentId: { type: 'string' }, connection: { type: 'string' },
      geometryJson: { type: 'string', description: 'JSON-encoded object with boxes and profiles arrays using the supplied grammar. Global stud XY / plate Z coordinates. No LEGO placements yet.' },
      partQueries: { type: 'array', items: { type: 'string' } },
    } } },
  } } },
} };
export const conceptChoiceSchema = { type: 'object', required: ['selectedIndex', 'summary', 'issues'], properties: {
  selectedIndex: { type: 'integer' }, summary: { type: 'string' }, issues: { type: 'array', items: { type: 'string' } },
} };
type Point = [number, number, number];
type Face = { points: Point[]; color: string; component: string };
const text = (value: unknown, max: number) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** A visual target only. No connector, inventory or buildability claim is made. */
export function parseConcept(value: unknown): ConstructionConcept {
  if (!value || typeof value !== 'object') throw new Error('A construction concept must be an object.');
  const concept = structuredClone(value) as ConstructionConcept;
  if (!text(concept.title, 90) || !text(concept.rationale, 1500) || !Array.isArray(concept.features) || concept.features.length < 1 || concept.features.length > 16 || !concept.features.every(item => text(item, 600))
    || !Array.isArray(concept.limitations) || !concept.limitations.every(item => text(item, 600)) || !Array.isArray(concept.components) || !concept.components.length) throw new Error('The concept needs a title, rationale, defining features, limitations and named components.');
  const ids = new Set<string>(), covered = new Set<number>();
  for (const component of concept.components) {
    const encoded = component as ConceptComponent & { geometryJson?: unknown };
    if (typeof encoded.geometryJson === 'string') {
      if (encoded.geometryJson.length > 200_000) throw new Error('Concept geometry response is too large.');
      const geometry = JSON.parse(encoded.geometryJson);
      if (!geometry || typeof geometry !== 'object' || Array.isArray(geometry)) throw new Error('Concept geometry must be an object.');
      encoded.boxes = geometry.boxes === undefined ? [] : geometry.boxes;
      encoded.profiles = geometry.profiles === undefined ? [] : geometry.profiles;
      delete encoded.geometryJson;
    }
    if (!component || !/^[a-z][a-z0-9_-]{0,60}$/.test(component.id) || ids.has(component.id) || !text(component.role, 600)
      || typeof component.parentId !== 'string' || component.parentId !== '' && !ids.has(component.parentId) || !text(component.connection, 600)
      || !Array.isArray(component.featureIndices) || !component.featureIndices.every(index => Number.isInteger(index) && index >= 0 && index < concept.features.length)
      || !Array.isArray(component.boxes) || !Array.isArray(component.profiles) || !component.boxes.length && !component.profiles.length
      || !Array.isArray(component.partQueries) || !component.partQueries.every(query => text(query, 120))) throw new Error('Each concept component needs a unique ID, earlier parent, geometry, feature indices and a connection strategy.');
    ids.add(component.id); component.featureIndices.forEach(index => covered.add(index));
    for (const [i, profile] of component.profiles.entries()) validateProfile(profile, `Concept ${component.id}/profiles/${i}`);
    for (const box of component.boxes) {
      if (!box || ![box.x, box.y, box.z, box.width, box.depth, box.height, box.colorId].every(Number.isSafeInteger) || !COLORS[box.colorId]
        || box.x < 0 || box.y < 0 || box.z < 0 || box.width < 1 || box.depth < 1 || box.height < 1 || box.x + box.width > WORKSPACE.width || box.y + box.depth > WORKSPACE.depth || box.z + box.height > WORKSPACE.heightPlates
        || box.cutouts?.length) throw new Error('Concept boxes need positive integer workspace dimensions and a known color; use separate volumes for openings.');
    }
  }
  if (covered.size !== concept.features.length) throw new Error('Every defining feature must be assigned to concept geometry.');
  return structuredClone(concept);
}

function conceptFaces(concept: ConstructionConcept): Face[] {
  const faces: Face[] = [];
  const loft = (rings: Point[][], colorId: number, component: string, caps: boolean) => {
    const color = COLORS[colorId].hex;
    for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < rings[i].length; j++) faces.push({ points: [rings[i][j], rings[i][(j + 1) % rings[i].length], rings[i + 1][(j + 1) % rings[i].length], rings[i + 1][j]], color, component });
    if (caps) for (const ring of [rings[0], rings.at(-1)!]) faces.push({ points: ring, color, component });
  };
  for (const component of concept.components) {
    for (const box of component.boxes) loft([box.z, box.z + box.height].map(z => [[box.x, box.y, z], [box.x + box.width, box.y, z], [box.x + box.width, box.y + box.depth, z], [box.x, box.y + box.depth, z]]), box.colorId, component.id, true);
    for (const profile of component.profiles) {
      const start = (profile.arc?.startDegrees || 0) * Math.PI / 180, sweep = (profile.arc?.sweepDegrees || 360) * Math.PI / 180;
      let outline = profile.shape === 'polygon' ? profile.outline! : profile.shape === 'rectangle' ? [{ u: -1, v: -1 }, { u: 1, v: -1 }, { u: 1, v: 1 }, { u: -1, v: 1 }]
        : Array.from({ length: 25 }, (_, i) => ({ u: Math.cos(start + sweep * i / 24), v: Math.sin(start + sweep * i / 24) }));
      if (profile.shape === 'ellipse' && profile.arc && profile.arc.sweepDegrees < 360 && !profile.wall) outline = [{ u: 0, v: 0 }, ...outline];
      const rings = profile.sections.map(section => outline.map(({ u, v }): Point => [section.cx + u * section.width / 2, section.cy + v * section.depth / 2, section.z]));
      // Profiles are a massing preview; shell interiors and connector details are
      // intentionally not represented here, and are labeled as unverified.
      loft(rings, profile.colorId, component.id, !profile.wall);
    }
  }
  return faces;
}

/** Cheap paired massing views before any expensive brick packing. */
export function renderConceptSvg(concept: ConstructionConcept, opposite = false): string {
  const faces = conceptFaces(parseConcept(concept));
  const sign = opposite ? -1 : 1;
  const project = ([x, y, z]: Point) => [sign * (x - y) * Math.sqrt(3) / 2, sign * (x + y) / 2 - z * 0.4];
  const points = faces.flatMap(face => face.points.map(project));
  const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys), width = Math.max(...xs) - minX, height = Math.max(...ys) - minY;
  const scale = Math.min(880 / Math.max(1, width), 760 / Math.max(1, height));
  const p = (point: Point) => { const [x, y] = project(point); return `${(72 + (x - minX) * scale).toFixed(2)},${(120 + (y - minY) * scale).toFixed(2)}`; };
  const depth = (face: Face) => face.points.reduce((sum, [x, y, z]) => sum + sign * (x + y) + z * 0.4, 0) / face.points.length;
  const polygons = faces.sort((a, b) => depth(a) - depth(b)).map(face => `<polygon data-component="${escape(face.component)}" points="${face.points.map(p).join(' ')}" fill="${face.color}" stroke="#223344" stroke-opacity=".25" stroke-width=".7"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="white"/><text x="32" y="40" font-family="Arial" font-size="24" fill="#172b3a">${escape(concept.title)}</text><text x="32" y="72" font-family="Arial" font-size="17" fill="#536879">Shape study · ${opposite ? 'opposite view' : 'first view'} · not a LEGO assembly</text>${polygons}<text x="32" y="988" font-family="Arial" font-size="15" fill="#536879">Approximate exterior masses. Openings, joints and buildability still need construction checks.</text></svg>`;
}

export async function renderConceptViews(concept: ConstructionConcept): Promise<LikenessView[]> {
  return Promise.all([false, true].map(async opposite => ({ label: `CONCEPT ONLY: ${opposite ? 'opposite' : 'first'} exterior view, not a brick model`, inlineData: { mimeType: 'image/png' as const, data: (await sharp(Buffer.from(renderConceptSvg(concept, opposite))).png().toBuffer()).toString('base64') } })));
}

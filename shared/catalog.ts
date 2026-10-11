/** Pinned, self-contained assets travel with the design, never a mutable global registry. */
export type CatalogPoint = [number, number, number];
export type CatalogMesh = { vertices: CatalogPoint[]; faces: number[][] };
export type CatalogColor = { id: number; name: string; hex: string; ldrawId: number; alpha?: number };
export type CatalogAsset = { url: string; sha256: string; license: string; author?: string };
export type ImportedGeometry = {
  body: CatalogMesh;
  studs: { position: CatalogPoint; mesh: CatalogMesh }[];
  receivers: CatalogPoint[];
  /** Exact DAT-to-canonical mapping, prior to a placement's four-way yaw. */
  ldraw: { matrix: number[]; offset: CatalogPoint };
  unsupportedSnaps: string[];
  assets: CatalogAsset[];
};
export type PartDefinition = {
  id: string; name: string; width: number; depth: number; heightPlates: number;
  kind: 'brick' | 'plate' | 'slope' | 'tile' | 'round-brick' | 'round-plate' | 'cone' | 'imported';
  ldrawId: string; topStudStyle?: 'hollow'; geometry?: ImportedGeometry;
};
export type CatalogPart = PartDefinition & { allowedColors: readonly number[] };
export type CatalogManifest = {
  schemaVersion: 1;
  parts: Record<string, CatalogPart>;
  colors: Record<number, CatalogColor>;
  /** Produced-color expansion for existing geometry, with its catalog evidence. */
  partColors?: Record<string, { allowedColors: number[]; source: CatalogAsset }>;
};
export type CatalogContext = { parts: Record<string, CatalogPart>; colors: Record<number, CatalogColor> };

/** A saved build or collection carries only the definitions it actually uses. */
export function subsetCatalog(manifest: CatalogManifest, partIds: Iterable<string>, colorIds: Iterable<number> = []): CatalogManifest {
  const ids = new Set(partIds);
  const parts = Object.fromEntries(Object.entries(manifest.parts).filter(([id]) => ids.has(id)));
  const partColors = Object.fromEntries(Object.entries(manifest.partColors || {}).filter(([id]) => ids.has(id)));
  const colors = new Set([...colorIds, ...[...Object.values(parts), ...Object.values(partColors)].flatMap(part => [...part.allowedColors])]);
  return { schemaVersion: 1, parts, partColors, colors: Object.fromEntries(Object.entries(manifest.colors).filter(([id]) => colors.has(Number(id)))) };
}
// Official tessellated arc primitives can overshoot nominal grid boundaries by
// about 2.5e-5 stud. This is 0.8 micrometers, not a shape-clearance allowance.
export const CATALOG_TESSELLATION_TOLERANCE_STUDS = 1e-4;

/** Conflicting snapshots require an explicit re-resolution, never last-write-wins. */
export function mergeCatalogManifests(...manifests: (CatalogManifest | undefined)[]): CatalogManifest {
  const result: CatalogManifest = { schemaVersion: 1, parts: {}, colors: {}, partColors: {} };
  for (const manifest of manifests) {
    if (!manifest) continue;
    assertCatalogManifest(manifest);
    for (const key of ['parts', 'colors', 'partColors'] as const) {
      const target = result[key] as Record<string, unknown>;
      for (const [id, value] of Object.entries(manifest[key] || {})) {
        if (Object.hasOwn(target, id) && JSON.stringify(target[id]) !== JSON.stringify(value)) throw new Error(`Conflicting pinned catalog ${key} entry ${id}.`);
        target[id] = value;
      }
    }
  }
  return result;
}

const point = (value: unknown): value is CatalogPoint => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
const mesh = (value: CatalogMesh) => value && Array.isArray(value.vertices) && value.vertices.length > 2
  && value.vertices.every(point) && Array.isArray(value.faces) && value.faces.length > 0
  && value.faces.every(face => Array.isArray(face) && (face.length === 3 || face.length === 4)
    && face.every(index => Number.isSafeInteger(index) && index >= 0 && index < value.vertices.length));

export function assertCatalogManifest(value: CatalogManifest): void {
  const fail = () => { throw new Error('Invalid pinned part catalog.'); };
  if (!value || value.schemaVersion !== 1 || !value.parts || !value.colors || Array.isArray(value.parts) || Array.isArray(value.colors)) fail();
  for (const [id, color] of Object.entries(value.colors)) {
    if (!color || color.id !== Number(id) || !Number.isSafeInteger(color.id) || color.id < 0 || typeof color.name !== 'string' || !color.name.trim()
      || !/^#[0-9a-f]{6}$/i.test(color.hex) || !Number.isSafeInteger(color.ldrawId) || color.ldrawId < 0
      || (color.alpha !== undefined && (!Number.isFinite(color.alpha) || color.alpha <= 0 || color.alpha > 1))) fail();
  }
  if (value.partColors !== undefined) {
    if (!value.partColors || Array.isArray(value.partColors)) fail();
    for (const [id, row] of Object.entries(value.partColors!)) {
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || !row || !Array.isArray(row.allowedColors) || !row.allowedColors.length
        || !row.allowedColors.every(n => Number.isSafeInteger(n) && n >= 0) || !row.source
        || !/^https:\/\/rebrickable.com\/api\/v3\/lego\/parts\//.test(row.source.url) || !/^[a-f0-9]{64}$/.test(row.source.sha256)) fail();
    }
  }
  for (const [id, part] of Object.entries(value.parts)) {
    if (!part || !/^[a-zA-Z0-9_-]{1,80}$/.test(id) || part.id !== id || typeof part.name !== 'string' || !part.name.trim()
      || !/^[a-zA-Z0-9_-]+\.dat$/.test(part.ldrawId) || ![part.width, part.depth, part.heightPlates].every(n => Number.isSafeInteger(n) && n > 0)
      || !Array.isArray(part.allowedColors) || !part.allowedColors.length || !part.allowedColors.every(n => Number.isSafeInteger(n) && n >= 0)) fail();
    const geometry = part.geometry;
    if (part.kind !== 'imported' || !geometry || !mesh(geometry.body) || !Array.isArray(geometry.studs) || !Array.isArray(geometry.receivers)
      || !geometry.receivers.length || !geometry.studs.every(stud => point(stud.position) && mesh(stud.mesh)) || !geometry.receivers.every(point)
      || !geometry.ldraw || !point(geometry.ldraw.offset) || !Array.isArray(geometry.ldraw.matrix) || geometry.ldraw.matrix.length !== 9 || !geometry.ldraw.matrix.every(Number.isFinite)
      || !Array.isArray(geometry.assets) || !geometry.assets.length || !geometry.assets.every(asset => /^https:\/\//.test(asset.url) && /^[a-f0-9]{64}$/.test(asset.sha256) && typeof asset.license === 'string')
      || !Array.isArray(geometry.unsupportedSnaps) || !geometry.unsupportedSnaps.every(snap => typeof snap === 'string')) fail();
    const validSite = (site: CatalogPoint, z: number) => site[0] > 0 && site[0] < part.width && site[1] > 0 && site[1] < part.depth
      && Number.isInteger(site[0] - 0.5) && Number.isInteger(site[1] - 0.5) && site[2] === z;
    if (!geometry!.receivers.every(site => validSite(site, 0)) || !geometry!.studs.every(stud => validSite(stud.position, part.heightPlates))) fail();
    const epsilon = CATALOG_TESSELLATION_TOLERANCE_STUDS;
    const inside = (p: CatalogPoint, bottom: number, top: number) => p[0] >= -epsilon && p[0] <= part.width + epsilon
      && p[1] >= -epsilon && p[1] <= part.depth + epsilon && p[2] >= bottom - epsilon / 0.4 && p[2] <= top + epsilon / 0.4;
    if (!geometry!.body.vertices.every(p => inside(p, 0, part.heightPlates))
      || !geometry!.studs.every(stud => stud.mesh.vertices.every(p => inside(p, part.heightPlates, part.heightPlates + 0.5)))) fail();
    if (geometry!.ldraw.matrix.join(',') !== '0.05,0,0,0,0,0.05,0,-0.125,0') fail();
  }
}

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { unzipSync } from 'three/examples/jsm/libs/fflate.module.js';
import { CATALOG_TESSELLATION_TOLERANCE_STUDS, type CatalogAsset, type CatalogMesh, type CatalogPoint, type CatalogPart, type ImportedGeometry } from '../shared/catalog.js';

type Point = CatalogPoint;
type Transform = { matrix: number[]; offset: Point };
type Snap = { id: string; gender: string; position: Point; upright: boolean; ordinary: boolean; description: string };
type FileData = { path: string; text: string; asset: CatalogAsset };
const cacheRoot = join(process.cwd(), 'data', 'catalog', 'assets');
const identity: Transform = { matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], offset: [0, 0, 0] };
const vector = (m: number[], p: Point): Point => [0, 1, 2].map(row => p.reduce((n, v, col) => n + m[row * 3 + col] * v, 0)) as Point;
const apply = (t: Transform, p: Point): Point => vector(t.matrix, p).map((v, i) => v + t.offset[i]) as Point;
const compose = (a: Transform, b: Transform): Transform => ({ offset: apply(a, b.offset),
  matrix: Array.from({ length: 9 }, (_, i) => [0, 1, 2].reduce((sum, k) => sum + a.matrix[Math.floor(i / 3) * 3 + k] * b.matrix[k * 3 + i % 3], 0)) });
const determinant = (m: number[]) => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const safeRef = (name: string) => {
  const normalized = name.toLowerCase().replaceAll('\\', '/');
  if (!/^(?:(?:parts|p)\/)?(?:(?:s|8|48)\/)?[a-z0-9_.-]+\.dat$/.test(normalized) || normalized.includes('..')) throw new Error('Unsupported LDraw asset reference.');
  return normalized;
};
const pending = new Map<string, Promise<string | null>>();
const resolvedSources = new Map<string, FileData>();
const backoff = new Map<string, number>();
let libraryArchive: Promise<Uint8Array> | undefined;

/** One official bulk download avoids thousands of public per-file requests. */
export async function warmLDrawLibrary(signal?: AbortSignal): Promise<number> {
  libraryArchive ??= (async () => {
    const path = join(cacheRoot, 'complete.zip');
    try { return await readFile(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const url = 'https://library.ldraw.org/library/updates/complete.zip';
    const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`Official bulk LDraw library download failed (${response.status}).`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length < 100_000 || bytes[0] !== 80 || bytes[1] !== 75) throw new Error('Official LDraw library archive is invalid.');
    await mkdir(cacheRoot, { recursive: true }); await writeFile(path, bytes);
    await writeFile(join(cacheRoot, 'complete-provenance.json'), JSON.stringify({ url, sha256: createHash('sha256').update(bytes).digest('hex'), retrievedAt: new Date().toISOString() }));
    return bytes;
  })().catch(error => { libraryArchive = undefined; throw error; });
  return (await libraryArchive).length;
}

async function cachedText(url: string, signal?: AbortSignal): Promise<string | null> {
  signal?.throwIfAborted();
  const path = join(cacheRoot, hash(url) + '.json');
  try { return JSON.parse(await readFile(path, 'utf8')).text; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (pending.has(url)) return pending.get(url)!;
  const request = (async () => {
    const host = new URL(url).hostname;
    if ((backoff.get(host) || 0) > Date.now()) throw new Error(`Part asset lookup rate limited at ${host}; retry later.`);
    const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) });
    if (response.status === 429) {
      const retry = response.headers.get('retry-after');
      const wait = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : retry ? Date.parse(retry) - Date.now() : 60_000;
      backoff.set(host, Date.now() + Math.max(1000, Number.isFinite(wait) ? wait : 60_000));
    }
    if (!response.ok && response.status !== 404) throw new Error(`Part asset lookup failed (${response.status}) at ${new URL(url).hostname}.`);
    const text = response.status === 404 ? null : await response.text();
    if (text !== null && text.length > 8_000_000) throw new Error('Part asset exceeds the supported file size.');
    await mkdir(cacheRoot, { recursive: true }); await writeFile(path, JSON.stringify({ url, text }));
    return text;
  })();
  pending.set(url, request);
  try { return await request; } finally { pending.delete(url); }
}

let revision: Promise<string> | undefined;
async function shadowRevision(signal?: AbortSignal) {
  revision ??= (async () => {
    const json = await cachedText('https://api.github.com/repos/RolandMelkert/LDCadShadowLibrary/commits/main', signal);
    const sha = JSON.parse(json || '{}').sha;
    if (typeof sha !== 'string' || !/^[a-f0-9]{40}$/.test(sha)) throw new Error('Cannot pin the LDCad shadow library revision.');
    return sha;
  })().catch(error => { revision = undefined; throw error; });
  return revision;
}

async function source(name: string, signal?: AbortSignal): Promise<FileData> {
  name = safeRef(name);
  if (resolvedSources.has(name)) return resolvedSources.get(name)!;
  const paths = /^(parts|p)\//.test(name) ? [name] : name.startsWith('s/') ? [`parts/${name}`] : /^(8|48)\//.test(name) ? [`p/${name}`] : [`parts/${name}`, `p/${name}`];
  for (const path of paths) {
    const url = `https://library.ldraw.org/library/official/${path}`;
    await warmLDrawLibrary(signal);
    const extracted = unzipSync(await libraryArchive!, { filter: entry => entry.name.toLowerCase() === `ldraw/${path}` });
    const content = Object.values(extracted)[0];
    const text = content ? new TextDecoder().decode(content) : null;
    if (text === null) continue;
    if (!/^0\s/m.test(text) || !/!LICENSE/.test(text)) throw new Error('Official LDraw asset is malformed or lacks its license.');
    const result = { path, text, asset: { url, sha256: hash(text), license: text.match(/0 !LICENSE (.+)/)?.[1]?.trim() || '', author: text.match(/0 Author: (.+)/)?.[1]?.trim() } };
    resolvedSources.set(name, result); return result;
  }
  throw new Error(`No official LDraw geometry found for ${name}.`);
}

function parameters(line: string): Record<string, string> {
  return Object.fromEntries([...line.matchAll(/\[([^=\]]+)=([^\]]*)\]/g)].map(match => [match[1].toLowerCase(), match[2]]));
}
const numbers = (value: string | undefined, fallback: number[]) => value === undefined ? fallback : value.trim().split(/\s+/).map(Number);

function snapGrid(value?: string): Point[] {
  if (!value) return [[0, 0, 0]];
  const tokens = value.trim().split(/\s+/); let index = 0;
  const xc = tokens[index] === 'C'; if (xc) index++;
  const nx = Number(tokens[index++]); const zc = tokens[index] === 'C'; if (zc) index++;
  const nz = Number(tokens[index++]), dx = Number(tokens[index++]), dz = Number(tokens[index++]);
  if (index !== tokens.length || ![nx, nz].every(v => Number.isSafeInteger(v) && v > 0 && v <= 96) || ![dx, dz].every(Number.isFinite)) throw new Error('Unsupported LDCad snap grid.');
  return Array.from({ length: nx * nz }, (_, i) => [(i % nx - (xc ? (nx - 1) / 2 : 0)) * dx, 0, (Math.floor(i / nx) - (zc ? (nz - 1) / 2 : 0)) * dz]);
}

/** Ordinary 6-LDU radius studs only. Other connector semantics remain explicit. */
export function parseUprightSnaps(text: string, transform: Transform = identity): Snap[] {
  const result: Snap[] = [];
  for (const line of text.split(/\r?\n/)) {
    const kind = line.match(/^0 !LDCAD (SNAP_\w+)/)?.[1]; if (!kind) continue;
    if (kind === 'SNAP_CLEAR' || kind === 'SNAP_INCL') throw new Error(`${kind} requires connector inheritance that is not enabled for automatic import.`);
    const p = parameters(line), local: Transform = { matrix: numbers(p.ori, identity.matrix), offset: numbers(p.pos, [0, 0, 0]) as Point };
    if (local.matrix.length !== 9 || local.offset.length !== 3 || ![...local.matrix, ...local.offset].every(Number.isFinite)) throw new Error('Malformed LDCad connector transform.');
    const world = compose(transform, local);
    const axis = vector(world.matrix, [0, 1, 0]);
    const upright = Math.abs(axis[0]) < 1e-6 && Math.abs(axis[1] - 1) < 1e-6 && Math.abs(axis[2]) < 1e-6;
    const radialX = vector(world.matrix, [1, 0, 0]), radialZ = vector(world.matrix, [0, 0, 1]);
    const unitRadius = Math.abs(Math.hypot(...radialX) - 1) < 1e-6 && Math.abs(Math.hypot(...radialZ) - 1) < 1e-6
      && Math.abs(radialX.reduce((sum, v, i) => sum + v * radialZ[i], 0)) < 1e-6;
    const sections = (p.secs || '').trim().split(/\s+/);
    const roundSections = sections.length % 3 === 0 && sections.every((value, index) => index % 3 === 0
      ? value === 'R' : Number.isFinite(Number(value)) && Number(value) > 0);
    const gender = (p.gender || 'M').toUpperCase();
    // A compound socket may narrow deeper inside (flowers, for example).
    // Admit only its initial full-depth ordinary-stud seat, never the deeper
    // bar/pin hole or an open-ended male cylinder as an ordinary stud.
    const ordinary = kind === 'SNAP_CYL' && (gender === 'M' || gender === 'F') && roundSections && Number(sections[1]) === 6
      && (gender === 'M' ? sections.length === 3 && Number(sections[2]) === 4 : Number(sections[2]) >= 4) && unitRadius
      && (!p.caps || p.caps === 'one' || p.caps === (gender === 'M' ? 'A' : 'B') || gender === 'F' && p.caps === 'none')
      && !p.group && p.center !== 'true' && p.slide !== 'true';
    for (const position of snapGrid(p.grid)) result.push({ id: p.id || '', gender, position: apply(world, position), upright, ordinary, description: line.trim() });
  }
  return result;
}

const append = (target: CatalogMesh, source: CatalogMesh) => {
  const offset = target.vertices.length;
  for (const vertex of source.vertices) target.vertices.push(vertex);
  for (const face of source.faces) target.faces.push(face.map(index => index + offset));
};
const emptyMesh = (): CatalogMesh => ({ vertices: [], faces: [] });

/** Unsupported recessed mates may remain visible, but cannot support a part.
 * Keep their exact triangles only when the whole mesh fits the existing body
 * reservation. The tolerance is the same source-tessellation tolerance used
 * by pinned-catalog admission, not extra mating or collision clearance. */
export function retainContainedStudGeometry(body: CatalogMesh, input: ImportedGeometry['studs'], envelope: { width: number; depth: number; heightPlates: number }) {
  const studs: ImportedGeometry['studs'] = [], unsupportedSnaps: string[] = [];
  const result = { vertices: [...body.vertices], faces: [...body.faces] };
  const epsilon = CATALOG_TESSELLATION_TOLERANCE_STUDS;
  for (const stud of input) {
    const [x, y, z] = stud.position;
    if (z === envelope.heightPlates && Number.isInteger(x - 0.5) && Number.isInteger(y - 0.5)) { studs.push(stud); continue; }
    if (!stud.mesh.vertices.length || !stud.mesh.vertices.every(p => p.every(Number.isFinite)
      && p[0] >= -epsilon && p[0] <= envelope.width + epsilon
      && p[1] >= -epsilon && p[1] <= envelope.depth + epsilon
      && p[2] >= -epsilon / 0.4 && p[2] <= envelope.heightPlates + epsilon / 0.4)) {
      throw new Error('Offset-height or off-grid studs outside the body envelope require additional assembly semantics.');
    }
    append(result, stud.mesh);
    unsupportedSnaps.push(`Ordinary stud at (${x}, ${y}, ${z}) retained as body geometry only; recessed or off-grid mating is unsupported.`);
  }
  return { body: result, studs, unsupportedSnaps };
}

/** Input is LDraw units. Mesh vertices are preserved; only the grid reservation
 * ignores sub-micrometer tessellation noise at intended integer boundaries. */
export function uprightEnvelope(minimum: number[], maximum: number[], anchor: Point) {
  const tolerance = CATALOG_TESSELLATION_TOLERANCE_STUDS;
  const minX = anchor[0] - 10 - Math.ceil((anchor[0] - 10 - minimum[0]) / 20 - tolerance) * 20;
  const minY = anchor[2] - 10 - Math.ceil((anchor[2] - 10 - minimum[2]) / 20 - tolerance) * 20;
  return { minX, minY, width: Math.ceil((maximum[0] - minX) / 20 - tolerance), depth: Math.ceil((maximum[2] - minY) / 20 - tolerance), heightPlates: Math.ceil((maximum[1] - minimum[1]) / 8 - tolerance / 0.4) };
}

/** Rebase a cached canonical mesh without changing a single source-space point.
 * Old accepted designs keep their original snapshot and coordinate system. */
export function tightenCatalogEnvelope(part: CatalogPart): CatalogPart {
  const geometry = part.geometry!;
  const minimum = [Infinity, Infinity, Infinity], maximum = [-Infinity, -Infinity, -Infinity];
  for (const [x, y, z] of geometry.body.vertices) for (const [axis, value] of [x * 20, -z * 8, y * 20].entries()) {
    minimum[axis] = Math.min(minimum[axis], value); maximum[axis] = Math.max(maximum[axis], value);
  }
  const site = geometry.receivers[0], envelope = uprightEnvelope(minimum, maximum, [site[0] * 20, 0, site[1] * 20]);
  const dx = -envelope.minX / 20, dy = -envelope.minY / 20;
  if (!dx && !dy && part.width === envelope.width && part.depth === envelope.depth && part.heightPlates === envelope.heightPlates) return part;
  const point = ([x, y, z]: Point): Point => [x + dx, y + dy, z];
  const mesh = (value: CatalogMesh): CatalogMesh => ({ ...value, vertices: value.vertices.map(point) });
  return { ...part, width: envelope.width, depth: envelope.depth, heightPlates: envelope.heightPlates,
    geometry: { ...geometry, body: mesh(geometry.body), studs: geometry.studs.map(stud => ({ position: point(stud.position), mesh: mesh(stud.mesh) })),
      receivers: geometry.receivers.map(point), ldraw: { ...geometry.ldraw, offset: point(geometry.ldraw.offset) } } };
}

export async function resolveLDrawGeometry(ldrawId: string, signal?: AbortSignal): Promise<{ width: number; depth: number; heightPlates: number; geometry: ImportedGeometry }> {
  const assets = new Map<string, CatalogAsset>(), shadowSha = await shadowRevision(signal);
  const shadowSnaps = async (path: string, transform: Transform, included = false): Promise<Snap[]> => {
    const url = `https://raw.githubusercontent.com/RolandMelkert/LDCadShadowLibrary/${shadowSha}/${path}`;
    const text = await cachedText(url, signal); if (!text) return [];
    assets.set(url, { url, sha256: hash(text), license: 'CC BY-SA 4.0', author: 'LDCad Shadow Library contributors' });
    const snaps: Snap[] = [];
    for (const line of text.split(/\r?\n/)) {
      if (/^0 !LDCAD SNAP_INCL\b/.test(line)) {
        if (included) throw new Error('Nested LDCad snap includes require additional inheritance handling.');
        const p = parameters(line), ref = safeRef(p.ref || '');
        if (p.scale) throw new Error('Scaled snap includes are not supported.');
        const local: Transform = { matrix: numbers(p.ori, identity.matrix), offset: numbers(p.pos, [0, 0, 0]) as Point };
        for (const position of snapGrid(p.grid)) {
          const next = compose(transform, { matrix: local.matrix, offset: apply(local, position) });
          const paths = ref.startsWith('s/') ? [`parts/${ref}`] : /^(parts|p)\//.test(ref) ? [ref] : [`parts/${ref}`, `p/${ref}`];
          let found = false;
          for (const target of paths) { const result = await shadowSnaps(target, next, true); if (result.length) { snaps.push(...result); found = true; break; } }
          if (!found) throw new Error('Included LDCad connector metadata could not be resolved.');
        }
      } else snaps.push(...parseUprightSnaps(line, transform));
    }
    return snaps;
  };
  const walk = async (name: string, transform: Transform, invert: boolean, stack: string[]): Promise<{ body: CatalogMesh; studs: { position: Point; mesh: CatalogMesh }[]; snaps: Snap[] }> => {
    signal?.throwIfAborted();
    const file = await source(name, signal);
    if (stack.includes(file.path) || stack.length > 64) throw new Error('Cyclic or excessively nested LDraw reference.');
    assets.set(file.asset.url, file.asset);
    const body = emptyMesh(), studs: { position: Point; mesh: CatalogMesh }[] = [], snaps: Snap[] = [];
    let ccw = true, invertNext = false, certified = false, clip = true;
    for (const line of file.text.split(/\r?\n/)) {
      const t = line.trim().split(/\s+/);
      if (t[0] === '0') {
        if (t[1] === 'BFC') {
          if (t.includes('CERTIFY')) certified = true; if (t.includes('NOCERTIFY')) certified = false;
          if (t.includes('NOCLIP')) clip = false; if (t.includes('CLIP')) clip = true;
          if (t.includes('CW')) ccw = false; if (t.includes('CCW')) ccw = true; if (t.includes('INVERTNEXT')) invertNext = true;
        }
        continue;
      }
      if (t[0] === '1') {
        if (t[1] !== '16') throw new Error('Fixed-color or printed subparts require a multicolor material resolver.');
        const n = t.slice(2, 14).map(Number);
        if (n.length !== 12 || !n.every(Number.isFinite)) throw new Error('Malformed LDraw placement.');
        const child = await walk(t.slice(14).join(' '), compose(transform, { offset: n.slice(0, 3) as Point, matrix: n.slice(3) }), invert !== invertNext, [...stack, file.path]);
        append(body, child.body); studs.push(...child.studs); snaps.push(...child.snaps); invertNext = false;
      } else if (t[0] === '3' || t[0] === '4') {
        if (!certified || !clip) throw new Error('Uncertified or double-sided LDraw faces require separate surface handling.');
        if (t[1] !== '16') throw new Error('Fixed-color or printed faces require a multicolor material resolver.');
        const n = t.slice(2).map(Number), count = Number(t[0]);
        if (n.length !== count * 3 || !n.every(Number.isFinite)) throw new Error('Malformed LDraw face.');
        const face = Array.from({ length: count }, (_, i) => { body.vertices.push(apply(transform, n.slice(i * 3, i * 3 + 3) as Point)); return body.vertices.length - 1; });
        if ((!ccw) !== (invert !== (determinant(transform.matrix) < 0))) face.reverse();
        body.faces.push(face);
      }
    }
    const own = await shadowSnaps(file.path, transform);
    if (own.length) {
      snaps.push(...own);
      const male = own.filter(snap => snap.ordinary && snap.upright && snap.gender === 'M');
      if (file.path.startsWith('p/') && male.length === 1 && body.faces.length) {
        for (const stud of studs) append(body, stud.mesh);
        return { body: emptyMesh(), studs: [{ position: male[0].position, mesh: body }], snaps };
      }
    }
    return { body, studs, snaps };
  };
  const result = await walk(safeRef(ldrawId), identity, false, []);
  if (!result.body.vertices.length) throw new Error('Part has no resolved body.');
  const minimum = [Infinity, Infinity, Infinity], maximum = [-Infinity, -Infinity, -Infinity];
  for (const vertex of result.body.vertices) for (let axis = 0; axis < 3; axis++) {
    minimum[axis] = Math.min(minimum[axis], vertex[axis]); maximum[axis] = Math.max(maximum[axis], vertex[axis]);
  }
  const bottomSnaps = result.snaps.filter(s => s.gender === 'F' && s.ordinary && s.upright && Math.abs(s.position[1] - maximum[1]) < 1e-5);
  if (!bottomSnaps.length) throw new Error('No verified ordinary upright underside sites were resolved.');
  // Connector centers anchor the stud lattice. Rounded edges or a flattened
  // cheese-slope peak can sit inside its nominal envelope; retain their exact
  // mesh while rounding the reserved collision envelope outward, never inward.
  const anchor = bottomSnaps[0].position;
  const { minX, minY, width, depth, heightPlates } = uprightEnvelope(minimum, maximum, anchor);
  if (![width, depth, heightPlates].every(n => Number.isInteger(n) && n > 0) || width > 96 || depth > 96 || heightPlates > 384) throw new Error('Geometry does not fit the supported upright integer-stud/plate envelope.');
  const mapping: Transform = { matrix: [0.05, 0, 0, 0, 0, 0.05, 0, -0.125, 0], offset: [-minX / 20, -minY / 20, maximum[1] / 8] };
  const convert = (p: Point): Point => apply(mapping, p).map(n => Math.round(n * 1e7) / 1e7) as Point;
  const convertMesh = (mesh: CatalogMesh): CatalogMesh => {
    const vertices: Point[] = [], indices = new Map<string, number>();
    const remap = mesh.vertices.map(p => { const v = convert(p), key = v.join(','); if (!indices.has(key)) { indices.set(key, vertices.length); vertices.push(v); } return indices.get(key)!; });
    return { vertices, faces: mesh.faces.map(face => face.map(i => remap[i])) };
  };
  const allReceivers = result.snaps.filter(s => s.gender === 'F' && s.ordinary && s.upright).map(s => convert(s.position));
  const receivers = [...new Map(allReceivers.filter(p => p[2] === 0 && Number.isInteger(p[0] - 0.5) && Number.isInteger(p[1] - 0.5)).map(p => [p.join(','), p])).values()];
  if (!receivers.length) throw new Error('No verified ordinary upright underside sites were resolved.');
  const visible = retainContainedStudGeometry(convertMesh(result.body), result.studs.map(stud => ({ position: convert(stud.position), mesh: convertMesh(stud.mesh) })), { width, depth, heightPlates });
  const unsupportedSnaps = [...new Set([...result.snaps.filter(s => !s.ordinary || !s.upright).map(s => s.description), ...visible.unsupportedSnaps])];
  return { width, depth, heightPlates, geometry: { ...visible, receivers, ldraw: mapping, unsupportedSnaps, assets: [...assets.values()] } };
}

import { COLORS, footprint, normalizeDesign, partBottomSites, partHeight, partTopStuds, type Brick, type Design } from './model';
import { partSurfaces, type PartPoint } from './part-surfaces';

type RenderOptions = {
  visibleIds?: string[];
  highlightIds?: string[];
  width?: number;
  height?: number;
};

const escapeXml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
})[character]!);

function tint(hex: string, amount: number) {
  const channels = hex.replace('#', '').match(/../g)!.map((channel) => parseInt(channel, 16));
  return '#' + channels.map((channel) => Math.round(amount >= 0
    ? channel + (255 - channel) * amount : channel * (1 + amount)).toString(16).padStart(2, '0')).join('');
}

// One stud is 20 LDU; one plate body is 8 LDU. The map's +Y runs down-left.
const project = (x: number, y: number, z: number) => [(x - y) * Math.sqrt(3) / 2, (x + y) / 2 - z * 0.4];
const view: PartPoint = [1, 1, 2.5];
const dot = (a: number[], b: number[]) => a.reduce((sum, value, axis) => sum + value * b[axis], 0);

type Box = { x: number; y: number; z: number; w: number; d: number; h: number };
type Polygon = { vertices: PartPoint[]; normal: PartPoint; svg: string; clip?: boolean };
type Drawing = { vertices: PartPoint[]; normals: PartPoint[]; svg: string; marker: string; polygons: () => Polygon[] };

function boxVertices({ x, y, z, w, d, h }: Box): PartPoint[] {
  return [x, x + w].flatMap((xx) => [y, y + d].flatMap((yy) => [z, z + h].map((zz) => [xx, yy, zz] as PartPoint)));
}

function silhouette(vertices: PartPoint[]) {
  const points = vertices.map((point) => project(...point)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (a: number[], b: number[], c: number[]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const half = (sequence: number[][]) => {
    const result: number[][] = [];
    for (const point of sequence) {
      while (result.length > 1 && cross(result.at(-2)!, result.at(-1)!, point) <= 1e-8) result.pop();
      result.push(point);
    }
    return result.slice(0, -1);
  };
  return [...half(points), ...half([...points].reverse())];
}

// Disjoint solids can form a painter cycle at different plate offsets. Split
// their visible polygons with a BSP only when whole-solid ordering cannot work.
// Clipping the original artwork avoids drawing seams along the split edges.
function splitPolygonOrder(polygons: Polygon[]): Polygon[] {
  if (polygons.length < 2) return polygons;
  const epsilon = 1e-8;
  const distance = (polygon: Polygon, plane: Polygon) => {
    const offset = dot(plane.normal, plane.vertices[0]);
    return polygon.vertices.map(vertex => dot(plane.normal, vertex) - offset);
  };
  let plane = polygons[0], best = Infinity;
  // A balanced choice limits recursion and fragmentation on dense facades.
  for (let sample = 0; sample < Math.min(12, polygons.length); sample++) {
    const candidate = polygons[Math.floor(sample * polygons.length / Math.min(12, polygons.length))];
    let front = 0, back = 0, splits = 0;
    for (const polygon of polygons) {
      const distances = distance(polygon, candidate);
      const positive = distances.some(value => value > epsilon), negative = distances.some(value => value < -epsilon);
      if (positive) front++;
      if (negative) back++;
      if (positive && negative) splits++;
    }
    const score = Math.abs(front - back) + splits * 3;
    if (score < best) { best = score; plane = candidate; }
  }
  const front: Polygon[] = [], back: Polygon[] = [], coplanar: Polygon[] = [];
  for (const polygon of polygons) {
    const distances = distance(polygon, plane);
    const positive = distances.some(value => value > epsilon), negative = distances.some(value => value < -epsilon);
    if (!positive && !negative) { coplanar.push(polygon); continue; }
    if (!negative) { front.push(polygon); continue; }
    if (!positive) { back.push(polygon); continue; }
    const frontVertices: PartPoint[] = [], backVertices: PartPoint[] = [];
    polygon.vertices.forEach((vertex, index) => {
      const next = (index + 1) % polygon.vertices.length;
      const a = distances[index], b = distances[next];
      if (a >= -epsilon) frontVertices.push(vertex);
      if (a <= epsilon) backVertices.push(vertex);
      if ((a > epsilon && b < -epsilon) || (a < -epsilon && b > epsilon)) {
        const fraction = a / (a - b);
        const intersection = vertex.map((value, axis) => value + fraction * (polygon.vertices[next][axis] - value)) as PartPoint;
        frontVertices.push(intersection); backVertices.push(intersection);
      }
    });
    front.push({ ...polygon, vertices: frontVertices, clip: true });
    back.push({ ...polygon, vertices: backVertices, clip: true });
  }
  // Every supplied polygon faces the fixed orthographic camera, so the plane's
  // negative half-space is farther away. Coplanar faces retain their own art.
  return [...splitPolygonOrder(back), ...coplanar, ...splitPolygonOrder(front)];
}

// Bounding-box depth sums fail for long bricks. Only overlapping projections
// need an order; along a viewing ray X, Y and Z all increase toward the camera.
function painterOrder(drawings: Drawing[], point: (...position: PartPoint) => string) {
  const outlines = drawings.map(({ vertices }) => silhouette(vertices));
  const bounds = outlines.map((points) => ({ left: Math.min(...points.map(([x]) => x)), right: Math.max(...points.map(([x]) => x)),
    top: Math.min(...points.map(([, y]) => y)), bottom: Math.max(...points.map(([, y]) => y)) }));
  const edges = drawings.map(() => [] as number[]);
  const incoming = drawings.map(() => 0);
  const range = (vertices: number[][], normal: number[]) => {
    let min = Infinity, max = -Infinity;
    for (const vertex of vertices) { const value = dot(vertex, normal); min = Math.min(min, value); max = Math.max(max, value); }
    return [min, max];
  };
  const normals: PartPoint[] = [];
  const normalIds = new Map<string, number>();
  const planes = drawings.map(drawing => drawing.normals.map(normal => {
    const key = normal.join(',');
    if (!normalIds.has(key)) { normalIds.set(key, normals.length); normals.push(normal); }
    return normalIds.get(key)!;
  }));
  // A body is tested against many neighbors along the same few planes. Compute
  // its projection interval once rather than allocating vertex arrays per pair.
  const intervals = drawings.map(drawing => normals.map(normal => range(drawing.vertices, normal)));
  const overlaps = (a: number[][], b: number[][]) => [a, b].every((polygon) => polygon.every((point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    const normal = [point[1] - next[1], next[0] - point[0]];
    const aa = range(a, normal), bb = range(b, normal);
    return Math.min(aa[1], bb[1]) - Math.max(aa[0], bb[0]) > 1e-8;
  }));
  // Sweep projected X first. Distant pieces never need polygon/plane tests;
  // every overlapping pair still receives the same exact ordering checks.
  const sweep = bounds.map((_, index) => index).sort((a, b) => bounds[a].left - bounds[b].left);
  for (let aIndex = 0; aIndex < sweep.length; aIndex++) for (let bIndex = aIndex + 1; bIndex < sweep.length; bIndex++) {
    if (bounds[sweep[bIndex]].left >= bounds[sweep[aIndex]].right) break;
    const i = Math.min(sweep[aIndex], sweep[bIndex]), j = Math.max(sweep[aIndex], sweep[bIndex]);
    const aa = bounds[i], bb = bounds[j];
    if (aa.right <= bb.left || bb.right <= aa.left || aa.bottom <= bb.top || bb.bottom <= aa.top) continue;
    if (!overlaps(outlines[i], outlines[j])) continue;
    // A slope's empty wedge is not solid. Use separating body planes rather
    // than an AABB depth sum, which can put its rear studs behind its ramp.
    let direction = 0;
    for (const normalId of [...planes[i], ...planes[j]]) {
      const normal = normals[normalId];
      const towardCamera = dot(normal, view);
      if (Math.abs(towardCamera) < 1e-8) continue;
      const aa = intervals[i][normalId], bb = intervals[j][normalId];
      if (aa[1] <= bb[0] + 1e-8) direction = Math.sign(towardCamera);
      else if (bb[1] <= aa[0] + 1e-8) direction = -Math.sign(towardCamera);
      if (direction) break;
    }
    if (!direction) continue;
    const from = direction > 0 ? i : j, to = direction > 0 ? j : i;
    edges[from].push(to);
    incoming[to]++;
  }
  const ready = incoming.flatMap((count, index) => count ? [] : [index]);
  const ordered: Drawing[] = [];
  for (let cursor = 0; cursor < ready.length; cursor++) {
    const index = ready[cursor];
    ordered.push(drawings[index]);
    for (const next of edges[index]) if (--incoming[next] === 0) ready.push(next);
  }
  const prefix = ordered.map(({ svg }) => svg).join('');
  if (ordered.length === drawings.length) return prefix;
  const unresolved = drawings.filter((_, index) => incoming[index] > 0);
  const fragments = splitPolygonOrder(unresolved.flatMap(drawing => drawing.polygons()));
  return prefix + unresolved.map(drawing => drawing.marker).join('') + fragments.map((polygon, index) => {
    if (!polygon.clip) return polygon.svg;
    const id = `occlusion-fragment-${index}`;
    const points = polygon.vertices.map(vertex => point(...vertex).split(',').map(Number));
    const winding = Math.sign(points.reduce((sum, [x, y], i) => {
      const next = points[(i + 1) % points.length]; return sum + x * next[1] - y * next[0];
    }, 0));
    const normals = points.map(([x, y], i) => {
      const next = points[(i + 1) % points.length], length = Math.hypot(next[0] - x, next[1] - y);
      return length ? [(next[1] - y) / length * winding, (x - next[0]) / length * winding] : [0, 0];
    });
    // Adjacent antialiased clips otherwise leave translucent hairlines. A
    // subpixel bleed joins them; the original artwork retains the outer edge.
    const clip = points.map(([x, y], i) => {
      const a = normals[(i + normals.length - 1) % normals.length], b = normals[i];
      const bleed = 0.75 / Math.max(0.1, 1 + dot(a, b));
      return `${x + (a[0] + b[0]) * bleed},${y + (a[1] + b[1]) * bleed}`;
    }).join(' ');
    return `<defs><clipPath id="${id}"><polygon points="${clip}"/></clipPath></defs><g clip-path="url(#${id})">${polygon.svg}</g>`;
  }).join('');
}

/** A fixed isometric camera fitted to the complete design, including hidden bricks. */
export function renderDesignSvg(design: Design, options: RenderOptions = {}): string {
  design = normalizeDesign(design);
  const width = options.width ?? 1000;
  const height = options.height ?? 650;
  const showCue = width >= 300 && height >= 200;
  const corners = design.bricks.flatMap((brick) => {
    const size = footprint(brick);
    return [brick.x, brick.x + size.width].flatMap((x) => [brick.y, brick.y + size.depth]
      .flatMap((y) => [brick.z, brick.z + partHeight(brick) + 0.5].map((z) => project(x, y, z))));
  });
  if (!corners.length) return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"/>`;
  const left = Math.min(...corners.map(([x]) => x));
  const right = Math.max(...corners.map(([x]) => x));
  const top = Math.min(...corners.map(([, y]) => y));
  const bottom = Math.max(...corners.map(([, y]) => y));
  const padding = Math.min(width, height) * 0.06;
  const cueHeight = showCue ? 48 : 0;
  const scale = Math.min((width - 2 * padding) / Math.max(1, right - left),
    (height - 2 * padding - cueHeight) / Math.max(1, bottom - top));
  const offsetX = (width - (right - left) * scale) / 2 - left * scale;
  const offsetY = (height - cueHeight - (bottom - top) * scale) / 2 - top * scale;
  const screen = (x: number, y: number, z: number) => {
    const [px, py] = project(x, y, z);
    return [px * scale + offsetX, py * scale + offsetY];
  };
  const point = (x: number, y: number, z: number) => screen(x, y, z).map((value) => value.toFixed(2)).join(',');
  const visible = options.visibleIds ? new Set(options.visibleIds) : null;
  const highlighted = options.highlightIds ? new Set(options.highlightIds) : null;
  const bricks = design.bricks.filter((brick) => !visible || visible.has(brick.id));
  const occupied = new Set(bricks.flatMap((brick) => partBottomSites(brick).map(({ x, y, z }) => `${x},${y},${z}`)));
  const drawBrick = (brick: Brick) => {
    const faded = highlighted !== null && !highlighted.has(brick.id);
    const base = COLORS[brick.colorId].hex;
    const color = faded ? tint(base, 0.77) : base;
    const stroke = faded ? '#b2c8cf' : tint(color, -0.43);
    const strokeWidth = Math.max(0.45, Math.min(1.4, scale * 0.03));
    const face = (points: string[], fill: string) => `<polygon points="${points.join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>`;
    const body = partSurfaces(brick);
    const polygons: Polygon[] = body.faces.filter(({ normal }) => dot(normal, view) > 1e-8).map(({ indices, normal }) => {
      const metricNormal = [normal[0], normal[1], normal[2] / 0.4];
      const shade = dot(metricNormal, [-0.3, -0.15, 0.08]) / metricNormal.reduce((sum, value) => sum + Math.abs(value), 0);
      return { vertices: indices.map(index => body.vertices[index]), normal,
        svg: face(indices.map((index) => point(...body.vertices[index])), tint(color, shade)) };
    });
    const marker = `<g data-brick-id="${escapeXml(brick.id)}" data-highlighted="${highlighted?.has(brick.id) ?? false}">`;
    const drawings: Drawing[] = [{ vertices: body.vertices, normals: body.faces.map(({ normal }) => normal),
      svg: `${marker}${polygons.map(polygon => polygon.svg).join('')}</g>`, marker: `${marker}</g>`, polygons: () => polygons }];
    for (const { x, y, z } of partTopStuds(brick)) {
      // An attached brick encloses the stud; never draw it through that brick.
      if (occupied.has(`${x},${y},${z}`)) continue;
      const [cx, cy] = screen(x, y, z);
      const rx = scale * 0.3 * Math.sqrt(1.5);
      const ry = scale * 0.3 * Math.sqrt(0.5);
      const rise = scale * 0.2;
      const stud = `<path d="M ${cx - rx} ${cy - rise} L ${cx - rx} ${cy} A ${rx} ${ry} 0 0 0 ${cx + rx} ${cy} L ${cx + rx} ${cy - rise} Z" fill="${tint(color, -0.15)}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`
        + `<ellipse cx="${cx}" cy="${cy - rise}" rx="${rx}" ry="${ry}" fill="${tint(color, 0.16)}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
      drawings.push({ vertices: boxVertices({ x: x - 0.3, y: y - 0.3, z, w: 0.6, d: 0.6, h: 0.5 }),
        normals: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        svg: `<g data-stud-owner="${escapeXml(brick.id)}">${stud}</g>`, marker: `<g data-stud-owner="${escapeXml(brick.id)}"/>`,
        polygons: () => {
          const ring = Array.from({ length: 32 }, (_, index): PartPoint => {
            const angle = index * 2 * Math.PI / 32;
            return [x + 0.3 * Math.cos(angle), y + 0.3 * Math.sin(angle), z + 0.5];
          });
          const surfaces: Polygon[] = [{ vertices: ring, normal: [0, 0, 1], svg: stud, clip: true }];
          for (let index = 0; index < ring.length; index++) {
            const a = ring[index], b = ring[(index + 1) % ring.length];
            const normal: PartPoint = [(a[0] + b[0]) / 2 - x, (a[1] + b[1]) / 2 - y, 0];
            if (dot(normal, view) > 1e-8) surfaces.push({ vertices: [a, [a[0], a[1], z], [b[0], b[1], z], b], normal, svg: stud, clip: true });
          }
          return surfaces;
        } });
    }
    return drawings;
  };
  const cue = showCue ? `<g font-family="Helvetica,Arial,sans-serif" font-size="12" fill="#356278" stroke="#356278" stroke-width="1.5">
    <path d="M 38 ${height - 34} L 62 ${height - 20} M 38 ${height - 34} L 14 ${height - 20} M 38 ${height - 34} L 38 ${height - 58}" fill="none"/>
    <text x="66" y="${height - 16}" stroke="none">+X</text><text x="4" y="${height - 8}" stroke="none">+Y</text>
    <text x="47" y="${height - 48}" stroke="none">UP</text><text x="${width - 12}" y="${height - 14}" text-anchor="end" stroke="none">FRONT</text>
  </g>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(design.title)} brick model"><title>${escapeXml(design.title)}</title>${painterOrder(bricks.flatMap(drawBrick), point)}${cue}</svg>`;
}

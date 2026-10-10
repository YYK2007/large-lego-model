import { COLORS, footprint, type Brick, type Design } from './model';

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

// One stud is 20 LDU; one brick body is 24 LDU. The map's +Y runs down-left.
const project = (x: number, y: number, z: number) => [(x - y) * Math.sqrt(3) / 2, (x + y) / 2 - z * 1.2];

/** A fixed isometric camera fitted to the complete design, including hidden bricks. */
export function renderDesignSvg(design: Design, options: RenderOptions = {}): string {
  const width = options.width ?? 1000;
  const height = options.height ?? 650;
  const showCue = width >= 300 && height >= 200;
  const corners = design.bricks.flatMap((brick) => {
    const size = footprint(brick);
    return [brick.x, brick.x + size.width].flatMap((x) => [brick.y, brick.y + size.depth]
      .flatMap((y) => [brick.z, brick.z + 1.18].map((z) => project(x, y, z))));
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
  const drawBrick = (brick: Brick) => {
    const { width: w, depth: d } = footprint(brick);
    const { x, y, z } = brick;
    const faded = highlighted !== null && !highlighted.has(brick.id);
    const base = COLORS[brick.colorId].hex;
    const color = faded ? tint(base, 0.77) : base;
    const stroke = faded ? '#b2c8cf' : tint(color, -0.43);
    const strokeWidth = Math.max(0.45, Math.min(1.4, scale * 0.03));
    const face = (points: string[], fill: string) => `<polygon points="${points.join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>`;
    let shape = face([point(x, y + d, z), point(x + w, y + d, z), point(x + w, y + d, z + 1), point(x, y + d, z + 1)], tint(color, -0.15));
    shape += face([point(x + w, y, z), point(x + w, y + d, z), point(x + w, y + d, z + 1), point(x + w, y, z + 1)], tint(color, -0.3));
    shape += face([point(x, y, z + 1), point(x + w, y, z + 1), point(x + w, y + d, z + 1), point(x, y + d, z + 1)], tint(color, 0.08));
    for (let row = 0; row < d; row++) for (let column = 0; column < w; column++) {
      const [cx, cy] = screen(x + column + 0.5, y + row + 0.5, z + 1);
      const rx = scale * 0.3;
      const ry = scale * 0.173;
      const rise = scale * 0.16;
      shape += `<path d="M ${cx - rx} ${cy - rise} L ${cx - rx} ${cy} A ${rx} ${ry} 0 0 0 ${cx + rx} ${cy} L ${cx + rx} ${cy - rise} Z" fill="${tint(color, -0.15)}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
      shape += `<ellipse cx="${cx}" cy="${cy - rise}" rx="${rx}" ry="${ry}" fill="${tint(color, 0.16)}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
    }
    return `<g data-brick-id="${escapeXml(brick.id)}" data-highlighted="${highlighted?.has(brick.id) ?? false}">${shape}</g>`;
  };
  const bricks = [...design.bricks].filter((brick) => !visible || visible.has(brick.id))
    .sort((a, b) => (a.x + a.y + a.z * 2) - (b.x + b.y + b.z * 2) || a.z - b.z);
  const cue = showCue ? `<g font-family="Helvetica,Arial,sans-serif" font-size="12" fill="#356278" stroke="#356278" stroke-width="1.5">
    <path d="M 38 ${height - 34} L 62 ${height - 20} M 38 ${height - 34} L 14 ${height - 20} M 38 ${height - 34} L 38 ${height - 58}" fill="none"/>
    <text x="66" y="${height - 16}" stroke="none">+X</text><text x="4" y="${height - 8}" stroke="none">+Y</text>
    <text x="47" y="${height - 48}" stroke="none">UP</text><text x="${width - 12}" y="${height - 14}" text-anchor="end" stroke="none">FRONT</text>
  </g>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(design.title)} brick model"><title>${escapeXml(design.title)}</title>${bricks.map(drawBrick).join('')}${cue}</svg>`;
}

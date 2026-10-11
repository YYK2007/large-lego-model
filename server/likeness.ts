import sharp from 'sharp';
import { renderDesignSvg } from '../shared/illustration.js';
import { catalogForDesign, footprint, normalizeDesign, validateDesign, type Brick, type Design } from '../shared/model.js';

export type LikenessView = { label: string; inlineData: { mimeType: 'image/png'; data: string } };

/** Exact compiled parts from opposite elevated corners, not photographic or generated previews. */
export async function renderLikenessViews(input: Design): Promise<LikenessView[]> {
  const design = normalizeDesign(input);
  const catalog = catalogForDesign(design);
  const check = validateDesign(design);
  if (!check.valid) throw new Error(`Cannot compare an invalid design: ${check.errors.join('; ')}`);
  const maxX = Math.max(...design.bricks.map(brick => brick.x + footprint(brick, catalog).width));
  const maxY = Math.max(...design.bricks.map(brick => brick.y + footprint(brick, catalog).depth));
  // A half-turn about the model bounds preserves every body, stud, and underside site.
  const opposite: Design = { ...design, bricks: design.bricks.map(brick => ({ ...brick,
    x: maxX - brick.x - footprint(brick, catalog).width, y: maxY - brick.y - footprint(brick, catalog).depth,
    rotation: ((brick.rotation + 180) % 360) as Brick['rotation'],
  })) };
  const views = [{ design, label: 'Isometric from +X / +Y', direction: '+' },
    { design: opposite, label: 'Isometric from -X / -Y', direction: '-' }];
  const result: LikenessView[] = [];
  for (const view of views) {
    // The shared renderer's fixed camera cues describe its temporary coordinates.
    // Relabel them in the original model's axes; neither view is a front elevation.
    const svg = renderDesignSvg(view.design, { width: 1024, height: 976 })
      .replace('>FRONT</text>', `>${view.direction}X / ${view.direction}Y</text>`)
      .replace('>+X</text>', `>${view.direction}X</text>`).replace('>+Y</text>', `>${view.direction}Y</text>`);
    const header = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="48"><rect width="1024" height="48" fill="white"/><text x="24" y="31" font-family="Arial,sans-serif" font-size="22" fill="#172b3a">${view.label} · ${design.bricks.length} real pieces</text></svg>`);
    const pixels = await sharp(Buffer.from(svg)).flatten({ background: '#ffffff' }).extend({ top: 48, bottom: 0, left: 0, right: 0, background: '#ffffff' })
      .composite([{ input: header, top: 0, left: 0 }]).png().toBuffer();
    result.push({ label: view.label, inlineData: { mimeType: 'image/png', data: pixels.toString('base64') } });
  }
  return result;
}

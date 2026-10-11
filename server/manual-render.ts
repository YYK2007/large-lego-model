import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import sharp from 'sharp';
import { allocateInventory, billOfMaterials, buildSteps, catalogForDesign, footprint, normalizeDesign, partHeight, validateDesign, type Brick, type Design, type InventoryItem, type CatalogContext } from '../shared/model';
import { renderDesignSvg } from '../shared/illustration';
import { groupManualSteps, type ManualStepGroup } from '../shared/manual-repeats';
import type { PartPoint } from '../shared/part-surfaces';

const INK = '#163744', BLUE = '#087da7', MUTED = '#607782';
const WIDTH = 841.89, HEIGHT = 595.28, MARGIN = 28, PANEL = (WIDTH - MARGIN * 2 - 24) / 2;
type SceneOptions = Parameters<typeof renderDesignSvg>[1];

function text(doc: PDFKit.PDFDocument, value: string, x: number, y: number, width: number, size = 10, bold = false, color = INK) {
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(color).text(value, x, y, { width, lineGap: 1.5 });
}
function heading(doc: PDFKit.PDFDocument, label: string, title: string) {
  doc.addPage();
  text(doc, label.toUpperCase(), MARGIN, 55, WIDTH - MARGIN * 2, 9, true, BLUE);
  text(doc, title, MARGIN, 73, WIDTH - MARGIN * 2, 25, true);
}
function singlePart(design: Design, partId: string, colorId: number): Design {
  return { ...design, bricks: [{ id: 'part', partId, colorId, x: 0, y: 0, z: 0, rotation: 0 }] };
}
function vector(doc: PDFKit.PDFDocument, design: Design, x: number, y: number, width: number, height: number) {
  SVGtoPDF(doc, renderDesignSvg(design, { width, height, showCue: false }), x, y, { width, height, assumePt: true });
}
async function scene(doc: PDFKit.PDFDocument, design: Design, x: number, y: number, width: number, height: number, options: SceneOptions = {}) {
  const svg = renderDesignSvg(design, { ...options, width, height, showCue: false });
  if (svg.length < 100_000) return SVGtoPDF(doc, svg, x, y, { width, height, assumePt: true });
  // Only a cropped assembly region is drawn. A compact 96-dpi palette image
  // preserves line-art detail without JPEG halos; labels remain vector.
  const image = await sharp(Buffer.from(svg), { density: 96 }).flatten({ background: '#ffffff' }).png({ palette: true, colors: 128, dither: 0 }).toBuffer();
  doc.image(image, x, y, { width, height });
}
function partsTray(doc: PDFKit.PDFDocument, design: Design, bricks: Brick[], x: number, y: number, width: number, pictures: Map<string, string>) {
  const parts = billOfMaterials({ ...design, bricks });
  const columns = Math.min(4, parts.length), cell = width / columns;
  const rows = Math.ceil(parts.length / columns), height = rows * 43 + 10;
  doc.roundedRect(x, y, width, height, 7).fill('#f0f6f5');
  parts.forEach((part, index) => {
    const left = x + index % columns * cell, top = y + 4 + Math.floor(index / columns) * 43;
    doc.image(pictures.get(`${part.partId}:${part.colorId}`)!, left + 3, top, { fit: [cell * 0.55, 30], align: 'center', valign: 'center' });
    text(doc, `${part.quantity}x`, left + cell * 0.55, top + 5, cell * 0.4, 13, true);
    text(doc, part.partId, left + 5, top + 29, cell - 8, 8, false, MUTED);
  });
  return height;
}
function frontCue(doc: PDFKit.PDFDocument, x: number, y: number) {
  doc.moveTo(x, y).lineTo(x + 14, y + 8).lineTo(x + 10, y + 1).moveTo(x + 14, y + 8).lineTo(x + 6, y + 8).lineWidth(1).strokeColor(MUTED).stroke();
  text(doc, 'FRONT', x + 20, y - 1, 50, 8, true, MUTED);
}
function checkedArrows(group: ManualStepGroup, catalog: CatalogContext) {
  if (group.steps[0].placements[0].approach === 'above') return [];
  const step = group.steps[0], brick = step.bricks[0], size = footprint(brick, catalog);
  const center = (point: { x: number; y: number; z: number }): PartPoint => [point.x + size.width / 2, point.y + size.depth / 2, point.z + partHeight(brick, catalog) / 2];
  return step.placements[0].waypoints.slice(1).map((point, i) => ({ from: center(step.placements[0].waypoints[i]), to: center(point) }));
}
async function instructionPanel(doc: PDFKit.PDFDocument, design: Design, group: ManualStepGroup, visibleIds: string[], x: number, catalog: CatalogContext, pictures: Map<string, string>) {
  const first = group.steps[0], last = group.steps.at(-1)!, repeated = group.steps.length > 1;
  const cycles = group.steps.length / (group.patternLength ?? 1);
  const bricks = group.steps.flatMap(step => step.bricks), ids = bricks.map(brick => brick.id);
  text(doc, repeated ? `${first.index}-${last.index}` : String(first.index), x, 55, PANEL, 31, true);
  text(doc, repeated ? `${cycles} ${group.patternLength === 2 ? 'cycles' : 'repeats'} / ${bricks.length} pieces total` : `${bricks.length} new ${bricks.length === 1 ? 'piece' : 'pieces'}`, x + 155, 70, PANEL - 155, 10, false, MUTED);
  const trayHeight = partsTray(doc, design, bricks, x, 101, PANEL, pictures);
  const top = 111 + trayHeight;
  if (group.patternLength === 2) {
    const cell = (PANEL - 12) / 2;
    for (let i = 0; i < 2; i++) {
      const origin = group.origins[i], step = group.steps[i];
      const template = { ...design, bricks: step.bricks.map(brick => ({ ...brick, x: brick.x - origin.x, y: brick.y - origin.y, z: brick.z - origin.z })) };
      const left = x + i * (cell + 12);
      doc.roundedRect(left, top, cell, 103, 6).lineWidth(0.7).strokeColor('#bed6df').stroke();
      vector(doc, template, left + 4, top + 3, cell - 8, 76);
      text(doc, `${i === 0 ? 'A' : 'B'} / ${step.bricks.length} pieces`, left + 7, top + 83, cell - 14, 10, true, BLUE);
    }
    text(doc, `A then B, ${cycles}x. Stack directly on the model.`, x, top + 112, PANEL, 11, true, BLUE);
    await scene(doc, design, x, top + 138, PANEL, 500 - top - 138, { visibleIds, highlightIds: ids, focusIds: ids });
    const perCycle = first.bricks.length + group.steps[1].bricks.length;
    text(doc, `Steps ${first.index}-${last.index} in order. ${perCycle} pieces per cycle.`, x, 510, PANEL, 10, true, BLUE);
  } else if (repeated) {
    const origin = group.origins[0];
    const template = { ...design, bricks: first.bricks.map(brick => ({ ...brick, x: brick.x - origin.x, y: brick.y - origin.y, z: brick.z - origin.z })) };
    doc.roundedRect(x, top, 134, 103, 6).lineWidth(0.7).strokeColor('#bed6df').stroke();
    vector(doc, template, x + 4, top + 3, 126, 74);
    text(doc, `${group.steps.length}x`, x + 92, top + 78, 36, 17, true, BLUE);
    text(doc, 'ONE REPEAT', x + 7, top + 82, 84, 8, true, MUTED);
    text(doc, group.kind === 'stack' ? 'Stack this pattern upward.' : 'Repeat at the highlighted locations.', x + 149, top + 17, PANEL - 153, 13, true);
    text(doc, 'Place directly on the model, in step order.', x + 149, top + 56, PANEL - 153, 10, false, MUTED);
    const labels = group.kind === 'placements' ? group.steps.map((step, index) => {
      const bounds = step.bricks.reduce((b, brick) => {
        const size = footprint(brick, catalog);
        return [Math.min(b[0], brick.x), Math.max(b[1], brick.x + size.width), Math.min(b[2], brick.y), Math.max(b[3], brick.y + size.depth), Math.max(b[4], brick.z + partHeight(brick, catalog))];
      }, [Infinity, -Infinity, Infinity, -Infinity, -Infinity]);
      return { point: [(bounds[0] + bounds[1]) / 2, (bounds[2] + bounds[3]) / 2, bounds[4] + 0.6] as PartPoint, text: String(index + 1) };
    }) : undefined;
    await scene(doc, design, x, top + 108, PANEL, 500 - top - 108, { visibleIds, highlightIds: ids, focusIds: ids, labels });
    // All original step destinations remain accessible without making the main
    // instruction page a coordinate worksheet.
    text(doc, `Steps ${first.index}-${last.index} in order. ${first.bricks.length} ${first.bricks.length === 1 ? 'piece' : 'pieces'} per repeat.`, x, 510, PANEL, 10, true, BLUE);
  } else {
    const hanging = first.placements[0].approach !== 'above';
    await scene(doc, design, x, top, PANEL, (hanging ? 460 : 510) - top, { visibleIds, highlightIds: ids, focusIds: ids, arrows: checkedArrows(group, catalog) });
    if (hanging) {
      text(doc, 'ATTACH FROM BELOW', x, 468, PANEL, 10, true, BLUE);
      text(doc, first.instruction, x, 486, PANEL, 9);
    }
  }
  frontCue(doc, x, 540);
  text(doc, 'Color = add now. Pale = already placed.', x + 89, 539, PANEL - 89, 8, false, MUTED);
}

/** Illustrated companion; the embedded data preserves every checked placement. */
export async function renderManualPdf(design: Design, inventory?: InventoryItem[]): Promise<Buffer> {
  const validation = validateDesign(design);
  if (!validation.valid) throw new Error(`Cannot create instructions for an invalid design: ${validation.errors.join('; ')}`);
  design = normalizeDesign(design);
  const catalog = catalogForDesign(design), steps = buildSteps(design), groups = groupManualSteps(steps), bom = billOfMaterials(design);
  // A stable data URI lets PDFKit embed each exact part/color thumbnail once,
  // instead of duplicating thousands of stud paths in every parts tray.
  const pictures = new Map<string, string>();
  for (const item of bom) {
    const svg = renderDesignSvg(singlePart(design, item.partId, item.colorId), { width: 96, height: 56, showCue: false });
    const image = await sharp(Buffer.from(svg), { density: 144 }).png().toBuffer();
    pictures.set(`${item.partId}:${item.colorId}`, `data:image/png;base64,${image.toString('base64')}`);
  }
  const allocation = inventory ? allocateInventory(design, inventory) : undefined;
  const allocationRows = allocation?.items.flatMap(item => [
    ...item.sources.map(source => ({ ...item, source: source.source, take: source.quantity, missing: false })),
    ...(item.missing ? [{ ...item, source: 'Missing - obtain before building', take: item.missing, missing: true }] : []),
  ]) ?? [];
  const imported = [...new Set(design.bricks.map(brick => brick.partId))].map(id => catalog.parts[id]).filter(part => part.geometry);
  const doc = new PDFDocument({ autoFirstPage: false, size: 'A4', layout: 'landscape', margin: MARGIN, bufferPages: false,
    info: { Title: `${design.title} - Building instructions`, Author: 'Sprout', Subject: `Design ${design.id}` } });
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => { doc.on('data', chunk => chunks.push(chunk)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
  const credits = imported.map(part => {
    const authors = [...new Set(part.geometry!.assets.map(asset => asset.author).filter(Boolean))].join('; ');
    const title = `${part.id} / ${part.name}`;
    const titleHeight = doc.font('Helvetica-Bold').fontSize(10).heightOfString(title, { width: WIDTH - MARGIN * 2 });
    const authorHeight = doc.font('Helvetica').fontSize(8).heightOfString(authors, { width: WIDTH - MARGIN * 2 });
    return { part, title, authors, titleHeight, height: titleHeight + authorHeight + 18 };
  });
  let creditPages = 0, creditY = 560;
  for (const row of credits) { if (creditY + row.height > 535) { creditPages++; creditY = 158; } creditY += row.height; }
  const totalPages = 1 + Math.ceil(groups.length / 2) + Math.ceil(bom.length / 28) + Math.ceil(allocationRows.length / 26) + creditPages;
  let pageNumber = 0;
  doc.on('pageAdded', () => {
    pageNumber++;
    text(doc, 'Large LEGO Model', MARGIN, 20, 400, 10, true, BLUE);
    doc.moveTo(MARGIN, HEIGHT - 30).lineTo(WIDTH - MARGIN, HEIGHT - 30).lineWidth(0.6).strokeColor('#dbe8ed').stroke();
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(design.title, MARGIN, HEIGHT - 22, { lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(8).fillColor(BLUE).text(`${String(pageNumber).padStart(2, '0')} / ${String(totalPages).padStart(2, '0')}`, WIDTH - 98, HEIGHT - 22, { lineBreak: false });
  });
  doc.file(Buffer.from(JSON.stringify({ designId: design.id, coordinateSystem: design.coordinateSystem, steps })), {
    name: 'exact-placements.json', description: 'Exact ordered parts, positions, rotations and checked placement paths for this design.',
  });

  doc.addPage();
  doc.roundedRect(28, 53, 475, 486, 14).fill(doc.linearGradient(0, 53, 0, 539).stop(0, '#e1f4fd').stop(1, '#f2f8e9'));
  await scene(doc, design, 35, 64, 460, 460);
  let titleSize = 26;
  while (titleSize > 16 && doc.font('Helvetica-Bold').fontSize(titleSize).heightOfString(design.title, { width: 280 }) > 76) titleSize--;
  text(doc, design.title, 531, 66, 280, titleSize, true);
  text(doc, `${design.bricks.length} PIECES / ${steps.length} BUILD STEPS`, 531, 155, 280, 11, true, BLUE);
  const summary = design.description.match(/^[\s\S]*?[.!?](?:\s|$)/)?.[0].trim() || design.description;
  text(doc, summary.length > 300 ? `${summary.slice(0, 297).replace(/\s+\S*$/, '')}...` : summary, 531, 184, 280, 10, false, MUTED);
  text(doc, 'Build left to right.', 531, 304, 280, 16, true);
  text(doc, 'Gather the pictured parts. Add the colored pieces to the pale assembly. Keep the same front. A close view may crop parts you already built.', 531, 332, 280, 11);
  text(doc, 'xN repeats a placement pattern. Stack pages build upward on the model; do not assemble separate copies.', 531, 401, 280, 10);
  text(doc, 'Parts and source-set quantities follow the instructions. Exact coordinates and paths are included in the attached exact-placements.json.', 531, 452, 280, 9, false, MUTED);
  if (allocation) text(doc, allocation.totalMissing ? `COLLECTION CHECK: ${allocation.totalMissing} bricks missing.` : 'COLLECTION CHECK: All required pieces are allocated.', 531, 497, 280, 9, true, allocation.totalMissing ? '#a14826' : '#268255');
  text(doc, 'Connection checks do not verify physical strength. Support loose pieces while building.', 531, 523, 280, 8, false, MUTED);

  const visibleIds: string[] = [];
  for (let i = 0; i < groups.length; i++) {
    if (i % 2 === 0) { doc.addPage(); doc.moveTo(WIDTH / 2, 52).lineTo(WIDTH / 2, 552).lineWidth(0.7).strokeColor('#dbe8ed').stroke(); }
    visibleIds.push(...groups[i].steps.flatMap(step => step.bricks.map(brick => brick.id)));
    await instructionPanel(doc, design, groups[i], [...visibleIds], MARGIN + i % 2 * (PANEL + 24), catalog, pictures);
  }

  for (let offset = 0; offset < bom.length; offset += 28) {
    heading(doc, 'Parts list', offset ? 'Everything you need, continued' : 'Everything you need');
    text(doc, 'Match the part and its color. Quantities cover the complete model.', MARGIN, 108, 780, 10, false, MUTED);
    bom.slice(offset, offset + 28).forEach((item, i) => {
      const x = MARGIN + Math.floor(i / 14) * (PANEL + 24), y = 140 + i % 14 * 28;
      if (i % 2 === 0) doc.roundedRect(x, y - 2, PANEL, 27, 4).fill('#f0f6f5');
      doc.image(pictures.get(`${item.partId}:${item.colorId}`)!, x + 2, y, { fit: [45, 23], align: 'center', valign: 'center' });
      text(doc, `${item.partId} / ${catalog.parts[item.partId].name.replaceAll('×', 'x')}`, x + 54, y, PANEL - 93, 8, true);
      text(doc, catalog.colors[item.colorId].name, x + 54, y + 12, PANEL - 93, 8, false, MUTED);
      text(doc, `${item.quantity}x`, x + PANEL - 35, y + 5, 34, 11, true, BLUE);
    });
  }
  for (let offset = 0; offset < allocationRows.length; offset += 26) {
    heading(doc, 'Your collection', offset ? 'Your pieces, continued' : 'Where your pieces come from');
    text(doc, allocation!.totalMissing ? `${allocation!.totalMissing} bricks missing. Obtain these before building.` : 'All required pieces are allocated from your saved collection.', MARGIN, 108, 780, 10, false, MUTED);
    allocationRows.slice(offset, offset + 26).forEach((item, i) => {
      const x = MARGIN + Math.floor(i / 13) * (PANEL + 24), y = 143 + i % 13 * 30;
      if (i % 2 === 0) doc.roundedRect(x, y - 3, PANEL, 29, 4).fill('#f0f6f5');
      text(doc, `${item.partId} / ${catalog.colors[item.colorId].name}`, x + 4, y, PANEL - 40, 9, true);
      text(doc, item.source.slice(0, 65), x + 4, y + 13, PANEL - 40, 8, false, item.missing ? '#a14826' : MUTED);
      text(doc, `${item.take}x`, x + PANEL - 34, y + 4, 34, 10, true, BLUE);
    });
  }
  let y = 560;
  for (const row of credits) {
    if (y + row.height > 535) {
      heading(doc, 'Part geometry credits', 'Pinned catalog sources');
      text(doc, 'LDraw geometry: CC BY 4.0. Connector metadata: LDCad Shadow Library, CC BY-SA 4.0. Exact source URLs and hashes accompany the saved design. Metallic colors use catalog RGB; their surface finish is not simulated.', MARGIN, 108, WIDTH - MARGIN * 2, 9, false, MUTED);
      y = 158;
    }
    text(doc, row.title, MARGIN, y, WIDTH - MARGIN * 2, 10, true);
    text(doc, row.authors, MARGIN, y + row.titleHeight + 3, WIDTH - MARGIN * 2, 8, false, MUTED);
    doc.link(MARGIN, y, WIDTH - MARGIN * 2, row.titleHeight, `https://library.ldraw.org/library/official/parts/${row.part.ldrawId}`);
    y += row.height;
  }
  doc.end();
  return result;
}

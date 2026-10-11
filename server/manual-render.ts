import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import sharp from 'sharp';
import { allocateInventory, billOfMaterials, buildSteps, catalogForDesign, footprint, normalizeDesign, partHeight, partPoint, partTopStuds, validateDesign, type Brick, type Design, type InventoryItem, type CatalogContext } from '../shared/model';
import { renderDesignSvg } from '../shared/illustration';
import { partSurfaces } from '../shared/part-surfaces';
import { groupManualSteps, type ManualStepGroup } from './manual-repeats';

const INK = '#133a50';
const BLUE = '#127faa';
const GREEN = '#55b584';
const MUTED = '#577384';
const PAGE_WIDTH = 595.28;
const MARGIN = 36;

function text(doc: PDFKit.PDFDocument, value: string, x: number, y: number, width: number, size = 10, color = INK, bold = false) {
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(color).text(value, x, y, { width, lineGap: 2 });
}

function page(doc: PDFKit.PDFDocument, label: string, title: string, subtitle?: string) {
  doc.addPage();
  doc.roundedRect(18, 15, PAGE_WIDTH - 36, 32, 9)
    .fill(doc.linearGradient(0, 15, 0, 47).stop(0, '#57b9ff').stop(0.46, '#087bd3').stop(1, '#0752ab'));
  doc.roundedRect(19, 16, PAGE_WIDTH - 38, 30, 8).lineWidth(0.7).strokeColor('#c1e7ff').stroke();
  doc.moveTo(31, 18).lineTo(PAGE_WIDTH - 31, 18).strokeColor('#e1f5ff').stroke();
  text(doc, 'SPROUT / BUILD SOMETHING NEW', MARGIN, 27, 370, 8, '#ffffff', true);
  text(doc, label.toUpperCase(), 410, 27, 148, 8, '#e8f7ff', true);
  let titleSize = 25;
  doc.font('Helvetica-Bold').fontSize(titleSize);
  while (doc.widthOfString(title) > 522 && titleSize > 16) doc.fontSize(--titleSize);
  let visibleTitle = title;
  while (doc.widthOfString(visibleTitle) > 522) visibleTitle = visibleTitle.slice(0, -4) + '...';
  text(doc, visibleTitle, MARGIN, 57, 522, titleSize, INK, true);
  if (subtitle) text(doc, subtitle, MARGIN, 93, 522, 10, MUTED);
}

function illustration(doc: PDFKit.PDFDocument, design: Design, x: number, y: number, width: number, height: number, visibleIds?: string[], highlightIds?: string[]) {
  SVGtoPDF(doc, renderDesignSvg(design, { width, height, visibleIds, highlightIds }), x, y, { width, height, assumePt: true });
}

async function assemblyIllustration(doc: PDFKit.PDFDocument, design: Design, x: number, y: number, width: number, height: number, visibleIds?: string[], highlightIds?: string[]) {
  if (design.bricks.length <= 1000) return illustration(doc, design, x, y, width, height, visibleIds, highlightIds);
  // Large manuals repeat thousands of pieces on hundreds of pages. Rasterize
  // the exact scene at 4 pixels per PDF point (288 dpi); maps and text stay vector.
  const svg = renderDesignSvg(design, { width, height, visibleIds, highlightIds });
  const png = await sharp(Buffer.from(svg), { density: 288 }).png().toBuffer();
  doc.image(png, x, y, { width, height });
}

function placementRows(doc: PDFKit.PDFDocument, bricks: Brick[], x: number, y: number, width: number, catalog: CatalogContext) {
  bricks.forEach((brick, index) => {
    const yy = y + index * 24;
    const size = footprint(brick, catalog);
    doc.roundedRect(x, yy, 20, 18, 5).fill('#e5f3f5');
    text(doc, String(index + 1), x + 3, yy + 4, 17, 8, BLUE, true);
    text(doc, `${brick.partId} / ${catalog.colors[brick.colorId].name} / ${(partHeight(brick, catalog) * 3.2).toFixed(1)} mm`, x + 27, yy, width - 27, 8, INK, true);
    text(doc, `(${brick.x}, ${brick.y})  ${size.width} x ${size.depth}  /  ${brick.rotation} deg`, x + 27, yy + 11, width - 27, 8, MUTED);
  });
}

function placementMap(doc: PDFKit.PDFDocument, design: Design, bricks: Brick[], x: number, y: number, width: number, height: number, readableTemplate = false) {
  const catalog = catalogForDesign(design);
  const columns = Math.max(...design.bricks.map((brick) => brick.x + footprint(brick, catalog).width));
  const rows = Math.max(...design.bricks.map((brick) => brick.y + footprint(brick, catalog).depth));
  const cell = Math.min((width - 32) / columns, (height - 32) / rows, 28);
  const originX = x + 25 + (width - 32 - columns * cell) / 2;
  const originY = y + 23 + (height - 32 - rows * cell) / 2;
  doc.save();
  const tickStride = readableTemplate ? Math.max(1, Math.ceil(15 / cell)) : 1;
  const tickSize = readableTemplate ? 7 : Math.min(8, cell * 0.55);
  for (let column = 0; column < columns; column += tickStride) text(doc, String(column), originX + column * cell, originY - 15, cell * tickStride, tickSize, MUTED);
  for (let row = 0; row < rows; row += tickStride) text(doc, String(row), originX - 18, originY + row * cell + cell / 2 - 4, 16, tickSize, MUTED);
  doc.lineWidth(0.4).strokeColor('#d6e4e8');
  for (let column = 0; column <= columns; column++) doc.moveTo(originX + column * cell, originY).lineTo(originX + column * cell, originY + rows * cell).stroke();
  for (let row = 0; row <= rows; row++) doc.moveTo(originX, originY + row * cell).lineTo(originX + columns * cell, originY + row * cell).stroke();
  bricks.forEach((brick, index) => {
    const size = footprint(brick, catalog);
    const bx = originX + brick.x * cell;
    const by = originY + brick.y * cell;
    if (catalog.parts[brick.partId].geometry) {
      // A plan-view silhouette comes from the same pinned mesh as the 3D view.
      // The dashed rectangle is its conservative reservation, not its body.
      const mesh = partSurfaces(brick, catalog);
      for (const face of mesh.faces) {
        const points = face.indices.map(i => [originX + mesh.vertices[i][0] * cell, originY + mesh.vertices[i][1] * cell]);
        doc.polygon(...points as [number, number][]).fill(catalog.colors[brick.colorId].hex);
      }
      doc.save().dash(2, { space: 2 }).rect(bx, by, size.width * cell, size.depth * cell).strokeColor(INK).stroke().restore();
      for (const stud of partTopStuds(brick, catalog)) doc.circle(originX + stud.x * cell, originY + stud.y * cell, cell * 0.13).fillAndStroke('#ffffff', INK);
    } else doc.rect(bx + 0.8, by + 0.8, size.width * cell - 1.6, size.depth * cell - 1.6)
      .fillAndStroke(catalog.colors[brick.colorId].hex, INK);
    if (catalog.parts[brick.partId].kind === 'slope') {
      const mapPoint = (u: number, v: number) => {
        const point = partPoint(brick, u, v, catalog);
        return [originX + point.x * cell, originY + point.y * cell];
      };
      const [ax, ay] = mapPoint(0, 1), [bx, by] = mapPoint(2, 1);
      doc.moveTo(ax, ay).lineTo(bx, by).lineWidth(0.7).strokeColor('#ffffff').stroke();
      // The arrow points down the ramp; dots mark the two high-row studs.
      const tail = mapPoint(1, 0.75), tip = mapPoint(1, 0.2);
      const left = mapPoint(0.77, 0.44), right = mapPoint(1.23, 0.44);
      doc.moveTo(tail[0], tail[1]).lineTo(tip[0], tip[1]).stroke();
      doc.moveTo(left[0], left[1]).lineTo(tip[0], tip[1]).lineTo(right[0], right[1]).stroke();
      for (const stud of partTopStuds(brick, catalog)) doc.circle(originX + stud.x * cell, originY + stud.y * cell, cell * 0.13).fillAndStroke('#ffffff', INK);
    }
    const labelSize = Math.min(10, cell * 0.68 * (readableTemplate ? Math.min(size.width, size.depth) : 1));
    const cx = bx + size.width * cell / 2;
    const cy = by + size.depth * cell / 2;
    doc.roundedRect(cx - labelSize * 0.8, cy - labelSize * 0.6, labelSize * 1.6, labelSize * 1.3, 2).fill('#ffffff');
    doc.font('Helvetica-Bold').fontSize(labelSize).fillColor(INK)
      .text(String(index + 1), cx - labelSize * 0.8, cy - labelSize * 0.43, { width: labelSize * 1.6, align: 'center', lineBreak: false });
  });
  doc.fillColor(GREEN).circle(originX, originY, 2.8).fill();
  text(doc, '+X >', originX + columns * cell - 26, originY - 28, 40, 8, BLUE, true);
  text(doc, '+Y v', originX - 25, originY + rows * cell + 6, 40, 8, BLUE, true);
  doc.restore();
}

async function repeatedStepPage(doc: PDFKit.PDFDocument, design: Design, group: ManualStepGroup, visibleIds: string[], totalSteps: number, catalog: CatalogContext) {
  const first = group.steps[0], last = group.steps.at(-1)!, origin = group.origins[0];
  const newIds = group.steps.flatMap(step => step.bricks.map(brick => brick.id));
  const template = { ...design, bricks: first.bricks.map(brick => ({ ...brick, x: brick.x - origin.x, y: brick.y - origin.y, z: brick.z - origin.z })) };
  const count = group.steps.length, pieces = first.bricks.length;
  page(doc, `Steps ${first.index}-${last.index} / ${totalSteps}`, `Repeat these placements x${count}`,
    `${pieces} ${pieces === 1 ? 'piece' : 'pieces'} per repeat / ${pieces * count} total in this group / ${visibleIds.length} of ${design.bricks.length} placed`);
  doc.roundedRect(36, 123, 523, 66, 9).fill('#edf6ef');
  text(doc, `GATHER FOR ALL ${count} REPEATS (PART / COLOR ID)`, 45, 131, 505, 9, BLUE, true);
  billOfMaterials({ ...design, bricks: group.steps.flatMap(step => step.bricks) }).forEach((item, index) => {
    const x = 45 + index % 4 * 128, y = 149 + Math.floor(index / 4) * 13;
    doc.rect(x, y, 9, 9).fillAndStroke(catalog.colors[item.colorId].hex, MUTED);
    text(doc, `${item.quantity}x ${item.partId} / ${item.colorId}`, x + 14, y, 111, 9, INK, true);
  });
  doc.roundedRect(36, 196, 300, 118, 12).fill('#f3f9fc');
  illustration(doc, template, 42, 198, 288, 114);
  text(doc, 'ONE REPEAT: EACH ROW IS ONE PIECE', 353, 199, 205, 9, BLUE, true);
  placementRows(doc, template.bricks, 353, 224, 205, catalog);
  text(doc, 'TEMPLATE MAP: LOCAL OFFSETS (dx, dy)', 36, 326, 310, 9, BLUE, true);
  placementMap(doc, template, template.bricks, 36, 346, 300, 155, true);
  text(doc, group.kind === 'stack' ? 'STACK IN PLACE - BUILD UPWARD' : 'REPEAT AT THE LISTED LOCATIONS', 36, 513, 523, 11, BLUE, true);
  text(doc, group.kind === 'stack'
    ? 'Place the same pattern at each listed height, in step order. Each layer joins the previous one. Do not build separate copies.'
    : 'Repeat the numbered placements directly on the model, in step order. This is a placement pattern, not an off-model subassembly.', 36, 535, 523, 10, MUTED);
  text(doc, 'AFTER THIS GROUP', 36, 579, 285, 9, BLUE, true);
  await assemblyIllustration(doc, design, 36, 596, 300, 137, [...visibleIds], newIds);
  text(doc, 'REPEAT / STEP / ORIGIN (X, Y, Z)', 350, 579, 210, 9, BLUE, true);
  group.steps.forEach((step, index) => {
    const at = group.origins[index];
    text(doc, `${index + 1}  /  ${step.index}  /  (${at.x}, ${at.y}, ${at.z})`, 354, 599 + index * 17, 202, 9, INK, true);
  });
  text(doc, 'For every piece: X = origin X + dx; Y = origin Y + dy; body-bottom Z = origin Z. X/Y are studs; Z is plate heights (3.2 mm). Keep every numbered placement in the printed order.', 36, 746, 523, 9, MUTED);
}

/** Derives every page from the accepted design; no model-written part counts or coordinates. */
export async function renderManualPdf(design: Design, inventory?: InventoryItem[]): Promise<Buffer> {
  const validation = validateDesign(design);
  if (!validation.valid) throw new Error(`Cannot create instructions for an invalid design: ${validation.errors.join('; ')}`);
  design = normalizeDesign(design);
  const catalog = catalogForDesign(design);
  const doc = new PDFDocument({ autoFirstPage: false, size: 'A4', margin: MARGIN, bufferPages: false,
    info: { Title: `${design.title} - Building instructions`, Author: 'Sprout', Subject: `Design ${design.id}` } });
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const steps = buildSteps(design);
  const instructionGroups = groupManualSteps(steps);
  const bom = billOfMaterials(design);
  const allocation = inventory ? allocateInventory(design, inventory) : undefined;
  const imported = [...new Set(design.bricks.map(brick => brick.partId))].map(id => catalog.parts[id]).filter(part => part.geometry);
  const credits = imported.map(part => {
    const title = `${part.id} / ${part.name}`;
    const authors = [...new Set(part.geometry!.assets.map(asset => asset.author).filter(Boolean))].join('; ');
    const titleHeight = doc.font('Helvetica-Bold').fontSize(10).heightOfString(title, { width: 520, lineGap: 2 });
    const authorHeight = doc.font('Helvetica').fontSize(8).heightOfString(authors, { width: 520, lineGap: 2 });
    return { part, title, authors, titleHeight, rowHeight: titleHeight + authorHeight + 22 };
  });
  let creditPages = 0, creditY = 721;
  for (const row of credits) {
    if (creditY + row.rowHeight > 720) { creditPages++; creditY = 194; }
    creditY += row.rowHeight;
  }
  const allocationRows = allocation?.items.reduce((sum, item) => sum + item.sources.length + (item.missing ? 1 : 0), 0) ?? 0;
  const totalPages = 2 + Math.ceil(bom.length / 18) + Math.ceil(allocationRows / 20) + instructionGroups.length + creditPages;
  let pageNumber = 0;
  // Finalize each vector page immediately instead of retaining hundreds of
  // cumulative diagrams solely for the final page-number pass.
  doc.on('pageAdded', () => {
    pageNumber++;
    doc.strokeColor('#d7e8eb').lineWidth(0.6).moveTo(MARGIN, 780).lineTo(PAGE_WIDTH - MARGIN, 780).stroke();
    text(doc, 'SPROUT  /  Original brick-building guide', MARGIN, 790, 410, 8, MUTED);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(BLUE).text(`${String(pageNumber).padStart(2, '0')} / ${String(totalPages).padStart(2, '0')}`, 501, 790, { width: 58, align: 'right', lineBreak: false });
  });

  page(doc, 'Your building guide', design.title);
  text(doc, design.description.slice(0, 360), MARGIN, 100, 520, 12, MUTED);
  doc.roundedRect(MARGIN + 2, 172, 523, 369, 15).fill('#c8dce6');
  doc.roundedRect(MARGIN, 169, 523, 369, 15)
    .fill(doc.linearGradient(0, 169, 0, 214).stop(0, '#6fceff').stop(0.5, '#1586d9').stop(1, '#0751ae'));
  doc.roundedRect(MARGIN + 1, 170, 521, 367, 14).lineWidth(1).strokeColor('#c1efff').stroke();
  text(doc, 'FINISHED MODEL', 51, 181, 300, 9, '#ffffff', true);
  doc.save();
  doc.roundedRect(41, 202, 513, 331, 10).clip();
  doc.rect(41, 202, 513, 331).fill(doc.linearGradient(0, 202, 0, 533).stop(0, '#aee1ff').stop(0.6, '#effbff').stop(1, '#f9fff5'));
  doc.fillOpacity(0.55).ellipse(121, 236, 96, 20).fill('#ffffff');
  doc.ellipse(456, 254, 114, 26).fill('#ffffff');
  doc.fillOpacity(1).moveTo(41, 510).bezierCurveTo(161, 442, 367, 540, 554, 478).lineTo(554, 533).lineTo(41, 533).closePath()
    .fill(doc.linearGradient(0, 478, 0, 533).stop(0, '#9fd86e').stop(1, '#5caf50'));
  doc.fillOpacity(0.78).roundedRect(53, 211, 489, 314, 13).fill('#ffffff');
  doc.restore();
  await assemblyIllustration(doc, design, 46, 203, 503, 323);
  text(doc, `${design.bricks.length} PIECES     ${steps.length} BUILD STEPS     ${bom.length} PART / COLOR TYPES`, MARGIN, 558, 523, 11, BLUE, true);
  text(doc, 'Your parts and assembly steps.', MARGIN, 595, 510, 22, INK, true);
  text(doc, 'Gather your parts, follow the numbered steps, and keep the front of your model facing you. Each diagram and placement is generated from this exact design.', MARGIN, 632, 500, 12, MUTED);
  if (allocation) text(doc, allocation.totalMissing
    ? `COLLECTION CHECK: ${allocation.totalMissing} ${allocation.totalMissing === 1 ? 'brick' : 'bricks'} missing. Gather the missing pieces before building.`
    : 'COLLECTION CHECK: All required pieces are allocated from your saved inventory.', MARGIN, 692, 515, 9, allocation.totalMissing ? '#a14826' : '#238154', true);
  text(doc, 'Checked for grid collisions and required connections. Physical stability has not been tested. Build on a flat surface and support loose pieces until joined.', MARGIN, 721, 515, 9, MUTED);
  text(doc, `Design: ${design.id}  |  Created: ${design.createdAt.slice(0, 10)}`, MARGIN, 757, 520, 8, MUTED);

  for (let offset = 0; offset < bom.length; offset += 18) {
    page(doc, 'Gather your bricks', offset ? 'Parts list, continued' : 'Everything you need', 'Match both the part number and its color. Quantities cover the complete model.');
    text(doc, 'PART', 113, 130, 280, 8, BLUE, true);
    text(doc, 'COLOR', 379, 130, 110, 8, BLUE, true);
    text(doc, 'QTY', 521, 130, 34, 8, BLUE, true);
    bom.slice(offset, offset + 18).forEach((item, index) => {
      const yy = 151 + index * 32;
      if (index % 2 === 0) doc.roundedRect(36, yy - 4, 523, 31, 6).fill('#f1f7f9');
      const preview = { ...design, bricks: [{ id: 'preview', partId: item.partId, colorId: item.colorId, x: 0, y: 0, z: 0, rotation: 0 as const }] };
      illustration(doc, preview, 42, yy - 4, 59, 29);
      const name = catalog.parts[item.partId].name;
      doc.font('Helvetica-Bold').fontSize(10);
      const nameSize = Math.max(7, Math.min(10, 10 * 260 / doc.widthOfString(name)));
      doc.fontSize(nameSize).fillColor(INK).text(name, 113, yy, { width: 260, height: 12, ellipsis: true });
      text(doc, `Part ${item.partId}`, 113, yy + 13, 260, 8, MUTED);
      text(doc, catalog.colors[item.colorId].name, 379, yy + 5, 132, 9);
      text(doc, String(item.quantity), 527, yy + 5, 30, 11, BLUE, true);
    });
    text(doc, allocation ? 'Your source-set allocation follows this parts list.'
      : 'The parts list describes this design. No owned-inventory snapshot was supplied with this guide.', MARGIN, 752, 522, 9, MUTED);
  }

  if (allocation) {
    const rows = allocation.items.flatMap((item) => [
      ...item.sources.map((source) => ({ ...item, source: source.source, take: source.quantity, missingRow: false })),
      ...(item.missing ? [{ ...item, source: 'Missing - obtain before building', take: item.missing, missingRow: true }] : []),
    ]);
    for (let offset = 0; offset < rows.length; offset += 20) {
      page(doc, 'Your collection', offset ? 'Where your pieces come from, continued' : 'Where your pieces come from', allocation.totalMissing
        ? `${allocation.totalMissing} missing ${allocation.totalMissing === 1 ? 'brick' : 'bricks'}. Rows marked missing are not allocated from your collection.`
        : 'Every required brick is allocated from your saved collection.');
      text(doc, 'PART / COLOR', 36, 131, 205, 8, BLUE, true);
      text(doc, 'SOURCE SET OR PARTS LIST', 240, 131, 270, 8, BLUE, true);
      text(doc, 'TAKE', 522, 131, 37, 8, BLUE, true);
      rows.slice(offset, offset + 20).forEach((row, index) => {
        const yy = 154 + index * 28;
        if (index % 2 === 0) doc.roundedRect(36, yy - 4, 523, 27, 5).fill('#f1f7f9');
        text(doc, `${row.partId} / ${catalog.colors[row.colorId].name}`, 43, yy + 2, 190, 9, INK, true);
        text(doc, row.source.slice(0, 60), 240, yy + 2, 270, 9, row.missingRow ? '#a14826' : MUTED);
        text(doc, String(row.take), 528, yy + 2, 28, 10, row.missingRow ? '#a14826' : BLUE, true);
      });
      text(doc, 'Allocation matches exact part and color IDs. Quantities refer only to this design; no substitutions are assumed.', 36, 752, 523, 9, MUTED);
    }
  }

  page(doc, 'Before you start', 'How to read your guide', 'One grid square = one stud (8 mm). One Z unit = one plate height (3.2 mm).');
  const guide = [
    ['1. Keep the same front', 'The isometric view keeps one camera for every step. +X points down-right; +Y points down-left. The top-down map has +X to the right and +Y downward.'],
    ['2. Count from zero', 'The green dot is grid origin (0, 0). A placement such as (2, 3) starts two studs right and three studs down from that origin. Coordinates mark the smallest X and Y corner of the brick body.'],
    ['3. Read the footprint', 'Each placement lists the body height in mm, then width x depth in studs after rotation. Width follows +X and depth follows +Y. All studs point upward. Slope arrows point down the ramp; dots mark its high stud row.'],
    ['4. Add only the vivid pieces', 'Pale pieces are already placed. Map numbers match the placement list. On xN pages, follow each listed step and add its origin to the template offsets. Stack pages repeat upward on the model.'],
    ['5. Check the body-bottom height', 'Place each piece at the printed height above the table. Z counts plate heights: z = 1 is 3.2 mm; z = 3 is 9.6 mm. A step can mix part heights. A step number is not a physical layer height.'],
    ['6. Support pieces as you build', 'Keep loose base pieces aligned until joined. Some later steps attach from below: follow the printed entry side and height, then raise the piece. Hold the built section as needed. These paths do not verify strength or hand clearance.'],
  ];
  guide.forEach(([heading, description], index) => {
    const yy = 139 + index * 92;
    text(doc, heading, MARGIN, yy, 523, 14, BLUE, true);
    text(doc, description, MARGIN, yy + 25, 515, 11, MUTED);
  });
  text(doc, 'Slope high edge: 0 deg = +Y; 90 deg = -X; 180 deg = -Y; 270 deg = +X. Rectangular parts use catalog width along X at 0 deg; 90 / 270 deg swap width and depth.', MARGIN, 716, 518, 10, MUTED);

  const visibleIds: string[] = [];
  for (const group of instructionGroups) {
    const step = group.steps[0];
    const newIds = group.steps.flatMap(step => step.bricks.map((brick) => brick.id));
    visibleIds.push(...newIds);
    if (group.steps.length > 1) {
      await repeatedStepPage(doc, design, group, visibleIds, steps.length, catalog);
      continue;
    }
    page(doc, `Step ${step.index} / ${steps.length}`, `Build step ${step.index}`, `${step.bricks.length} new pieces  /  Body bottom: ${(step.z * 3.2).toFixed(1)} mm (z = ${step.z})  /  ${visibleIds.length} of ${design.bricks.length} placed`);
    doc.roundedRect(36, 123, 523, 256, 15).fill('#f3f9fc');
    await assemblyIllustration(doc, design, 42, 126, 330, 245, [...visibleIds], newIds);
    text(doc, step.placements[0].approach === 'above' ? 'ADD THESE PIECES' : 'ATTACH FROM BELOW', 390, 146, 145, 9, BLUE, true);
    text(doc, step.instruction, 390, 171, 145, 11, INK);
    text(doc, 'Vivid = new pieces\nPale = previous steps', 390, 329, 145, 9, MUTED);
    text(doc, 'TOP-DOWN PLACEMENT MAP', 36, 404, 310, 9, BLUE, true);
    text(doc, 'PART / COLOR / BODY HEIGHT', 366, 404, 191, 9, BLUE, true);
    text(doc, '(X, Y)  footprint / rotation', 393, 421, 164, 8, MUTED);
    placementMap(doc, design, step.bricks, 36, 436, 300, 275);
    placementRows(doc, step.bricks, 366, 443, 190, catalog);
    text(doc, 'Map numbers match the placement list. Keep the same front before adding the next step.', 36, 744, 523, 9, MUTED);
  }

  if (imported.length) {
    let y = 721;
    for (const { part, title, authors, titleHeight, rowHeight } of credits) {
      if (y + rowHeight > 720) {
        page(doc, 'Part geometry credits', 'Pinned catalog sources', 'These part drawings use official LDraw geometry. Parts and colors are identified by Rebrickable.');
        text(doc, 'LDraw geometry: CC BY 4.0. Connector metadata: LDCad Shadow Library, CC BY-SA 4.0. Meshes were transformed into the build coordinate system. Exact source URLs and hashes accompany the saved design and embedded LDraw export.', 36, 122, 523, 10, MUTED);
        text(doc, 'Imported plan-view silhouettes show the actual mesh. Dashed map boxes mark reserved footprints. Metallic and pearl colors use catalog RGB; their surface finishes are not simulated.', 36, 741, 523, 9, MUTED);
        y = 194;
      }
      text(doc, title, 36, y, 520, 10, INK, true);
      text(doc, authors, 36, y + titleHeight + 4, 520, 8, MUTED);
      doc.link(36, y, 520, titleHeight, `https://library.ldraw.org/library/official/parts/${part.ldrawId}`);
      y += rowHeight;
    }
  }

  doc.end();
  return result;
}

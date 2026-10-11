import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { deflateSync, inflateSync } from 'node:zlib';
import sharp from 'sharp';
import PDFDocument from 'pdfkit';
import { generateManualPdf } from '../server/manual';
import { renderManualPdf } from '../server/manual-render';
import { groupManualSteps } from '../shared/manual-repeats';
import { renderDesignSvg } from '../shared/illustration';
import { partSurfaces } from '../shared/part-surfaces';
import { buildSteps, validateDesign, type BuildStep, type Design } from '../shared/model';
import { hangingDesign } from './fixtures/hanging-design';

const design: Design = {
  id: 'manual-test', title: 'Little tower', description: 'A four-brick test model.', source: 'sample',
  prompt: 'Build a tower', createdAt: '2026-10-10T12:00:00.000Z',
  bricks: [
    { id: 'base-a', partId: '3004', colorId: 1, x: 0, y: 0, z: 0, rotation: 0 },
    { id: 'base-b', partId: '3004', colorId: 4, x: 1, y: 0, z: 0, rotation: 0 },
    { id: 'join', partId: '3003', colorId: 14, x: 0, y: 0, z: 1, rotation: 0 },
    { id: 'top', partId: '3005', colorId: 15, x: 1, y: 1, z: 2, rotation: 0 },
  ],
};

const mixed: Design = {
  ...design, id: 'plate-slope-manual', title: 'Four-way slope study',
  schemaVersion: 2, catalogVersion: 'upright-plates-slopes-1', coordinateSystem: 'stud-xy-plate-z',
  bricks: [
    { id: 'base-west', partId: '3020', colorId: 71, x: 0, y: 0, z: 0, rotation: 0 },
    { id: 'base-east', partId: '3020', colorId: 71, x: 2, y: 0, z: 0, rotation: 0 },
    { id: 'bond-north', partId: '3020', colorId: 15, x: 0, y: 0, z: 1, rotation: 90 },
    { id: 'bond-west', partId: '3022', colorId: 15, x: 0, y: 2, z: 1, rotation: 0 },
    { id: 'bond-east', partId: '3022', colorId: 15, x: 2, y: 2, z: 1, rotation: 0 },
    { id: 'slope-0', partId: '3039', colorId: 4, x: 0, y: 0, z: 2, rotation: 0 },
    { id: 'slope-90', partId: '3039', colorId: 4, x: 2, y: 0, z: 2, rotation: 90 },
    { id: 'slope-180', partId: '3039', colorId: 4, x: 0, y: 2, z: 2, rotation: 180 },
    { id: 'slope-270', partId: '3039', colorId: 4, x: 2, y: 2, z: 2, rotation: 270 },
    { id: 'rear-cap', partId: '3004', colorId: 1, x: 0, y: 1, z: 5, rotation: 90 },
  ],
};

// PDF streams are binary: a final CR byte belongs to the data, not the following
// newline. PDFKit writes direct /Length values, so read those exact byte ranges.
function pdfText(pdf: Buffer): string {
  const raw = pdf.toString('latin1');
  let extracted = '';
  const starts = /(?:^|\n)stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = starts.exec(raw))) {
    const dictionary = raw.slice(raw.lastIndexOf(' obj', match.index) + 4, match.index);
    const length = dictionary.match(/\/Length\s+(\d+)\b/);
    assert.ok(length, 'PDFKit stream must declare its byte length');
    const start = match.index + match[0].length;
    const end = start + Number(length[1]);
    assert.match(raw.slice(end), /^\r?\nendstream\b/, 'Stream length must reach the endstream delimiter');
    const bytes = pdf.subarray(start, end);
    const stream = (/\/Filter\s+\/FlateDecode\b/.test(dictionary) ? inflateSync(bytes) : bytes).toString('latin1');
    extracted += [...stream.matchAll(/<([\da-f]+)>/gi)].map((value) => Buffer.from(value[1], 'hex').toString('latin1')).join('') + '\n';
    starts.lastIndex = end;
  }
  return extracted;
}

function exactPlacements(pdf: Buffer): { designId: string; coordinateSystem: string; steps: BuildStep[] } {
  const raw = pdf.toString('latin1'), at = raw.indexOf('/Type /EmbeddedFile');
  assert.ok(at >= 0, 'The companion must retain exact placements as an embedded attachment');
  const stream = raw.indexOf('stream\n', at), dictionary = raw.slice(at, stream);
  const length = Number(dictionary.match(/\/Length\s+(\d+)/)![1]);
  return JSON.parse(inflateSync(pdf.subarray(stream + 7, stream + 7 + length)).toString('utf8'));
}

test('PDF text extraction preserves a final carriage-return byte in compressed data', () => {
  const instruction = 'BT <4c6974746c6520746f776572> Tj ET\n%';
  const bytes = Array.from({ length: 256 }, (_, suffix) => deflateSync(Buffer.from(instruction + String.fromCharCode(suffix), 'latin1')))
    .find((value) => value.at(-1) === 13)!;
  assert.ok(bytes, 'Fixture must end in a literal CR byte');
  const pdf = Buffer.concat([Buffer.from(`1 0 obj\n<< /Length ${bytes.length} /Filter /FlateDecode >>\nstream\n`), bytes,
    Buffer.from('\nendstream\nendobj\n')]);
  assert.equal(pdfText(pdf).trim(), 'Little tower');
});

test('hanging-piece PDF follows the anchor-first order and prints exact upward entry instructions', async () => {
  const pdf = await generateManualPdf(hangingDesign), content = pdfText(pdf);
  assert.equal((content.match(/ATTACH FROM BELOW/g) || []).length, 2);
  assert.match(content, /Enter from \+X/);
  assert.match(content, /17\.6 mm above the table/);
  assert.match(content, /8\.0 mm above the table/);
  assert.equal((content.match(/then raise it 1\.6 mm/g) || []).length, 2);
  assert.deepEqual(exactPlacements(pdf).steps, buildSteps(hangingDesign));
  assert.match(content, /3 repeats/);
  assert.match(content, /Stack this pattern upward/);
});

test('layer illustrations retain the full-model camera and exact geometry', () => {
  const full = renderDesignSvg(design);
  const partial = renderDesignSvg(design, { visibleIds: ['base-a'] });
  const group = (svg: string) => svg.match(/<g data-brick-id="base-a"[\s\S]*?<\/g>/)?.[0];
  assert.ok(group(full));
  assert.equal(group(partial), group(full));
  assert.ok(!partial.includes('data-brick-id="top"'));
  assert.equal((full.match(/data-brick-id=/g) ?? []).length, 4);
});

test('legacy heights render at their original physical positions without double conversion', () => {
  const original = JSON.stringify(design);
  const canonical: Design = { ...design, schemaVersion: 2, catalogVersion: 'upright-plates-slopes-1', coordinateSystem: 'stud-xy-plate-z',
    bricks: design.bricks.map((brick, index) => ({ ...brick, z: [0, 0, 3, 6][index] })) };
  assert.equal(renderDesignSvg(design), renderDesignSvg(canonical));
  assert.equal(JSON.stringify(design), original);
});

test('body surfaces have outward faces, exact plate thickness and all four real slope profiles', () => {
  for (const partId of ['3020', '3022']) {
    const body = partSurfaces({ ...mixed.bricks[0], partId, z: 7 });
    assert.equal(Math.min(...body.vertices.map((point) => point[2])), 7);
    assert.equal(Math.max(...body.vertices.map((point) => point[2])), 8);
  }
  const noses = [
    [[4, 5, 7.5], [6, 5, 7.5]], [[6, 5, 7.5], [6, 7, 7.5]],
    [[6, 7, 7.5], [4, 7, 7.5]], [[4, 7, 7.5], [4, 5, 7.5]],
  ];
  for (const [index, rotation] of ([0, 90, 180, 270] as const).entries()) {
    const body = partSurfaces({ ...mixed.bricks[5], x: 4, y: 5, z: 7, rotation });
    assert.deepEqual(body.vertices.slice(4, 6), noses[index]);
    assert.equal(Math.max(...body.vertices.map((point) => point[2])), 10);
    for (const face of body.faces) {
      const origin = body.vertices[face.indices[0]];
      for (const vertex of body.vertices) assert.ok(vertex.reduce((sum, value, axis) => sum + (value - origin[axis]) * face.normal[axis], 0) < 1e-8,
        `Rotation ${rotation}: every vertex must lie inside each outward face plane`);
    }
    // Independent volume of the 2-wide extrusion: ramp 1*(0.5+3)/2 plus rear 1*3.
    let volume = 0;
    for (const face of body.faces) for (let i = 1; i < face.indices.length - 1; i++) {
      const [a, b, c] = [face.indices[0], face.indices[i], face.indices[i + 1]].map((n) => body.vertices[n]);
      volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    }
    assert.ok(Math.abs(volume - 9.5) < 1e-8, `Rotation ${rotation} must retain the real wedge volume`);
  }
});

test('slope diagrams show only high-row studs and attached caps hide them', () => {
  assert.equal(validateDesign(mixed).valid, true);
  const full = renderDesignSvg(mixed);
  assert.ok(!full.includes('data-stud-owner="slope-0"'));
  const partial = renderDesignSvg(mixed, { visibleIds: mixed.bricks.filter((brick) => brick.id !== 'rear-cap').map((brick) => brick.id) });
  for (const rotation of [0, 90, 180, 270]) assert.equal((partial.match(new RegExp(`data-stud-owner="slope-${rotation}"`, 'g')) ?? []).length, 2);
  assert.ok(!partial.includes('data-stud-owner="bond-north"'), 'Slopes enclose both rows of supporting plate studs');
});

test('slope ramp pixels show an inclined surface instead of a rectangular body', async () => {
  const slope: Design = { ...mixed, bricks: [{ ...mixed.bricks[5], x: 0, y: 0, z: 0, rotation: 180, colorId: 25 }] };
  const { data, info } = await sharp(Buffer.from(renderDesignSvg(slope, { width: 400, height: 320 }))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // World point (1, 1.5, 1.75 plates) lies in the center of the 45-degree ramp.
  // The fixed camera fits a 2x2 footprint and a 3.5-plate body+stud envelope.
  const scale = (320 - 2 * 19.2 - 48) / (2 + 3.5 * 0.4);
  const px = Math.round(200 + (1 - 1.5) * Math.sqrt(3) / 2 * scale);
  const py = Math.round(19.2 + 3.5 * 0.4 * scale + ((1 + 1.5) / 2 - 1.75 * 0.4) * scale);
  const start = (py * info.width + px) * info.channels;
  assert.deepEqual(Array.from(data.subarray(start, start + 4)), [245, 133, 23, 255]);
});

test('highlights preserve new-brick color and escape labels', () => {
  const svg = renderDesignSvg({ ...design, title: 'A <script> & "B"' }, { highlightIds: ['join'] });
  assert.match(svg, /data-brick-id="join" data-highlighted="true"/);
  assert.match(svg, /data-brick-id="base-a" data-highlighted="false"/);
  assert.ok(svg.includes('A &lt;script&gt; &amp; &quot;B&quot;'));
  assert.ok(!svg.includes('<script>'));
});

test('covered studs disappear only when the covering brick is visible', () => {
  const full = renderDesignSvg(design);
  assert.ok(!full.includes('data-stud-owner="base-a"'));
  assert.equal((full.match(/data-stud-owner="join"/g) ?? []).length, 3);
  const partial = renderDesignSvg(design, { visibleIds: ['base-a'] });
  assert.equal((partial.match(/data-stud-owner="base-a"/g) ?? []).length, 2);
});

test('solid staggered walls render solid side faces, without back faces or studs bleeding through', async () => {
  const solid: Design = { ...design, id: 'occlusion-regression', bricks: [] };
  for (let z = 0; z < 3; z++) {
    if (z === 1) continue;
    const rotated = z % 2 === 1;
    for (let x = 0; x < 8; x += rotated ? 4 : 2) for (let y = 0; y < 8; y += rotated ? 2 : 4) {
      solid.bricks.push({ id: `brick-${x}-${y}-${z}`, partId: '3001', colorId: 25, x, y, z, rotation: rotated ? 90 : 0 });
    }
  }
  // Mixed sizes and orientations expose ordering errors that uniform tiling hides.
  const middle: [string, number, number, 0 | 90][] = [
    ['3002', 0, 0, 90], ['3002', 3, 0, 0], ['3002', 5, 0, 90],
    ['3001', 0, 2, 0], ['3010', 2, 2, 0], ['3001', 5, 2, 0], ['3010', 7, 2, 0],
    ['3001', 3, 3, 0], ['3002', 0, 6, 90], ['3002', 5, 6, 90], ['3004', 3, 7, 90],
  ];
  for (const [partId, x, y, rotation] of middle) solid.bricks.push({ id: `middle-${x}-${y}`, partId, colorId: 25, x, y, z: 1, rotation });
  assert.equal(validateDesign(solid).valid, true);
  const { data, info } = await sharp(Buffer.from(renderDesignSvg(solid))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // Independent analytic front-face samples of the complete 8 x 8 x 3 solid.
  // Avoid edges, seams and the top surface, where antialiasing/studs are expected.
  const scale = 524 / (8 + 9.5 * 0.4);
  const offsetY = 39 + 9.5 * 0.4 * scale;
  const pixel = (x: number, y: number, z: number) => {
    const px = Math.round(500 + (x - y) * Math.sqrt(3) / 2 * scale);
    const py = Math.round(offsetY + ((x + y) / 2 - z * 1.2) * scale);
    const start = (py * info.width + px) * info.channels;
    return Array.from(data.subarray(start, start + 4));
  };
  for (const z of [0.35, 0.65, 1.35, 1.65, 2.35, 2.65]) for (let position = 0.4; position < 8; position += 0.5) {
    assert.deepEqual(pixel(position, 8, z), [216, 117, 20, 255], `Wrong front wall at x=${position}, z=${z}`);
    assert.deepEqual(pixel(8, position, z), [178, 97, 17, 255], `Wrong side wall at y=${position}, z=${z}`);
  }
});

test('diagram-led PDF preserves exact placements, complete BOM, inventory shortages, and landscape page totals', async () => {
  assert.equal(validateDesign(design).valid, true);
  const pdf = await generateManualPdf(design, [{ partId: '3004', colorId: 1, quantity: 1, source: 'Set 10696-1' }]);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  const content = pdfText(pdf);
  for (const expected of ['Little tower', '4 PIECES', '3004', '3003', '3005', 'Set 10696-1', '3 bricks missing',
    '1 x 2', '01 / 05', '05 / 05', 'exact-placements.json', 'Build left to right.']) {
    assert.ok(content.includes(expected), `Missing PDF text: ${expected}`);
  }
  assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length, 5);
  assert.match(pdf.toString('latin1'), /\/MediaBox \[0 0 841\.89 595\.28\]/);
  assert.deepEqual(exactPlacements(pdf).steps, buildSteps(design));
  assert.ok(!content.includes('TOP-DOWN PLACEMENT MAP'), 'Engineering coordinates should not dominate the illustrated guide');
});

test('mixed-height PDF preserves plate heights and all four slope rotations in its exact attachment', async () => {
  const pdf = await generateManualPdf(mixed), content = pdfText(pdf);
  for (const expected of ['10 PIECES', '3020', '3022', '3039', 'White', 'FRONT']) {
    assert.ok(content.includes(expected), `Missing mixed-part PDF text: ${expected}`);
  }
  assert.ok(!content.includes('Build layer'), 'Step indices must not be presented as full-brick heights');
  assert.deepEqual(exactPlacements(pdf).steps, buildSteps(mixed));
});

test('repeated stack PDF gathers total quantities and prints every original step and height once', async () => {
  const repeated: Design = { ...mixed, id: randomUUID(), title: 'Repeated plate stack', bricks: [
    { id: 'base', partId: '3001', colorId: 1, x: 3, y: 4, z: 0, rotation: 0 },
    ...Array.from({ length: 8 }, (_, i) => ({ id: `plate-${i}`, partId: '3020', colorId: 15, x: 3, y: 4, z: i + 3, rotation: 0 as const })),
  ] };
  assert.equal(validateDesign(repeated).valid, true);
  assert.equal(buildSteps(repeated).length, 9);
  assert.equal(groupManualSteps(buildSteps(repeated)).length, 2);
  const inventory = [{ partId: '3020', colorId: 15, quantity: 8, source: 'My plate box' }, { partId: '3001', colorId: 1, quantity: 1, source: 'My base box' }];
  const pdf = await generateManualPdf(repeated, inventory), content = pdfText(pdf);
  for (const expected of ['9 PIECES', '9 BUILD STEPS', '8 repeats / 8 pieces total', '1 piece per repeat',
    '8x', '3020', 'ONE REPEAT', 'Stack this pattern upward.', 'My plate box', 'My base box', 'All required pieces are allocated', '04 / 04']) {
    assert.ok(content.includes(expected), `Missing repetition detail: ${expected}`);
  }
  assert.deepEqual(exactPlacements(pdf).steps, buildSteps(repeated));
  assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length, 4, 'The exact 9 checked steps fit on 1 instruction spread');
});

test('same-height translated PDF uses repeated placements with exact destinations and total gather counts', async () => {
  const repeated: Design = { ...mixed, id: randomUUID(), title: 'Repeated base rows', bricks: [
    ...Array.from({ length: 24 }, (_, i) => ({ id: `base-${i}`, partId: '3024', colorId: 1, x: i % 12, y: Math.floor(i / 12), z: 0, rotation: 0 as const })),
    ...[0, 4, 8].map(x => ({ id: `cap-${x}`, partId: '3020', colorId: 15, x, y: 0, z: 1, rotation: 90 as const })),
    ...[2, 6].map(x => ({ id: `bridge-${x}`, partId: '3020', colorId: 14, x, y: 0, z: 2, rotation: 90 as const })),
  ] };
  assert.equal(validateDesign(repeated).valid, true);
  const groups = groupManualSteps(buildSteps(repeated));
  assert.equal(groups[0].kind, 'placements');
  assert.equal(groups[0].steps.length, 2);
  const pdf = await generateManualPdf(repeated), content = pdfText(pdf);
  for (const expected of ['29 PIECES', '2 repeats / 24 pieces total', '12 pieces per repeat', '24x', '3024',
    'Repeat at the highlighted locations.', 'Place directly on the model, in step order.', '04 / 04']) {
    assert.ok(content.includes(expected), `Missing translated-placement detail: ${expected}`);
  }
  assert.deepEqual(exactPlacements(pdf).steps, buildSteps(repeated));
  assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length, 4);
});

test('alternating stack PDF shows A then B with cycle totals and preserves every checked placement', async () => {
  const repeated: Design = { ...mixed, id: randomUUID(), title: 'Alternating plate courses', bricks:
    Array.from({ length: 8 }, (_, z) => [0, 1].map(i => ({ id: `course-${z}-${i}`, partId: '3020', colorId: 4,
      x: z % 2 ? 0 : i * 2, y: z % 2 ? i * 2 : 0, z, rotation: (z % 2 ? 90 : 0) as 0 | 90,
    }))).flat(),
  };
  assert.equal(validateDesign(repeated).valid, true);
  const steps = buildSteps(repeated), groups = groupManualSteps(steps);
  assert.equal(groups.length, 1); assert.equal(groups[0].patternLength, 2);
  const pdf = await generateManualPdf(repeated), content = pdfText(pdf);
  for (const expected of ['16 PIECES', '8 BUILD STEPS', '4 cycles / 16 pieces total', 'A / 2 pieces', 'B / 2 pieces',
    'A then B, 4x. Stack directly on the model.', '4 pieces per cycle', '16x', '03 / 03']) {
    assert.ok(content.includes(expected), `Missing two-layer cycle detail: ${expected}`);
  }
  assert.deepEqual(exactPlacements(pdf).steps, steps);
  assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length, 3);
});

test('narrow-plate SVG and manual retain one-plate steps, correct exposed studs and source quantities', async () => {
  const narrow: Design = { ...mixed, id: 'narrow-plate-guide', title: 'Narrow plate stair', bricks: ['3710', '3623', '3023', '3024'].map((partId, z) => ({
    id: `narrow-${z}`, partId, colorId: 15, x: 0, y: 0, z, rotation: 0,
  })) };
  assert.equal(validateDesign(narrow).valid, true);
  const svg = renderDesignSvg(narrow);
  assert.equal((svg.match(/data-brick-id=/g) || []).length, 4);
  for (let z = 0; z < 4; z++) assert.equal((svg.match(new RegExp(`data-stud-owner="narrow-${z}"`, 'g')) || []).length, 1, 'Only the uncovered last stud of each plate is visible');
  const inventory = narrow.bricks.map(brick => ({ partId: brick.partId, colorId: brick.colorId, quantity: 1, source: 'My narrow plate box' }));
  const pdf = await generateManualPdf(narrow, inventory), content = pdfText(pdf);
  for (const expected of ['4 PIECES', '3710', '3623', '3023', '3024', 'My narrow plate box', 'All required pieces are allocated',
    'White', '1 x 4', '1 x 3', '1 x 2', '1 x 1']) {
    assert.ok(content.includes(expected), `Missing narrow-plate guide text: ${expected}`);
  }
  assert.deepEqual(exactPlacements(pdf).steps, buildSteps(narrow));
});

test('manual generation rejects invalid brick placement before exporting', async () => {
  const invalid = { ...design, bricks: [...design.bricks, { ...design.bricks[0], id: 'collision' }] };
  await assert.rejects(generateManualPdf(invalid), /invalid design.*overlap/);
});

test('PDF rendering leaves the main event loop available and shares identical pending requests', async () => {
  let finished = false;
  const first = generateManualPdf(design);
  const duplicate = generateManualPdf(structuredClone(design));
  assert.equal(first, duplicate);
  first.then(() => { finished = true; });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(finished, false, 'other requests must be able to run before the PDF finishes');
  assert.equal((await first).subarray(0, 5).toString(), '%PDF-');
});

test('manuals flush completed vector pages and retain exact page totals and placements', async t => {
  const addPage = PDFDocument.prototype.addPage;
  const buffered: number[] = [];
  t.mock.method(PDFDocument.prototype, 'addPage', function (this: PDFKit.PDFDocument, ...args: Parameters<typeof addPage>) {
    const result = addPage.apply(this, args);
    buffered.push(this.bufferedPageRange().count);
    return result;
  });
  const pdf = await renderManualPdf(design, [{ partId: '3004', colorId: 1, quantity: 1, source: 'Page count source' }]);
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
  const expected = 3 + Math.ceil(groupManualSteps(buildSteps(design)).length / 2); // cover, BOM, allocation, instruction spreads
  assert.equal(pages, expected);
  assert.equal(buffered.length, expected);
  assert.ok(buffered.every(count => count === 1), 'Only the active vector page stays buffered, regardless of manual length');
  assert.equal((pdf.toString('latin1').match(/\/Subtype \/Image\b/g) || []).length, 8, 'Four exact part/color thumbnails (RGB plus alpha) are embedded once and reused across trays and BOM');
  const content = pdfText(pdf);
  for (let index = 1; index <= pages; index++) assert.ok(content.includes(`${String(index).padStart(2, '0')} / ${String(pages).padStart(2, '0')}`));
  assert.ok(content.includes('Page count source'));
  assert.deepEqual(exactPlacements(pdf).steps, buildSteps(design));
});

test('manual cache survives process restart and keys exact design and inventory content', async t => {
  const original = { ...design, id: `manual-cache-${randomUUID()}` };
  const inventory = [{ partId: '3004', colorId: 1, quantity: 1, source: 'Cached source lot' }];
  const changed = { ...original, title: 'Changed cached revision' };
  const inputs = [{ design: original, inventory }, { design: changed, inventory }, { design: original, inventory: [] }];
  const filenames = inputs.map(input => `data/manual-cache/manual-v6-pattern-cycles-${createHash('sha256').update(JSON.stringify(input)).digest('hex')}.pdf`);
  t.after(() => Promise.all(filenames.map(filename => rm(filename, { force: true }))));
  const first = await generateManualPdf(original, inventory);
  assert.deepEqual(await readFile(filenames[0]), first);
  const script = `import { generateManualPdf } from './server/manual.ts'; import { createHash } from 'node:crypto';
    const input = ${JSON.stringify(inputs[0])}; const pdf = await generateManualPdf(input.design, input.inventory);
    process.stdout.write(createHash('sha256').update(pdf).digest('hex'));`;
  const child = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script]);
  assert.equal(child.stdout, createHash('sha256').update(first).digest('hex'), 'A new process returns the exact cached PDF bytes');
  assert.match(pdfText(await generateManualPdf(changed, inventory)), /Changed cached revision/);
  const empty = pdfText(await generateManualPdf(original, []));
  assert.match(empty, /4 bricks missing/);
  assert.ok(!empty.includes('Cached source lot'));
  await writeFile(filenames[0], 'incomplete PDF cache');
  assert.match(pdfText(await generateManualPdf(original, inventory)), /Cached source lot/, 'A truncated cache entry must be regenerated');
});

test('a rejected export does not stall the queue and queued inputs retain their original snapshot', async () => {
  const invalid = { ...design, bricks: [...design.bricks, { ...design.bricks[0], id: 'collision' }] };
  const rejection = assert.rejects(generateManualPdf(invalid), /invalid design.*overlap/);
  const snapshot = structuredClone(design);
  const inventory = [{ partId: '3004', colorId: 1, quantity: 1, source: 'Original source lot' }];
  const queued = generateManualPdf(snapshot, inventory);
  const differentInventory = generateManualPdf(snapshot, []);
  assert.notEqual(queued, differentInventory, 'source allocations must not share a different inventory export');
  snapshot.title = 'Edited while queued';
  snapshot.bricks.length = 0;
  inventory[0].source = 'Changed while queued';
  inventory[0].quantity = 999;
  await rejection;
  const content = pdfText(await queued);
  assert.ok(content.includes('Little tower'));
  assert.ok(content.includes('Original source lot'));
  assert.ok(content.includes('3 bricks missing'));
  assert.ok(!content.includes('Edited while queued'));
  assert.ok(!content.includes('Changed while queued'));
  const otherContent = pdfText(await differentInventory);
  assert.ok(!otherContent.includes('Original source lot'));
  assert.ok(otherContent.includes('4 bricks missing'));
});

test('dense layers become small numbered steps without losing any placements', async () => {
  const dense: Design = { ...design, id: 'dense-test', bricks: [] };
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    dense.bricks.push({ id: `base-${x}-${y}`, partId: '3005', colorId: 1, x, y, z: 0, rotation: 0 });
  }
  dense.bricks.push(
    { id: 'join-a', partId: '3001', colorId: 14, x: 0, y: 0, z: 1, rotation: 0 },
    { id: 'join-b', partId: '3001', colorId: 14, x: 2, y: 0, z: 1, rotation: 0 },
    { id: 'cap', partId: '3001', colorId: 4, x: 0, y: 1, z: 2, rotation: 90 },
  );
  assert.equal(validateDesign(dense).valid, true);
  const pdf = await generateManualPdf(dense), content = pdfText(pdf);
  assert.deepEqual(buildSteps(dense).map(step => step.bricks.length), [12, 4, 2, 1]);
  assert.ok(content.includes('4 new pieces'));
  assert.deepEqual(exactPlacements(pdf).steps, buildSteps(dense));
});

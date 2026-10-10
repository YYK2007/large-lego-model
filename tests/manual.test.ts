import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, inflateSync } from 'node:zlib';
import sharp from 'sharp';
import { generateManualPdf } from '../server/manual';
import { renderDesignSvg } from '../shared/illustration';
import { validateDesign, type Design } from '../shared/model';

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

test('PDF text extraction preserves a final carriage-return byte in compressed data', () => {
  const instruction = 'BT <4c6974746c6520746f776572> Tj ET\n%';
  const bytes = Array.from({ length: 256 }, (_, suffix) => deflateSync(Buffer.from(instruction + String.fromCharCode(suffix), 'latin1')))
    .find((value) => value.at(-1) === 13)!;
  assert.ok(bytes, 'Fixture must end in a literal CR byte');
  const pdf = Buffer.concat([Buffer.from(`1 0 obj\n<< /Length ${bytes.length} /Filter /FlateDecode >>\nstream\n`), bytes,
    Buffer.from('\nendstream\nendobj\n')]);
  assert.equal(pdfText(pdf).trim(), 'Little tower');
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
  const scale = 524 / (8 + 3.18 * 1.2);
  const offsetY = 39 + 3.18 * 1.2 * scale;
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

test('PDF has all step coordinates, complete BOM, inventory shortages, and numbered pages', async () => {
  assert.equal(validateDesign(design).valid, true);
  const pdf = await generateManualPdf(design, [{ partId: '3004', colorId: 1, quantity: 1, source: 'Set 10696-1' }]);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  const content = pdfText(pdf);
  for (const expected of ['Little tower', '4 BRICKS', '3004', '3003', '3005', 'Set 10696-1', '3 bricks missing',
    'Build layer 1', 'Build layer 2', 'Build layer 3', '(0, 0)', '(1, 0)', '(1, 1)', '1 x 2', '90 deg', '01 / 07', '07 / 07']) {
    assert.ok(content.includes(expected), `Missing PDF text: ${expected}`);
  }
  assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length, 7);
});

test('manual generation rejects invalid brick placement before exporting', async () => {
  const invalid = { ...design, bricks: [...design.bricks, { ...design.bricks[0], id: 'collision' }] };
  await assert.rejects(generateManualPdf(invalid), /invalid design.*overlap/);
});

test('dense layers include every placement on continuation pages', async () => {
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
  const content = pdfText(await generateManualPdf(dense));
  assert.ok(content.includes('Layer 1, continued'));
  assert.ok(content.includes('(3, 3)  1 x 1  /  0 deg'));
  assert.ok(content.includes('(0, 1)  4 x 2  /  90 deg'));
});

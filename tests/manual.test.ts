import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, inflateSync } from 'node:zlib';
import sharp from 'sharp';
import { generateManualPdf } from '../server/manual';
import { renderDesignSvg } from '../shared/illustration';
import { partSurfaces } from '../shared/part-surfaces';
import { buildSteps, validateDesign, type Design } from '../shared/model';

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

test('PDF has all step coordinates, complete BOM, inventory shortages, and numbered pages', async () => {
  assert.equal(validateDesign(design).valid, true);
  const pdf = await generateManualPdf(design, [{ partId: '3004', colorId: 1, quantity: 1, source: 'Set 10696-1' }]);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  const content = pdfText(pdf);
  for (const expected of ['Little tower', '4 PIECES', '3004', '3003', '3005', 'Set 10696-1', '3 bricks missing',
    'Build step 1', 'Build step 2', 'Build step 3', 'Body bottom: 9.6 mm (z = 3)', 'Body bottom: 19.2 mm (z = 6)',
    '(0, 0)', '(1, 0)', '(1, 1)', '1 x 2', '90 deg', '01 / 07', '07 / 07']) {
    assert.ok(content.includes(expected), `Missing PDF text: ${expected}`);
  }
  assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length, 7);
});

test('mixed-height PDF prints actual body-bottom heights, all slope directions and plate BOM entries', async () => {
  const content = pdfText(await generateManualPdf(mixed));
  for (const expected of ['10 PIECES', '3020', '3022', '3039', 'Build step 4', 'Body bottom: 3.2 mm (z = 1)',
    'Body bottom: 6.4 mm (z = 2)', 'Body bottom: 16.0 mm (z = 5)', '0 deg = +Y', '90 deg = -X', '180 deg = -Y', '270 deg = +X',
    '3022 / White / 3.2 mm', '(0, 2)  2 x 2  /  180 deg', '(2, 2)  2 x 2  /  270 deg']) {
    assert.ok(content.includes(expected), `Missing mixed-part PDF text: ${expected}`);
  }
  assert.ok(!content.includes('Build layer'), 'Step indices must not be presented as full-brick heights');
});

test('manual generation rejects invalid brick placement before exporting', async () => {
  const invalid = { ...design, bricks: [...design.bricks, { ...design.bricks[0], id: 'collision' }] };
  await assert.rejects(generateManualPdf(invalid), /invalid design.*overlap/);
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
  const content = pdfText(await generateManualPdf(dense));
  assert.deepEqual(buildSteps(dense).map(step => step.bricks.length), [12, 4, 2, 1]);
  assert.ok(content.includes('Build step 2'));
  assert.ok(content.includes('4 new pieces'));
  assert.ok(content.includes('(3, 3)  1 x 1  /  0 deg'));
  assert.ok(content.includes('(0, 1)  4 x 2  /  90 deg'));
});

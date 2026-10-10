import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
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

// Read PDFKit's compressed drawing streams so assertions test actual exported text.
function pdfText(pdf: Buffer): string {
  const raw = pdf.toString('latin1');
  let extracted = '';
  for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try {
      const stream = inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1');
      extracted += [...stream.matchAll(/<([\da-f]+)>/gi)].map((value) => Buffer.from(value[1], 'hex').toString('latin1')).join('') + '\n';
    } catch { /* Non-deflated streams contain no PDFKit page text. */ }
  }
  return extracted;
}

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

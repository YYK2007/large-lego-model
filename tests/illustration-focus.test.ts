import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { renderDesignSvg } from '../shared/illustration';
import { CATALOG_VERSION, COORDINATE_SYSTEM, type Design } from '../shared/model';

const tower: Design = {
  id: 'focus-tower', title: 'Focused tower', description: 'Tall stack for instruction camera tests.', prompt: 'Show its current placement.',
  source: 'sample', createdAt: '2026-10-11T12:00:00Z', schemaVersion: 2, catalogVersion: CATALOG_VERSION, coordinateSystem: COORDINATE_SYSTEM,
  bricks: Array.from({ length: 60 }, (_, i) => ({ id: `brick-${i}`, partId: '3001', colorId: 1, x: 0, y: 0, z: i * 3, rotation: 0 })),
};
function targetWidth(svg: string, id: string) {
  const group = svg.match(new RegExp(`<g data-brick-id="${id}"[^>]*>([\\s\\S]*?)</g>`))![1];
  const xs = [...group.matchAll(/points="([^"]+)"/g)].flatMap(match => match[1].split(' ').map(point => Number(point.split(',')[0])));
  return Math.max(...xs) - Math.min(...xs);
}

test('instruction framing enlarges the new assembly, keeps adjacent support and omits projected-outside geometry', () => {
  const full = renderDesignSvg(tower, { width: 380, height: 300, showCue: false });
  const close = renderDesignSvg(tower, { width: 380, height: 300, showCue: false, focusIds: ['brick-59'], highlightIds: ['brick-59'] });
  assert.ok(targetWidth(close, 'brick-59') > targetWidth(full, 'brick-59') * 5, 'A tall model must not force the active piece into a distant whole-model view');
  assert.match(close, /data-brick-id="brick-58"/);
  assert.ok(!close.includes('data-brick-id="brick-0"'));
  assert.ok(close.length < full.length / 3, 'The close view should avoid constructing offscreen drawing primitives');
  assert.match(close, /clip-path="url\(#instruction-crop\)"/);
});

test('projected occluders remain even when they are far from the new piece in world space', async () => {
  const background = { ...tower, bricks: [tower.bricks[59]] };
  // Moving both X and Y by30 and Z by75 keeps this part in the same
  // orthographic image while moving it much closer to the viewing direction.
  const foreground = { ...background, bricks: [...background.bricks, { ...tower.bricks[59], id: 'foreground', colorId: 4, x: 30, y: 30, z: 252 }] };
  const options = { width: 380, height: 300, showCue: false, focusIds: ['brick-59'] };
  const alone = renderDesignSvg(background, options), occluded = renderDesignSvg(foreground, options);
  assert.match(occluded, /data-brick-id="foreground"/);
  const a = await sharp(Buffer.from(alone)).raw().toBuffer(), b = await sharp(Buffer.from(occluded)).raw().toBuffer();
  assert.notDeepEqual(a, b, 'The forward solid must visibly occlude the focused brick rather than disappear from a world-distance crop');
});

test('future pieces do not enter a close instruction view; invalid focus falls back to the unchanged full view', () => {
  const options = { visibleIds: ['brick-57', 'brick-58'], focusIds: ['brick-58'], showCue: false };
  const svg = renderDesignSvg(tower, options);
  assert.ok(!svg.includes('data-brick-id="brick-59"'));
  assert.equal(renderDesignSvg(tower, { focusIds: ['missing'] }), renderDesignSvg(tower));
});

test('checked movement arrows and copy labels are rendered and escaped without changing part geometry', () => {
  const svg = renderDesignSvg({ ...tower, bricks: [tower.bricks[0]] }, {
    focusIds: ['brick-0'], arrows: [{ from: [1, 6, 1.5], to: [1, 2, 1.5] }], labels: [{ point: [1, 2, 3.6], text: '<1>' }],
  });
  assert.match(svg, /data-placement-arrow="true"/);
  assert.match(svg, /data-placement-label="&lt;1&gt;"/);
  assert.ok(!svg.includes('<1>'));
  assert.equal((svg.match(/data-brick-id=/g) || []).length, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { renderLikenessViews } from '../server/likeness.js';
import { renderDesignSvg } from '../shared/illustration.js';
import { CATALOG_VERSION, COORDINATE_SYSTEM, validateDesign, type Design } from '../shared/model.js';

const design: Design = { id: 'likeness-test', title: 'Asymmetric slope specimen', description: 'Red slope opposite a blue block.', prompt: 'A slope specimen', source: 'sample', createdAt: '2026-10-10',
  schemaVersion: 2, coordinateSystem: COORDINATE_SYSTEM, catalogVersion: CATALOG_VERSION, bricks: [
    { id: 'base', partId: '3001', colorId: 15, x: 5, y: 7, z: 0, rotation: 0 },
    { id: 'floor', partId: '3001', colorId: 15, x: 5, y: 7, z: 3, rotation: 0 },
    { id: 'slope', partId: '3039', colorId: 4, x: 5, y: 7, z: 6, rotation: 0 },
    { id: 'back', partId: '3003', colorId: 1, x: 5, y: 9, z: 6, rotation: 0 },
  ] };

test('comparison views are labeled opposite isometric PNGs, bounded and opaque, without mutating placements', async () => {
  const before = JSON.stringify(design);
  const views = await renderLikenessViews(design);
  assert.deepEqual(views.map(view => view.label), ['Isometric from +X / +Y', 'Isometric from -X / -Y']);
  assert.equal(JSON.stringify(design), before);
  for (const view of views) {
    assert.equal(view.inlineData.mimeType, 'image/png');
    const pixels = sharp(Buffer.from(view.inlineData.data, 'base64'));
    const metadata = await pixels.metadata();
    assert.equal(metadata.width, 1024); assert.equal(metadata.height, 1024);
    const stats = await pixels.stats();
    assert.equal(stats.isOpaque, true);
    assert.ok(stats.channels.some(channel => channel.min < 50 && channel.max === 255), 'Has actual model pixels on white');
  }
  assert.notEqual(views[0].inlineData.data, views[1].inlineData.data);
});

test('rendered body pixels equal the canonical SVG and a manually placed half-turned slope assembly', async () => {
  // Independent fixture: red slope moved to the far end and points the opposite way.
  const opposite: Design = { ...design, bricks: [
    { ...design.bricks[0], x: 0, y: 0, rotation: 180 },
    { ...design.bricks[1], x: 0, y: 0, rotation: 180 },
    { ...design.bricks[2], x: 0, y: 2, rotation: 180 },
    { ...design.bricks[3], x: 0, y: 0, rotation: 180 },
  ] };
  assert.equal(validateDesign(opposite).valid, true);
  const views = await renderLikenessViews(design);
  for (const [index, expected] of [design, opposite].entries()) {
    const reference = await sharp(Buffer.from(renderDesignSvg(expected, { width: 1024, height: 976 }))).flatten({ background: '#fff' })
      .extract({ left: 0, top: 0, width: 1024, height: 890 }).removeAlpha().raw().toBuffer();
    const actual = await sharp(Buffer.from(views[index].inlineData.data, 'base64'))
      .extract({ left: 0, top: 48, width: 1024, height: 890 }).removeAlpha().raw().toBuffer();
    assert.deepEqual(actual, reference, 'All body pixels match the actual compiled-part renderer');
  }
});

test('invalid models are not illustrated as valid comparison evidence, while legacy inputs normalize once', async () => {
  await assert.rejects(renderLikenessViews({ ...design, bricks: [{ ...design.bricks[0], z: 3 }] }), /invalid design.*no stud support/);
  const legacy: Design = { ...design, schemaVersion: undefined, coordinateSystem: undefined, catalogVersion: undefined, bricks: [design.bricks[0]] };
  const before = JSON.stringify(legacy);
  assert.equal((await renderLikenessViews(legacy)).length, 2);
  assert.equal(JSON.stringify(legacy), before);
});

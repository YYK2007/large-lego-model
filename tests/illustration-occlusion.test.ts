import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import sharp from 'sharp';
import { renderDesignSvg } from '../shared/illustration';
import { buildSteps, COLORS, validateDesign, type Design } from '../shared/model';
import { generateManualPdf } from '../server/manual';

const tower: Design = JSON.parse(await readFile(new URL('./fixtures/bell-tower-occlusion.json', import.meta.url), 'utf8'));

test('accepted 436-piece Bell Tower exports every piece and its complete manual despite a painter cycle', async () => {
  assert.equal(tower.bricks.length, 436);
  assert.equal(validateDesign(tower).valid, true);
  const svg = renderDesignSvg(tower, { width: 1000, height: 1000 });
  assert.match(svg, /occlusion-fragment-/);
  assert.equal((svg.match(/data-brick-id=/g) || []).length, 436);
  for (const brick of tower.bricks) assert.ok(svg.includes(`data-brick-id="${brick.id}"`));
  const pdf = await generateManualPdf(tower);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.subarray(-20).toString().includes('%%EOF'));
  const raw = pdf.toString('latin1'), attachment = raw.indexOf('/Type /EmbeddedFile');
  assert.ok(attachment >= 0, 'The compact manual must retain its exact assembly sequence');
  const start = raw.indexOf('stream\n', attachment), dictionary = raw.slice(attachment, start);
  const length = Number(dictionary.match(/\/Length\s+(\d+)/)![1]);
  const retained = JSON.parse(inflateSync(pdf.subarray(start + 7, start + 7 + length)).toString('utf8'));
  assert.deepEqual(retained.steps, buildSteps(tower), 'Every ordered step and checked path survives grouped panels');
  const retainedIds = retained.steps.flatMap((step: { bricks: { id: string }[] }) => step.bricks.map(brick => brick.id));
  assert.equal(retainedIds.length, 436);
  for (const id of ['b362', 'b363', 'b366', 'b375', 'b383']) assert.equal(retainedIds.filter((value: string) => value === id).length, 1,
    `Cyclic clock placement ${id} is retained exactly once`);
});

test('split face colors agree with independent ray-box intersections across the five-brick cycle', async () => {
  // Real placements from the accepted clock. Distinct colors expose incorrect
  // ordering that its original all-white bricks would conceal.
  const ids = ['b362', 'b363', 'b366', 'b375', 'b383'];
  const colors = [4, 1, 2, 14, 25];
  const cycle: Design = { ...tower, bricks: ids.map((id, index) => {
    const brick = tower.bricks.find(brick => brick.id === id)!;
    return { ...brick, colorId: colors[index], x: brick.x - 8, y: brick.y - 10, z: brick.z - 57 };
  }) };
  const svg = renderDesignSvg(cycle, { width: 700, height: 620 });
  assert.match(svg, /occlusion-fragment-/);
  const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // Independently specified body boxes, in the same order as the five IDs.
  const boxes = [
    { min: [4, 0, 0], max: [6, 4, 3] }, { min: [6, 0, 0], max: [7, 4, 3] },
    { min: [0, 3, 0], max: [4, 5, 3] }, { min: [1, 1, 1], max: [4, 3, 4] },
    { min: [3, 0, 3], max: [7, 1, 6] },
  ];
  const studs = boxes.flatMap(box => {
    const result = [];
    for (let x = box.min[0] + 0.5; x < box.max[0]; x++) for (let y = box.min[1] + 0.5; y < box.max[1]; y++) {
      result.push({ min: [x - 0.33, y - 0.33, box.max[2]], max: [x + 0.33, y + 0.33, box.max[2] + 0.53] });
    }
    return result;
  });
  const direction = [1, 1, 2.5];
  const hit = (origin: number[], box: { min: number[]; max: number[] }) => {
    const entry = box.min.map((value, axis) => (value - origin[axis]) / direction[axis]);
    const exit = box.max.map((value, axis) => (value - origin[axis]) / direction[axis]);
    const far = Math.min(...exit);
    return Math.max(...entry) <= far ? { t: far, axis: exit.indexOf(far) } : null;
  };
  // Fixed camera bounds from the five boxes including 0.5-plate stud height:
  // projected X = [-5√3/2, 7√3/2], projected Y = [-1.1, 5.5].
  const scale = (700 - 2 * 37.2) / (12 * Math.sqrt(3) / 2);
  const offsetX = 350 - Math.sqrt(3) / 2 * scale;
  const offsetY = (620 - 48 - 6.6 * scale) / 2 + 1.1 * scale;
  const sampled = new Set<number>();
  let count = 0;
  for (let py = 10; py < 570; py += 7) for (let px = 10; px < 690; px += 7) {
    const u = (px + 0.5 - offsetX) / scale, v = (py + 0.5 - offsetY) / scale;
    const origin = [v + u / Math.sqrt(3), v - u / Math.sqrt(3), 0];
    const hits = boxes.flatMap((box, index) => { const result = hit(origin, box); return result ? [{ ...result, index }] : []; });
    const closest = hits.sort((a, b) => b.t - a.t)[0];
    if (!closest || studs.some(stud => (hit(origin, stud)?.t ?? -Infinity) >= closest.t - 0.01)) continue;
    // The renderer outlines real edges. Exclude the narrow boundary where a
    // nearer part's outline crosses an otherwise interior point of this face.
    if (boxes.some((other, index) => index !== closest.index && (hit(origin, {
      min: other.min.map(value => value - 0.04), max: other.max.map(value => value + 0.04),
    })?.t ?? -Infinity) >= closest.t - 0.08)) continue;
    const position = origin.map((value, axis) => value + closest.t * direction[axis]);
    const box = boxes[closest.index];
    if (position.some((value, axis) => axis !== closest.axis && Math.min(value - box.min[axis], box.max[axis] - value) < 0.12)) continue;
    const shade = [-0.3, -0.15, 0.08][closest.axis];
    const expected = COLORS[colors[closest.index]].hex.slice(1).match(/../g)!.map(value => {
      const channel = parseInt(value, 16);
      return Math.round(shade > 0 ? channel + (255 - channel) * shade : channel * (1 + shade));
    });
    const actual = [...data.subarray((py * info.width + px) * 4, (py * info.width + px) * 4 + 4)];
    assert.equal(actual[3], 255, `Surface must remain opaque at ${px},${py}`);
    assert.ok(expected.every((channel, index) => Math.abs(channel - actual[index]) <= 2),
      `Wrong visible face at ${px},${py}: expected ${expected}, got ${actual}`);
    count++; sampled.add(closest.index);
  }
  assert.ok(count > 300, 'Reference must inspect a substantial interior surface area');
  assert.equal(sampled.size, 5, 'Reference must inspect every member of the cycle');
});

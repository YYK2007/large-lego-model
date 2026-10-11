import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { orderedOcclusionComponents, renderDesignSvg } from '../shared/illustration';
import type { Design } from '../shared/model';

test('cyclic components precede their acyclic descendants without dropping any ordering edge', () => {
  // Already-emitted node 0, two cycles, and a chain blocked behind both cycles.
  const edges = [[1], [2, 3], [1, 4], [4], [5], [4, 6], [7], []];
  const groups = orderedOcclusionComponents(edges, [false, true, true, true, true, true, true, true]);
  assert.deepEqual(groups, [[1, 2], [3], [4, 5], [6], [7]]);
  const groupOf = new Map(groups.flatMap((group, index) => group.map(node => [node, index] as const)));
  for (const [from, targets] of edges.entries()) for (const to of targets) {
    if (groupOf.has(from)) assert.ok(groupOf.get(from)! <= groupOf.get(to)!, `Lost edge ${from} -> ${to}`);
  }
  assert.equal(new Set(groups.flat()).size, 7);
});

test('component traversal handles a deep unresolved graph without recursive stack overflow', () => {
  const count = 30_000;
  const edges = Array.from({ length: count }, (_, index) => index + 1 < count ? [index + 1] : []);
  edges[1].push(0);
  const groups = orderedOcclusionComponents(edges, edges.map(() => true));
  assert.equal(groups.length, count - 1);
  assert.deepEqual(groups[0], [0, 1]);
  assert.deepEqual(groups.at(-1), [count - 1]);
  assert.deepEqual(groups.flat(), Array.from({ length: count }, (_, index) => index));
});

test('a real painter cycle splits only its members, with unique clip IDs across separate cycles', async () => {
  const tower: Design = JSON.parse(await readFile(new URL('./fixtures/bell-tower-occlusion.json', import.meta.url), 'utf8'));
  const ids = ['b362', 'b363', 'b366', 'b375', 'b383'];
  const cycle: Design = { ...tower, bricks: ids.map(id => {
    const brick = tower.bricks.find(brick => brick.id === id)!;
    return { ...brick, x: brick.x - 8, y: brick.y - 10, z: brick.z - 57 };
  }) };
  const options = { width: 700, height: 620 };
  const clips = (svg: string) => [...svg.matchAll(/<clipPath id="([^"]+)"/g)].map(match => match[1]);
  const originalClips = clips(renderDesignSvg(cycle, options));
  assert.ok(originalClips.length > 0, 'The frozen five-piece geometry must exercise BSP');
  const descendant: Design = { ...cycle, bricks: [...cycle.bricks,
    { id: 'front', partId: '3005', colorId: 4, x: 6, y: 4, z: 12, rotation: 0 }] };
  const svg = renderDesignSvg(descendant, options);
  assert.equal(clips(svg).length, originalClips.length, 'A blocked descendant must retain its unsplit artwork');
  assert.equal((svg.match(/data-brick-id=/g) || []).length, 6);
  assert.ok(svg.indexOf('data-brick-id="front"') > svg.lastIndexOf('<clipPath'), 'The overlapping descendant is in front of its cycle');

  const separated: Design = { ...cycle, bricks: [...cycle.bricks,
    ...cycle.bricks.map(brick => ({ ...brick, id: `${brick.id}-second`, x: brick.x + 10, y: brick.y + 10 }))] };
  const twoCycles = renderDesignSvg(separated, options), clipIds = clips(twoCycles);
  assert.equal(clipIds.length, originalClips.length * 2);
  assert.equal(new Set(clipIds).size, clipIds.length, 'Separate BSP groups cannot reuse SVG clip IDs');
  assert.equal((twoCycles.match(/data-brick-id=/g) || []).length, 10);
  for (const [, id] of twoCycles.matchAll(/clip-path="url\(#([^)]+)\)"/g)) assert.ok(clipIds.includes(id));
});

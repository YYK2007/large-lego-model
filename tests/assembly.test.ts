import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { placementOffset } from '../shared/assembly';
import { buildSteps, billOfMaterials, exportLDraw, normalizeDesign, partBottomSites, partTopStuds, validateDesign, type Design } from '../shared/model';
import { SAMPLE_DESIGNS } from '../shared/examples';
import { cavityDesign, hangingBrick, hangingDesign } from './fixtures/hanging-design';

test('grounded hanging chain uses real upper mates and places its anchor first', () => {
  const before = JSON.stringify(hangingDesign);
  assert.equal(validateDesign(hangingDesign).valid, true);
  const steps = buildSteps(hangingDesign), placements = steps.flatMap(step => step.placements);
  assert.deepEqual(steps.flatMap(step => step.bricks.map(brick => brick.id)), ['ground', 'column1', 'column2', 'beam', 'hanging1', 'hanging2']);
  assert.deepEqual(placements.slice(-2).map(p => [p.approach, p.attachedTo]), [['+X', ['beam']], ['+X', ['hanging1']]]);
  const placed = new Map<string, typeof hangingDesign.bricks[number]>();
  for (const step of steps) for (const [i, brick] of step.bricks.entries()) {
    const placement = step.placements[i];
    assert.deepEqual(placement.waypoints.at(-1), { x: brick.x, y: brick.y, z: brick.z });
    assert.ok(placement.waypoints.every(point => point.z >= 0));
    for (const anchor of placement.attachedTo) {
      assert.ok(placed.has(anchor));
      const lower = placement.approach === 'above' ? placed.get(anchor)! : brick;
      const upper = placement.approach === 'above' ? brick : placed.get(anchor)!;
      assert.ok(partTopStuds(lower).some(a => partBottomSites(upper).some(b => a.x === b.x && a.y === b.y && a.z === b.z)));
    }
    placed.set(brick.id, brick);
  }
  assert.equal(JSON.stringify(hangingDesign), before);
  assert.deepEqual(billOfMaterials({ ...hangingDesign, bricks: [...placed.values()] }), billOfMaterials(hangingDesign));
  const ldraw = exportLDraw(hangingDesign).split(/\r?\n/).filter(line => line.startsWith('1 '));
  assert.deepEqual(ldraw.map(line => Number(line.split(' ')[3])), [-24, -48, -72, -80, -72, -48], 'LDraw uses the same descending appendage order after the beam');
});

test('floating connected groups and side contact remain invalid', () => {
  assert.match(validateDesign({ ...hangingDesign, bricks: hangingDesign.bricks.map(b => ({ ...b, z: b.z + 3 })) }).errors.join(' '), /no grounded piece/);
  assert.match(validateDesign({ ...hangingDesign, bricks: [hangingBrick('a', 0, 0, 0), hangingBrick('b', 1, 0, 0)] }).errors.join(' '), /disconnected/);
});

test('connection counts include every grounded or floating component regardless of input order', () => {
  assert.equal(validateDesign(hangingDesign).connectedComponents, 1);
  const floating = hangingDesign.bricks.map(b => ({ ...b, z: b.z + 3 }));
  const floatingCheck = validateDesign({ ...hangingDesign, bricks: floating });
  assert.equal(floatingCheck.valid, false);
  assert.equal(floatingCheck.connectedComponents, 1, 'A connected floating assembly still fails the separate ground check');
  const groups = [...hangingDesign.bricks, hangingBrick('loose-ground', 12, 0, 0), hangingBrick('floating-lower', 15, 0, 3), hangingBrick('floating-upper', 15, 0, 6)];
  for (const bricks of [groups, [...groups].reverse()]) {
    const check = validateDesign({ ...hangingDesign, bricks });
    assert.equal(check.valid, false);
    assert.equal(check.connectedComponents, 3, 'The grounded chain, separate grounded piece, and floating stack are distinct');
    assert.match(check.errors.join(' '), /disconnected groups/);
  }
  assert.equal(validateDesign({ ...hangingDesign, bricks: [] }).connectedComponents, 0);
});

test('a connected closed cavity requires a subassembly; a real lateral opening permits upward insertion', () => {
  const closed = validateDesign(cavityDesign(false));
  assert.equal(closed.valid, false);
  assert.match(closed.errors.join(' '), /No assembly path/);
  assert.doesNotMatch(closed.errors.join(' '), /disconnected|overlap/);
  assert.throws(() => buildSteps(cavityDesign(false)), /No assembly path/);
  const opened = cavityDesign(true);
  assert.equal(validateDesign(opened).valid, true);
  const placement = buildSteps(opened).flatMap(step => step.placements).find(p => p.brickId === 'inside')!;
  assert.equal(placement.approach, '+X', 'The overhead roof prevents a downward approach');
  assert.ok(placement.waypoints[0].x > 4);
  assert.ok(placement.waypoints[1].z < 2.5);
});

test('an unrelated stud blocks the entry sweep without a blanket receiver exemption', () => {
  const result = validateDesign(cavityDesign(true, true));
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /No assembly path/);
  assert.doesNotMatch(result.errors.join(' '), /disconnected|overlap/);
});

test('hanging siblings are both seated before their lower plate closes the insertion gap', () => {
  const design = { ...hangingDesign, bricks: [
    hangingBrick('ground', 2, 0, 0), hangingBrick('support', 2, 0, 3, '3024'),
    hangingBrick('anchor', 1, 0, 4, '3020'), hangingBrick('front', 0, 0, 3, '3022'),
    hangingBrick('rear', 0, 2, 3, '3022'), hangingBrick('lower', 0, 0, 2, '3020'),
  ] };
  assert.equal(validateDesign(design).valid, true);
  const placements = buildSteps(design).flatMap(step => step.placements);
  assert.deepEqual(placements.map(p => p.brickId), ['ground', 'support', 'anchor', 'front', 'rear', 'lower']);
  assert.deepEqual(placements.slice(3).map(p => [p.approach, p.attachedTo]), [
    ['-X', ['anchor']], ['-X', ['anchor']], ['-X', ['front', 'rear']],
  ]);
  assert.ok(placements.slice(3).every(p => p.waypoints[0].x < 0));
});

test('the saved 925-piece turtle finds a complete connected sequence without changing its geometry', t => {
  // Actual general-02 turtle attempt 5, before the last provider patch. The
  // original greedy frontier trapped b272 after installing lower plate b149.
  const design: Design = JSON.parse(readFileSync(new URL('./fixtures/turtle-assembly.json', import.meta.url), 'utf8'));
  const before = JSON.stringify(design), started = performance.now();
  assert.equal(design.bricks.length, 925);
  const check = validateDesign(design);
  assert.equal(check.valid, true, check.errors.join('; '));
  assert.equal(check.connectedComponents, 1);
  const placements = buildSteps(design).flatMap(step => step.placements);
  const byId = new Map(design.bricks.map(brick => [brick.id, brick])), placed = new Set<string>();
  for (const p of placements) {
    assert.equal(placed.has(p.brickId), false);
    const brick = byId.get(p.brickId)!;
    assert.deepEqual(p.waypoints.at(-1), { x: brick.x, y: brick.y, z: brick.z });
    assert.ok(p.waypoints.every(point => point.z >= 0));
    assert.ok(brick.z === 0 || p.attachedTo.length > 0);
    for (const id of p.attachedTo) {
      assert.ok(placed.has(id), `${p.brickId} needs an already placed anchor ${id}`);
      const lower = p.approach === 'above' ? byId.get(id)! : brick;
      const upper = p.approach === 'above' ? brick : byId.get(id)!;
      assert.ok(partTopStuds(lower).some(a => partBottomSites(upper).some(b => a.x === b.x && a.y === b.y && a.z === b.z)));
    }
    placed.add(p.brickId);
  }
  assert.equal(placed.size, design.bricks.length);
  assert.deepEqual(placements.filter(p => ['b372', 'b261', 'b272', 'b149', 'b371'].includes(p.brickId)).map(p => p.brickId), ['b372', 'b261', 'b272', 'b149', 'b371']);
  assert.equal(JSON.stringify(design), before);
  t.diagnostic(`Validation and assembly took ${(performance.now() - started).toFixed(1)} ms; full-suite timing includes concurrent tests.`);
});

test('placement animation follows the lateral then upward path and ends at canonical geometry', () => {
  const placement = buildSteps(hangingDesign).at(-1)!.placements[0];
  assert.ok(placementOffset(placement, 0).x > 0);
  assert.deepEqual(placementOffset(placement, 0.5), { x: 0, y: 0, z: placement.waypoints[1].z - 3 });
  assert.ok(placementOffset(placement, 0.75).z > placementOffset(placement, 0.5).z);
  assert.deepEqual(placementOffset(placement, 1), { x: 0, y: 0, z: 0 });
});

test('all frozen samples preserve the previous low-to-high order and twelve-piece batches', () => {
  for (const sample of SAMPLE_DESIGNS) {
    const oldOrder = normalizeDesign(sample).bricks.sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
    const steps = buildSteps(sample);
    assert.deepEqual(steps.flatMap(step => step.bricks), oldOrder, sample.id);
    assert.ok(steps.every(step => step.bricks.length <= 12 && step.placements.every(p => p.approach === 'above')));
  }
});

test('over a thousand connected pieces retain checked hanging paths without a piece cap', () => {
  const bricks = [];
  for (let row = 0; row < 8; row++) for (let column = 0; column < 20; column++) {
    const x = column * 4, y = row * 2, id = `${row}-${column}`;
    bricks.push(...hangingDesign.bricks.map(b => ({ ...b, id: `${id}-${b.id}`, x: b.x + x, y: b.y + y })));
    if (column < 19) bricks.push(hangingBrick(`${id}-bond`, x + 2, y, 10, '3710', 90));
    if (column === 0 && row < 7) bricks.push(hangingBrick(`${id}-row-bond`, row % 2, y, 10, '3623'));
  }
  const design = { ...hangingDesign, bricks }, started = performance.now();
  assert.equal(bricks.length, 1119);
  assert.deepEqual(validateDesign(design).errors, []);
  const placements = buildSteps(design).flatMap(step => step.placements);
  assert.equal(placements.length, bricks.length);
  assert.equal(placements.filter(p => p.approach !== 'above').length, 320);
  assert.ok(performance.now() - started < 5000, 'Assembly checks must stay responsive on this connected fixture');
});

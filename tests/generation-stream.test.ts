import assert from 'node:assert/strict';
import test from 'node:test';
import { BuildRequestError, readGenerationStream, summarizeBuildChecks } from '../src/generation-stream.js';
import { ROOF_SAMPLE } from '../shared/roof-sample.js';

function response(text: string, chunkSize = 7): Response {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) {
    for (let offset = 0; offset < bytes.length; offset += chunkSize) controller.enqueue(bytes.slice(offset, offset + chunkSize));
    controller.close();
  } }));
}

test('streamed progress and Unicode designs survive arbitrary network chunk boundaries', async () => {
  const progress = { type: 'progress', stage: 'planning' as const, attempt: 1, maxAttempts: 2 };
  const design = { ...ROOF_SAMPLE, title: 'Roof – slopes 🧱' };
  const events: unknown[] = [];
  const result = await readGenerationStream(response(JSON.stringify(progress) + '\n' + JSON.stringify({ type: 'design', design })), event => events.push(event));
  assert.deepEqual(events, [progress]);
  assert.deepEqual(result, design);
});

test('stream failures and incomplete results reject instead of replacing the current design', async () => {
  await assert.rejects(readGenerationStream(response('{"type":"error","error":"Planning timed out."}\n'), () => {}), /Planning timed out/);
  await assert.rejects(readGenerationStream(response('{"type":"progress","stage":"planning","attempt":1,"maxAttempts":2}\n'), () => {}), /before the design was saved/);
  await assert.rejects(readGenerationStream(new Response('{"error":"Two builds are already being planned."}', { status: 429 }), () => {}), /Two builds/);
});

test('checker feedback survives streaming and JSON error responses without losing exact attempt details', async () => {
  const message = 'The design did not pass our brick checks after two attempts.';
  const checks = [
    'Brick b47 (part 3004, x=11, y=6, z=64 plates, rotation=90) has no stud support directly below it.',
    'Cannot pack color White at (11, 6, 64 plates) with the supported part shapes. Bell tower 🧱.',
  ];
  const progress = { type: 'progress', stage: 'repairing', attempt: 2, maxAttempts: 2 };
  for (const res of [
    response(JSON.stringify(progress) + '\n' + JSON.stringify({ type: 'error', error: message, checks }), 1),
    new Response(JSON.stringify({ error: message, checks }), { status: 422, headers: { 'Content-Type': 'application/json' } }),
  ]) {
    await assert.rejects(readGenerationStream(res, () => {}), (error: unknown) => {
      assert.ok(error instanceof BuildRequestError);
      assert.equal(error.message, message);
      assert.deepEqual(error.checks, checks);
      assert.equal(summarizeBuildChecks(error.checks), 'Some planned details could not be made with the supported part shapes.');
      return true;
    });
  }
});

test('a late error rejects a partial design instead of committing it and retains its checks', async () => {
  const checks = ['The model contains disconnected groups. Side-to-side contact does not connect studs.'];
  const events = [
    { type: 'design', design: ROOF_SAMPLE },
    { type: 'error', error: 'The final build could not be saved.', checks },
  ];
  await assert.rejects(readGenerationStream(response(events.map(event => JSON.stringify(event)).join('\n')), () => {}), (error: unknown) => {
    assert.ok(error instanceof BuildRequestError);
    assert.deepEqual(error.checks, checks);
    return true;
  });
});

test('feedback summaries distinguish catalog-shape limits from stock and remain concise', () => {
  assert.equal(summarizeBuildChecks(['Cannot pack color White at (11, 6, 64 plates) with the available inventory.']), 'The last plan could not be built with the available pieces.');
  assert.equal(summarizeBuildChecks(['Brick b5 has no stud support directly below it.; The model contains disconnected groups.']), 'The last plan had unsupported or disconnected pieces.');
  const long = 'An unrecognized checker finding. '.repeat(40);
  assert.ok(summarizeBuildChecks([long]).length <= 180);
  const error = new BuildRequestError('Failed', [long, null, 12, {}, '', '   ']);
  assert.deepEqual(error.checks, [long], 'Exact valid details remain intact behind the summary');
  assert.deepEqual(new BuildRequestError('Failed', { invalid: true }).checks, []);
  assert.equal(summarizeBuildChecks([]), '');
});

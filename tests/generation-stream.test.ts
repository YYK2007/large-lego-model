import assert from 'node:assert/strict';
import test from 'node:test';
import { readGenerationStream } from '../src/generation-stream.js';
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

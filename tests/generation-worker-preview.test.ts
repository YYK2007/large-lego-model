import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import type { GenerationAttempt } from '../server/generation-attempt.js';
import { validateDesign, type Design } from '../shared/model.js';

const workerUrl = new URL('data:text/javascript,' + encodeURIComponent(`
  const dotenv = (await import(${JSON.stringify(import.meta.resolve('dotenv'))})).default;
  dotenv.config = () => ({ parsed: {} });
  process.env.GEMINI_API_KEY = 'mock-worker-preview';
  process.env.GEMINI_MODEL = 'gemini-3.8-flash';
  delete process.env.REBRICKABLE_API_KEY;
  const box = { x: 0, y: 0, z: 0, width: 4, depth: 4, height: 9, colorId: 4 };
  const observations = { usedImages: [], silhouette: 'A broad red body', proportions: 'A square upright body', features: ['A broad red body'], colors: ['Red'], limitations: [] };
  globalThis.fetch = async (url, options) => {
    if (new URL(String(url)).hostname !== 'generativelanguage.googleapis.com') throw new Error('Unexpected test network request');
    const fields = JSON.parse(options.body).generationConfig.responseJsonSchema.properties;
    const value = fields.kind ? { kind: 'original', name: '', location: '', aliases: [] }
      : fields.usedImages ? observations
      : fields.matches ? { matches: true, summary: 'The broad body is visible.', issues: [], identity: { status: 'recognizable', perceivedSubject: 'Requested sculpture', evidence: 'Broad body', correction: '' }, features: [{ index: 0, status: 'present', evidence: 'Broad body', correction: '' }] }
      : fields.edits ? { edits: [{ op: 'remove', path: '/boxes/1', valueJson: 'null' }] }
      : { schemaVersion: 2, coordinateSystem: 'stud-xy-plate-z', title: 'Worker test', description: 'An exact preview regression.', boxes: [box, { ...box, x: 12 }], observations };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] }, finishReason: 'STOP' }] }), { headers: { 'content-type': 'application/json' } });
  };
  await import(${JSON.stringify(new URL('../server/generation-worker.ts', import.meta.url).href)});
`));
type Message = { type: string; sequence?: number; attempt?: GenerationAttempt; previewSvg?: string; design?: Design; error?: unknown };

test('actual generation worker retains invalid previews and omits only review-disabled valid previews', async t => {
  for (const visualReview of [false, true, undefined]) await t.test(String(visualReview), async () => {
    const worker = new Worker(workerUrl, { workerData: { input: { prompt: 'Invent a broad red sculpture', quality: 'quick' }, continuous: true, stopWhenMatched: true, visualReview } });
    const messages: Message[] = [];
    const timer = setTimeout(() => { void worker.terminate(); }, 15_000);
    try {
      await new Promise<void>((resolve, reject) => {
        worker.on('message', (message: Message) => {
          messages.push(message);
          if (message.sequence !== undefined) worker.postMessage({ type: 'ack', sequence: message.sequence });
        });
        worker.once('error', reject);
        worker.once('exit', code => code === 0 ? resolve() : reject(new Error(`Worker exited ${code}`)));
      });
      assert.equal(messages.some(message => message.type === 'failure'), false);
      const attempts = messages.filter(message => message.type === 'attempt');
      assert.deepEqual(attempts.map(message => message.attempt!.status), ['invalid', 'valid']);
      assert.match(attempts[0].previewSvg!, /Unfinished attempt 1/);
      assert.equal(validateDesign(attempts[0].attempt!.design!).valid, false);
      if (visualReview === false) assert.equal(attempts[1].previewSvg, undefined);
      else assert.match(attempts[1].previewSvg!, /brick checks passed/);
      assert.equal(validateDesign(attempts[1].attempt!.design!).valid, true);
      assert.ok(attempts[1].attempt!.plan); assert.ok(attempts[1].attempt!.response);
      const complete = messages.find(message => message.type === 'complete')!.design!;
      assert.deepEqual(complete.bricks, attempts[1].attempt!.design!.bricks);
      assert.equal(complete.research!.comparison.status, visualReview === false ? 'not-reviewed' : 'matched');
    } finally { clearTimeout(timer); await worker.terminate(); }
  });
});

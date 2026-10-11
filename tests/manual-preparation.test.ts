import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { generateManualPdf, prepareManualPdf } from '../server/manual.js';
import { prepareGuidePdf } from '../src/manual-download.js';
import { hangingDesign } from './fixtures/hanging-design.js';

test('short preparation polls share one pending render and become ready from its existing cache', async () => {
  const design = { ...hangingDesign, id: `preparation-${randomUUID()}` };
  const render = generateManualPdf(design);
  assert.equal(await prepareManualPdf(design, undefined, undefined, 1), null);
  assert.equal(generateManualPdf(structuredClone(design)), render);
  assert.equal(await prepareManualPdf(design, undefined, undefined, 1), null);
  assert.equal(generateManualPdf(design), render, 'Repeated polls must retain the same render promise');
  const bytes = await render;
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  assert.deepEqual(await prepareManualPdf(design), bytes);
});

test('aborting a preparation wait leaves the shared render available to other callers', async () => {
  const design = { ...hangingDesign, id: `abort-preparation-${randomUUID()}` };
  const render = generateManualPdf(design);
  const controller = new AbortController();
  const waiting = prepareManualPdf(design, undefined, controller.signal);
  controller.abort(new Error('Browser left the guide'));
  await assert.rejects(waiting, /Browser left the guide/);
  assert.equal(generateManualPdf(design), render);
  assert.deepEqual(await prepareManualPdf(design), await render);
  const alreadyAborted = new AbortController(); alreadyAborted.abort();
  await assert.rejects(prepareManualPdf(design, undefined, alreadyAborted.signal), { name: 'AbortError' });
});

test('a render failure between polls is reported once before an explicit retry may render again', async () => {
  const design = { ...hangingDesign, id: `failed-preparation-${randomUUID()}`,
    bricks: [...hangingDesign.bricks, { ...hangingDesign.bricks[0], id: 'overlap' }] };
  const rejected = assert.rejects(generateManualPdf(design), /invalid design.*overlap/);
  assert.equal(await prepareManualPdf(design, undefined, undefined, 1), null);
  await rejected;
  let reported = false;
  const failure = prepareManualPdf(design).catch(error => { reported = true; throw error; });
  const checkedFailure = assert.rejects(failure, /invalid design.*overlap/);
  await Promise.resolve();
  assert.equal(reported, true, 'The next poll receives the recorded failure without starting another worker');
  await checkedFailure;
  const retry = prepareManualPdf(design);
  await assert.rejects(retry, /invalid design.*overlap/);
});

test('guide polls 202 using the same signed revision and only marks a PDF response ready', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const url = '/api/designs/exact-revision/manual.pdf?share=signed-token';
  const calls: { url: string; method?: string; signal?: AbortSignal | null }[] = [];
  const controller = new AbortController();
  let finished = false;
  const preparing = prepareGuidePdf(url, controller.signal, async (input, init) => {
    calls.push({ url: String(input), method: init?.method, signal: init?.signal });
    return calls.length < 3 ? new Response(null, { status: 202, headers: { 'Retry-After': '2' } })
      : new Response(null, { headers: { 'Content-Type': 'application/pdf' } });
  }).then(downloadUrl => { finished = true; return downloadUrl; });
  await Promise.resolve();
  assert.equal(finished, false); assert.equal(calls.length, 1);
  t.mock.timers.tick(2000); await Promise.resolve(); await Promise.resolve();
  assert.equal(finished, false); assert.equal(calls.length, 2);
  t.mock.timers.tick(2000);
  assert.equal(await preparing, url, 'The final download retains its signed revision, without prepare=1');
  assert.equal(calls.length, 3);
  for (const call of calls) assert.deepEqual(call, { url: `${url}&prepare=1`, method: 'HEAD', signal: controller.signal });
});

test('guide cancellation during a poll delay prevents further requests and failures stay user-friendly', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController(); let requests = 0;
  const preparing = prepareGuidePdf('/api/designs/revision/manual.pdf', controller.signal, async () => {
    requests++; return new Response(null, { status: 202, headers: { 'Retry-After': '2' } });
  });
  await Promise.resolve();
  controller.abort(new Error('Overall preparation deadline'));
  await assert.rejects(preparing, /Overall preparation deadline/);
  t.mock.timers.tick(30_000);
  assert.equal(requests, 1);
  for (const response of [new Response('PRIVATE_ERROR', { status: 500 }), new Response('HTML page', { headers: { 'Content-Type': 'text/html' } })]) {
    await assert.rejects(prepareGuidePdf('/manual.pdf', new AbortController().signal, async () => response), /PDF couldn’t be prepared.*\/manual/);
  }
});

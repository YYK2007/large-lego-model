import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { photonJobsApi, type PhotonJobsApi } from '../server/photon-api.js';
import type { Design } from '../shared/model.js';

const calls: { name: string; timeout: number; run: (api: PhotonJobsApi, signal: AbortSignal) => Promise<unknown> }[] = [
  { name: 'design', timeout: 15_000, run: (api, signal) => api.design('revision', signal) },
  { name: 'guide', timeout: 15_000, run: (api, signal) => api.instructionsLink!('revision', signal) },
  { name: 'manual', timeout: 600_000, run: (api, signal) => api.file('revision', 'manual.pdf', signal) },
  { name: 'model', timeout: 120_000, run: (api, signal) => api.file('revision', 'mobile.usdz', signal) },
];

test('caller cancellation reaches held HTTP requests while preserving each existing timeout', async t => {
  const originalTimeout = AbortSignal.timeout;
  const deadlines: number[] = [];
  t.mock.method(AbortSignal, 'timeout', (milliseconds: number) => { deadlines.push(milliseconds); return originalTimeout(milliseconds); });
  for (const call of calls) {
    const controller = new AbortController(), stopped = new Error(`Stopped ${call.name}`);
    let requestSignal: AbortSignal | undefined;
    const api = photonJobsApi('http://127.0.0.1:3001', async (_url, init) => {
      requestSignal = init!.signal!;
      return new Promise((_resolve, reject) => requestSignal!.addEventListener('abort', () => reject(requestSignal!.reason), { once: true }));
    });
    const waiting = call.run(api, controller.signal);
    assert.ok(requestSignal); assert.notEqual(requestSignal, controller.signal);
    controller.abort(stopped);
    await assert.rejects(waiting, error => error === stopped);
    assert.equal(requestSignal.aborted, true);
    assert.equal(deadlines.at(-1), call.timeout);
  }
});

test('the existing HTTP timeout still ends a request when its caller has not stopped', async t => {
  const deadline = new AbortController(), caller = new AbortController();
  t.mock.method(AbortSignal, 'timeout', () => deadline.signal);
  const api = photonJobsApi('http://127.0.0.1:3001', async (_url, init) => new Promise((_resolve, reject) => {
    init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
  }));
  const waiting = api.file('revision', 'manual.pdf', caller.signal);
  deadline.abort(new DOMException('Timed out', 'TimeoutError'));
  await assert.rejects(waiting, { name: 'TimeoutError' });
  assert.equal(caller.signal.aborted, false);
});

test('an already stopped caller never starts a design, guide or file request', async () => {
  let requests = 0;
  const api = photonJobsApi('http://127.0.0.1:3001', async () => { requests++; throw new Error('Unexpected request'); });
  const controller = new AbortController(); controller.abort();
  for (const call of calls) await assert.rejects(call.run(api, controller.signal), { name: 'AbortError' });
  assert.equal(requests, 0);
});

test('Stop during a file body download rejects that caller without returning partial bytes', async () => {
  const controller = new AbortController();
  let started!: () => void;
  const reading = new Promise<void>(resolve => { started = resolve; });
  const api = photonJobsApi('http://127.0.0.1:3001', async (_url, init) => new Response(new ReadableStream({
    start(stream) {
      stream.enqueue(new Uint8Array([1, 2]));
      init!.signal!.addEventListener('abort', () => stream.error(init!.signal!.reason), { once: true });
      started();
    },
  })));
  const downloading = api.file('revision', 'manual.pdf', controller.signal);
  await reading; controller.abort();
  await assert.rejects(downloading, { name: 'AbortError' });
});

test('Stop releases a validation waiter promptly while another caller completes the same checked snapshot', async () => {
  const design: Design = JSON.parse(readFileSync(new URL('./fixtures/mushroom-cap-assembly.json', import.meta.url), 'utf8'));
  const api = photonJobsApi('http://127.0.0.1:3001', async () => Response.json(design));
  const cancelled = new AbortController(), retained = new AbortController();
  const waiting = api.design(design.id, cancelled.signal);
  let completed = false;
  const other = api.design(design.id, retained.signal).then(result => { completed = true; return result; });
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(completed, false);
  assert.equal(getEventListeners(cancelled.signal, 'abort').length, 1, 'The caller is waiting on validation, after its HTTP response');
  cancelled.abort();
  await assert.rejects(waiting, { name: 'AbortError' });
  assert.equal(completed, false, 'Cancellation must not wait for the assembly search');
  assert.equal(getEventListeners(cancelled.signal, 'abort').length, 0);
  assert.deepEqual(await other, design);
  assert.equal(getEventListeners(retained.signal, 'abort').length, 0, 'Completion also removes the waiter listener');
  assert.deepEqual(await api.design(design.id), design, 'The shared successful validation remains usable after cancellation');
});

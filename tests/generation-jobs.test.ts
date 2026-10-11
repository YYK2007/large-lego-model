import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GenerationJobs } from '../server/generation-jobs.js';
import { validateDesign } from '../shared/model.js';
import { renderConceptSvg } from '../server/concept.js';
import type { SavedDesign } from '../server/store.js';
import type { GenerationJob } from '../shared/generation-job.js';

async function harness(options: { maxWorkers?: number; maxQueued?: number; workerTimeoutMs?: number; beforeSave?: (design: SavedDesign) => Promise<void> } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'generation-jobs-'));
  const designs = new Map<string, SavedDesign>();
  const settings = { directory, workerUrl: new URL('./fixtures/generation-job-worker.mjs', import.meta.url), ...options,
    save: async (design: SavedDesign) => { await options.beforeSave?.(design); assert.equal(validateDesign(design).valid, true); assert.equal(designs.has(design.id), false, 'Every stored revision is immutable'); designs.set(design.id, structuredClone(design)); },
    load: async (id: string) => designs.get(id) || null };
  let manager = new GenerationJobs(settings); await manager.ready;
  return { designs, directory, get jobs() { return manager; },
    restart: async () => { await manager.close(); manager = new GenerationJobs(settings); await manager.ready; },
    close: async () => { await manager.close(); await rm(directory, { recursive: true, force: true }); } };
}
async function until(jobs: GenerationJobs, id: string, predicate: (job: GenerationJob) => boolean) {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) { const job = await jobs.get(id); if (predicate(job)) return job; await new Promise(resolve => setTimeout(resolve, 15)); }
  assert.fail(`Job did not reach expected state: ${JSON.stringify(await jobs.get(id))}`);
}

test('worker success persists progress, a distinct valid draft and final result; status excludes request images and stock', async () => {
  const h = await harness();
  try {
    const id = randomUUID(), input = { prompt: 'complete', quality: 'quick' as const, image: { data: 'cHJpdmF0ZQ==', mimeType: 'image/png' }, inventory: [{ partId: '3005', colorId: 15, quantity: 1, source: 'Private collection' }] };
    await h.jobs.submit(id, input);
    const result = await until(h.jobs, id, job => job.status === 'succeeded');
    assert.equal(result.quality, 'quick'); assert.equal(result.milestones[0].stage, 'planning');
    assert.deepEqual(result.usage, { requests: 2, inputTokens: 100, outputTokens: 40, thinkingTokens: 20, cachedTokens: 30, elapsedMs: 15 });
    assert.equal(h.designs.size, 2); assert.equal(result.bestDraftId, result.resultId);
    assert.equal(h.designs.get(result.resultId!)!.description, 'Final metadata differs from the earlier draft.');
    assert.equal(h.designs.get(result.resultId!)!.inventory?.[0].source, 'Private collection');
    assert.doesNotMatch(JSON.stringify(result), /cHJpdmF0ZQ|Private collection|"input"/);
    assert.equal((await stat(join(h.directory, `${id}.json`))).mode & 0o777, 0o600);
    assert.equal((await h.jobs.submit(id, input)).status, 'succeeded', 'Retrying the same request must not pay for another worker');
    await assert.rejects(h.jobs.submit(id, { ...input, prompt: 'different' }), /different build/);
  } finally { await h.close(); }
});

test('queue is bounded and validates input before persisting; queued cancellation never starts a worker', async () => {
  const h = await harness({ maxWorkers: 1, maxQueued: 1 });
  try {
    await assert.rejects(h.jobs.submit(randomUUID(), { prompt: '' }), /Describe/);
    const first = randomUUID(), second = randomUUID();
    await h.jobs.submit(first, { prompt: 'wait' });
    assert.equal((await h.jobs.submit(second, { prompt: 'complete' })).status, 'queued');
    await assert.rejects(h.jobs.submit(randomUUID(), { prompt: 'complete' }), /queue is full/);
    const cancelled = await h.jobs.cancel(second); assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.startedAt, undefined);
    await h.jobs.cancel(first);
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal((await h.jobs.get(second)).startedAt, undefined);
  } finally { await h.close(); }
});

test('cancellation stops a running worker, retains its draft and rejects late results', async () => {
  const h = await harness();
  try {
    const id = randomUUID(); await h.jobs.submit(id, { prompt: 'wait' });
    const running = await until(h.jobs, id, job => Boolean(job.bestDraftId));
    const stopped = await h.jobs.cancel(id);
    assert.equal(stopped.status, 'cancelled'); assert.equal(stopped.bestDraftId, running.bestDraftId);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal((await h.jobs.get(id)).status, 'cancelled'); assert.equal((await h.jobs.get(id)).resultId, undefined);
    assert.equal(h.designs.size, 1);
  } finally { await h.close(); }
});

test('restart labels active and queued jobs interrupted, keeps drafts, and starts nothing until explicit resume', async () => {
  const h = await harness({ maxWorkers: 1 });
  try {
    const id = randomUUID(), queued = randomUUID();
    await h.jobs.submit(id, { prompt: 'wait' });
    const before = await until(h.jobs, id, job => Boolean(job.bestDraftId));
    await h.jobs.submit(queued, { prompt: 'complete' });
    await h.restart();
    assert.equal((await h.jobs.get(id)).status, 'interrupted'); assert.equal((await h.jobs.get(id)).bestDraftId, before.bestDraftId);
    assert.deepEqual((await h.jobs.get(id)).usage, before.usage);
    assert.equal((await h.jobs.get(queued)).status, 'interrupted'); assert.equal(h.jobs.activeCount, 0);
    const resumedId = randomUUID(); await h.jobs.resume(id, resumedId);
    const result = await until(h.jobs, resumedId, job => job.status === 'succeeded');
    assert.equal(result.resumedFrom, id); assert.equal(result.resumeMode, 'draft');
    assert.ok(result.milestones.some(event => event.detail === `Resumed ${before.bestDraftId}`));
    assert.equal((await h.jobs.get(id)).status, 'interrupted');
    assert.equal((await h.jobs.resume(id, resumedId)).id, resumedId, 'Resume POST is idempotent too');
  } finally { await h.close(); }
});

test('client-provided catalog metadata is authenticated before queue admission', async () => {
  const h = await harness();
  try {
    const id = randomUUID();
    const previous: SavedDesign = { id: 'catalog-forgery', title: 'Specimen', description: 'Not a trusted catalog.', prompt: 'Test', source: 'ai', createdAt: new Date().toISOString(), schemaVersion: 2, catalogVersion: 'upright-architecture-2', coordinateSystem: 'stud-xy-plate-z',
      bricks: [{ id: 'one', partId: '3005', colorId: 15, x: 0, y: 0, z: 0, rotation: 0 }],
      catalog: { schemaVersion: 1, parts: {}, colors: { 999999: { id: 999999, name: 'Forged material', hex: '#FFFFFF', ldrawId: 999999 } } } };
    await assert.rejects(h.jobs.submit(id, { prompt: 'complete', previous }), /verified catalog material/);
    await assert.rejects(h.jobs.submit(id, { prompt: 'complete', inventoryCatalog: previous.catalog }), /verified catalog material/);
    await assert.rejects(h.jobs.get(id), /not found/);
    assert.equal(h.jobs.activeCount, 0);
  } finally { await h.close(); }
});

test('failures and worker exit retain draft; the watchdog bounds an unresponsive worker', async () => {
  for (const prompt of ['fail', 'exit', 'wait']) {
    const h = await harness({ workerTimeoutMs: 700 });
    try {
      const id = randomUUID(); await h.jobs.submit(id, { prompt });
      const failed = await until(h.jobs, id, job => job.status === 'failed');
      assert.ok(failed.bestDraftId); assert.equal(failed.resultId, undefined); assert.ok(failed.error?.message);
      assert.equal(JSON.parse(await readFile(join(h.directory, `${id}.json`), 'utf8')).job.status, 'failed');
    } finally { await h.close(); }
  }
});

test('CPU-heavy generation is isolated while job reads and cancellation stay responsive', async () => {
  const h = await harness();
  try {
    const id = randomUUID(); await h.jobs.submit(id, { prompt: 'cpu' });
    await until(h.jobs, id, job => Boolean(job.progress));
    const started = performance.now();
    for (let index = 0; index < 50; index++) assert.equal((await h.jobs.get(id)).id, id);
    assert.ok(performance.now() - started < 250, 'Status reads cannot wait for the 1s worker CPU loop');
    await h.jobs.cancel(id); assert.equal((await h.jobs.get(id)).status, 'cancelled');
  } finally { await h.close(); }
});

test('concept checkpoints are validated and persisted separately from public job status', async () => {
  const h = await harness();
  try {
    const id = randomUUID(); await h.jobs.submit(id, { prompt: 'concept' });
    const job = await until(h.jobs, id, value => value.status === 'succeeded');
    assert.equal(job.conceptId, id); assert.doesNotMatch(JSON.stringify(job), /<script>|components/);
    const concept = await h.jobs.concept(id), svg = renderConceptSvg(concept);
    assert.doesNotMatch(svg, /<script>/); assert.match(svg, /&lt;script&gt;/);
    await h.restart(); assert.deepEqual(await h.jobs.concept(id), concept);
    const bad = randomUUID(); await h.jobs.submit(bad, { prompt: 'invalid-concept' });
    await until(h.jobs, bad, value => value.status === 'failed');
    await assert.rejects(h.jobs.concept(bad), /does not have/);
  } finally { await h.close(); }
});

test('continuous jobs retain every attempt beyond four, with failed previews separate from checked designs, across restart', async () => {
  const h = await harness();
  try {
    const id = randomUUID(); await h.jobs.submit(id, { prompt: 'continuous' });
    const job = await until(h.jobs, id, value => value.attempts?.length === 7);
    assert.equal(job.continuous, true); assert.equal(job.stopWhenMatched, false); assert.equal(job.status, 'running'); assert.equal(job.resultId, undefined);
    assert.deepEqual(job.attempts?.map(item => item.attempt), [1, 2, 3, 4, 5, 6, 7]);
    assert.equal(job.attempts?.[4].previewAvailable, true); assert.equal(job.attempts?.[4].designId, undefined);
    assert.equal(job.attempts?.[6].status, 'valid'); assert.ok(job.attempts?.[6].designId);
    assert.notEqual(job.bestDraftId, job.attempts?.[6].designId, 'A merely valid attempt does not replace the previously selected best draft');
    assert.equal(h.designs.size, 2, 'Only the checked draft and checked attempt enter the normal design store');
    assert.doesNotMatch(JSON.stringify(job), /"bricks"|"boxes"|"response"/);
    const failed = await h.jobs.attempt(id, 5);
    assert.equal(failed.status, 'invalid'); assert.ok(failed.design); assert.equal(validateDesign(failed.design).valid, false);
    assert.match(await h.jobs.attemptPreview(id, 5), /Unfinished attempt 5/);
    assert.match(await h.jobs.attemptPreview(id, 5), /data-brick-id="one"/, 'The preview uses the real brick renderer');
    assert.ok((await h.jobs.attempt(id, 1)).plan, 'Unpackable attempts still retain their exact plan output');
    await assert.rejects(h.jobs.attemptPreview(id, 1), /does not have/);
    await assert.rejects(h.jobs.attempt(id, -1), /not found/);
    assert.equal((await stat(join(h.directory, id, '5.json'))).mode & 0o777, 0o600);
    await h.restart();
    const recovered = await h.jobs.get(id);
    assert.equal(recovered.status, 'interrupted'); assert.deepEqual(recovered.attempts, job.attempts);
    assert.deepEqual(await h.jobs.attempt(id, 5), failed); assert.equal(h.jobs.activeCount, 0);
  } finally { await h.close(); }
});

test('Stop retains an already received attempt while its save is in flight, without late completion or state revival', async () => {
  let saves = 0, release!: () => void, entered!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const saving = new Promise<void>(resolve => { entered = resolve; });
  const h = await harness({ beforeSave: async () => { if (++saves === 2) { entered(); await blocked; } } });
  try {
    const id = randomUUID(); await h.jobs.submit(id, { prompt: 'continuous' });
    await saving;
    const stop = h.jobs.cancel(id);
    await new Promise(resolve => setTimeout(resolve, 20));
    release(); await stop;
    const stopped = await h.jobs.get(id);
    assert.equal(stopped.status, 'cancelled'); assert.equal(stopped.attempts?.length, 7);
    assert.equal(stopped.resultId, undefined); assert.ok(stopped.attempts?.[6].designId);
    const originalDraft = stopped.bestDraftId;
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal((await h.jobs.get(id)).bestDraftId, originalDraft);
    assert.equal((await h.jobs.get(id)).status, 'cancelled');
    assert.equal(JSON.parse(await readFile(join(h.directory, `${id}.json`), 'utf8')).job.attempts.length, 7);
  } finally { release(); await h.close(); }
});

test('bounded legacy execution reaches the worker and cannot be changed by reusing its request ID', async () => {
  const h = await harness();
  try {
    const id = randomUUID(); await h.jobs.submit(id, { prompt: 'mode' }, undefined, { continuous: false });
    const job = await until(h.jobs, id, value => value.status === 'succeeded');
    assert.equal(job.continuous, false); assert.ok(job.milestones.some(item => item.detail === 'Continuous: false'));
    await assert.rejects(h.jobs.submit(id, { prompt: 'mode' }), /different build/);
    assert.equal((await h.jobs.submit(id, { prompt: 'mode' }, undefined, { continuous: false })).id, id);
  } finally { await h.close(); }
});

test('stop-when-matched jobs retain attempts and complete, with an immutable persisted execution policy', async () => {
  const h = await harness();
  try {
    const id = randomUUID(), input = { prompt: 'continuous' }, execution = { continuous: true, stopWhenMatched: true };
    await h.jobs.submit(id, input, undefined, execution);
    const job = await until(h.jobs, id, value => value.status === 'succeeded');
    assert.equal(job.continuous, true); assert.equal(job.stopWhenMatched, true);
    assert.equal(job.attempts?.length, 7); assert.equal(job.attempts?.[6].status, 'valid');
    assert.ok(job.resultId); assert.equal(validateDesign(h.designs.get(job.resultId!)!).valid, true);
    await assert.rejects(h.jobs.submit(id, input), /different build/);
    await assert.rejects(h.jobs.submit(id, input, undefined, { ...execution, stopWhenMatched: false }), /different build/);
    await h.restart();
    assert.deepEqual(await h.jobs.get(id), JSON.parse(JSON.stringify(job)));
    assert.equal((await h.jobs.submit(id, input, undefined, execution)).resultId, job.resultId);
    assert.equal(h.jobs.activeCount, 0);
  } finally { await h.close(); }
});

test('resuming a persisted stop-when-matched job preserves its policy and saved draft', async () => {
  const h = await harness();
  try {
    const id = randomUUID();
    await h.jobs.submit(id, { prompt: 'wait' }, undefined, { continuous: true, stopWhenMatched: true });
    const before = await until(h.jobs, id, value => Boolean(value.bestDraftId));
    await h.restart();
    const interrupted = await h.jobs.get(id);
    assert.equal(interrupted.status, 'interrupted'); assert.equal(interrupted.stopWhenMatched, true);
    const resumedId = randomUUID();
    await h.jobs.resume(id, resumedId);
    const resumed = await until(h.jobs, resumedId, value => value.status === 'succeeded');
    assert.equal(resumed.continuous, true); assert.equal(resumed.stopWhenMatched, true);
    assert.equal(resumed.resumedFrom, id); assert.equal(resumed.resumeMode, 'draft');
    assert.ok(resumed.milestones.some(event => event.detail === `Resumed ${before.bestDraftId}`));
    assert.equal((await h.jobs.resume(id, resumedId)).resultId, resumed.resultId);
  } finally { await h.close(); }
});

test('Quick messaging deadline ends repeated retries with its exact first checked draft', async () => {
  const h = await harness({ workerTimeoutMs: 1200 });
  try {
    const id = randomUUID();
    await h.jobs.submit(id, { prompt: 'quick-retries', quality: 'quick' }, undefined, { continuous: true, stopWhenMatched: true });
    const early = await until(h.jobs, id, job => Boolean(job.bestDraftId));
    const final = await until(h.jobs, id, job => job.status === 'succeeded');
    assert.equal(final.resultId, early.bestDraftId);
    assert.equal(final.bestDraftId, early.bestDraftId);
    assert.ok(final.milestones.filter(item => item.stage === 'repairing').length > 2);
    assert.equal(h.designs.size, 1, 'Promote the saved revision without copying or inventing a review');
    assert.equal(h.designs.get(final.resultId!)?.research, undefined);
    assert.ok(Date.parse(final.finishedAt!) - Date.parse(final.startedAt!) < 2200);
    assert.equal(h.jobs.activeCount, 0);
    await h.restart();
    assert.equal((await h.jobs.get(id)).resultId, early.bestDraftId);
  } finally { await h.close(); }
});

test('Quick messaging deadline without a checked draft stops and offers a concrete next choice', async () => {
  const h = await harness({ workerTimeoutMs: 1200 });
  try {
    const id = randomUUID();
    await h.jobs.submit(id, { prompt: 'quick-no-draft', quality: 'quick' }, undefined, { continuous: true, stopWhenMatched: true });
    const final = await until(h.jobs, id, job => job.status === 'failed');
    assert.equal(final.resultId, undefined); assert.equal(final.bestDraftId, undefined);
    assert.match(final.error!.message, /Quick.*time limit.*Detailed.*simpler/);
    assert.equal(h.designs.size, 0); assert.equal(h.jobs.activeCount, 0);
  } finally { await h.close(); }
});

test('Quick time budget starts when its worker runs, excluding queue wait', async () => {
  const h = await harness({ maxWorkers: 1, workerTimeoutMs: 1200 });
  try {
    const first = randomUUID(), second = randomUUID();
    await h.jobs.submit(first, { prompt: 'wait' });
    const queued = await h.jobs.submit(second, { prompt: 'quick-retries', quality: 'quick' }, undefined, { stopWhenMatched: true });
    assert.equal(queued.status, 'queued'); assert.equal(queued.startedAt, undefined);
    const final = await until(h.jobs, second, job => job.status === 'succeeded');
    assert.ok(Date.parse(final.startedAt!) - Date.parse(final.createdAt) >= 900);
    assert.ok(Date.parse(final.finishedAt!) - Date.parse(final.startedAt!) >= 1100);
    assert.ok(final.resultId);
  } finally { await h.close(); }
});

test('default worker deadlines reserve delivery time for Quick and leave Detailed and continuous policies intact', async t => {
  for (const policy of [
    { quality: 'quick' as const, continuous: true, stopWhenMatched: true, timeout: 150_000 },
    { quality: 'quick' as const, continuous: false, stopWhenMatched: false, timeout: 160_000 },
    { quality: 'detailed' as const, continuous: false, stopWhenMatched: false, timeout: 310_000 },
    { quality: 'quick' as const, continuous: true, stopWhenMatched: false, timeout: undefined },
  ]) await t.test(JSON.stringify(policy), async t => {
    const nativeTimeout = setTimeout, deadlines: number[] = [];
    t.mock.method(globalThis, 'setTimeout', (...args: Parameters<typeof setTimeout>) => {
      if (args[1] !== undefined && args[1] > 1000) deadlines.push(args[1]);
      return nativeTimeout(...args);
    });
    const h = await harness();
    try {
      const id = randomUUID();
      await h.jobs.submit(id, { prompt: 'wait', quality: policy.quality }, undefined, { continuous: policy.continuous, stopWhenMatched: policy.stopWhenMatched });
      await until(h.jobs, id, job => Boolean(job.bestDraftId));
      assert.deepEqual(deadlines, policy.timeout === undefined ? [] : [policy.timeout]);
      await h.jobs.cancel(id);
    } finally { await h.close(); }
  });
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { cancelJob, readJob, resumeJob, submitJob, stopAndReadAttempt, JobRequestError } from '../src/generation-jobs.js';
import type { JobAttempt } from '../shared/generation-job.js';
import type { Design } from '../shared/model.js';

const id = '11111111-1111-4111-8111-111111111111';
const nextId = '22222222-2222-4222-8222-222222222222';
const status = { id, status: 'running', quality: 'detailed', createdAt: '2026-10-10T00:00:00Z', updatedAt: '2026-10-10T00:00:00Z', milestones: [] };
const checkedDesign: Design = { id: 'checked-attempt', title: 'Checked specimen', description: 'One checked brick', prompt: 'A brick', source: 'ai', createdAt: status.createdAt,
  schemaVersion: 2, catalogVersion: 'upright-architecture-2', coordinateSystem: 'stud-xy-plate-z', bricks: [{ id: 'one', partId: '3005', colorId: 15, x: 0, y: 0, z: 0, rotation: 0 }] };
const checkedAttempt: JobAttempt = { attempt: 7, status: 'valid', checks: [], previewAvailable: true, designId: checkedDesign.id, at: status.createdAt };

test('polling binds each response to the requested job and never submits another generation', async () => {
  const original = globalThis.fetch;
  try {
    const calls: { url: string; method: string }[] = [];
    globalThis.fetch = async (url, options) => { calls.push({ url: String(url), method: options?.method || 'GET' }); return Response.json(status); };
    assert.equal((await readJob(id)).id, id);
    assert.deepEqual(calls, [{ url: `/api/generation-jobs/${id}`, method: 'GET' }]);
    await assert.rejects(readJob(nextId), /different or invalid/);
    globalThis.fetch = async () => { throw new TypeError('Network unavailable'); };
    await assert.rejects(readJob(id), /Network unavailable/);
    assert.equal(calls.length, 2, 'An interrupted poll must not invoke POST');
  } finally { globalThis.fetch = original; }
});

test('Use this build confirms Stop before loading the exact checked attempt', async () => {
  const original = globalThis.fetch;
  try {
    const calls: string[] = [];
    globalThis.fetch = async url => {
      calls.push(String(url));
      return Response.json(calls.length === 1 ? { ...status, status: 'cancelled', attempts: [checkedAttempt] } : checkedDesign);
    };
    const result = await stopAndReadAttempt(id, checkedAttempt);
    assert.equal(result.job.status, 'cancelled'); assert.deepEqual(result.design, checkedDesign);
    assert.deepEqual(calls, [`/api/generation-jobs/${id}/cancel`, `/api/designs/${checkedDesign.id}`]);
  } finally { globalThis.fetch = original; }
});

test('Use this build never loads invalid attempts or unconfirmed Stop, and rejects invalid or mismatched saved geometry', async () => {
  const original = globalThis.fetch;
  try {
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw new TypeError('Offline'); };
    await assert.rejects(stopAndReadAttempt(id, { ...checkedAttempt, status: 'invalid' }), /complete checked/);
    assert.equal(calls, 0);
    await assert.rejects(stopAndReadAttempt(id, checkedAttempt), /Offline/); assert.equal(calls, 1);
    globalThis.fetch = async () => { calls++; return Response.json({ ...status, attempts: [checkedAttempt] }); };
    await assert.rejects(stopAndReadAttempt(id, checkedAttempt), /has not stopped/); assert.equal(calls, 2);
    for (const design of [{ ...checkedDesign, id: 'wrong-id' }, { ...checkedDesign, bricks: [{ ...checkedDesign.bricks[0], z: 3 }] }]) {
      globalThis.fetch = async url => Response.json(String(url).endsWith('/cancel') ? { ...status, status: 'cancelled', attempts: [checkedAttempt] } : design);
      await assert.rejects(stopAndReadAttempt(id, checkedAttempt), /invalid or does not match/);
    }
    globalThis.fetch = async () => Response.json({ ...status, status: 'cancelled', attempts: [{ ...checkedAttempt, designId: 'other-revision' }] });
    await assert.rejects(stopAndReadAttempt(id, checkedAttempt), /could not be confirmed/);
  } finally { globalThis.fetch = original; }
});

test('submit and explicit resume use caller request IDs, while cancel targets only its requested job', async () => {
  const original = globalThis.fetch;
  try {
    const calls: { url: string; body: unknown }[] = [];
    globalThis.fetch = async (url, options) => {
      const body = JSON.parse(String(options?.body)); calls.push({ url: String(url), body });
      return Response.json({ ...status, id: body.requestId || id });
    };
    await submitJob(id, { prompt: 'A sculpture', quality: 'detailed' });
    await cancelJob(id);
    await resumeJob(id, nextId);
    assert.deepEqual(calls, [
      { url: '/api/generation-jobs', body: { requestId: id, input: { prompt: 'A sculpture', quality: 'detailed' } } },
      { url: `/api/generation-jobs/${id}/cancel`, body: {} },
      { url: `/api/generation-jobs/${id}/resume`, body: { requestId: nextId } },
    ]);
    globalThis.fetch = async () => Response.json({ error: 'Check this request.', checks: ['No matching receiver.'] }, { status: 422 });
    await assert.rejects(readJob(id), error => error instanceof JobRequestError && error.status === 422 && error.checks[0] === 'No matching receiver.');
  } finally { globalThis.fetch = original; }
});

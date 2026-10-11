import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message } from 'spectrum-ts';
import { PhotonConversation, type PhotonReply } from '../server/photon-conversation.js';
import type { PhotonJobsApi } from '../server/photon-api.js';
import type { Conversation } from '../server/photon-routing.js';
import type { GenerationInput } from '../server/generation.js';
import type { SavedDesign } from '../server/store.js';
import type { GenerationJob } from '../shared/generation-job.js';

const originalPrompt = 'Build a coastal lighthouse from this photo';
const image = { data: Buffer.from('fixture-photo').toString('base64'), mimeType: 'image/png' };
const inventory = [{ partId: '3005', colorId: 15, quantity: 20, source: 'Confirmed white brick box' }];
const a: SavedDesign = { id: 'preview-a', title: 'Lighthouse A', description: 'Checked fixture.', prompt: originalPrompt,
  source: 'ai', createdAt: '2026-10-11T00:00:00.000Z', schemaVersion: 2, coordinateSystem: 'stud-xy-plate-z', catalogVersion: 'upright-architecture-2',
  bricks: [{ id: 'a1', partId: '3005', colorId: 15, x: 0, y: 0, z: 0, rotation: 0 }] };
const b: SavedDesign = { ...a, id: 'preview-b', title: 'Lighthouse B', bricks: [...a.bricks, { ...a.bricks[0], id: 'b2', z: 3 }] };

function harness() {
  let state: Conversation = { handledIds: [], jobId: 'job-a', requestPrompt: originalPrompt, pendingImage: image, inventory };
  const job = (id: string): GenerationJob => ({ id, status: 'running', quality: 'detailed', continuous: true,
    createdAt: a.createdAt, updatedAt: a.createdAt, milestones: [], attempts: [] });
  const jobs = new Map<string, GenerationJob>([['job-a', { ...job('job-a'), bestDraftId: a.id }]]);
  const designs = new Map([[a.id, a], [b.id, b]]);
  const texts: string[] = [], previews: string[] = [], deliveries: string[] = [], fileRequests: string[] = [];
  const submissions: GenerationInput[] = [], failures = new Set<string>();
  const api: PhotonJobsApi = {
    submit: async (id, input) => { submissions.push(structuredClone(input)); jobs.set(id, job(id)); return structuredClone(jobs.get(id)!); },
    get: async id => structuredClone(jobs.get(id)!),
    stop: async id => { jobs.get(id)!.status = 'cancelled'; return structuredClone(jobs.get(id)!); },
    design: async id => structuredClone(designs.get(id)!),
    instructionsLink: async id => `https://guide.example/${id}`,
    file: async (id, format) => { fileRequests.push(`${id}:${format}`); return Buffer.from(`${id}:${format}`); },
    preview: async () => { assert.fail('This fixture delivers checked saved-design previews'); },
    chat: async () => ({ intent: 'model', text: 'Request the selected model.' }),
  };
  const send = async (bytes: Buffer) => { const key = bytes.toString(); if (failures.has(key)) throw new Error('Delivery unavailable'); deliveries.push(key); };
  const reply: PhotonReply = {
    text: async value => { texts.push(value); }, designPreview: async design => { previews.push(design.id); },
    instructions: async url => { deliveries.push(`guide:${url.split('/').at(-1)}`); },
    model: send, manual: send, parts: send, preview: async () => assert.fail('Unexpected attempt preview'),
  };
  let messageId = 0;
  const message = (text: string) => ({ id: `message-${++messageId}`, direction: 'inbound', content: { type: 'text', text } } as Pick<Message, 'id' | 'direction' | 'content'>);
  const create = () => new PhotonConversation(structuredClone(state), api, reply, async value => { state = structuredClone(value); }, undefined, () => Date.parse(a.createdAt), false);
  return { create, message, jobs, texts, previews, deliveries, fileRequests, submissions, failures, state: () => state };
}

test('unapproved complete previews and direct or interpreted export requests send no guide or final files', async () => {
  const h = harness(), conversation = h.create();
  await conversation.poll();
  h.jobs.get('job-a')!.status = 'succeeded'; h.jobs.get('job-a')!.resultId = a.id;
  await conversation.poll();
  assert.deepEqual(h.previews, [a.id]); assert.deepEqual(h.deliveries, []);
  for (const request of ['/instructions', '/model', '/manual', '/parts', 'Please send me the model file']) {
    await conversation.handle(h.message(request));
    assert.match(h.texts.at(-1)!, /approv/i);
  }
  assert.deepEqual(h.fileRequests, []); assert.deepEqual(h.deliveries, []); assert.deepEqual(h.submissions, []);
  assert.equal(h.state().approvedDesignId, undefined);
});

test('approval pins A, feedback retains its complete context, and B requires its own approval', async () => {
  const h = harness(), conversation = h.create(); await conversation.poll();
  h.jobs.get('job-a')!.bestDraftId = b.id; // A is still the preview the user saw.
  await conversation.handle(h.message('/approve'));
  assert.equal(h.state().approvedDesignId, a.id);
  assert.deepEqual(h.deliveries, [`guide:${a.id}`, `${a.id}:mobile.usdz`, `${a.id}:parts.csv`]);
  assert.ok(!h.fileRequests.some(value => value.endsWith('manual.pdf')), 'The PDF stays optional');
  await conversation.handle(h.message('Make it taller'));
  assert.equal(h.submissions.length, 1);
  const input = h.submissions[0];
  assert.deepEqual(input.previous, a); assert.deepEqual(input.image, image);
  assert.deepEqual(input.inventory, inventory); assert.equal(input.inventoryMode, 'owned');
  assert.equal(input.prompt, `${originalPrompt}\nRequested change: Make it taller`);
  h.jobs.get(h.state().jobId!)!.bestDraftId = b.id;
  await conversation.poll();
  assert.deepEqual(h.previews, [a.id, b.id]); assert.equal(h.state().feedbackDesignId, b.id);
  assert.equal(h.state().approvedDesignId, a.id); assert.equal(h.state().approvedDeliveries?.[b.id], undefined);
  for (const request of ['/instructions', '/model', '/manual', '/parts']) await conversation.handle(h.message(request));
  assert.equal(h.deliveries.length, 3); assert.equal(h.fileRequests.length, 2);
  await conversation.handle(h.message('/approve'));
  assert.equal(h.state().approvedDesignId, b.id);
  assert.deepEqual(h.deliveries.slice(3), [`guide:${b.id}`, `${b.id}:mobile.usdz`, `${b.id}:parts.csv`]);
});

test('restart retry remains pinned to missing approved A files while unapproved B stays selected', async () => {
  const h = harness(), conversation = h.create(); await conversation.poll();
  h.failures.add(`${a.id}:parts.csv`);
  await conversation.handle(h.message('/approve'));
  assert.deepEqual(h.state().approvedDeliveries?.[a.id], { mode: 'guide', instructions: true, model: true });
  await conversation.handle(h.message('Make it taller'));
  h.jobs.get(h.state().jobId!)!.bestDraftId = b.id; await conversation.poll();
  h.failures.clear(); const before = h.deliveries.length;
  await h.create().handle(h.message('/retry'));
  assert.deepEqual(h.deliveries.slice(before), [`${a.id}:parts.csv`]);
  assert.equal(h.state().feedbackDesignId, b.id); assert.equal(h.state().designId, b.id);
  assert.equal(h.state().approvedDesignId, a.id); assert.equal(h.state().approvedDeliveries?.[b.id], undefined);
  assert.equal(h.submissions.length, 1); assert.equal(h.jobs.get(h.state().jobId!)!.status, 'running');
});

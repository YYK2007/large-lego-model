import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import type { Content, Message } from 'spectrum-ts';
import { PhotonConversation, type PhotonReply } from '../server/photon-conversation.js';
import { photonJobsApi, PhotonApiError, type PhotonJobsApi } from '../server/photon-api.js';
import { PhotonInputError, type Conversation } from '../server/photon-routing.js';
import type { GenerationInput } from '../server/generation.js';
import type { SavedDesign } from '../server/store.js';
import type { GenerationJob } from '../shared/generation-job.js';

const build: SavedDesign = { id: 'checked-build', title: 'Rocket', description: 'A checked brick', prompt: 'Rocket', source: 'ai', createdAt: new Date().toISOString(),
  schemaVersion: 2, catalogVersion: 'upright-architecture-2', coordinateSystem: 'stud-xy-plate-z', bricks: [{ id: 'brick', partId: '3005', colorId: 15, x: 0, y: 0, z: 0, rotation: 0 }] };
const message = (text: string, id = randomUUID()) => ({ id, direction: 'inbound', content: { type: 'text', text } } as Pick<Message, 'id' | 'direction' | 'content'>);
// Retain archived mode-selection coverage; current-flow tests pass false.
function harness(initial: Conversation = { handledIds: [] }, qualitySelectionEnabled = true) {
  const texts: string[] = [], media: string[] = [], submitted: { id: string; input: GenerationInput }[] = [], stops: string[] = [];
  const jobs = new Map<string, GenerationJob>();
  const designs = new Map<string, SavedDesign>([[build.id, build]]);
  let saved = structuredClone(initial), clock = Date.parse(build.createdAt);
  const api: PhotonJobsApi = {
    submit: async (id, input) => { submitted.push({ id, input }); const job: GenerationJob = { id, status: 'running', quality: input.quality ?? 'detailed', continuous: true, createdAt: build.createdAt, updatedAt: build.createdAt, milestones: [], attempts: [] }; jobs.set(id, job); return structuredClone(job); },
    get: async id => { if (!jobs.has(id)) throw new Error('Missing job'); return structuredClone(jobs.get(id)!); },
    stop: async id => { stops.push(id); const job = jobs.get(id)!; job.status = 'cancelled'; return structuredClone(job); },
    design: async id => { if (!designs.has(id)) throw new Error('Missing design'); return structuredClone(designs.get(id)!); },
    preview: async () => Buffer.from('<svg/>'), file: async (_id, format) => Buffer.from(format),
  };
  const reply: PhotonReply = { text: async text => { texts.push(text); }, preview: async () => { media.push('attempt'); }, designPreview: async design => { media.push(`design:${design.id}`); }, model: async () => { media.push('model'); }, manual: async () => { media.push('manual'); }, parts: async () => { media.push('parts'); } };
  const create = () => new PhotonConversation(saved, api, reply, async value => { saved = structuredClone(value); }, 'https://example.test', () => clock, qualitySelectionEnabled);
  return { api, reply, texts, media, submitted, stops, jobs, designs, create, advance: (milliseconds: number) => { clock += milliseconds; }, now: () => clock, state: () => saved };
}

async function start(conversation: PhotonConversation, prompt: string, quality = 'Detailed') {
  await conversation.handle(message(prompt)); await conversation.handle(message(quality));
}

test('both build-start acknowledgements explain every supported command before submitting', async () => {
  for (const quality of ['Quick', 'Detailed']) {
    const h = harness(), conversation = h.create(), send = h.reply.text;
    let acknowledged = false;
    h.reply.text = async text => {
      if (text.startsWith(`Starting ${quality}.`)) {
        acknowledged = true;
        assert.equal(h.submitted.length, 0);
        if (quality === 'Quick') assert.match(text, /aim for a usable checked draft in about 2\.5 minutes/);
        for (const command of ['/status', '/stop', '/model', '/manual', '/instructions', '/build', '/parts', '/approve', '/retry', '/use N', '/open ID', '/new idea', '/quick idea', '/detailed idea']) {
          assert.ok(text.includes(command), `${quality} acknowledgement is missing ${command}`);
        }
        assert.match(text, /once a checked build is available/);
        assert.match(text, /Reply with a change to keep this mode/);
      }
      await send(text);
    };
    await start(conversation, 'Build a rocket', quality);
    assert.equal(acknowledged, true); assert.equal(h.submitted.length, 1);
  }
});

test('inbound prompt starts a background job once and Stop stays available before any result', async () => {
  const h = harness(), conversation = h.create(), incoming = message('Make a small rocket');
  await conversation.handle(incoming); await conversation.handle(incoming);
  assert.equal(h.submitted.length, 0);
  assert.match(h.texts.at(-1)!, /Quick: aim for a usable draft in about 2\.5 minutes/);
  await conversation.handle(message('Detailed')); await conversation.handle(message('Detailed'));
  await conversation.handle({ ...message('outbound'), direction: 'outbound' });
  assert.equal(h.submitted.length, 1); assert.equal(h.submitted[0].input.previous, undefined);
  assert.ok(h.texts.some(text => /Send \/stop any time/.test(text)));
  await conversation.handle(message('/stop'));
  assert.equal(h.stops[0], h.submitted[0].id); assert.match(h.texts.at(-1)!, /Generation stopped/);
  const sent = h.texts.length; await conversation.poll(); assert.equal(h.texts.length, sent);
});

test('a photo followed by its caption reaches the same request without treating the image as inventory', async () => {
  const h = harness(), conversation = h.create();
  const image: Content = { type: 'attachment', id: 'image', name: 'photo.jpg', mimeType: 'image/jpeg', size: 3,
    read: async () => Buffer.from('abc'), stream: async () => new ReadableStream({ start(controller) { controller.enqueue(Buffer.from('abc')); controller.close(); } }) };
  await conversation.handle({ ...message(''), content: image });
  assert.equal(h.submitted.length, 0);
  await start(conversation, 'Build this flower');
  assert.deepEqual(h.submitted[0].input.image, { data: 'YWJj', mimeType: 'image/jpeg' });
  assert.equal(h.submitted[0].input.inventoryMode, 'unlimited');
});

test('failed attempt summaries begin at four; best checked draft survives failure and reconnect does not replay output', async () => {
  const h = harness(), conversation = h.create();
  await start(conversation, 'Build a rocket'); const id = h.submitted[0].id;
  const job = h.jobs.get(id)!; job.bestDraftId = build.id; job.status = 'failed'; job.error = { message: 'Provider quota reached.', checks: [] };
  job.attempts = [1, 2, 3, 4].map(attempt => ({ attempt, status: 'invalid', checks: ['Disconnected pieces'], previewAvailable: attempt === 4, at: build.createdAt }));
  for (let index = 0; index < 5; index++) await conversation.poll();
  assert.ok(h.media.includes(`design:${build.id}`)); assert.equal(h.media.filter(item => item === 'attempt').length, 1);
  assert.ok(h.texts.some(text => /Attempt 4 is unfinished/.test(text))); assert.ok(!h.texts.some(text => /Attempt [123] is unfinished/.test(text)));
  assert.match(h.texts.at(-1)!, /usage limit.*checked draft is kept/);
  assert.equal(h.state().designId, build.id);
  const count = h.texts.length; await h.create().poll(); assert.equal(h.texts.length, count); assert.equal(h.submitted.length, 1);
});

test('Use rejects unfinished attempts and a later revision keeps the explicitly selected checked build', async () => {
  const h = harness(), conversation = h.create(), chosen = { ...build, id: 'chosen-build' }; h.designs.set(chosen.id, chosen);
  await start(conversation, 'Build something'); const id = h.submitted[0].id;
  const job = h.jobs.get(id)!; job.bestDraftId = build.id;
  job.attempts = [{ attempt: 4, status: 'invalid', checks: ['Bad'], previewAvailable: true, at: build.createdAt }, { attempt: 5, status: 'valid', checks: [], previewAvailable: true, designId: chosen.id, at: build.createdAt }];
  await conversation.handle(message('/use 4')); assert.equal(h.stops.length, 0); assert.equal(h.state().designId, undefined);
  await conversation.handle(message('/use 5')); assert.equal(h.state().designId, chosen.id); assert.equal(job.status, 'cancelled');
  await start(conversation, 'Make it red'); assert.equal(h.submitted[1].input.previous?.id, chosen.id);
  await start(conversation, '/new a blue boat'); assert.equal(h.submitted[2].input.previous, undefined); assert.equal(h.submitted[2].input.image, undefined);
});

test('terminal status preserves a chosen attempt for exports and the next revision across restart', async () => {
  const h = harness(), conversation = h.create(), chosen = { ...build, id: 'chosen-after-stop' };
  h.designs.set(chosen.id, chosen);
  await start(conversation, 'Build a tower');
  const job = h.jobs.get(h.submitted[0].id)!; job.bestDraftId = build.id;
  job.attempts = [{ attempt: 5, status: 'valid', checks: [], previewAvailable: true, designId: chosen.id, at: build.createdAt }];
  await conversation.handle(message('/use 5'));
  const restarted = h.create();
  await restarted.handle(message('/status'));
  assert.equal(h.state().designId, chosen.id);
  assert.ok(h.texts.at(-1)!.includes(`design=${chosen.id}`));
  assert.equal(h.stops.length, 1);
  const exported: string[] = [];
  h.api.file = async (id, format) => { exported.push(id); return Buffer.from(format); };
  await restarted.handle(message('/model')); await restarted.handle(message('/manual'));
  assert.deepEqual(exported, [chosen.id, chosen.id]);
  await start(restarted, 'Make it red');
  assert.equal(h.submitted[1].input.previous?.id, chosen.id);
});

test('new feedback stops ongoing work and retains its checked draft plus owned stock as revision context', async () => {
  const inventory = [{ partId: '3005', colorId: 15, quantity: 3, source: 'Loose bricks' }];
  const h = harness({ handledIds: [], inventory }), conversation = h.create();
  await start(conversation, 'Build a rocket'); h.jobs.get(h.submitted[0].id)!.bestDraftId = build.id;
  await start(conversation, 'Make it taller');
  assert.equal(h.stops[0], h.submitted[0].id); assert.equal(h.submitted[1].input.previous?.id, build.id);
  assert.deepEqual(h.submitted[1].input.inventory, inventory); assert.equal(h.submitted[1].input.inventoryMode, 'owned');
});

test('interrupted submit keeps its request id for polling and never automatically pays for a new request', async () => {
  const h = harness(), original = h.api.submit;
  h.api.submit = async (id, input) => { await original(id, input); throw new Error('PRIVATE_PROVIDER_TOKEN'); };
  const conversation = h.create(); await start(conversation, 'Build a flower');
  assert.equal(h.submitted.length, 1); assert.equal(h.state().jobId, h.submitted[0].id);
  assert.doesNotMatch(h.texts.join('\n'), /PRIVATE_PROVIDER_TOKEN/);
  await h.create().poll(); assert.equal(h.submitted.length, 1);
});

test('HTTP transport binds jobs and checked designs and defaults to the human feedback workflow', async () => {
  const id = randomUUID(), calls: { url: string; body?: unknown }[] = [];
  const fetcher: typeof fetch = async (url, options) => {
    calls.push({ url: String(url), ...(options?.body ? { body: JSON.parse(String(options.body)) } : {}) });
    return Response.json(String(url).includes('/designs/') ? build : { id, status: 'running', milestones: [] });
  };
  const api = photonJobsApi('http://127.0.0.1:3001', fetcher);
  await api.submit(id, { prompt: 'A simple rocket' });
  assert.deepEqual(calls[0].body, { requestId: id, input: { prompt: 'A simple rocket' }, stopWhenMatched: true, visualReview: false });
  assert.equal((await api.design(build.id)).id, build.id);
  await assert.rejects(api.get(randomUUID()), /Invalid build-job/);
  await assert.rejects(api.design('different'), /did not pass/);
});

test('failed media delivery remains pending across restart and terminal notice waits for delivery', async () => {
  const h = harness(), conversation = h.create();
  await start(conversation, 'Build a rocket'); const id = h.submitted[0].id;
  const job = h.jobs.get(id)!; job.bestDraftId = build.id; job.status = 'failed'; job.error = { message: 'Quota reached', checks: [] };
  const send = h.reply.designPreview; h.reply.designPreview = async () => { throw new Error('Send failed'); };
  await assert.rejects(conversation.poll(), /Send failed/);
  assert.equal(h.state().lastDraftId, undefined); assert.equal(h.state().finishedJobId, undefined);
  h.reply.designPreview = send;
  await h.create().poll();
  assert.equal(h.state().lastDraftId, build.id); assert.equal(h.state().finishedJobId, id);
  assert.ok(h.media.includes(`design:${build.id}`));
});

test('unfinished attempt preview failure is retried rather than advancing its delivery cursor', async () => {
  const h = harness(), conversation = h.create();
  await start(conversation, 'Build a rocket'); const id = h.submitted[0].id;
  h.jobs.get(id)!.attempts = [{ attempt: 4, status: 'invalid', checks: ['Disconnected'], previewAvailable: true, at: build.createdAt }];
  const send = h.reply.preview; h.reply.preview = async () => { throw new Error('Attachment unavailable'); };
  await assert.rejects(conversation.poll(), /Attachment unavailable/); assert.equal(h.state().lastAttempt, 0);
  h.reply.preview = send; await h.create().poll(); assert.equal(h.state().lastAttempt, 4); assert.ok(h.media.includes('attempt'));
});

test('Stop bypasses a stalled export, which retains the captured revision', async () => {
  const h = harness({ handledIds: [], designId: build.id }), conversation = h.create();
  await start(conversation, 'Make the rocket taller'); const id = h.submitted[0].id;
  let release!: () => void, entered!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  h.api.file = async designId => { assert.equal(designId, build.id); entered(); await blocked; return Buffer.from('file'); };
  const exporting = conversation.handle(message('/model')); await started;
  await conversation.handle(message('/stop'));
  assert.equal(h.jobs.get(id)!.status, 'cancelled'); release(); await exporting;
  assert.ok(h.media.includes('model'));
});

test('feedback before the first checked draft retains the original subject, while /new resets it', async () => {
  const h = harness(), conversation = h.create();
  await start(conversation, 'Build a lighthouse');
  await start(conversation, 'Make it red');
  assert.match(h.submitted[1].input.prompt, /Build a lighthouse\nRequested change: Make it red/);
  await start(conversation, '/new a small boat');
  assert.equal(h.submitted[2].input.prompt, 'a small boat');
});

test('definite admission rejection and a confirmed missing request cannot wedge future prompts', async () => {
  const h = harness(), submit = h.api.submit, conversation = h.create();
  h.api.submit = async () => { throw new PhotonApiError('Queue is full', 429); };
  await start(conversation, 'Build a rocket'); assert.equal(h.state().jobId, undefined);
  h.api.submit = submit; await start(conversation, '/new a boat'); assert.equal(h.submitted.length, 1);
  h.api.stop = async () => { throw new PhotonApiError('Build job not found', 404); };
  await start(conversation, '/new a lighthouse'); assert.equal(h.submitted.length, 2);
  assert.equal(h.submitted[1].input.prompt, 'a lighthouse');
});

test('pending request and photo survive restart; small talk and status neither replace nor start it', async () => {
  const h = harness(), original = h.create();
  const image: Content = { type: 'attachment', id: 'pending-photo', name: 'photo.jpg', mimeType: 'image/jpeg', size: 3,
    read: async () => Buffer.from('abc'), stream: async () => new ReadableStream({ start(controller) { controller.enqueue(Buffer.from('abc')); controller.close(); } }) };
  await original.handle({ ...message(''), content: image });
  await original.handle(message('Build this flower')); assert.equal(h.submitted.length, 0);
  const restarted = h.create();
  await restarted.handle(message('thanks')); await restarted.handle(message('I sent you a build request already, what’s going on?'));
  assert.equal(h.state().pendingRequest?.prompt, 'Build this flower'); assert.equal(h.submitted.length, 0);
  assert.match(h.texts.at(-1)!, /waiting for your choice/);
  await restarted.handle(message('Quick'));
  assert.equal(h.submitted[0].input.quality, 'quick'); assert.deepEqual(h.submitted[0].input.image, { data: 'YWJj', mimeType: 'image/jpeg' });
  assert.equal(h.state().pendingRequest, undefined);
});

test('clear revisions reuse the active mode, while new subjects wait for their own choice', async () => {
  const h = harness(), conversation = h.create(); await start(conversation, 'Build a tower', 'Quick');
  await conversation.handle(message('Quick')); await conversation.handle(message('Detailed'));
  assert.equal(h.submitted.length, 1); assert.equal(h.stops.length, 0);
  await conversation.handle(message('Make it red'));
  await conversation.handle(message('ok')); await conversation.handle(message('are you still working?'));
  assert.equal(h.state().pendingRequest, undefined); assert.equal(h.submitted.length, 2); assert.equal(h.stops.length, 1);
  assert.equal(h.submitted[1].input.quality, 'quick');
  await conversation.handle(message('Build a boat'));
  assert.equal(h.submitted.length, 2); assert.equal(h.stops.length, 1);
  await conversation.handle(message('Detailed'));
  assert.equal(h.submitted.length, 3); assert.equal(h.submitted[2].input.quality, 'detailed'); assert.equal(h.stops.length, 2);
  assert.equal(h.submitted[2].input.previous, undefined);
});

test('Stop clears unconfirmed requests and photos without starting generation', async () => {
  const h = harness(), conversation = h.create();
  await conversation.handle(message('Build a flower')); await conversation.handle(message('/stop'));
  assert.equal(h.state().pendingRequest, undefined); assert.equal(h.state().pendingQuality, undefined); assert.equal(h.submitted.length, 0);
  await conversation.handle(message('Quick')); assert.equal(h.submitted.length, 0); assert.equal(h.state().pendingQuality, 'quick');
  await conversation.handle(message('/stop')); assert.equal(h.state().pendingQuality, undefined);
});

test('explicit quality and idea can arrive together without a second confirmation', async () => {
  const h = harness(), conversation = h.create();
  await conversation.handle(message('/quick a red rocket'));
  assert.equal(h.submitted.length, 1); assert.equal(h.submitted[0].input.prompt, 'a red rocket'); assert.equal(h.submitted[0].input.quality, 'quick');
  await conversation.handle(message('Make it red in Detailed mode'));
  assert.equal(h.submitted.length, 2); assert.match(h.submitted[1].input.prompt, /Requested change: Make it red/); assert.equal(h.submitted[1].input.quality, 'detailed');
});

test('stage changes throttle to15s, heartbeat to30s, and successful status resets the quiet timer', async () => {
  const h = harness(), conversation = h.create(); await start(conversation, 'Build a tower');
  const job = h.jobs.get(h.submitted[0].id)!; job.progress = { stage: 'planning', attempt: 1, maxAttempts: 4 };
  let count = h.texts.length;
  h.advance(14_999); await conversation.poll(); assert.equal(h.texts.length, count);
  h.advance(1); await conversation.poll(); assert.equal(h.texts.length, ++count); assert.match(h.texts.at(-1)!, /Planning the build/);
  job.progress.stage = 'checking'; h.advance(1000); await conversation.poll(); assert.equal(h.texts.length, count);
  h.advance(14_000); await conversation.poll(); assert.equal(h.texts.length, ++count); assert.match(h.texts.at(-1)!, /Checking brick connections/);
  h.advance(29_999); await conversation.poll(); assert.equal(h.texts.length, count);
  h.advance(1); await conversation.poll(); assert.equal(h.texts.length, ++count); assert.match(h.texts.at(-1)!, /Still working/);
  h.advance(10_000); await conversation.handle(message('any updates?')); count = h.texts.length;
  h.advance(29_999); await conversation.poll(); assert.equal(h.texts.length, count);
  h.advance(1); await conversation.poll(); assert.equal(h.texts.length, count + 1);
});

test('failed progress delivery changes no timestamps and retries after restart', async () => {
  const h = harness(), conversation = h.create(); await start(conversation, 'Build a tower');
  const job = h.jobs.get(h.submitted[0].id)!; job.progress = { stage: 'checking', attempt: 1, maxAttempts: 4 };
  const delivered = h.state().lastDeliveryAt, send = h.reply.text;
  h.advance(15_000); h.reply.text = async () => { throw new Error('Send failed'); };
  await assert.rejects(conversation.poll(), /Send failed/);
  assert.equal(h.state().lastProgressAt, undefined); assert.equal(h.state().lastDeliveryAt, delivered);
  h.reply.text = send; await h.create().poll(); assert.equal(h.state().lastProgressAt, h.now()); assert.equal(h.state().lastDeliveryAt, h.now());
});

test('Quick geometry-only completion offers Detailed without claiming a visual match', async () => {
  const h = harness(), conversation = h.create(); await start(conversation, 'Build a tower', 'Quick');
  const job = h.jobs.get(h.submitted[0].id)!; job.status = 'succeeded'; job.resultId = build.id;
  await conversation.poll();
  assert.match(h.texts.at(-1)!, /Quick finished with a draft that passes brick checks/);
  assert.match(h.texts.at(-1)!, /visual review was skipped/); assert.match(h.texts.at(-1)!, /Reply Detailed/);
  await conversation.handle(message('Detailed'));
  assert.equal(h.submitted.length, 2); assert.equal(h.submitted[1].input.quality, 'detailed'); assert.equal(h.submitted[1].input.previous?.id, build.id);
});

test('Quick with no valid draft keeps earlier selected build and offers Detailed; partial failures are not delivered as finished models', async () => {
  const h = harness({ handledIds: [], designId: build.id }), conversation = h.create(); await start(conversation, 'Make it larger', 'Quick');
  const job = h.jobs.get(h.submitted[0].id)!; job.status = 'failed'; job.error = { message: 'Quick reached its time limit.', checks: [] };
  job.attempts = [{ attempt: 4, status: 'invalid', partial: true, checks: ['Disconnected stem'], previewAvailable: true, at: build.createdAt }];
  await conversation.poll(); await conversation.poll();
  assert.equal(h.media.length, 0); assert.equal(h.state().designId, build.id);
  assert.match(h.texts.at(-1)!, /without a draft that passes brick checks/); assert.match(h.texts.at(-1)!, /Reply Detailed/);
  await conversation.handle(message('/status'));
  assert.match(h.texts.at(-1)!, /without a draft that passes brick checks/);
  assert.match(h.texts.at(-1)!, /previous checked build is kept/);
  assert.equal(h.state().designId, build.id);
});

test('Detailed partial attempt feedback explicitly says missing sections are not shown', async () => {
  const h = harness(), conversation = h.create(); await start(conversation, 'Build a flower');
  const job = h.jobs.get(h.submitted[0].id)!;
  job.attempts = [{ attempt: 4, status: 'invalid', partial: true, checks: ['Disconnected stem'], previewAvailable: true, at: build.createdAt }];
  await conversation.poll(); assert.match(h.texts.at(-1)!, /preview only shows part of the build; missing sections are not shown/);
});

test('attempt replies explain connection and overlap failures without exposing diagnostics or coordinates', async () => {
  const h = harness(), conversation = h.create(); await start(conversation, 'Build a flower');
  const job = h.jobs.get(h.submitted[0].id)!;
  const checks = ['Brick b226 (part 3001, x=46, y=20, z=9 plates, rotation=90) has no stud support directly below it.\nPlan support diagnostics: {"unsupportedPieceCount":13,"disconnectedGroups":[{"pieceCount":3,"bounds":{"x":11,"y":12}}]}', 'A slope envelope overlaps a box.'];
  job.attempts = [{ attempt: 4, status: 'invalid', partial: true, checks, previewAvailable: true, at: build.createdAt }];
  await conversation.poll();
  const text = h.texts.at(-1)!;
  assert.match(text, /Some sections don’t connect yet/); assert.match(text, /Some pieces overlap/);
  assert.match(text, /only shows part/); assert.match(text, /I’m still working/); assert.match(text, /\/stop/);
  assert.doesNotMatch(text, /[{}]|b226|3001|rotation|unsupportedPieceCount|diagnostics|x=46/);
  assert.ok(text.length < 500); assert.deepEqual(job.attempts[0].checks, checks);
  assert.deepEqual(h.media, ['attempt']); assert.equal(h.state().lastAttempt, 4);
});

test('unrecognized JSON diagnostics receive a plain fallback and never leak into text', async () => {
  const h = harness(), conversation = h.create(); await start(conversation, 'Build a flower');
  const job = h.jobs.get(h.submitted[0].id)!;
  job.status = 'failed'; job.error = { message: '{"error":{"detail":"PRIVATE_PROVIDER_TOKEN"}}', checks: [] };
  job.attempts = [{ attempt: 4, status: 'invalid', checks: ['```json\n{"internalPlan":{"z":42}}\n```'], previewAvailable: false, at: build.createdAt }];
  await conversation.poll(); const attemptText = h.texts.at(-1)!;
  assert.match(attemptText, /arrangement that passes the brick checks/); assert.match(attemptText, /run has ended/);
  assert.doesNotMatch(attemptText, /still working/);
  await conversation.poll();
  assert.match(h.texts.at(-1)!, /Reply Quick or Detailed/);
  assert.doesNotMatch(h.texts.join('\n'), /[{}]|```|internalPlan|PRIVATE_PROVIDER_TOKEN/);
});

test('Quick and Detailed explain provider failures without raw JSON and retain checked drafts', async () => {
  for (const quality of ['Quick', 'Detailed']) for (const failure of [
    { message: '{"error":{"code":402,"message":"Your prepayment credits are depleted"}}', expected: /out of credits/ },
    { message: '{"error":{"code":429,"message":"Quota reached"}}', expected: /usage limit/ },
    { message: '{"error":{"code":503,"message":"Service unavailable"}}', expected: /temporarily unavailable/ },
  ]) {
    const h = harness(), conversation = h.create(); await start(conversation, 'Build a tower', quality);
    const job = h.jobs.get(h.submitted[0].id)!;
    job.status = 'failed'; job.bestDraftId = build.id; job.error = { message: failure.message, checks: [] };
    await conversation.poll();
    assert.match(h.texts.at(-1)!, failure.expected); assert.match(h.texts.at(-1)!, /checked draft is kept/);
    assert.doesNotMatch(h.texts.at(-1)!, /[{}]|"error"|"code"|passed the AI visual review/);
    assert.equal(h.state().designId, build.id); assert.equal(h.state().finishedJobId, job.id);
  }
});

test('status on a stopped build does not claim its old planning stage is still running', async () => {
  const h = harness(), conversation = h.create(); await start(conversation, 'Build a flower');
  const job = h.jobs.get(h.submitted[0].id)!;
  job.progress = { stage: 'planning', attempt: 8, maxAttempts: 10 };
  await conversation.handle(message('/stop'));
  const sent = h.texts.length;
  await conversation.handle(message('what’s happening?'));
  assert.equal(h.texts.length, sent + 1);
  assert.match(h.texts.at(-1)!, /build was stopped/); assert.match(h.texts.at(-1)!, /Reply Quick or Detailed/);
  assert.doesNotMatch(h.texts.at(-1)!, /Planning|still working|Send \/stop/);
  assert.equal(h.submitted.length, 1);
});

test('HTTP errors in commands cannot pass provider JSON through the input-error handler', async () => {
  const h = harness(), conversation = h.create();
  h.api.submit = async () => { throw new PhotonApiError('{"error":{"code":429,"token":"PRIVATE_PROVIDER_TOKEN"}}', 429); };
  await start(conversation, 'Build a flower');
  assert.match(h.texts.at(-1)!, /build service is busy/);
  assert.doesNotMatch(h.texts.join('\n'), /[{}]|PRIVATE_PROVIDER_TOKEN/);
  assert.equal(h.state().pendingRequest?.prompt, 'Build a flower');
});

test('Quick suppressed attempt backlog cannot delay heartbeat or completion', async () => {
  const h = harness(), conversation = h.create(); await start(conversation, 'Build a tower', 'Quick');
  const job = h.jobs.get(h.submitted[0].id)!;
  job.attempts = Array.from({ length: 20 }, (_, i) => ({ attempt: i + 1, status: 'invalid', checks: ['Still disconnected'], previewAvailable: true, at: build.createdAt }));
  h.advance(30_000); await conversation.poll();
  assert.equal(h.state().lastAttempt, 20); assert.match(h.texts.at(-1)!, /elapsed/); assert.equal(h.media.length, 0);
  job.status = 'succeeded'; job.resultId = build.id; job.bestDraftId = build.id;
  job.attempts.push({ attempt: 21, status: 'valid', checks: [], previewAvailable: true, designId: build.id, at: build.createdAt });
  await conversation.poll();
  assert.equal(h.state().lastAttempt, 21); assert.equal(h.state().finishedJobId, job.id);
  assert.match(h.texts.at(-1)!, /Quick finished/); assert.equal(h.texts.some(text => /Attempt 21 passes/.test(text)), false);
});

test('Stop or a confirmed new request suppresses an obsolete preview still downloading', async () => {
  for (const change of ['stop', 'new']) {
    const h = harness(), conversation = h.create(); await start(conversation, 'Build a flower');
    const job = h.jobs.get(h.submitted[0].id)!;
    job.attempts = [{ attempt: 4, status: 'invalid', partial: true, checks: ['Disconnected stem'], previewAvailable: true, at: build.createdAt }];
    let release!: (value: Buffer) => void, entered!: () => void;
    const fetching = new Promise<void>(resolve => { entered = resolve; });
    h.api.preview = async () => { entered(); return new Promise<Buffer>(resolve => { release = resolve; }); };
    const delivery = conversation.poll(); await fetching;
    if (change === 'stop') await conversation.handle(message('/stop'));
    else await start(conversation, '/new a boat');
    release(Buffer.from('<svg/>')); await delivery;
    assert.equal(h.media.includes('attempt'), false);
    if (change === 'new') assert.equal(h.state().lastAttempt, 0);
  }
});

test('failed model delivery retains the selected build and links to that exact revision', async () => {
  const h = harness({ handledIds: [], designId: build.id }), conversation = h.create();
  h.reply.model = async () => { throw new PhotonInputError('This 3D model is too large to send through iMessage. Open its build page to download it.'); };
  await conversation.handle(message('/model'));
  assert.match(h.texts[0], /Preparing your rotatable 3D file/);
  assert.match(h.texts.at(-1)!, /too large.*\nhttps:\/\/example.test\/\?design=checked-build/);
  assert.equal(h.state().designId, build.id);
  assert.equal(h.submitted.length, 0);
});

test('failed direct file sends offer the signed guide for the requested selection, not the separate approved revision', async () => {
  for (const kind of ['model', 'manual', 'parts'] as const) {
    const approvedId = 'older-approved-revision';
    const deliveries = { [approvedId]: { mode: 'guide' as const, instructions: true as const, parts: true as const } };
    const h = harness({ handledIds: [], designId: build.id, feedbackDesignId: build.id, approvedDesignId: approvedId, approvedDeliveries: deliveries });
    const links: string[] = [], cards: string[] = [], files: string[] = [];
    h.api.instructionsLink = async id => { links.push(id); return `https://guide.example/?build=${id}&share=signed`; };
    h.api.file = async (id, format) => { files.push(`${id}/${format}`); return Buffer.from(format); };
    h.reply[kind] = async () => { throw new PhotonInputError('The file couldn’t be sent through iMessage. Your checked build is saved.'); };
    h.reply.instructions = async url => { cards.push(url); };
    await h.create().handle(message(`/${kind}`));
    assert.deepEqual(files, [`${build.id}/${kind === 'model' ? 'mobile.usdz' : kind === 'manual' ? 'manual.pdf' : 'parts.csv'}`]);
    assert.deepEqual(links, [build.id]); assert.deepEqual(cards, [`https://guide.example/?build=${build.id}&share=signed`]);
    assert.match(h.texts.at(-1)!, /couldn’t be sent.*\nYou can download this exact build from its guide/);
    assert.doesNotMatch(h.texts.join('\n'), /local to the computer|\?design=|^Sent your/m);
    assert.equal(h.state().designId, build.id); assert.equal(h.state().feedbackDesignId, build.id); assert.equal(h.state().approvedDesignId, approvedId);
    assert.deepEqual(h.state().approvedDeliveries, deliveries); assert.deepEqual(h.media, []); assert.equal(h.submitted.length, 0); assert.deepEqual(h.stops, []);
  }
});

test('a failed fallback guide card still supplies the signed download link without acknowledging the file', async () => {
  const h = harness({ handledIds: [], designId: build.id, approvedDesignId: build.id, approvedDeliveries: { [build.id]: { manual: true, parts: true } } });
  const url = `https://guide.example/?build=${build.id}&share=signed`;
  let cardAttempts = 0;
  h.api.instructionsLink = async () => url;
  h.reply.model = async () => { throw new PhotonInputError('The file transfer took too long. Your checked build is saved.'); };
  h.reply.instructions = async () => { cardAttempts++; throw new Error('PRIVATE_GUIDE_TRANSPORT_ERROR'); };
  await h.create().handle(message('/model'));
  assert.equal(cardAttempts, 1); assert.match(h.texts.join('\n'), /file transfer took too long/);
  assert.equal(h.texts.at(-1), `Open this build’s guide to download the file:\n${url}`);
  assert.doesNotMatch(h.texts.join('\n'), /PRIVATE_GUIDE_TRANSPORT_ERROR|^Sent your/m);
  assert.deepEqual(h.state().approvedDeliveries, { [build.id]: { manual: true, parts: true } });
  assert.equal(h.state().designId, build.id); assert.equal(h.submitted.length, 0);
});

test('unavailable signed guides retain local-only download help after a transport failure', async () => {
  for (const unavailable of ['null', 'failure']) {
    const h = harness({ handledIds: [], designId: build.id });
    const links: string[] = [];
    h.api.instructionsLink = async id => { links.push(id); if (unavailable === 'failure') throw new Error('PRIVATE_LINK_ERROR'); return null; };
    h.reply.parts = async () => { throw new PhotonInputError('The parts file could not be delivered.'); };
    h.reply.instructions = async () => { assert.fail('No card is sent without a verified guide URL'); };
    await h.create().handle(message('/parts'));
    assert.deepEqual(links, [build.id]);
    assert.match(h.texts.at(-1)!, /could not be delivered.*\nThe viewer is local.*\?design=checked-build.*parts CSV/);
    assert.doesNotMatch(h.texts.join('\n'), /PRIVATE_LINK_ERROR|^Sent your|https:\/\/example.test/m);
    assert.equal(h.state().designId, build.id); assert.equal(h.state().approvedDeliveries, undefined); assert.equal(h.submitted.length, 0);
  }
});

test('approval status translates every pending export key into the existing readable file names', async () => {
  for (const guide of [false, true]) {
    const h = harness({ handledIds: [], designId: build.id, feedbackDesignId: build.id, approvedDesignId: build.id, approvedDeliveries: { [build.id]: guide ? { mode: 'guide' } : {} } });
    await h.create().handle(message('/status'));
    assert.ok(h.texts.at(-1)!.includes(guide ? 'Still to send: interactive building guide, rotatable 3D file, parts list.' : 'Still to send: rotatable 3D file, PDF instructions, parts list.'));
    assert.equal(h.submitted.length, 0); assert.deepEqual(h.media, []);
  }
});

test('attachment fallback explains local-only viewing when a public origin is absent', async () => {
  const h = harness({ handledIds: [], designId: build.id });
  h.reply.model = async () => { throw new PhotonInputError('The file could not be delivered.'); };
  const conversation = new PhotonConversation(h.state(), h.api, h.reply, async () => {});
  await conversation.handle(message('/model'));
  assert.match(h.texts.at(-1)!, /local to the computer.*\?design=checked-build.*Download 3D/);
  assert.doesNotMatch(h.texts.at(-1)!, /https?:\/\//);
});

test('approval needs a checked preview or explicit selection, while small talk and dissatisfaction never generate', async () => {
  const h = harness(), conversation = h.create();
  for (const text of ['/approve', 'Looks good!', 'thanks', 'yes', "I don't like it", "It doesn't look right", 'try again']) await conversation.handle(message(text));
  assert.equal(h.submitted.length, 0); assert.deepEqual(h.media, []); assert.equal(h.state().approvedDesignId, undefined);
  assert.match(h.texts.at(-1)!, /What should I change/);
  await start(conversation, 'Build a flower', 'Quick');
  const id = h.state().jobId;
  await conversation.handle(message("I don't like it"));
  assert.equal(h.state().jobId, id); assert.equal(h.stops.length, 0); assert.equal(h.submitted.length, 1);
});

test('approval pins the previewed revision while stopping a worker with a newer draft, then sends each file once', async () => {
  const h = harness(), conversation = h.create(), newer = { ...build, id: 'newer-unseen' };
  h.designs.set(newer.id, newer);
  await start(conversation, 'Build a flower', 'Quick');
  const job = h.jobs.get(h.state().jobId!)!; job.bestDraftId = build.id;
  await conversation.poll(); assert.equal(h.state().feedbackDesignId, build.id);
  job.bestDraftId = newer.id;
  const files: string[] = [];
  h.api.file = async (id, format) => { files.push(`${id}/${format}`); return Buffer.from(format); };
  await conversation.handle(message('Looks good!'));
  assert.equal(h.state().designId, build.id); assert.equal(h.state().approvedDesignId, build.id);
  assert.deepEqual(h.state().approvedDeliveries, { [build.id]: { model: true, manual: true, parts: true } });
  assert.deepEqual(files, ['mobile.usdz', 'manual.pdf', 'parts.csv'].map(format => `${build.id}/${format}`));
  assert.equal(h.stops.length, 1); assert.equal(h.submitted.length, 1);
  const restarted = h.create(); await restarted.handle(message('/approve')); await restarted.handle(message('/status'));
  assert.equal(files.length, 3); assert.match(h.texts.at(-1)!, /selected build is approved.*were sent/);
  assert.doesNotMatch(h.texts.at(-1)!, /reply.*approve/i);
});

test('failed and late preview deliveries cannot replace the revision a user approves', async t => {
  for (const outcome of ['failed', 'late'] as const) await t.test(outcome, async () => {
    const h = harness(), conversation = h.create(), newer = { ...build, id: `unconfirmed-${outcome}` };
    h.designs.set(newer.id, newer);
    await start(conversation, 'Build a flower', 'Quick');
    const job = h.jobs.get(h.state().jobId!)!; job.bestDraftId = build.id; await conversation.poll();
    let release!: () => void, entered!: () => void;
    const sending = new Promise<void>(resolve => { entered = resolve; });
    h.reply.designPreview = async () => { entered(); if (outcome === 'failed') throw new Error('send failed'); await new Promise<void>(resolve => { release = resolve; }); };
    job.bestDraftId = newer.id;
    const pending = conversation.poll();
    if (outcome === 'failed') await assert.rejects(pending, /send failed/); else await sending;
    await conversation.handle(message('/approve'));
    if (outcome === 'late') { release(); await pending; }
    assert.equal(h.state().approvedDesignId, build.id); assert.equal(h.state().feedbackDesignId, build.id); assert.equal(h.state().designId, build.id);
    assert.equal(h.submitted.length, 1);
  });
});

test('a first failed preview or an unfinished attempt never becomes approvable', async () => {
  const h = harness(), conversation = h.create(); await start(conversation, 'Build a flower');
  const job = h.jobs.get(h.state().jobId!)!; job.bestDraftId = build.id;
  h.reply.designPreview = async () => { throw new Error('preview failed'); };
  await assert.rejects(conversation.poll(), /preview failed/);
  await conversation.handle(message('/approve'));
  assert.equal(h.state().approvedDesignId, undefined); assert.equal(h.stops.length, 0);
  delete job.bestDraftId;
  job.attempts = [{ attempt: 4, status: 'invalid', partial: true, checks: ['Disconnected'], previewAvailable: true, at: build.createdAt }];
  await conversation.poll(); await conversation.handle(message('/approve'));
  assert.equal(h.state().approvedDesignId, undefined); assert.equal(h.media.includes('model'), false);
});

test('approval continues other files after failure and retries only the unacknowledged file after restart', async () => {
  const h = harness({ handledIds: [], designId: build.id, feedbackDesignId: build.id }), conversation = h.create();
  h.reply.model = async () => { throw new Error('{"secret":"PRIVATE_PROVIDER_TOKEN"}'); };
  await conversation.handle(message('/approve'));
  assert.deepEqual(h.state().approvedDeliveries?.[build.id], { manual: true, parts: true });
  assert.deepEqual(h.media, ['manual', 'parts']); assert.doesNotMatch(h.texts.join('\n'), /PRIVATE_PROVIDER_TOKEN|[{}]/);
  const restarted = h.create(); await restarted.handle(message('/status'));
  assert.match(h.texts.at(-1)!, /approved.*Still to send: rotatable 3D file/);
  h.reply.model = async () => { h.media.push('model'); };
  await restarted.handle(message('/approve')); await restarted.handle(message('Approved'));
  assert.deepEqual(h.media, ['manual', 'parts', 'model']);
  assert.deepEqual(h.state().approvedDeliveries?.[build.id], { model: true, manual: true, parts: true });
  assert.equal(h.submitted.length, 0);
});

test('/retry restores missing approved delivery after selection was cleared without regenerating or resending acknowledged files', async () => {
  const approved = { ...build, id: '24a4987f-6588-4f09-8646-aaa27c80e762' };
  const h = harness({ handledIds: [], approvedDesignId: approved.id, approvedDeliveries: { [approved.id]: { manual: true, parts: true } }, requestPrompt: '/retry' }, false);
  h.designs.set(approved.id, approved);
  const files: string[] = [];
  h.api.file = async (id, format) => { files.push(`${id}/${format}`); return Buffer.from(format); };
  await h.create().handle(message('/retry'));
  assert.deepEqual(files, [`${approved.id}/mobile.usdz`]); assert.deepEqual(h.media, ['model']);
  assert.equal(h.submitted.length, 0); assert.equal(h.stops.length, 0);
  assert.equal(h.state().approvedDesignId, approved.id);
  assert.deepEqual(h.state().approvedDeliveries?.[approved.id], { model: true, manual: true, parts: true });
  await h.create().handle(message('/retry'));
  assert.equal(files.length, 1); assert.match(h.texts.at(-1)!, /all three files were sent/);
});

test('/retry pins the old approved revision while preserving a newer preview and keeping Stop responsive', { timeout: 2000 }, async () => {
  const newer = { ...build, id: 'newer-unapproved' };
  const h = harness({ handledIds: [], designId: newer.id, feedbackDesignId: newer.id, approvedDesignId: build.id,
    approvedDeliveries: { [build.id]: { manual: true, parts: true } }, jobId: 'new-job' }, false), conversation = h.create();
  h.designs.set(newer.id, newer);
  h.jobs.set('new-job', { id: 'new-job', quality: 'detailed', status: 'running', createdAt: build.createdAt, updatedAt: build.createdAt, milestones: [], attempts: [] });
  let release!: () => void, entered!: () => void;
  const sending = new Promise<void>(resolve => { entered = resolve; });
  const files: string[] = [];
  h.api.file = async (id, format) => { files.push(`${id}/${format}`); return Buffer.from(format); };
  h.reply.model = async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); h.media.push('model'); };
  const retry = conversation.handle(message('/retry')); await sending;
  const duplicate = conversation.handle(message('/retry'));
  assert.equal(h.stops.length, 0); assert.equal(h.state().designId, newer.id); assert.equal(h.state().feedbackDesignId, newer.id);
  await conversation.handle(message('/status')); assert.match(h.texts.at(-1)!, /Sending your rotatable 3D file/);
  await conversation.handle(message('/stop')); assert.equal(h.jobs.get('new-job')!.status, 'cancelled');
  release(); await retry; await duplicate;
  assert.deepEqual(files, [`${build.id}/mobile.usdz`]); assert.deepEqual(h.media, ['model']); assert.equal(h.submitted.length, 0);
  assert.equal(h.state().approvedDesignId, build.id); assert.equal(h.state().feedbackDesignId, newer.id);
});

test('/retry without approval and unknown slash commands preserve pending requests and never submit generation', async () => {
  const pendingRequest = { kind: 'new' as const, prompt: 'A boat' };
  const h = harness({ handledIds: [], designId: build.id, feedbackDesignId: build.id, pendingRequest }, false), conversation = h.create();
  await conversation.handle(message('/retry'));
  assert.match(h.texts.at(-1)!, /no approved build.*\/approve/i);
  for (const text of ['/resend', '/retry something else', '/restart using detailed mode', '/manual using detailed mode', '/help']) {
    await conversation.handle(message(text)); assert.match(h.texts.at(-1)!, /don’t recognize that command.*\/retry/);
  }
  assert.equal(h.submitted.length, 0); assert.equal(h.stops.length, 0); assert.deepEqual(h.media, []);
  assert.equal(h.state().feedbackDesignId, build.id); assert.deepEqual(h.state().pendingRequest, pendingRequest);
  assert.equal(h.state().approvedDesignId, undefined);
});

test('checked previews and instruction aliases send the signed guide for that exact selected build', async () => {
  const h = harness({ handledIds: [] }, false), conversation = h.create();
  const guides: string[] = [], links: string[] = [];
  h.api.instructionsLink = async id => { links.push(id); return `https://guide.example/?build=${id}&share=signed`; };
  h.reply.instructions = async url => { guides.push(url); };
  await conversation.handle(message('Make a rocket'));
  const job = h.jobs.get(h.state().jobId!)!; job.bestDraftId = build.id;
  await conversation.poll();
  assert.equal(h.state().feedbackDesignId, build.id); assert.equal(guides.length, 1);
  await conversation.handle(message('/instructions')); await conversation.handle(message('/build'));
  assert.deepEqual(links, [build.id, build.id, build.id]);
  assert.ok(guides.every(url => new URL(url).searchParams.get('build') === build.id));
  assert.doesNotMatch(h.texts.join('\n'), /https:\/\/example\.test/);
  assert.equal(h.submitted.length, 1); assert.deepEqual(h.media, [`design:${build.id}`]);
});

test('new approval sends guide, model and parts; PDF is on demand and retries preserve the guide intent', async () => {
  const h = harness({ handledIds: [], designId: build.id, feedbackDesignId: build.id }, false), conversation = h.create();
  let failGuide = true;
  const guides: string[] = [], files: string[] = [];
  h.api.instructionsLink = async id => `https://guide.example/?build=${id}&share=signed`;
  h.reply.instructions = async url => { if (failGuide) throw new Error('Card and text failed'); guides.push(url); };
  h.api.file = async (id, format) => { files.push(`${id}/${format}`); return Buffer.from(format); };
  await conversation.handle(message('/approve'));
  assert.deepEqual(h.state().approvedDeliveries?.[build.id], { mode: 'guide', model: true, parts: true });
  assert.deepEqual(files, [`${build.id}/mobile.usdz`, `${build.id}/parts.csv`]);
  assert.match(h.texts.at(-1)!, /building guide.*\/retry/);
  failGuide = false; await h.create().handle(message('/retry'));
  assert.equal(guides.length, 1); assert.equal(files.length, 2);
  assert.deepEqual(h.state().approvedDeliveries?.[build.id], { mode: 'guide', instructions: true, model: true, parts: true });
  await h.create().handle(message('/retry')); assert.equal(guides.length, 1); assert.equal(files.length, 2);
  await h.create().handle(message('/manual'));
  assert.equal(files.at(-1), `${build.id}/manual.pdf`); assert.equal(h.submitted.length, 0);
});

test('legacy approvals keep their promised PDF retry even when a guide becomes available', async () => {
  const h = harness({ handledIds: [], approvedDesignId: build.id, approvedDeliveries: { [build.id]: { model: true, parts: true } } }, false);
  h.api.instructionsLink = async id => `https://guide.example/?build=${id}&share=signed`;
  h.reply.instructions = async () => { assert.fail('Legacy file retry must not add a new guide delivery'); };
  await h.create().handle(message('/retry'));
  assert.deepEqual(h.media, ['manual']); assert.deepEqual(h.state().approvedDeliveries?.[build.id], { model: true, manual: true, parts: true });
});

test('no public guide falls back to the file bundle and instruction commands explain the limitation without a fake URL', async () => {
  const h = harness({ handledIds: [], designId: build.id, feedbackDesignId: build.id }, false), conversation = h.create();
  h.api.instructionsLink = async () => null;
  await conversation.handle(message('/build'));
  assert.match(h.texts.at(-1)!, /guide isn’t available.*\/manual/); assert.doesNotMatch(h.texts.at(-1)!, /https?:\/\//);
  await conversation.handle(message('/approve'));
  assert.deepEqual(h.media, ['model', 'manual', 'parts']); assert.equal(h.state().approvedDeliveries?.[build.id].mode, undefined);
});

test('guide approval stays pinned while a newer worker draft appears and Stop bypasses a held card', { timeout: 2000 }, async () => {
  const newer = { ...build, id: 'newest-worker-result' };
  const h = harness({ handledIds: [], designId: build.id, feedbackDesignId: build.id, jobId: 'running' }, false), conversation = h.create();
  h.designs.set(newer.id, newer);
  h.jobs.set('running', { id: 'running', quality: 'detailed', status: 'running', bestDraftId: newer.id, createdAt: build.createdAt, updatedAt: build.createdAt, milestones: [], attempts: [] });
  const ids: string[] = [], guides: string[] = [];
  let entered!: () => void, release!: () => void;
  const sending = new Promise<void>(resolve => { entered = resolve; });
  h.api.instructionsLink = async id => { ids.push(id); return `https://guide.example/?build=${id}&share=signed`; };
  h.reply.instructions = async url => { guides.push(url); entered(); await new Promise<void>(resolve => { release = resolve; }); };
  const approving = conversation.handle(message('/approve')); await sending;
  const duplicate = conversation.handle(message('/approve'));
  await conversation.handle(message('/stop'));
  release(); await approving; await duplicate;
  assert.ok(ids.every(id => id === build.id)); assert.equal(guides.length, 1);
  assert.equal(h.state().approvedDesignId, build.id); assert.equal(h.state().feedbackDesignId, build.id);
  assert.deepEqual(h.media, ['model', 'parts']); assert.equal(h.submitted.length, 0);
});

test('status and Stop stay responsive during a directly requested guide card', { timeout: 2000 }, async () => {
  const h = harness({ handledIds: [], designId: build.id }, false), conversation = h.create();
  let entered!: () => void, release!: () => void;
  const sending = new Promise<void>(resolve => { entered = resolve; });
  h.api.instructionsLink = async id => `https://guide.example/?build=${id}&share=signed`;
  h.reply.instructions = async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); };
  const guide = conversation.handle(message('/instructions')); await sending;
  await conversation.handle(message('/status')); assert.match(h.texts.at(-1)!, /Sending your interactive building guide/);
  await conversation.handle(message('/stop')); assert.match(h.texts.at(-1)!, /no active generation/i);
  release(); await guide;
  assert.equal(h.submitted.length, 0); assert.equal(h.state().designId, build.id);
});

test('approval preparation keeps status and Stop responsive during design and guide lookups without changing the pinned revision', { timeout: 2000 }, async () => {
  for (const heldLookup of ['design', 'guide']) {
    const newer = { ...build, id: 'newer-unapproved-result' };
    const h = harness({ handledIds: [], designId: build.id, feedbackDesignId: build.id, jobId: 'running' }, false), conversation = h.create();
    h.designs.set(newer.id, newer);
    h.jobs.set('running', { id: 'running', quality: 'detailed', status: 'running', bestDraftId: newer.id, createdAt: build.createdAt, updatedAt: build.createdAt, milestones: [], attempts: [] });
    let entered!: () => void, release!: () => void;
    const lookupStarted = new Promise<void>(resolve => { entered = resolve; }), lookupReady = new Promise<void>(resolve => { release = resolve; });
    const ids: string[] = [], files: string[] = [], guides: string[] = [];
    const readDesign = h.api.design;
    h.api.design = async id => { ids.push(id); if (heldLookup === 'design') { entered(); await lookupReady; } return readDesign(id); };
    h.api.instructionsLink = async id => { ids.push(id); if (heldLookup === 'guide') { entered(); await lookupReady; } return `https://guide.example/?build=${id}&share=signed`; };
    h.api.file = async (id, format) => { files.push(`${id}/${format}`); return Buffer.from(format); };
    h.reply.instructions = async url => { guides.push(url); };
    const approval = conversation.handle(message('/approve')); await lookupStarted;
    const duplicate = conversation.handle(message('/approve'));
    await conversation.handle(message('/status'));
    assert.match(h.texts.at(-1)!, /Preparing your interactive building guide/);
    assert.equal(h.state().approvedDesignId, undefined); assert.deepEqual(files, []); assert.deepEqual(guides, []);
    await conversation.handle(message('/stop'));
    assert.equal(h.jobs.get('running')!.status, 'cancelled'); assert.match(h.texts.at(-1)!, /Generation stopped/);
    assert.equal(h.state().designId, build.id); assert.equal(h.state().approvedDeliveries, undefined);
    release(); await approval; await duplicate;
    assert.ok(ids.every(id => id === build.id));
    assert.deepEqual(files, [`${build.id}/mobile.usdz`, `${build.id}/parts.csv`]);
    assert.deepEqual(guides, [`https://guide.example/?build=${build.id}&share=signed`]);
    assert.equal(h.state().approvedDesignId, build.id); assert.equal(h.state().feedbackDesignId, build.id);
    assert.deepEqual(h.state().approvedDeliveries?.[build.id], { mode: 'guide', instructions: true, model: true, parts: true });
    assert.equal(h.submitted.length, 0); assert.deepEqual(h.stops, ['running']);
  }
});

test('a held approval retry lookup keeps the approved revision and previous acknowledgments even when another build is selected', { timeout: 2000 }, async () => {
  const selected = { ...build, id: 'selected-later-build' };
  const h = harness({ handledIds: [], designId: selected.id, feedbackDesignId: selected.id, approvedDesignId: build.id,
    approvedDeliveries: { [build.id]: { mode: 'guide', instructions: true, parts: true } } }, false), conversation = h.create();
  h.designs.set(selected.id, selected);
  let entered!: () => void, release!: () => void;
  const lookupStarted = new Promise<void>(resolve => { entered = resolve; }), lookupReady = new Promise<void>(resolve => { release = resolve; });
  const files: string[] = [], ids: string[] = [];
  h.api.instructionsLink = async id => { ids.push(id); entered(); await lookupReady; return `https://guide.example/?build=${id}&share=signed`; };
  h.api.file = async (id, format) => { files.push(`${id}/${format}`); return Buffer.from(format); };
  h.reply.instructions = async () => assert.fail('An acknowledged guide must not be sent again');
  const retry = conversation.handle(message('/retry')); await lookupStarted;
  await conversation.handle(message('/status')); assert.match(h.texts.at(-1)!, /Preparing your interactive building guide/);
  await conversation.handle(message('/stop')); assert.match(h.texts.at(-1)!, /no active generation/i);
  assert.deepEqual(h.state().approvedDeliveries?.[build.id], { mode: 'guide', instructions: true, parts: true });
  release(); await retry;
  assert.deepEqual(ids, [build.id]); assert.deepEqual(files, [`${build.id}/mobile.usdz`]); assert.deepEqual(h.media, ['model']);
  assert.equal(h.state().designId, selected.id); assert.equal(h.state().feedbackDesignId, selected.id); assert.equal(h.state().approvedDesignId, build.id);
  assert.deepEqual(h.state().approvedDeliveries?.[build.id], { mode: 'guide', instructions: true, model: true, parts: true });
  assert.equal(h.submitted.length, 0);
});

test('failed approval preparation clears export progress and never creates an approval or file acknowledgment', { timeout: 2000 }, async () => {
  const h = harness({ handledIds: [], designId: build.id, feedbackDesignId: build.id }, false), conversation = h.create();
  let entered!: () => void, release!: () => void;
  const lookupStarted = new Promise<void>(resolve => { entered = resolve; }), lookupReady = new Promise<void>(resolve => { release = resolve; });
  h.api.design = async () => { entered(); await lookupReady; throw new PhotonApiError('PRIVATE_LOOKUP_ERROR', 503); };
  const approval = conversation.handle(message('/approve')); await lookupStarted;
  await conversation.handle(message('/status')); assert.match(h.texts.at(-1)!, /Preparing your rotatable 3D file/);
  await conversation.handle(message('/stop')); assert.match(h.texts.at(-1)!, /no active generation/i);
  release(); await approval;
  assert.equal(h.state().approvedDesignId, undefined); assert.equal(h.state().approvedDeliveries, undefined); assert.deepEqual(h.media, []);
  assert.doesNotMatch(h.texts.join('\n'), /PRIVATE_LOOKUP_ERROR|^Approved /m);
  await conversation.handle(message('/status')); assert.match(h.texts.at(-1)!, /No active build yet/);
  const count = h.texts.length; h.advance(60_000); await conversation.poll(); assert.equal(h.texts.length, count);
  assert.equal(h.state().designId, build.id); assert.equal(h.submitted.length, 0);
});

test('approval never delivers if stopping the active worker is unconfirmed', async () => {
  const h = harness({ handledIds: [], designId: build.id, feedbackDesignId: build.id });
  h.jobs.set('running-job', { id: 'running-job', status: 'running', quality: 'quick', createdAt: build.createdAt, updatedAt: build.createdAt, milestones: [], attempts: [] });
  h.api.stop = async id => structuredClone(h.jobs.get(id)!);
  const conversation = new PhotonConversation({ ...h.state(), jobId: 'running-job' }, h.api, h.reply, async () => {});
  await conversation.handle(message('/approve'));
  assert.equal(conversation.snapshot().approvedDesignId, undefined); assert.deepEqual(h.media, []);
  assert.match(h.texts.at(-1)!, /Stopping could not be confirmed/);
});

test('Stop remains responsive while approval exports are pending', async () => {
  const h = harness({ handledIds: [], designId: build.id, feedbackDesignId: build.id }), conversation = h.create();
  let release!: () => void, entered!: () => void;
  const exporting = new Promise<void>(resolve => { entered = resolve; });
  h.reply.model = async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); h.media.push('model'); };
  const approval = conversation.handle(message('/approve')); await exporting;
  await conversation.handle(message('/stop'));
  assert.match(h.texts.at(-1)!, /no active generation/i);
  release(); await approval; assert.deepEqual(h.media, ['model', 'manual', 'parts']);
});

test('two revisions preserve original prompt, photo, owned stock and approval history, with an explicit mode override', async () => {
  const inventory = [{ partId: '3005', colorId: 15, quantity: 3, source: 'My stock' }];
  const h = harness({ handledIds: [], inventory }), conversation = h.create();
  const image: Content = { type: 'attachment', id: 'reference-photo', name: 'photo.jpg', mimeType: 'image/jpeg', size: 3,
    read: async () => Buffer.from('abc'), stream: async () => new ReadableStream({ start(controller) { controller.enqueue(Buffer.from('abc')); controller.close(); } }) };
  await conversation.handle({ ...message(''), content: image }); await start(conversation, 'Build a flower from this photo', 'Quick');
  h.jobs.get(h.state().jobId!)!.bestDraftId = build.id; await conversation.poll(); await conversation.handle(message('/approve'));
  await conversation.handle(message('Looks good but widen the petals'));
  assert.equal(h.submitted.length, 2); assert.equal(h.submitted[1].input.quality, 'quick');
  const revision = { ...build, id: 'wider-petals', prompt: h.submitted[1].input.prompt }; h.designs.set(revision.id, revision);
  h.jobs.get(h.state().jobId!)!.bestDraftId = revision.id; await conversation.poll();
  await conversation.handle(message('Add two leaves in Detailed mode'));
  const input = h.submitted[2].input;
  assert.equal(input.quality, 'detailed'); assert.equal(input.previous?.id, revision.id);
  assert.match(input.prompt, /Build a flower from this photo\nRequested change: Looks good but widen the petals\nRequested change: Add two leaves/);
  assert.deepEqual(input.image, { data: 'YWJj', mimeType: 'image/jpeg' }); assert.deepEqual(input.inventory, inventory); assert.equal(input.inventoryMode, 'owned');
  assert.equal(h.state().approvedDesignId, build.id); assert.deepEqual(h.state().approvedDeliveries?.[build.id], { model: true, manual: true, parts: true });
  assert.equal(h.media.filter(value => value === 'model').length, 1, 'Revision wording must not finalize another build');
});

test('explicit checked selection is approvable and parts command exports that exact design', async () => {
  const h = harness(), conversation = h.create();
  await conversation.handle(message(`/open ${build.id}`));
  assert.equal(h.state().feedbackDesignId, build.id);
  const files: string[] = []; h.api.file = async (id, format) => { files.push(`${id}/${format}`); return Buffer.from(format); };
  await conversation.handle(message('/parts')); assert.deepEqual(files, [`${build.id}/parts.csv`]);
  await conversation.handle(message('/approve')); assert.equal(h.state().approvedDesignId, build.id); assert.equal(h.submitted.length, 0);
});

test('Quick and Detailed skipped-review completions ask for human feedback without inventing a failed verdict', async () => {
  for (const quality of ['Quick', 'Detailed']) {
    const h = harness(), conversation = h.create(); await start(conversation, 'Build a flower', quality);
    const job = h.jobs.get(h.state().jobId!)!; job.status = 'succeeded'; job.resultId = build.id; job.bestDraftId = build.id;
    await conversation.poll();
    assert.match(h.texts.at(-1)!, /passes brick checks.*visual review was skipped.*\/approve/s);
    assert.doesNotMatch(h.texts.at(-1)!, /needs visual refinement|has not passed|passed the AI visual review/);
  }
});

test('current iMessage flow starts new subjects immediately and preserves checked feedback approval', async () => {
  const h = harness({ handledIds: [] }, false), conversation = h.create();
  await conversation.handle(message('Build a flower'));
  assert.equal(h.submitted.length, 1); assert.equal(h.submitted[0].input.quality, 'detailed');
  assert.equal(h.state().pendingRequest, undefined); assert.match(h.texts[0], /Starting your build/);
  assert.doesNotMatch(h.texts.join('\n'), /Quick|Detailed|choose a mode|which would you like/i);
  h.jobs.get(h.state().jobId!)!.bestDraftId = build.id;
  await conversation.poll(); assert.equal(h.state().feedbackDesignId, build.id);
  await conversation.handle(message('looks good'));
  assert.equal(h.state().approvedDesignId, build.id); assert.equal(h.submitted.length, 1);
  assert.deepEqual(h.state().approvedDeliveries?.[build.id], { model: true, manual: true, parts: true });
  await conversation.handle(message('Make it taller'));
  assert.equal(h.submitted.length, 2); assert.equal(h.submitted[1].input.quality, 'detailed');
  assert.equal(h.submitted[1].input.previous?.id, build.id); assert.equal(h.state().approvedDesignId, build.id);
  await conversation.handle(message('Build a boat'));
  assert.equal(h.submitted.length, 3); assert.equal(h.submitted[2].input.quality, 'detailed'); assert.equal(h.submitted[2].input.previous, undefined);
});

test('archived Quick commands cannot choose quick generation or interrupt an existing job without a new request', async () => {
  const h = harness({ handledIds: [], quality: 'quick' }, false), conversation = h.create();
  await conversation.handle(message('/quick a flower'));
  const firstId = h.state().jobId;
  assert.equal(h.submitted[0].input.quality, 'detailed');
  for (const command of ['Quick', 'Detailed', 'thanks', 'status', "I don't like it"]) await conversation.handle(message(command));
  assert.equal(h.submitted.length, 1); assert.equal(h.stops.length, 0); assert.equal(h.state().jobId, firstId);
  await conversation.handle(message('Make it red in Quick mode'));
  assert.equal(h.submitted.length, 2); assert.equal(h.submitted[1].input.quality, 'detailed');
  assert.match(h.submitted[1].input.prompt, /Build|a flower/);
  assert.doesNotMatch(h.texts.join('\n'), /Quick|Detailed|choose a mode|which would you like/i);
  await conversation.handle(message('/stop')); assert.equal(h.submitted.length, 2);
});

test('saved mode-choice requests recover with either old choice or go ahead, retaining their photo and stock', async () => {
  for (const choice of ['Quick!', 'Detailed', 'go ahead']) {
    const image = { data: 'YWJj', mimeType: 'image/jpeg' };
    const inventory = [{ partId: '3005', colorId: 15, quantity: 3, source: 'Owned stock' }];
    const h = harness({ handledIds: [], quality: 'quick', pendingQuality: 'quick', inventory, pendingRequest: { kind: 'new', prompt: 'Build this flower', image } }, false);
    const conversation = h.create();
    await conversation.handle(message('/status')); await conversation.handle(message('thanks'));
    assert.equal(h.submitted.length, 0); assert.match(h.texts.at(-1)!, /go ahead/);
    await conversation.handle(message(choice));
    assert.equal(h.submitted.length, 1); assert.equal(h.submitted[0].input.quality, 'detailed');
    assert.equal(h.submitted[0].input.prompt, 'Build this flower'); assert.deepEqual(h.submitted[0].input.image, image);
    assert.deepEqual(h.submitted[0].input.inventory, inventory); assert.equal(h.submitted[0].input.inventoryMode, 'owned');
    assert.equal(h.state().pendingRequest, undefined); assert.equal(h.state().pendingQuality, undefined);
  }
});

test('an uncaptioned photo waits only for its subject, then starts without a mode question', async () => {
  const h = harness({ handledIds: [] }, false), conversation = h.create();
  const image: Content = { type: 'attachment', id: 'new-photo', name: 'photo.jpg', mimeType: 'image/jpeg', size: 3,
    read: async () => Buffer.from('abc'), stream: async () => new ReadableStream({ start(controller) { controller.enqueue(Buffer.from('abc')); controller.close(); } }) };
  await conversation.handle({ ...message(''), content: image });
  assert.equal(h.submitted.length, 0); assert.match(h.texts.at(-1)!, /What would you like to build from this photo/);
  await conversation.handle(message('Build this flower'));
  assert.equal(h.submitted.length, 1); assert.equal(h.submitted[0].input.quality, 'detailed');
  assert.deepEqual(h.submitted[0].input.image, { data: 'YWJj', mimeType: 'image/jpeg' });
  assert.doesNotMatch(h.texts.join('\n'), /Quick|Detailed|choose a mode/i);
});

test('restoring an old Quick job leaves it running and hides archived choices from progress and completion', async () => {
  const h = harness({ handledIds: [], jobId: 'old-build', quality: 'quick', requestPrompt: 'Build a flower' }, false);
  const job: GenerationJob = { id: 'old-build', quality: 'quick', status: 'queued', createdAt: build.createdAt, updatedAt: build.createdAt, milestones: [], attempts: [] };
  h.jobs.set(job.id, job);
  const conversation = h.create(); await conversation.poll(); await conversation.handle(message('/status'));
  assert.equal(job.quality, 'quick'); assert.equal(job.status, 'queued'); assert.equal(h.stops.length, 0); assert.equal(h.submitted.length, 0);
  job.status = 'failed'; job.error = { message: 'deadline exceeded', checks: [] }; await conversation.poll();
  assert.doesNotMatch(h.texts.join('\n'), /Quick|Detailed|choose a mode/i);
  await conversation.handle(message('Make it smaller'));
  assert.equal(h.submitted[0].input.quality, 'detailed'); assert.match(h.submitted[0].input.prompt, /Build a flower\nRequested change: Make it smaller/);
});

test('the constructor default uses immediate detailed generation without a config override', async () => {
  const h = harness();
  const conversation = new PhotonConversation({ handledIds: [] }, h.api, h.reply, async () => {});
  await conversation.handle(message('Build a flower'));
  assert.equal(h.submitted.length, 1); assert.equal(h.submitted[0].input.quality, 'detailed');
});

test('status and Stop bypass a long manual export without changing its captured revision or starting a retry job', { timeout: 2000 }, async () => {
  const h = harness({ handledIds: [], designId: build.id }, false), conversation = h.create();
  await conversation.handle(message('Make it taller')); const jobId = h.state().jobId!;
  let release!: () => void, entered!: () => void, delivered = false;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const calls: string[] = [];
  h.api.file = async (id, format) => {
    calls.push(`${id}/${format}`); entered(); await new Promise<void>(resolve => { release = resolve; }); return Buffer.from(format);
  };
  h.reply.manual = async () => { delivered = true; };
  const exporting = conversation.handle(message('/manual')); await started;
  assert.match(h.texts.at(-1)!, /Preparing your PDF instructions/);
  for (const text of ['/status', 'What’s going on?']) {
    await conversation.handle(message(text));
    assert.match(h.texts.at(-1)!, /Preparing your PDF instructions/); assert.equal(delivered, false);
  }
  await conversation.handle(message('/stop'));
  assert.equal(h.jobs.get(jobId)!.status, 'cancelled'); assert.equal(delivered, false);
  assert.match(h.texts.at(-1)!, /requested files are still being prepared or sent/);
  release(); await exporting;
  assert.equal(delivered, true); assert.deepEqual(calls, [`${build.id}/manual.pdf`]); assert.equal(h.submitted.length, 1);
});

test('approval status and Stop remain responsive during PDF preparation while a duplicate approval waits for acknowledgements', { timeout: 2000 }, async () => {
  const h = harness({ handledIds: [], designId: build.id, feedbackDesignId: build.id }, false), conversation = h.create();
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const calls: string[] = [];
  h.api.file = async (id, format) => {
    calls.push(`${id}/${format}`);
    if (format === 'manual.pdf') { entered(); await new Promise<void>(resolve => { release = resolve; }); }
    return Buffer.from(format);
  };
  const first = conversation.handle(message('/approve')); await started;
  const duplicate = conversation.handle(message('/approve'));
  await conversation.handle(message('/status'));
  assert.match(h.texts.at(-1)!, /Preparing your PDF instructions/);
  assert.deepEqual(h.state().approvedDeliveries?.[build.id], { model: true });
  await conversation.handle(message('/stop')); assert.match(h.texts.at(-1)!, /no active generation/i);
  release(); await first; await duplicate;
  assert.deepEqual(calls, ['mobile.usdz', 'manual.pdf', 'parts.csv'].map(format => `${build.id}/${format}`));
  assert.deepEqual(h.media, ['model', 'manual', 'parts']); assert.equal(h.submitted.length, 0);
  assert.equal(h.state().approvedDesignId, build.id);
});

test('a timed-out manual can be retried after restart without regenerating or resending the other approved files', async () => {
  const h = harness({ handledIds: [], designId: build.id, feedbackDesignId: build.id }, false), conversation = h.create();
  const calls: string[] = []; let failManual = true;
  h.api.file = async (id, format) => {
    calls.push(`${id}/${format}`);
    if (format === 'manual.pdf' && failManual) throw new Error('Export timed out');
    return Buffer.from(format);
  };
  await conversation.handle(message('/approve'));
  assert.deepEqual(h.state().approvedDeliveries?.[build.id], { model: true, parts: true });
  failManual = false; await h.create().handle(message('/approve'));
  assert.deepEqual(calls, ['mobile.usdz', 'manual.pdf', 'parts.csv', 'manual.pdf'].map(format => `${build.id}/${format}`));
  assert.deepEqual(h.media, ['model', 'parts', 'manual']); assert.equal(h.submitted.length, 0);
});

test('approval polling follows preparation and sending with throttled check-ins after the job has finished', { timeout: 2000 }, async () => {
  const h = harness({ handledIds: [], designId: build.id, feedbackDesignId: build.id, jobId: 'finished', finishedJobId: 'finished' }, false), conversation = h.create();
  h.jobs.set('finished', { id: 'finished', quality: 'detailed', status: 'succeeded', createdAt: build.createdAt, updatedAt: build.createdAt, milestones: [], attempts: [] });
  let releaseFile!: () => void, fileEntered!: () => void, releaseSend!: () => void, sendEntered!: () => void;
  const fetching = new Promise<void>(resolve => { fileEntered = resolve; });
  const sending = new Promise<void>(resolve => { sendEntered = resolve; });
  const calls: string[] = [];
  h.api.file = async (id, format) => {
    calls.push(`${id}/${format}`);
    if (format === 'mobile.usdz') { fileEntered(); await new Promise<void>(resolve => { releaseFile = resolve; }); }
    return Buffer.from(format);
  };
  h.reply.model = async () => { sendEntered(); await new Promise<void>(resolve => { releaseSend = resolve; }); h.media.push('model'); };
  const approval = conversation.handle(message('/approve')); await fetching;
  const duplicate = conversation.handle(message('/approve'));
  assert.match(h.texts.at(-1)!, /Approved Rocket.*Preparing your rotatable 3D file/);
  let count = h.texts.length;
  h.advance(29_999); await conversation.poll(); assert.equal(h.texts.length, count);
  h.advance(1); await conversation.poll(); assert.equal(h.texts.length, ++count);
  assert.match(h.texts.at(-1)!, /Still working: preparing your rotatable 3D file/);
  releaseFile(); await sending;
  h.advance(14_999); await conversation.poll(); assert.equal(h.texts.length, count);
  h.advance(1); await conversation.poll(); assert.equal(h.texts.length, ++count);
  assert.match(h.texts.at(-1)!, /Sending your rotatable 3D file/);
  await conversation.handle(message('/status')); assert.match(h.texts.at(-1)!, /Sending your rotatable 3D file/);
  await conversation.handle(message('/stop')); assert.match(h.texts.at(-1)!, /requested files are still being prepared or sent/);
  releaseSend(); await approval; await duplicate;
  assert.deepEqual(calls, ['mobile.usdz', 'manual.pdf', 'parts.csv'].map(format => `${build.id}/${format}`));
  assert.deepEqual(h.state().approvedDeliveries?.[build.id], { model: true, manual: true, parts: true });
  assert.equal(h.state().approvedDesignId, build.id); assert.equal(h.submitted.length, 0);
  count = h.texts.length; h.advance(60_000); await conversation.poll(); assert.equal(h.texts.length, count);
});

test('failed progress texts retry on a safe interval without aborting exports or losing file acknowledgements', { timeout: 2000 }, async () => {
  const h = harness({ handledIds: [], designId: build.id, feedbackDesignId: build.id }, false), conversation = h.create();
  let release!: () => void, entered!: () => void, textAttempts = 0;
  const fetching = new Promise<void>(resolve => { entered = resolve; });
  const calls: string[] = [];
  h.api.file = async (_id, format) => {
    calls.push(format);
    if (format === 'manual.pdf') { entered(); await new Promise<void>(resolve => { release = resolve; }); }
    return Buffer.from(format);
  };
  h.reply.text = async text => {
    textAttempts++;
    if (textAttempts <= 2 || text.includes('have been sent')) throw new Error('Text send failed');
    h.texts.push(text);
  };
  const approval = conversation.handle(message('/approve')); await fetching;
  assert.deepEqual(h.state().approvedDeliveries?.[build.id], { model: true });
  h.advance(15_000); await conversation.poll(); assert.equal(textAttempts, 2);
  h.advance(14_999); await conversation.poll(); assert.equal(textAttempts, 2);
  h.advance(1); await conversation.poll(); assert.equal(textAttempts, 3);
  assert.match(h.texts.at(-1)!, /Preparing your PDF instructions/);
  release(); await approval;
  assert.deepEqual(h.state().approvedDeliveries?.[build.id], { model: true, manual: true, parts: true });
  const before = calls.length;
  h.reply.text = async text => { h.texts.push(text); };
  await h.create().handle(message('/approve'));
  assert.equal(calls.length, before); assert.deepEqual(h.media, ['model', 'manual', 'parts']);
});

test('an in-flight export check-in finishes before acknowledgement with no stale progress after completion', { timeout: 2000 }, async () => {
  const h = harness({ handledIds: [], designId: build.id }, false), conversation = h.create();
  let releaseFile!: () => void, fileEntered!: () => void, releaseText!: () => void, textEntered!: () => void, delivered!: () => void;
  const fetching = new Promise<void>(resolve => { fileEntered = resolve; });
  const checkingIn = new Promise<void>(resolve => { textEntered = resolve; });
  const sent = new Promise<void>(resolve => { delivered = resolve; });
  h.api.file = async (_id, format) => { fileEntered(); await new Promise<void>(resolve => { releaseFile = resolve; }); return Buffer.from(format); };
  h.reply.text = async text => {
    if (text.startsWith('Still working:')) { textEntered(); await new Promise<void>(resolve => { releaseText = resolve; }); }
    h.texts.push(text);
  };
  h.reply.manual = async () => { h.media.push('manual'); delivered(); };
  const exportTask = conversation.handle(message('/manual')); await fetching;
  h.advance(30_000); const polling = conversation.poll(); await checkingIn;
  releaseFile(); await sent;
  releaseText(); await polling; await exportTask;
  assert.match(h.texts.at(-1)!, /Sent your PDF instructions/);
  const count = h.texts.length; h.advance(60_000); await conversation.poll(); assert.equal(h.texts.length, count);
  assert.deepEqual(h.media, ['manual']);
});

test('fast direct exports acknowledge the actual file without routine progress chatter', async () => {
  for (const kind of ['model', 'manual', 'parts'] as const) {
    const h = harness({ handledIds: [], designId: build.id }, false), conversation = h.create();
    await conversation.handle(message(`/${kind}`));
    assert.equal(h.texts.length, 2); assert.match(h.texts[0], /^Preparing your/); assert.match(h.texts[1], /^Sent your/);
    assert.deepEqual(h.media, [kind]); h.advance(60_000); await conversation.poll(); assert.equal(h.texts.length, 2);
  }
});

test('plain and legacy-mode new subjects drop the prior Bell Tower and its photo but retain owned stock', async () => {
  const inventory = [{ partId: '3005', colorId: 15, quantity: 20, source: 'My stock' }];
  const bell = { ...build, id: 'bell-tower', title: 'Bell Tower', prompt: 'Make the Bell Tower at UNC' };
  for (const text of ['Make wilson library at UNC', '/quick Make wilson library at UNC', '/detailed Make wilson library at UNC']) {
    const h = harness({ handledIds: [], designId: bell.id, feedbackDesignId: bell.id, requestPrompt: bell.prompt, quality: 'quick', inventory,
      pendingImage: { data: 'b2xk', mimeType: 'image/jpeg' } }, false);
    h.designs.set(bell.id, bell);
    await h.create().handle(message(text));
    assert.equal(h.submitted.length, 1);
    const input = h.submitted[0].input;
    assert.equal(input.prompt, 'Make wilson library at UNC'); assert.equal(input.previous, undefined); assert.equal(input.image, undefined);
    assert.equal(input.quality, 'detailed'); assert.deepEqual(input.inventory, inventory); assert.equal(input.inventoryMode, 'owned');
    assert.equal(h.state().pendingImage, undefined); assert.equal(h.state().requestPrompt, 'Make wilson library at UNC');
  }
});

test('legacy saved new-subject requests are reclassified without dropping their own attached photo or stock', async () => {
  for (const attached of [false, true]) {
    const image = { data: 'bmV3', mimeType: 'image/jpeg' };
    const inventory = [{ partId: '3005', colorId: 15, quantity: 20, source: 'My stock' }];
    const h = harness({ handledIds: [], designId: build.id, feedbackDesignId: build.id, requestPrompt: 'Make the Bell Tower at UNC', quality: 'quick', inventory,
      pendingImage: { data: 'b2xk', mimeType: 'image/jpeg' }, pendingRequest: { kind: 'design', prompt: 'Make wilson library at UNC', ...(attached ? { image } : {}) } }, false);
    await h.create().handle(message('Detailed'));
    const input = h.submitted[0].input;
    assert.equal(input.prompt, 'Make wilson library at UNC'); assert.equal(input.previous, undefined);
    assert.deepEqual(input.image, attached ? image : undefined); assert.deepEqual(input.inventory, inventory);
    assert.equal(input.quality, 'detailed');
  }
});

test('saved revisions and same-request retries keep the selected build, original photo and request context', async () => {
  const original = 'Build a flower';
  for (const prompt of ['Make it red', 'Add two leaves', 'Make the flower taller', 'Build the same model again', original]) {
    const image = { data: 'b2xk', mimeType: 'image/jpeg' };
    const h = harness({ handledIds: [], designId: build.id, feedbackDesignId: build.id, requestPrompt: original, pendingImage: image,
      pendingRequest: { kind: 'design', prompt } }, false);
    await h.create().handle(message('Quick'));
    const input = h.submitted[0].input;
    assert.equal(input.previous?.id, build.id); assert.deepEqual(input.image, image); assert.equal(input.quality, 'detailed');
    assert.equal(input.prompt, prompt === original ? original : `${original}\nRequested change: ${prompt}`);
  }
});


test('chat replies retain the current draft, pending photograph, owned stock and approval without generating', async () => {
  const pendingImage = { data: Buffer.from('photo').toString('base64'), mimeType: 'image/png' };
  const initial: Conversation = { handledIds: [], designId: build.id, feedbackDesignId: build.id, requestPrompt: 'A rose', pendingImage,
    inventory: [{ partId: '3005', colorId: 15, quantity: 5, source: 'My bricks' }], approvedDesignId: build.id,
    approvedDeliveries: { [build.id]: { model: true } } };
  const h = harness(initial, false), conversation = h.create();
  let calls = 0;
  h.api.chat = async (prompt, context) => {
    calls++; assert.equal(prompt, 'Hey, what can you help me build?');
    assert.equal(context.designId, build.id); assert.equal(context.originalRequest, 'A rose'); assert.equal(context.hasPendingPhoto, true);
    return { intent: 'reply', text: 'We can turn an idea into a brick model, then work on its shape together.' };
  };
  const incoming = message('Hey, what can you help me build?');
  await conversation.handle(incoming); await conversation.handle(incoming);
  assert.equal(calls, 1); assert.equal(h.submitted.length, 0); assert.equal(h.stops.length, 0);
  assert.match(h.texts.at(-1)!, /turn an idea into a brick model/);
  assert.deepEqual({ ...h.state(), handledIds: [], chatHistory: undefined }, { ...initial, chatHistory: undefined });
  assert.equal(h.state().chatHistory?.at(-1)?.text, h.texts.at(-1));
});

test('natural-language file requests use the real checked revision and never regenerate or approve', async () => {
  for (const intent of ['manual', 'model', 'parts'] as const) {
    const h = harness({ handledIds: [], designId: build.id, feedbackDesignId: build.id }, false);
    h.api.chat = async () => ({ intent, text: 'Never display this routing text.' });
    const requested: string[] = [];
    h.api.file = async (id, format) => { requested.push(`${id}/${format}`); return Buffer.from(format); };
    await h.create().handle(message(`Could you send me the ${intent}?`));
    assert.deepEqual(requested, [`${build.id}/${intent === 'manual' ? 'manual.pdf' : intent === 'model' ? 'mobile.usdz' : 'parts.csv'}`]);
    assert.equal(h.submitted.length, 0); assert.equal(h.state().approvedDesignId, undefined);
    assert.ok(!h.texts.some(text => text.includes('routing text')));
  }
});

test('interpreted revisions keep the exact user feedback, selected draft, original request and image', async () => {
  const pendingImage = { data: Buffer.from('photo').toString('base64'), mimeType: 'image/png' };
  const h = harness({ handledIds: [], designId: build.id, feedbackDesignId: build.id, requestPrompt: 'A red rose', pendingImage }, false);
  h.api.chat = async () => ({ intent: 'revision', text: 'Do not substitute this generated rewrite.' });
  await h.create().handle(message('I would like the petals a bit wider.'));
  assert.equal(h.submitted.length, 1);
  assert.equal(h.submitted[0].input.previous?.id, build.id);
  assert.equal(h.submitted[0].input.prompt, 'A red rose\nRequested change: I would like the petals a bit wider.');
  assert.deepEqual(h.submitted[0].input.image, pendingImage);
});

test('a natural-language new subject becomes a build only after interpretation, with the exact request', async () => {
  const h = harness({ handledIds: [] }, false); h.api.chat = async () => ({ intent: 'new', text: 'An invented rewrite' });
  await h.create().handle(message('A red rose with green leaves'));
  assert.equal(h.submitted.length, 1); assert.equal(h.submitted[0].input.prompt, 'A red rose with green leaves');
  assert.equal(h.submitted[0].input.previous, undefined);
});

test('unavailable conversational interpretation asks for a next step and never starts or stops generation', async () => {
  for (const available of [false, true]) {
    const h = harness({ handledIds: [], designId: build.id }, false);
    if (available) h.api.chat = async () => { throw new Error('provider internal payload'); };
    await h.create().handle(message('Hello there'));
    assert.match(h.texts.at(-1)!, /build is unchanged/);
    assert.ok(!h.texts.at(-1)!.includes('payload')); assert.equal(h.state().designId, build.id);
    assert.equal(h.submitted.length, 0); assert.equal(h.stops.length, 0);
  }
});

test('Status and Stop bypass a held conversational request and Stop invalidates a late build action', async () => {
  const h = harness({ handledIds: [] }, false), conversation = h.create();
  await conversation.handle(message('Build a rocket'));
  let release!: () => void, started!: () => void;
  const waiting = new Promise<void>(resolve => { started = resolve; });
  h.api.chat = async () => { started(); await new Promise<void>(resolve => { release = resolve; }); return { intent: 'new', text: 'A castle' }; };
  const chat = conversation.handle(message('A castle instead please')); await waiting;
  await conversation.handle(message('/status')); assert.match(h.texts.at(-1)!, /Send \/stop/);
  await conversation.handle(message('/stop')); assert.equal(h.stops.length, 1);
  release(); await chat;
  assert.equal(h.submitted.length, 1, 'Late interpretation must not restart after Stop');
});


test('short conversational history survives restart and is bounded independently from build state', async () => {
  const h = harness({ handledIds: [], designId: build.id }, false);
  let seen = 0;
  h.api.chat = async (_message, context) => {
    assert.equal(context.recentMessages?.length ?? 0, Math.min(seen * 2, 8));
    if (seen) assert.equal(context.recentMessages!.at(-1)!.text, `Reply ${seen}`);
    return { intent: 'reply', text: `Reply ${++seen}` };
  };
  for (let i = 0; i < 6; i++) await h.create().handle(message(`Could we talk about option ${i}?`));
  assert.equal(h.state().chatHistory?.length, 8); assert.equal(h.submitted.length, 0);
  assert.equal(h.state().designId, build.id);
});


test('confirming a conversational build suggestion resolves the subject instead of generating from yes', async () => {
  const h = harness({ handledIds: [] }, false);
  h.api.chat = async () => ({ intent: 'reply', text: 'We could try a small red rose with a green stem. Want to build it?' });
  await h.create().handle(message('Would a rose be possible?'));
  h.api.chat = async (message, context) => {
    assert.equal(message, 'Yes'); assert.match(context.recentMessages!.at(-1)!.text, /red rose/);
    return { intent: 'new', text: 'Build a small red rose with a green stem.' };
  };
  await h.create().handle(message('Yes'));
  assert.equal(h.submitted.length, 1); assert.equal(h.submitted[0].input.prompt, 'Build a small red rose with a green stem.\nUser confirmation: Yes');
  assert.equal(h.state().approvedDesignId, undefined);
});


test('a natural-language caption uses the waiting photo without reusing an older build photo', async () => {
  const image = { data: Buffer.from('new-photo').toString('base64'), mimeType: 'image/png' };
  const h = harness({ handledIds: [], pendingRequest: { kind: 'new', prompt: '', image }, pendingImage: { ...image, data: Buffer.from('old-photo').toString('base64') } }, false);
  h.api.chat = async () => ({ intent: 'new', text: 'A red rose from the photograph' });
  await h.create().handle(message('A red rose from this picture'));
  assert.deepEqual(h.submitted[0].input.image, image);
});

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
function harness(initial: Conversation = { handledIds: [] }) {
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
  const reply: PhotonReply = { text: async text => { texts.push(text); }, preview: async () => { media.push('attempt'); }, designPreview: async design => { media.push(`design:${design.id}`); }, model: async () => { media.push('model'); }, manual: async () => { media.push('manual'); } };
  const create = () => new PhotonConversation(saved, api, reply, async value => { saved = structuredClone(value); }, 'https://example.test', () => clock);
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
        for (const command of ['/status', '/stop', '/model', '/manual', '/use N', '/open ID', '/new idea', '/quick idea', '/detailed idea']) {
          assert.ok(text.includes(command), `${quality} acknowledgement is missing ${command}`);
        }
        assert.match(text, /once a checked build is available/);
        assert.match(text, /Reply with a change, then choose a mode/);
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

test('HTTP transport binds jobs and checked designs and requests automatic stop only for a reviewed match', async () => {
  const id = randomUUID(), calls: { url: string; body?: unknown }[] = [];
  const fetcher: typeof fetch = async (url, options) => {
    calls.push({ url: String(url), ...(options?.body ? { body: JSON.parse(String(options.body)) } : {}) });
    return Response.json(String(url).includes('/designs/') ? build : { id, status: 'running', milestones: [] });
  };
  const api = photonJobsApi('http://127.0.0.1:3001', fetcher);
  await api.submit(id, { prompt: 'A simple rocket' });
  assert.deepEqual(calls[0].body, { requestId: id, input: { prompt: 'A simple rocket' }, stopWhenMatched: true });
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

test('an active build keeps running until a staged revision receives an explicit quality choice', async () => {
  const h = harness(), conversation = h.create(); await start(conversation, 'Build a tower', 'Quick');
  await conversation.handle(message('Quick')); await conversation.handle(message('Detailed'));
  assert.equal(h.submitted.length, 1); assert.equal(h.stops.length, 0);
  await conversation.handle(message('Make it red'));
  await conversation.handle(message('ok')); await conversation.handle(message('are you still working?'));
  assert.equal(h.state().pendingRequest?.prompt, 'Make it red'); assert.equal(h.submitted.length, 1); assert.equal(h.stops.length, 0);
  await conversation.handle(message('Detailed'));
  assert.equal(h.submitted.length, 2); assert.equal(h.submitted[1].input.quality, 'detailed'); assert.equal(h.stops.length, 1);
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
  assert.match(h.texts.at(-1)!, /not passed a complete visual review/); assert.match(h.texts.at(-1)!, /Reply Detailed/);
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

test('attachment fallback explains local-only viewing when a public origin is absent', async () => {
  const h = harness({ handledIds: [], designId: build.id });
  h.reply.model = async () => { throw new PhotonInputError('The file could not be delivered.'); };
  const conversation = new PhotonConversation(h.state(), h.api, h.reply, async () => {});
  await conversation.handle(message('/model'));
  assert.match(h.texts.at(-1)!, /local to the computer.*\?design=checked-build.*Download 3D/);
  assert.doesNotMatch(h.texts.at(-1)!, /https?:\/\//);
});

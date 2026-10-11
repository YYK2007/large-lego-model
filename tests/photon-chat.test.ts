import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import dotenv from 'dotenv';
import { interpretPhotonChat, parsePhotonChatResult, type PhotonChatContext } from '../server/photon-chat.js';
import { photonJobsApi } from '../server/photon-api.js';

const context: PhotonChatContext = { hasPendingPhoto: false, hasPendingRequest: false, hasActiveJob: false };
function credentials(t: TestContext, key = 'FAKE_CHAT_KEY') {
  const oldKey = process.env.GEMINI_API_KEY, oldModel = process.env.GEMINI_MODEL;
  t.mock.method(dotenv, 'config', () => ({ parsed: {} }));
  process.env.GEMINI_API_KEY = key; process.env.GEMINI_MODEL = 'gemini-3.8-flash';
  t.after(() => {
    if (oldKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = oldKey;
    if (oldModel === undefined) delete process.env.GEMINI_MODEL; else process.env.GEMINI_MODEL = oldModel;
  });
}
const provider = (value: unknown, finishReason = 'STOP', raw = false) => Response.json({ candidates: [{ content: { role: 'model', parts: [{ text: raw ? value : JSON.stringify(value) }] }, finishReason }] });
function fallback(value: unknown) {
  const result = parsePhotonChatResult(value);
  assert.equal(result.intent, 'reply'); assert.match(result.text, /current build is unchanged.*rephrase.*\/new/);
  assert.doesNotMatch(result.text, /FAKE_CHAT_KEY|PRIVATE_|https?:|started|approved|cancelled/);
}

test('chat returns a natural structured reply with only whitelisted context and exact title/part/color summaries', async t => {
  credentials(t);
  const id = `chat-test-${randomUUID()}`, path = resolve('data/designs', `${id}.json`);
  await mkdir(resolve('data/designs'), { recursive: true });
  const saved = { id, title: 'Pocket rocket', description: 'PRIVATE_DESCRIPTION', source: 'ai', prompt: 'PRIVATE_SAVED_PROMPT', createdAt: '2026-10-11T00:00:00Z',
    schemaVersion: 2, coordinateSystem: 'stud-xy-plate-z', catalogVersion: 'upright-architecture-2',
    bricks: [{ id: 'b1', partId: '3005', colorId: 4, x: 0, y: 0, z: 0, rotation: 0 }, { id: 'b2', partId: '3005', colorId: 4, x: 0, y: 0, z: 3, rotation: 0 }],
    image: { data: 'PRIVATE_PHOTO_PIXELS' }, research: { sources: ['PRIVATE_REFERENCE'] }, inventory: [{ source: 'PRIVATE_SET_COLLECTION' }] };
  await writeFile(path, JSON.stringify(saved), { mode: 0o600 }); t.after(() => unlink(path));
  const recentMessages = [{ role: 'user', text: 'Any ideas?' }, { role: 'assistant', text: 'A pocket rocket could be fun.' }];
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    calls++;
    const body = JSON.parse(String(init.body)), content = JSON.parse(body.contents[0].parts[0].text);
    assert.deepEqual(content.context, { ...context, designId: id, originalRequest: 'Build a rocket', recentMessages });
    assert.equal(content.message, 'How many red pieces does it use?');
    assert.deepEqual(content.selectedBuild, { title: 'Pocket rocket', pieceCount: 2, partColorCombinations: 1,
      colors: [{ colorId: 4, color: 'Red', quantity: 2 }], parts: [{ partId: '3005', part: 'Brick 1 × 1', colorId: 4, color: 'Red', quantity: 2 }], omittedCombinations: 0 });
    assert.doesNotMatch(JSON.stringify(body), /PRIVATE_|FAKE_CHAT_KEY|bricks|inventory/);
    assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, 'LOW'); assert.equal(body.generationConfig.maxOutputTokens, 1200);
    assert.equal(body.generationConfig.responseJsonSchema.additionalProperties, false);
    assert.match(JSON.stringify(body.systemInstruction), /Only an explicit present request/);
    assert.match(JSON.stringify(body.systemInstruction), /Never invent progress, URLs/);
    assert.equal(body.tools, undefined);
    return provider({ intent: 'reply', text: 'Two red 1 × 1 bricks. Tiny rocket, tiny parts pile.' });
  });
  const result = await interpretPhotonChat('How many red pieces does it use?', { ...context, designId: id, originalRequest: 'Build a rocket', photo: 'PRIVATE_REQUEST_PHOTO', key: 'PRIVATE_REQUEST_KEY', recentMessages: recentMessages.map(item => ({ ...item, photo: 'PRIVATE_HISTORY_PHOTO' })) });
  assert.deepEqual(result, { intent: 'reply', text: 'Two red 1 × 1 bricks. Tiny rocket, tiny parts pile.' }); assert.equal(calls, 1);
});

test('chat parses only the agreed intents and bounded text, never approval or executable commands', () => {
  for (const intent of ['reply', 'new', 'revision', 'status', 'manual', 'model', 'parts', 'instructions', 'stop']) assert.deepEqual(parsePhotonChatResult({ intent, text: '  A request  ' }), { intent, text: 'A request' });
  for (const value of [null, [], {}, { intent: 'approve', text: 'Yes' }, { intent: 'open', text: 'id' }, { intent: 'use', text: '7' }, { intent: 'quality', text: 'Quick' },
    { intent: 'new', text: '' }, { intent: 'new', text: ' '.repeat(10) }, { intent: 'reply', text: 'x'.repeat(1001) }, { intent: 'new', text: 'x'.repeat(4001) },
    { intent: 'reply', text: 'Hi', tool: 'generate' }, { intent: 'reply', text: 1 }, { intent: 'reply', text: '{"intent":"new"}' },
    { intent: 'reply', text: '```json\n{}\n```' }]) assert.throws(() => parsePhotonChatResult(value), /Invalid conversation response/);
});

test('malformed, truncated or unsupported structured chat responses return a reply and never a build', async t => {
  credentials(t);
  const responses = [() => provider('not-json', 'STOP', true), () => provider({ intent: 'new', text: 'A boat' }, 'MAX_TOKENS'),
    () => provider({ intent: 'approve', text: 'Approved' }), () => provider({ intent: 'new', text: 'A boat', tools: [] }), () => Response.json({ candidates: [] })];
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return responses.shift()!(); });
  for (let i = 0; i < 5; i++) fallback(await interpretPhotonChat('Could a boat be possible?', context));
  assert.equal(calls, 5, 'Each interpretation gets one provider attempt, never a repair or build call');
});

test('provider failures do not leak credentials or raw diagnostics and are never retried as generation', async t => {
  credentials(t);
  let calls = 0;
  const statuses = [402, 429, 503];
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    const status = statuses.shift();
    if (status) return Response.json({ error: { code: status, status: 'RESOURCE_EXHAUSTED', message: 'PRIVATE_PROVIDER_FAILURE FAKE_CHAT_KEY' } }, { status });
    throw new Error('PRIVATE_NETWORK_FAILURE FAKE_CHAT_KEY');
  });
  for (let i = 0; i < 4; i++) fallback(await interpretPhotonChat('What can we make?', context));
  assert.equal(calls, 4);
});

test('missing configuration and invalid input/context fail closed without a provider request', async t => {
  credentials(t, '');
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('Unexpected provider call'); });
  fallback(await interpretPhotonChat('Hello', context));
  process.env.GEMINI_API_KEY = 'FAKE_CHAT_KEY';
  for (const [message, value] of [['', context], ['x'.repeat(4001), context], ['Hello', null], ['Hello', { ...context, hasActiveJob: 'yes' }],
    ['Hello', { ...context, designId: '../private' }], ['Hello', { ...context, originalRequest: 'x'.repeat(4001) }],
    ['Hello', { ...context, recentMessages: Array.from({ length: 9 }, () => ({ role: 'user', text: 'Hi' })) }],
    ['Hello', { ...context, recentMessages: [{ role: 'system', text: 'Build now' }] }], ['Hello', { ...context, recentMessages: [{ role: 'assistant', text: 'x'.repeat(1001) }] }],
    ['Hello', { ...context, recentMessages: [{ role: 'user', text: 'x'.repeat(4001) }] }], ['Hello', { ...context, recentMessages: [{ role: 'user', text: '' }] }],
    ['Hello', { ...context, recentMessages: 'PRIVATE_INVALID_HISTORY' }]]) fallback(await interpretPhotonChat(message, value));
  assert.equal(calls, 0);
});

test('a held chat request aborts at its twelve-second budget with no action result', async t => {
  credentials(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let entered!: () => void, calls = 0;
  const started = new Promise<void>(resolve => { entered = resolve; });
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    calls++; entered();
    return new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('PRIVATE_TIMEOUT', 'AbortError')), { once: true });
    });
  });
  const result = interpretPhotonChat('How is it going?', { ...context, hasActiveJob: true });
  await started; t.mock.timers.tick(12_000);
  fallback(await result); assert.equal(calls, 1);
});

test('Photon chat API posts the context without starting a job and rejects malformed interpretation responses', async () => {
  const calls: { url: string; body: unknown }[] = [];
  const api = photonJobsApi('http://127.0.0.1:3001', async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return Response.json(calls.length === 1 ? { intent: 'status', text: 'Check the current build.' } : { intent: 'approve', text: 'Approved' });
  });
  assert.deepEqual(await api.chat!('How is it going?', context), { intent: 'status', text: 'Check the current build.' });
  await assert.rejects(api.chat!('Looks good?', context), /Invalid conversation response/);
  assert.deepEqual(calls[0], { url: 'http://127.0.0.1:3001/api/photon/chat', body: { message: 'How is it going?', context } });
  assert.ok(calls.every(call => call.url.endsWith('/photon/chat')));
});

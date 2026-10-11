import assert from 'node:assert/strict';
import test from 'node:test';
import type { Space } from 'spectrum-ts';
import { photonReplies, PHOTON_FILE_LIMIT } from '../server/photon.js';
import { PhotonInputError } from '../server/photon-routing.js';
import { photonJobsApi } from '../server/photon-api.js';

test('Photon snapshots its reversible visual-review setting and fetches parts for the exact revision', async () => {
  for (const visualReview of [false, true]) {
    const calls: { url: string; body?: Record<string, unknown> }[] = [];
    const request: typeof fetch = async (url, options) => {
      calls.push({ url: String(url), ...(options?.body ? { body: JSON.parse(String(options.body)) } : {}) });
      return String(url).endsWith('/parts.csv') ? new Response('exact-parts') : Response.json({ id: 'test-job', status: 'queued', milestones: [] });
    };
    const api = photonJobsApi('http://127.0.0.1:3001', request, visualReview);
    await api.submit('test-job', { prompt: 'A flower' });
    assert.equal(calls[0].body?.visualReview, visualReview);
    assert.equal(calls[0].body?.stopWhenMatched, true, 'Review configuration does not replace the existing execution policy');
    assert.equal((await api.file('approved-revision', 'parts.csv')).toString(), 'exact-parts');
    assert.match(calls[1].url, /\/designs\/approved-revision\/parts\.csv$/);
  }
});

test('parts delivery retains CSV bytes and offers the parts command after a failed send', async () => {
  const bytes = Buffer.from('Part ID,Required\r\n3005,4\r\n');
  let delivered: { name: string; mimeType: string; read(): Promise<Buffer> } | undefined;
  const reply = photonReplies({ send: async (value: unknown) => {
    delivered = await (value as { build(): Promise<typeof delivered> }).build();
  } } as Pick<Space, 'send'>);
  await reply.parts(bytes);
  assert.equal(delivered?.name, 'large-lego-model-parts.csv');
  assert.equal(delivered?.mimeType, 'text/csv');
  assert.deepEqual(await delivered?.read(), bytes);
  const failed = photonReplies({ send: async () => { throw new Error('network'); } } as unknown as Pick<Space, 'send'>);
  await assert.rejects(failed.parts(bytes), /Send \/parts to retry/);
});

test('model delivery keeps its USDZ name and bytes and explains opening only after sending', async () => {
  const sent: unknown[] = [], bytes = Buffer.from('small-model');
  const reply = photonReplies({ send: async (value: unknown) => {
    sent.push(typeof value === 'string' ? value : await (value as { build(): Promise<unknown> }).build());
  } } as Pick<Space, 'send'>);
  await reply.model(bytes);
  const file = sent[0] as { name: string; mimeType: string; read(): Promise<Buffer> };
  assert.equal(file.name, 'large-lego-model.usdz');
  assert.equal(file.mimeType, 'model/vnd.usdz+zip');
  assert.deepEqual(await file.read(), bytes);
  assert.match(String(sent[1]), /Tap the 3D file/);
});

test('manual delivery retains PDF bytes and gives the manual retry command after a failed send', async () => {
  const bytes = Buffer.from('%PDF-1.7\nmanual');
  let file: { name: string; mimeType: string; read(): Promise<Buffer> } | undefined;
  const reply = photonReplies({ send: async (value: unknown) => {
    file = await (value as { build(): Promise<typeof file> }).build();
  } } as Pick<Space, 'send'>);
  await reply.manual(bytes);
  assert.equal(file?.name, 'large-lego-model-instructions.pdf');
  assert.equal(file?.mimeType, 'application/pdf');
  assert.deepEqual(await file?.read(), bytes);
  const failed = photonReplies({ send: async () => { throw new Error('network'); } } as unknown as Pick<Space, 'send'>);
  await assert.rejects(failed.manual(bytes), /Send \/manual to retry/);
});

test('delivery failures explain size or timeout without forwarding provider payloads', async () => {
  for (const [message, expected] of [
    ['Attempted to send message with a size larger than 104857600', /too large.*build page/],
    ['DEADLINE_EXCEEDED {"token":"private-value"}', /transfer took too long.*\/model/],
    ['{"providerError":{"secret":"private-value"}}', /couldn’t be sent.*\/model/],
  ] as const) {
    let sends = 0;
    const reply = photonReplies({ send: async () => { sends++; throw new Error(message); } } as unknown as Pick<Space, 'send'>);
    await assert.rejects(reply.model(Buffer.from('model')), error => {
      assert.ok(error instanceof PhotonInputError);
      assert.match(error.message, expected);
      assert.doesNotMatch(error.message, /[{}]|private-value|DEADLINE|104857600/);
      return true;
    });
    assert.equal(sends, 1, 'No false success text or duplicate attachment retry');
  }
});

test('oversized files are caught before sending and offer downloading without a futile retry', async () => {
  let sends = 0;
  const reply = photonReplies({ send: async () => { sends++; } } as unknown as Pick<Space, 'send'>);
  await assert.rejects(reply.manual(Buffer.alloc(PHOTON_FILE_LIMIT + 1)), /too large.*build page/);
  assert.equal(sends, 0);
});

test('an accepted attachment stays successful if its follow-up instructions fail', async () => {
  let attachments = 0;
  const reply = photonReplies({ send: async (value: unknown) => {
    if (typeof value === 'string') throw new Error('network');
    attachments++;
  } } as Pick<Space, 'send'>);
  await reply.model(Buffer.from('small-model'));
  assert.equal(attachments, 1);
});

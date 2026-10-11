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

test('the instruction-link API uses the exact revision and rejects unsigned, mismatched or credential-bearing links', async () => {
  const id = 'approved-revision', good = `https://guide.example/?build=${id}&share=test-signature`;
  for (const value of [good, null]) {
    let requested = '';
    const api = photonJobsApi('http://127.0.0.1:3001', async url => { requested = String(url); return Response.json({ url: value }); });
    assert.equal(await api.instructionsLink!(id), value);
    assert.match(requested, /\/api\/designs\/approved-revision\/instructions-link$/);
  }
  for (const url of ['http://guide.example/?build=approved-revision&share=s', 'https://user:secret@guide.example/?build=approved-revision&share=s',
    'https://guide.example/?build=another&share=s', 'https://guide.example/?build=approved-revision', 123]) {
    const api = photonJobsApi('http://127.0.0.1:3001', async () => Response.json({ url }));
    await assert.rejects(api.instructionsLink!(id));
  }
});

test('the API fetches a mobile viewing copy without substituting the approved revision or canonical export', async () => {
  const calls: string[] = [];
  const api = photonJobsApi('http://127.0.0.1:3001', async url => {
    calls.push(String(url));
    return new Response(String(url).endsWith('/mobile.usdz') ? 'mobile-copy' : 'canonical-copy', { headers: { 'Content-Type': 'model/vnd.usdz+zip' } });
  });
  assert.equal((await api.file('approved-revision', 'mobile.usdz')).toString(), 'mobile-copy');
  assert.equal((await api.file('approved-revision', 'model.usdz')).toString(), 'canonical-copy');
  assert.deepEqual(calls, ['http://127.0.0.1:3001/api/designs/approved-revision/mobile.usdz', 'http://127.0.0.1:3001/api/designs/approved-revision/model.usdz']);
});

test('instruction delivery uses the installed Spectrum app card with explicit layout plus the same Safari link', async () => {
  const url = 'https://guide.example/?build=exact-revision&share=test-signature';
  const sent: unknown[] = [];
  const reply = photonReplies({ send: async (value: unknown) => {
    sent.push(typeof value === 'string' ? value : await (value as { build(): Promise<unknown> }).build());
  } } as Pick<Space, 'send'>);
  await reply.instructions!(url, 'Pocket Rocket');
  const card = sent[0] as { type: string; url(): Promise<string>; layout(): Promise<Record<string, string>>; live?: boolean };
  assert.equal(card.type, 'app'); assert.equal(await card.url(), url); assert.equal(card.live, undefined);
  assert.deepEqual(await card.layout(), { caption: 'Build Pocket Rocket', subcaption: 'Step-by-step 3D instructions', summary: 'Open this exact checked build' });
  assert.equal(sent[1], `Your building guide. Open in Safari if you want to try AR:\n${url}`);
});

test('a guide is acknowledged if either its app card or plain link is accepted, and fails if both fail', async () => {
  for (const fails of ['card', 'text', 'both']) {
    const calls: string[] = [];
    const reply = photonReplies({ send: async (value: unknown) => {
      const type = typeof value === 'string' ? 'text' : 'card'; calls.push(type);
      if (fails === 'both' || type === fails) throw new Error('Send failed');
    } } as Pick<Space, 'send'>);
    const delivery = reply.instructions!('https://guide.example/?build=id&share=s', 'Rocket');
    if (fails === 'both') await assert.rejects(delivery, /Send failed/); else await delivery;
    assert.deepEqual(calls, ['card', 'text']);
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
  assert.match(String(sent[1]), /viewing copy.*covered stud detail.*full file/);
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

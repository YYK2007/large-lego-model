import assert from 'node:assert/strict';
import test from 'node:test';
import type { Space } from 'spectrum-ts';
import { photonReplies, PHOTON_FILE_LIMIT } from '../server/photon.js';
import { PhotonInputError } from '../server/photon-routing.js';

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

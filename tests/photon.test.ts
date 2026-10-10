import assert from 'node:assert/strict';
import test from 'node:test';
import type { Content, Message } from 'spectrum-ts';
import type { Design } from '../shared/model.js';
import {
  MAX_IMAGE_BYTES, MESSAGE_HISTORY_LIMIT, contentMessageIds, extractMessageInput,
  importSavedDesign, inventoryContext, parseConversation, rememberMessageIds, routeText,
  sessionKey, shouldHandleMessage,
} from '../server/photon-routing.js';

const savedBuild: Design = {
  id: '03de1ff9-d951-4e06-beb2-7e5e52f96f22', title: 'One brick', description: 'A minimal checked layout.',
  source: 'ai', prompt: 'Build one brick', createdAt: '2026-10-10T18:00:00Z',
  bricks: [{ id: 'one', partId: '3001', colorId: 4, x: 0, y: 0, z: 0, rotation: 0 }],
};

function photo(chunks: Uint8Array[], options: { size?: number; mimeType?: string; onCancel?: () => void } = {}): Content {
  return {
    type: 'attachment', id: 'photo-1', name: 'bricks.jpg', mimeType: options.mimeType ?? 'image/jpeg', size: options.size,
    read: async () => Buffer.concat(chunks),
    stream: async () => new ReadableStream<Uint8Array>({
      start(controller) { for (const chunk of chunks) controller.enqueue(chunk); },
      pull(controller) { controller.close(); },
      cancel() { options.onCancel?.(); },
    }),
  };
}

test('outbound echoes and replayed inbound IDs cannot trigger another generation', () => {
  assert.equal(shouldHandleMessage('outbound', 'new', []), false);
  assert.equal(shouldHandleMessage('inbound', 'seen', ['seen']), false);
  assert.equal(shouldHandleMessage('inbound', 'new', ['seen']), true);
  const ids = rememberMessageIds(Array.from({ length: 205 }, (_, i) => String(i)), ['204', 'new']);
  assert.equal(ids.length, MESSAGE_HISTORY_LIMIT);
  assert.equal(ids.at(-1), 'new');
  assert.equal(ids.filter(id => id === '204').length, 1);
});

test('conversation storage keys are scoped to platform and safe for filesystem paths', () => {
  const key = sessionKey('imessage', '../private/+15555550123');
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.equal(key, sessionKey('imessage', '../private/+15555550123'));
  assert.notEqual(key, sessionKey('terminal', '../private/+15555550123'));
  assert.notEqual(sessionKey('a', 'b\0c'), sessionKey('a\0b', 'c'));
});

test('manual commands do not swallow requests mentioning instructions', () => {
  assert.deepEqual(routeText(' /Instructions '), { kind: 'manual', prompt: '' });
  assert.deepEqual(routeText('make the instructions simpler'), { kind: 'design', prompt: 'make the instructions simpler' });
  assert.deepEqual(routeText('/new a red rocket'), { kind: 'new', prompt: 'a red rocket' });
  assert.deepEqual(routeText('/new'), { kind: 'new', prompt: '' });
});

test('/open accepts a saved ID and rejects paths, URLs, missing IDs, and extra arguments', () => {
  assert.deepEqual(routeText(`/open ${savedBuild.id}`), { kind: 'open', designId: savedBuild.id, prompt: '' });
  for (const command of ['/open', '/open ../secrets', '/open https://example.com/design', '/open id another-id']) {
    assert.throws(() => routeText(command), /design ID/);
  }
});

test('imported owned inventory survives a session restart and remains detached from the web snapshot', () => {
  const inventory = [{ partId: '3001', colorId: 4, quantity: 3, source: 'My set' }];
  const imported = importSavedDesign({ handledIds: ['open-message'], pendingImage: { data: 'YQ==', mimeType: 'image/png' } }, { ...savedBuild, inventory });
  inventory[0].quantity = 99;
  const restored = parseConversation(JSON.parse(JSON.stringify(imported)));
  assert.equal(restored.designId, savedBuild.id);
  assert.equal(restored.inventory![0].quantity, 3);
  assert.equal(restored.pendingImage, undefined);
  assert.deepEqual(inventoryContext(restored), {
    inventory: [{ partId: '3001', colorId: 4, quantity: 3, source: 'My set' }], inventoryMode: 'owned',
  });
  assert.deepEqual(restored.handledIds, ['open-message']);
});

test('opening a design replaces old inventory, and absent or empty snapshots use unlimited mode', () => {
  const previous = { designId: 'older', inventory: [{ partId: '3001', colorId: 4, quantity: 3, source: 'Old set' }], handledIds: [] };
  for (const saved of [savedBuild, { ...savedBuild, inventory: [] }]) {
    const imported = importSavedDesign(previous, saved);
    assert.equal(inventoryContext(imported).inventoryMode, 'unlimited');
    assert.equal(imported.inventory?.length ?? 0, 0);
  }
  assert.equal(previous.inventory[0].quantity, 3);
});

test('malformed persisted inventory fails closed instead of enabling unlimited generation', () => {
  const row = { partId: '3001', colorId: 4, quantity: 3, source: 'My set' };
  for (const invalid of [null, 'unlimited', [{ ...row, quantity: -1 }], [{ ...row, partId: '__proto__' }], [{ ...row, quantity: 1.5 }]]) {
    assert.throws(() => parseConversation({ handledIds: [], inventory: invalid }), /inventory is invalid/);
    assert.throws(() => importSavedDesign({ handledIds: [] }, { ...savedBuild, inventory: invalid }), /inventory is invalid/);
  }
  assert.throws(() => parseConversation({ designId: '../escape', handledIds: [] }), /design ID/);
  assert.throws(() => importSavedDesign({ handledIds: [] }, { ...savedBuild, bricks: [] }), /design is invalid/);
  const clean = parseConversation({ handledIds: [], ignored: 'do not persist', inventory: [{ ...row, extra: 'do not persist' }] });
  assert.equal(Object.hasOwn(clean, 'ignored'), false);
  assert.equal(Object.hasOwn(clean.inventory![0], 'extra'), false);
});

test('actual Spectrum group shape combines a caption with its image', async () => {
  const content: Content = {
    type: 'group', items: [
      { id: 'text-1', direction: 'inbound', content: { type: 'text', text: 'Make this flower' } } as Message,
      { id: 'image-1', direction: 'inbound', content: photo([Buffer.from('photo bytes')]) } as Message,
    ],
  };
  const input = await extractMessageInput(content);
  assert.equal(input.prompt, 'Make this flower');
  assert.equal(Buffer.from(input.image!.data, 'base64').toString(), 'photo bytes');
  assert.deepEqual(contentMessageIds('album-1', content), ['album-1', 'text-1', 'image-1']);
});

test('oversized metadata rejects a photo before downloading it', async () => {
  const attachment = photo([], { size: MAX_IMAGE_BYTES + 1 });
  if (attachment.type !== 'attachment') throw new Error('test fixture');
  attachment.stream = async () => { throw new Error('must not download'); };
  await assert.rejects(extractMessageInput(attachment), /too large/);
});

test('a photo with absent or inaccurate size is capped while streaming', async () => {
  let cancelled = false;
  await assert.rejects(extractMessageInput(photo([
    new Uint8Array(MAX_IMAGE_BYTES), new Uint8Array(1), new Uint8Array(1),
  ], { onCancel: () => { cancelled = true; } })), /too large/);
  assert.equal(cancelled, true);
});

test('non-image attachments and multiple photos return an actionable input error', async () => {
  await assert.rejects(extractMessageInput(photo([], { mimeType: 'application/pdf' })), /JPEG/);
  const content: Content = { type: 'group', items: [1, 2].map(id => ({
    id: String(id), direction: 'inbound', content: photo([new Uint8Array(1)]),
  } as Message)) };
  await assert.rejects(extractMessageInput(content), /one photo at a time/);
});

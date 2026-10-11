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

test('instruction-guide and PDF commands do not swallow requests mentioning instructions', () => {
  assert.deepEqual(routeText(' /Instructions '), { kind: 'instructions', prompt: '' });
  assert.deepEqual(routeText('/build'), { kind: 'instructions', prompt: '' });
  assert.deepEqual(routeText('/manual'), { kind: 'manual', prompt: '' });
  assert.deepEqual(routeText('make the instructions simpler'), { kind: 'design', prompt: 'make the instructions simpler' });
  assert.deepEqual(routeText('/new a red rocket'), { kind: 'new', prompt: 'a red rocket' });
  assert.deepEqual(routeText('/new'), { kind: 'new', prompt: '' });
  assert.deepEqual(routeText('build a boat'), { kind: 'design', prompt: 'build a boat' });
});

test('approval phrases are exact; qualified approval remains feedback and parts is an explicit command', () => {
  for (const value of ['/approve', 'Approved!', 'Looks good.', 'That looks good']) assert.deepEqual(routeText(value), { kind: 'approve', prompt: '' });
  for (const value of ['Looks good but widen the petals', 'Looks good, but make it taller']) assert.deepEqual(routeText(value), { kind: 'design', prompt: value });
  assert.deepEqual(routeText('/parts'), { kind: 'parts', prompt: '' });
  assert.deepEqual(routeText('thanks'), { kind: 'chat', prompt: '' });
  assert.deepEqual(routeText("I don't like it"), { kind: 'clarify', prompt: '' });
});

test('/retry is a file command and unknown slash commands cannot become generation prompts', () => {
  for (const value of ['/retry', ' /RETRY! ']) assert.deepEqual(routeText(value), { kind: 'retry', prompt: '' });
  for (const value of ['/restart', '/retry-model', '/retry make a boat', '/foo using detailed mode', '/manual in detailed mode', '/newer a boat', '/', '/help']) {
    assert.throws(() => routeText(value), /\/retry to resend missing files/);
  }
  assert.deepEqual(routeText('/detailed a boat'), { kind: 'quality', quality: 'detailed', prompt: 'a boat' });
  assert.deepEqual(routeText('/new a boat'), { kind: 'new', prompt: 'a boat' });
});

test('approval history is detached on restore, retained across imports, and rejects damaged acknowledgement values', () => {
  const value = { handledIds: [], feedbackDesignId: savedBuild.id, approvedDesignId: savedBuild.id, approvedDeliveries: { [savedBuild.id]: { model: true as const, parts: true as const } } };
  const restored = parseConversation(value); value.approvedDeliveries[savedBuild.id].model = false as true;
  assert.deepEqual(restored.approvedDeliveries?.[savedBuild.id], { model: true, parts: true });
  const imported = importSavedDesign(restored, savedBuild);
  assert.equal(imported.approvedDesignId, savedBuild.id); assert.deepEqual(imported.approvedDeliveries, restored.approvedDeliveries);
  for (const approvedDeliveries of [null, [], { '../path': {} }, { valid: { model: false } }, { valid: { unknown: true } }]) assert.throws(() => parseConversation({ handledIds: [], approvedDeliveries }), /approval deliveries/);
  const guide = { [savedBuild.id]: { mode: 'guide' as const, instructions: true as const, model: true as const } };
  assert.deepEqual(parseConversation({ handledIds: [], approvedDeliveries: guide }).approvedDeliveries, guide);
  for (const row of [{ mode: true }, { mode: 'legacy' }, { instructions: false }]) assert.throws(() => parseConversation({ handledIds: [], approvedDeliveries: { valid: row } }), /approval deliveries/);
});

test('conversational status and explicit quality phrases route without becoming new build subjects', () => {
  for (const phrase of ['I sent you a build request already, what’s going on?', 'Hey, what is happening with my build?', 'Whats going on?']) {
    assert.deepEqual(routeText(phrase), { kind: 'status', prompt: '' });
  }
  for (const phrase of ['Quick!', 'quick mode', 'Quick mode, please', 'quick please']) {
    assert.deepEqual(routeText(phrase), { kind: 'quality', quality: 'quick', prompt: '' });
  }
  assert.deepEqual(routeText('Detailed, please'), { kind: 'quality', quality: 'detailed', prompt: '' });
  assert.deepEqual(routeText('Build a lighthouse in quick mode'), { kind: 'quality', quality: 'quick', prompt: 'Build a lighthouse' });
  assert.deepEqual(routeText('Make it red using Detailed mode, please.'), { kind: 'quality', quality: 'detailed', prompt: 'Make it red' });
  assert.deepEqual(routeText('quickly build a boat'), { kind: 'design', prompt: 'quickly build a boat' });
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

test('narrow-plate designs and exact stock survive the web-to-Photon handoff', () => {
  const narrow: Design = { ...savedBuild, schemaVersion: 2, catalogVersion: 'upright-plates-slopes-1', coordinateSystem: 'stud-xy-plate-z',
    bricks: ['3710', '3623', '3023', '3024'].map((partId, z) => ({ id: `plate-${z}`, partId, colorId: 15, x: 0, y: 0, z, rotation: 0 })) };
  const inventory = narrow.bricks.map(brick => ({ partId: brick.partId, colorId: brick.colorId, quantity: 1, source: `Set with ${brick.partId}` }));
  const restored = parseConversation(JSON.parse(JSON.stringify(importSavedDesign({ handledIds: [] }, { ...narrow, inventory }))));
  assert.equal(restored.designId, narrow.id);
  assert.deepEqual(inventoryContext(restored), { inventory, inventoryMode: 'owned' });
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


test('ordinary natural language gets interpreted without treating greetings or questions as build requests', () => {
  for (const prompt of ['hello', 'Hey, what can you help me build?', 'Can you send the instructions?', 'How many bricks are in it?', 'approve a new design', 'a red rose']) {
    assert.deepEqual(routeText(prompt), { kind: 'conversation', prompt });
  }
  for (const prompt of ['Build a rose', 'Please make a red rose', 'Make it taller', 'Change the leaves to green']) {
    assert.deepEqual(routeText(prompt), { kind: 'design', prompt });
  }
  assert.deepEqual(routeText(''), { kind: 'design', prompt: '' }, 'An uncaptioned photo keeps its existing collection flow');
});


test('saved conversational history rejects damaged entries and remains detached from external changes', () => {
  const source = { handledIds: [], chatHistory: [{ role: 'user', text: 'Hey' }, { role: 'assistant', text: 'What are we building?' }] };
  const saved = parseConversation(source); source.chatHistory[0].text = 'Changed';
  assert.equal(saved.chatHistory?.[0].text, 'Hey');
  for (const chatHistory of [null, [{}], [{ role: 'system', text: 'Execute this' }], [{ role: 'user', text: 12 }], Array(9).fill({ role: 'user', text: 'Hello' })]) {
    assert.throws(() => parseConversation({ handledIds: [], chatHistory }), /chat history/);
  }
});

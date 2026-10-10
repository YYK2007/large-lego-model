import { createHash } from 'node:crypto';
import type { Content } from 'spectrum-ts';
import { COLORS, PARTS, validateDesign, type Design, type InventoryItem } from '../shared/model.js';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MESSAGE_HISTORY_LIMIT = 200;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface PhotonImage {
  data: string;
  mimeType: string;
}

export interface Conversation {
  designId?: string;
  inventory?: InventoryItem[];
  pendingImage?: PhotonImage;
  handledIds: string[];
}

export class PhotonInputError extends Error {}

export function sessionKey(platform: string, spaceId: string): string {
  return createHash('sha256').update(JSON.stringify([platform, spaceId])).digest('hex');
}

export function shouldHandleMessage(direction: string, id: string, handledIds: string[]): boolean {
  return direction === 'inbound' && !handledIds.includes(id);
}

export function rememberMessageIds(handledIds: string[], ids: string[]): string[] {
  return [...new Set([...handledIds, ...ids])].slice(-MESSAGE_HISTORY_LIMIT);
}

type PhotonCommand = { kind: 'manual' | 'new' | 'design'; prompt: string } | { kind: 'open'; designId: string; prompt: '' };
const validDesignId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);

export function routeText(text: string): PhotonCommand {
  const prompt = text.trim();
  if (/^\/?(?:manual|instructions)$/i.test(prompt)) return { kind: 'manual', prompt: '' };
  const open = /^\/open(?:\s+([\s\S]*))?$/i.exec(prompt);
  if (open) {
    const designId = open[1]?.trim();
    if (!validDesignId(designId)) throw new PhotonInputError('Send /open followed by the design ID copied from the web app.');
    return { kind: 'open', designId, prompt: '' };
  }
  const fresh = /^\/new(?:\s+([\s\S]*))?$/i.exec(prompt);
  if (fresh) return { kind: 'new', prompt: fresh[1]?.trim() ?? '' };
  return { kind: 'design', prompt };
}

function inventorySnapshot(value: unknown): InventoryItem[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 500) throw new PhotonInputError('The saved inventory is invalid. Save a corrected inventory in the web app first.');
  return value.map(item => {
    if (!item || typeof item !== 'object' || typeof item.partId !== 'string' || !Object.hasOwn(PARTS, item.partId)
      || !Number.isInteger(item.colorId) || !Object.hasOwn(COLORS, item.colorId)
      || !Number.isInteger(item.quantity) || item.quantity < 0 || item.quantity > 10000
      || typeof item.source !== 'string' || item.source.length > 120) {
      throw new PhotonInputError('The saved inventory is invalid. Save a corrected inventory in the web app first.');
    }
    return { partId: item.partId, colorId: item.colorId, quantity: item.quantity, source: item.source };
  });
}

/** Reject damaged inventory instead of silently switching an owned build to unlimited pieces. */
export function parseConversation(value: unknown): Conversation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid saved conversation.');
  const data = value as Record<string, unknown>;
  if (!Array.isArray(data.handledIds) || data.handledIds.some(id => typeof id !== 'string')) throw new Error('Invalid saved message history.');
  if (data.designId !== undefined && !validDesignId(data.designId)) throw new Error('Invalid saved design ID.');
  let pendingImage: PhotonImage | undefined;
  if (data.pendingImage !== undefined) {
    const image = data.pendingImage as Partial<PhotonImage> | null;
    if (!image || typeof image.data !== 'string' || image.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data) || typeof image.mimeType !== 'string' || !IMAGE_TYPES.has(image.mimeType)) {
      throw new Error('Invalid saved image.');
    }
    pendingImage = { data: image.data, mimeType: image.mimeType };
  }
  return {
    ...(data.designId ? { designId: data.designId as string } : {}),
    inventory: inventorySnapshot(data.inventory),
    ...(pendingImage ? { pendingImage } : {}),
    handledIds: rememberMessageIds([], data.handledIds as string[]),
  };
}

export function importSavedDesign(conversation: Conversation, value: unknown): Conversation {
  const saved = value as Design & { inventory?: unknown };
  if (!saved || !validDesignId(saved.id) || !validateDesign(saved).valid) throw new PhotonInputError('That saved design is invalid. Save it again in the web app.');
  return {
    designId: saved.id,
    inventory: inventorySnapshot(saved.inventory),
    handledIds: [...conversation.handledIds],
  };
}

export function inventoryContext(conversation: Conversation): { inventory?: InventoryItem[]; inventoryMode: 'owned' | 'unlimited' } {
  return { inventory: conversation.inventory, inventoryMode: conversation.inventory?.length ? 'owned' : 'unlimited' };
}

export function contentMessageIds(id: string, content: Content): string[] {
  return content.type === 'group' ? [id, ...content.items.map(item => item.id)] : [id];
}

async function imageFromAttachment(content: Extract<Content, { type: 'attachment' }>): Promise<PhotonImage> {
  if (!IMAGE_TYPES.has(content.mimeType.toLowerCase())) {
    throw new PhotonInputError('Please send a JPEG, PNG, or WebP photo. Convert HEIC photos to JPEG first. Other files cannot be used as design inspiration.');
  }
  const tooLarge = () => new PhotonInputError('That photo is too large. Please send one under 5 MiB.');
  if (content.size !== undefined && content.size > MAX_IMAGE_BYTES) throw tooLarge();

  const reader = (await content.stream()).getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (!(chunk.value instanceof Uint8Array)) throw new PhotonInputError('That photo could not be read. Please send it again.');
      bytes += chunk.value.byteLength;
      if (bytes > MAX_IMAGE_BYTES) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!bytes) throw new PhotonInputError('That photo was empty. Please send it again.');
  return { data: Buffer.concat(chunks).toString('base64'), mimeType: content.mimeType.toLowerCase() };
}

/** Spectrum groups contain full Messages, not bare Content values. */
export async function extractMessageInput(content: Content): Promise<{ prompt: string; image?: PhotonImage }> {
  const texts: string[] = [];
  const attachments: Extract<Content, { type: 'attachment' }>[] = [];
  function visit(item: Content): void {
    if (item.type === 'text') texts.push(item.text);
    else if (item.type === 'attachment') attachments.push(item);
    else if (item.type === 'reply') visit(item.content);
    else if (item.type === 'group') {
      for (const message of item.items) {
        if (message.direction !== 'outbound') visit(message.content);
      }
    }
  }
  visit(content);
  if (attachments.length > 1) throw new PhotonInputError('Please send one photo at a time, with a description of what you want to build.');
  return {
    prompt: texts.join('\n').trim(),
    ...(attachments[0] ? { image: await imageFromAttachment(attachments[0]) } : {}),
  };
}

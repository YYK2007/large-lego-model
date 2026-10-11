import { createHash } from 'node:crypto';
import type { Content } from 'spectrum-ts';
import { resolveCatalog, mergeCatalogManifests, validateDesign, type CatalogManifest, type Design, type InventoryItem } from '../shared/model.js';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MESSAGE_HISTORY_LIMIT = 200;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface PhotonImage {
  data: string;
  mimeType: string;
}
export type PhotonQuality = 'quick' | 'detailed';
export type PendingPhotonRequest = { kind: 'new' | 'design'; prompt: string; image?: PhotonImage };
export type ApprovedDelivery = Partial<Record<'model' | 'manual' | 'parts', true>>;

export interface Conversation {
  designId?: string;
  inventory?: InventoryItem[];
  inventoryCatalog?: CatalogManifest;
  pendingImage?: PhotonImage;
  handledIds: string[];
  spaceId?: string;
  jobId?: string;
  lastAttempt?: number;
  lastDraftId?: string;
  finishedJobId?: string;
  requestPrompt?: string;
  quality?: PhotonQuality;
  pendingRequest?: PendingPhotonRequest;
  pendingQuality?: PhotonQuality;
  lastDeliveryAt?: number;
  lastProgressAt?: number;
  lastProgressKey?: string;
  feedbackDesignId?: string;
  approvedDesignId?: string;
  approvedDeliveries?: Record<string, ApprovedDelivery>;
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

type PhotonCommand = { kind: 'manual' | 'model' | 'parts' | 'approve' | 'retry' | 'clarify' | 'stop' | 'status' | 'chat' | 'new' | 'design'; prompt: string } | { kind: 'open'; designId: string; prompt: '' } | { kind: 'use'; attempt: number; prompt: '' } | { kind: 'quality'; quality: PhotonQuality; prompt: string };
const validDesignId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
const commandHelp = 'I don’t recognize that command. Use /status for progress, /stop to stop generation, /approve to accept a checked preview, or /retry to resend missing files from your approved build. /model, /manual and /parts request a copy. Send /new followed by an idea to start another build.';

/** Only clear edits reuse a build's mode; a new subject still gets a choice. */
export function isRevisionPrompt(prompt: string): boolean {
  return /^(?:make|turn|keep|paint)\s+(?:it|this|that|them|the (?:build|model))\b/i.test(prompt)
    || /^(?:make|keep)\s+the\b.+\b(?:taller|shorter|bigger|larger|smaller|wider|narrower|thicker|thinner|simpler|more|less)\b/i.test(prompt)
    || /^(?:add|remove|replace|adjust|change|move|enlarge|shrink|increase|decrease|reduce)\b/i.test(prompt)
    || /^(?:looks good|this looks good|that looks good|i like it)[, ]+but\b/i.test(prompt)
    || /^(?:can|could) you\s+(?:make it|add|remove|replace|adjust|change|move)\b/i.test(prompt);
}

export function routeText(text: string): PhotonCommand {
  const prompt = text.trim();
  const natural = prompt.toLowerCase().replace(/[’]/g, "'").replace(/[?!.]+$/, '').trim();
  if (prompt.startsWith('/') && !['approve', 'retry', 'manual', 'instructions', 'stop', 'cancel', 'status', 'model', '3d', 'parts', 'use', 'open', 'new', 'quick', 'detailed'].includes(/^\/([a-z0-9]+)/i.exec(prompt)?.[1].toLowerCase() ?? '')) throw new PhotonInputError(commandHelp);
  if (natural === '/retry') return { kind: 'retry', prompt: '' };
  if (['/approve', 'approve', 'approved', 'i approve this build', 'looks good', 'this looks good', 'that looks good'].includes(natural)) return { kind: 'approve', prompt: '' };
  if (/^(?:i (?:don't|do not) like (?:it|this)|(?:it|this|that) (?:looks (?:bad|wrong)|(?:isn't|is not) (?:right|good))|(?:it|this|that) (?:doesn't|does not) look right|not (?:right|good)|try again|no)$/.test(natural)) return { kind: 'clarify', prompt: '' };
  if (/\bwhat(?:'s| is|s) (?:going on|happening)\b/.test(natural)) return { kind: 'status', prompt: '' };
  if (['status', '/status', 'update', 'progress', 'any update', 'any updates', 'are you working', 'are you still working', 'still working', 'is it ready', 'is it done', 'are you done', 'how is it going', "how's it going", 'how long', 'how much longer', "what's happening"].includes(natural)) return { kind: 'status', prompt: '' };
  if (/^(?:ok(?:ay)?|thanks|thank you|cool|great|sounds good|yes|yep|sure)$/.test(natural)) return { kind: 'chat', prompt: '' };
  const quality = /^\/?(quick|detailed)(?=$|[\s:,.!-])(?:\s*[:,-]\s*|\s+)?(.*)$/i.exec(prompt);
  if (quality) return { kind: 'quality', quality: quality[1].toLowerCase() as PhotonQuality, prompt: /^(?:mode)?(?:[, ]*please)?[.!]*$/i.test(quality[2].trim()) ? '' : quality[2].trim() };
  const modeSuffix = /^(.*?)\s+(?:in|using)\s+(quick|detailed)\s+mode(?:,?\s+please)?[.!]?$/i.exec(prompt);
  if (modeSuffix && !prompt.startsWith('/')) return { kind: 'quality', quality: modeSuffix[2].toLowerCase() as PhotonQuality, prompt: modeSuffix[1].trim() };
  if (/^\/?(?:manual|instructions)$/i.test(prompt)) return { kind: 'manual', prompt: '' };
  if (/^\/?(?:stop|cancel)$/i.test(prompt)) return { kind: 'stop', prompt: '' };
  if (/^\/?status$/i.test(prompt)) return { kind: 'status', prompt: '' };
  if (/^\/?(?:model|3d)$/i.test(prompt)) return { kind: 'model', prompt: '' };
  if (/^\/?(?:parts|parts list)$/i.test(prompt)) return { kind: 'parts', prompt: '' };
  const use = /^\/?use(?:\s+(\d+))?$/i.exec(prompt);
  if (use) {
    const attempt = Number(use[1]);
    if (!Number.isSafeInteger(attempt) || attempt < 1) throw new PhotonInputError('Send /use followed by a checked attempt number, for example /use 7.');
    return { kind: 'use', attempt, prompt: '' };
  }
  const open = /^\/open(?:\s+([\s\S]*))?$/i.exec(prompt);
  if (open) {
    const designId = open[1]?.trim();
    if (!validDesignId(designId)) throw new PhotonInputError('Send /open followed by the design ID copied from the web app.');
    return { kind: 'open', designId, prompt: '' };
  }
  const fresh = /^\/new(?:\s+([\s\S]*))?$/i.exec(prompt);
  if (fresh) return { kind: 'new', prompt: fresh[1]?.trim() ?? '' };
  if (prompt.startsWith('/')) throw new PhotonInputError(commandHelp);
  return { kind: 'design', prompt };
}

function inventorySnapshot(value: unknown, manifest?: CatalogManifest): InventoryItem[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 500) throw new PhotonInputError('The saved inventory is invalid. Save a corrected inventory in the web app first.');
  const { parts, colors } = resolveCatalog(manifest);
  return value.map(item => {
    if (!item || typeof item !== 'object' || typeof item.partId !== 'string' || !Object.hasOwn(parts, item.partId)
      || !Number.isInteger(item.colorId) || !Object.hasOwn(colors, item.colorId)
      || !Number.isSafeInteger(item.quantity) || item.quantity < 0
      || typeof item.source !== 'string' || item.source.length > 120) {
      throw new PhotonInputError('The saved inventory is invalid. Save a corrected inventory in the web app first.');
    }
    return { partId: item.partId, colorId: item.colorId, quantity: item.quantity, source: item.source };
  });
}

function parseImage(value: unknown): PhotonImage {
  const image = value as Partial<PhotonImage> | null;
  if (!image || typeof image.data !== 'string' || image.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data) || typeof image.mimeType !== 'string' || !IMAGE_TYPES.has(image.mimeType)) throw new Error('Invalid saved image.');
  return { data: image.data, mimeType: image.mimeType };
}

/** Reject damaged inventory instead of silently switching an owned build to unlimited pieces. */
export function parseConversation(value: unknown): Conversation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid saved conversation.');
  const data = value as Record<string, unknown>;
  if (!Array.isArray(data.handledIds) || data.handledIds.some(id => typeof id !== 'string')) throw new Error('Invalid saved message history.');
  if (data.designId !== undefined && !validDesignId(data.designId)) throw new Error('Invalid saved design ID.');
  for (const name of ['jobId', 'lastDraftId', 'finishedJobId', 'feedbackDesignId', 'approvedDesignId']) if (data[name] !== undefined && !validDesignId(data[name])) throw new Error('Invalid saved job or draft ID.');
  let approvedDeliveries: Record<string, ApprovedDelivery> | undefined;
  if (data.approvedDeliveries !== undefined) {
    if (!data.approvedDeliveries || typeof data.approvedDeliveries !== 'object' || Array.isArray(data.approvedDeliveries)) throw new Error('Invalid saved approval deliveries.');
    approvedDeliveries = Object.fromEntries(Object.entries(data.approvedDeliveries).map(([id, value]) => {
      if (!validDesignId(id) || !value || typeof value !== 'object' || Array.isArray(value)
        || Object.entries(value).some(([key, sent]) => !['model', 'manual', 'parts'].includes(key) || sent !== true)) throw new Error('Invalid saved approval deliveries.');
      return [id, { ...value } as ApprovedDelivery];
    }));
  }
  if (data.lastAttempt !== undefined && (!Number.isSafeInteger(data.lastAttempt) || (data.lastAttempt as number) < 0)) throw new Error('Invalid saved attempt number.');
  if (data.spaceId !== undefined && (typeof data.spaceId !== 'string' || !data.spaceId.length || data.spaceId.length > 1000)) throw new Error('Invalid saved conversation address.');
  if (data.requestPrompt !== undefined && (typeof data.requestPrompt !== 'string' || data.requestPrompt.length > 4000)) throw new Error('Invalid saved build prompt.');
  for (const key of ['quality', 'pendingQuality']) if (data[key] !== undefined && !['quick', 'detailed'].includes(data[key] as string)) throw new Error('Invalid saved build quality.');
  for (const key of ['lastDeliveryAt', 'lastProgressAt']) if (data[key] !== undefined && (!Number.isFinite(data[key]) || (data[key] as number) < 0)) throw new Error('Invalid saved progress time.');
  if (data.lastProgressKey !== undefined && (typeof data.lastProgressKey !== 'string' || data.lastProgressKey.length > 100)) throw new Error('Invalid saved progress stage.');
  const inventoryCatalog = data.inventoryCatalog === undefined ? undefined : structuredClone(data.inventoryCatalog) as CatalogManifest;
  resolveCatalog(inventoryCatalog);
  const pendingImage = data.pendingImage === undefined ? undefined : parseImage(data.pendingImage);
  let pendingRequest: PendingPhotonRequest | undefined;
  if (data.pendingRequest !== undefined) {
    const request = data.pendingRequest as Partial<PendingPhotonRequest> | null;
    if (!request || !['new', 'design'].includes(request.kind as string) || typeof request.prompt !== 'string' || request.prompt.length > 4000) throw new Error('Invalid saved pending request.');
    pendingRequest = { kind: request.kind as 'new' | 'design', prompt: request.prompt, ...(request.image === undefined ? {} : { image: parseImage(request.image) }) };
  }
  return {
    ...(data.designId ? { designId: data.designId as string } : {}),
    inventory: inventorySnapshot(data.inventory, inventoryCatalog),
    ...(inventoryCatalog ? { inventoryCatalog } : {}),
    ...(pendingImage ? { pendingImage } : {}),
    handledIds: rememberMessageIds([], data.handledIds as string[]),
    ...(data.spaceId ? { spaceId: data.spaceId as string } : {}),
    ...(data.jobId ? { jobId: data.jobId as string } : {}),
    ...(data.lastDraftId ? { lastDraftId: data.lastDraftId as string } : {}),
    ...(data.feedbackDesignId ? { feedbackDesignId: data.feedbackDesignId as string } : {}),
    ...(data.approvedDesignId ? { approvedDesignId: data.approvedDesignId as string } : {}),
    ...(approvedDeliveries ? { approvedDeliveries } : {}),
    ...(data.finishedJobId ? { finishedJobId: data.finishedJobId as string } : {}),
    ...(data.lastAttempt !== undefined ? { lastAttempt: data.lastAttempt as number } : {}),
    ...(data.requestPrompt ? { requestPrompt: data.requestPrompt as string } : {}),
    ...(data.quality ? { quality: data.quality as PhotonQuality } : {}),
    ...(data.pendingQuality ? { pendingQuality: data.pendingQuality as PhotonQuality } : {}),
    ...(pendingRequest ? { pendingRequest } : {}),
    ...(data.lastDeliveryAt !== undefined ? { lastDeliveryAt: data.lastDeliveryAt as number } : {}),
    ...(data.lastProgressAt !== undefined ? { lastProgressAt: data.lastProgressAt as number } : {}),
    ...(data.lastProgressKey ? { lastProgressKey: data.lastProgressKey as string } : {}),
  };
}

export function importSavedDesign(conversation: Conversation, value: unknown): Conversation {
  const saved = value as Design & { inventory?: unknown; inventoryCatalog?: CatalogManifest };
  if (!saved || !validDesignId(saved.id) || !validateDesign(saved).valid) throw new PhotonInputError('That saved design is invalid. Save it again in the web app.');
  const inventoryCatalog = mergeCatalogManifests(saved.inventoryCatalog, saved.catalog);
  return {
    designId: saved.id,
    inventory: inventorySnapshot(saved.inventory, inventoryCatalog),
    ...(Object.keys(inventoryCatalog.parts).length || Object.keys(inventoryCatalog.colors).length ? { inventoryCatalog } : {}),
    handledIds: [...conversation.handledIds],
    ...(conversation.quality ? { quality: conversation.quality } : {}),
    ...(conversation.approvedDesignId ? { approvedDesignId: conversation.approvedDesignId } : {}),
    ...(conversation.approvedDeliveries ? { approvedDeliveries: structuredClone(conversation.approvedDeliveries) } : {}),
    ...(conversation.spaceId ? { spaceId: conversation.spaceId } : {}),
  };
}

export function inventoryContext(conversation: Conversation): { inventory?: InventoryItem[]; inventoryCatalog?: CatalogManifest; inventoryMode: 'owned' | 'unlimited' } {
  return { inventory: conversation.inventory, ...(conversation.inventory?.length && conversation.inventoryCatalog ? { inventoryCatalog: conversation.inventoryCatalog } : {}), inventoryMode: conversation.inventory?.length ? 'owned' : 'unlimited' };
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

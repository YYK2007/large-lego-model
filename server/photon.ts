import 'dotenv/config';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { Spectrum, attachment, type Message, type Space } from 'spectrum-ts';
import { imessage } from 'spectrum-ts/providers/imessage';
import { renderDesignSvg } from '../shared/illustration.js';
import { validateDesign, type Design, type InventoryItem } from '../shared/model.js';
import { generateDesign } from './generation.js';
import { generateManualPdf } from './manual.js';
import { generateUsdz } from './native-model.js';
import { loadDesign, saveDesign } from './store.js';
import {
  PhotonInputError, contentMessageIds, extractMessageInput, rememberMessageIds,
  importSavedDesign, inventoryContext, parseConversation, routeText, sessionKey,
  shouldHandleMessage, type Conversation,
} from './photon-routing.js';

const sessionsDirectory = resolve('data/photon-sessions');

async function loadConversation(key: string): Promise<Conversation> {
  try {
    return parseConversation(JSON.parse(await readFile(resolve(sessionsDirectory, `${key}.json`), 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { handledIds: [] };
    throw error;
  }
}

async function saveConversation(key: string, conversation: Conversation): Promise<void> {
  await mkdir(sessionsDirectory, { recursive: true, mode: 0o700 });
  const path = resolve(sessionsDirectory, `${key}.json`);
  await writeFile(`${path}.tmp`, JSON.stringify(parseConversation(conversation)), { mode: 0o600 });
  await rename(`${path}.tmp`, path);
}

async function sendManual(space: Space, design: Design, inventory?: InventoryItem[]): Promise<void> {
  const pdf = await generateManualPdf(design, inventory);
  await space.send(attachment(pdf, { name: 'large-lego-model-instructions.pdf', mimeType: 'application/pdf' }));
}

async function handleMessage(space: Space, message: Message, publicBaseUrl?: string): Promise<void> {
  const key = sessionKey(message.platform, space.id);
  let conversation = await loadConversation(key);
  if (!shouldHandleMessage(message.direction, message.id, conversation.handledIds)) return;

  // Claim before side effects: a reconnect must not generate/send the same build twice.
  conversation.handledIds = rememberMessageIds(conversation.handledIds, contentMessageIds(message.id, message.content));
  await saveConversation(key, conversation);
  try {
    const input = await extractMessageInput(message.content);
    if (!input.prompt && !input.image) return; // Tapbacks, receipts, and other conversation events.
    const command = routeText(input.prompt);
    if (command.kind === 'open') {
      const saved = await loadDesign(command.designId);
      if (!saved) throw new PhotonInputError('I could not find that design. Copy its /open command from the web app and try again.');
      conversation = importSavedDesign(conversation, saved);
      await saveConversation(key, conversation);
      const pieces = conversation.inventory?.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
      await space.send(`Opened ${saved.title}.${conversation.inventory?.length ? ` I will keep future builds within your saved inventory of ${pieces} bricks.` : ' This design has no saved owned-brick inventory.'}\nReply with a change, or send “manual” for its instructions.`);
      return;
    }
    const current = conversation.designId ? await loadDesign(conversation.designId) : null;

    if (command.kind === 'manual') {
      if (!current) await space.send('Tell me what you want to build first, then send “manual” for its instructions.');
      else await space.responding(() => sendManual(space, current, conversation.inventory));
      return;
    }

    if (command.kind === 'new' && !command.prompt) {
      delete conversation.designId;
      delete conversation.pendingImage;
      await saveConversation(key, conversation);
    }
    if (input.image) {
      conversation.pendingImage = input.image;
      await saveConversation(key, conversation);
    }
    if (!command.prompt) {
      await saveConversation(key, conversation);
      await space.send(input.image
        ? 'What would you like to build from this photo? I can use it as inspiration. A photo does not give me a verified inventory of your bricks.'
        : 'What would you like to build? Send an idea, or one photo with a description.');
      return;
    }

    await space.responding(async () => {
      const design = await generateDesign({
        prompt: command.prompt,
        image: command.kind === 'new' ? input.image : conversation.pendingImage,
        previous: command.kind === 'new' ? undefined : current ?? undefined,
        ...inventoryContext(conversation),
      });
      const validation = validateDesign(design);
      if (!validation.valid) throw new Error('Generated layout failed validation.');
      await saveDesign({ ...design, inventory: conversation.inventory });
      conversation.designId = design.id;
      delete conversation.pendingImage;
      await saveConversation(key, conversation);

      const preview = await sharp(Buffer.from(renderDesignSvg(design))).png().toBuffer();
      await space.send(`${design.title} · ${design.bricks.length} bricks\n${design.description}\n\nReply with a change, or send “manual” for the PDF. Use /new followed by an idea to start over.\nPhysical stability has not been verified.`);
      await space.send(attachment(preview, { name: 'brick-preview.png', mimeType: 'image/png' }));
      if (publicBaseUrl) {
        const url = new URL('/', publicBaseUrl);
        url.searchParams.set('design', design.id);
        await space.send(`Explore the build in 3D: ${url.toString()}`);
      }
      try {
        const model = await generateUsdz(design);
        await space.send('Tap the attached 3D model to inspect and rotate it on a compatible Apple device. Then tell me what to change, or send “manual”.');
        await space.send(attachment(model, { name: `brick-model-${design.id}.usdz`, mimeType: 'model/vnd.usdz+zip' }));
      } catch {
        console.error(`Photon conversation ${key.slice(0, 12)} could not deliver the native model.`);
        await space.send('The native 3D attachment is unavailable for this reply. You can use the preview above, ask for a change, or send “manual”.');
      }
    });
  } catch (error) {
    // Do not expose provider errors, private prompts, phone numbers, or credentials in logs/replies.
    console.error(`Photon conversation ${key.slice(0, 12)} could not complete a request.`);
    await space.send(error instanceof PhotonInputError
      ? error.message
      : 'I could not finish that request. Please send it again. If a build was already saved, send “manual” to get its instructions.');
  }
}

export async function startPhoton(): Promise<void> {
  const required = ['SPECTRUM_PROJECT_ID', 'SPECTRUM_PROJECT_SECRET', 'GEMINI_API_KEY'] as const;
  const missing = required.filter(name => !process.env[name]?.trim());
  if (missing.length) throw new Error(`Missing ${missing.join(', ')}. Add them to .env; see docs/photon-setup.md. No Photon connection was started.`);

  const publicBaseUrl = process.env.PUBLIC_BASE_URL?.trim() || undefined;
  if (publicBaseUrl) {
    const url = new URL(publicBaseUrl);
    if (url.protocol !== 'https:') throw new Error('PUBLIC_BASE_URL must use HTTPS so phone users can open the viewer.');
  }
  const app = await Spectrum({
    projectId: process.env.SPECTRUM_PROJECT_ID!,
    projectSecret: process.env.SPECTRUM_PROJECT_SECRET!,
    providers: [imessage.config()],
  });
  const pending = new Map<string, Promise<void>>();
  const stop = () => { void app.stop(); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  console.log('Large Lego Model is listening through Photon. Incoming messages will receive real replies.');
  try {
    for await (const [space, message] of app.messages) {
      if (message.direction === 'outbound') continue;
      const key = sessionKey(message.platform, space.id);
      const task = (pending.get(key) ?? Promise.resolve())
        .then(() => handleMessage(space, message, publicBaseUrl))
        .catch(() => { console.error(`Photon conversation ${key.slice(0, 12)} failed; send a fresh message to retry.`); });
      pending.set(key, task);
      void task.then(() => { if (pending.get(key) === task) pending.delete(key); });
    }
  } finally {
    await Promise.all(pending.values());
    await app.stop();
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  startPhoton().catch(error => {
    const missingSetup = error instanceof Error && /^(Missing |PUBLIC_BASE_URL)/.test(error.message);
    console.error(missingSetup ? error.message : 'Photon could not start. Check the dashboard project, line, credentials, and network connection.');
    process.exitCode = 1;
  });
}

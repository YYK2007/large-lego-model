import 'dotenv/config';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import sharp from 'sharp';
import { Spectrum, attachment, type Space } from 'spectrum-ts';
import { imessage } from 'spectrum-ts/providers/imessage';
import { photonJobsApi } from './photon-api.js';
import { PhotonConversation, type PhotonReply } from './photon-conversation.js';
import { PhotonInputError, parseConversation, sessionKey, type Conversation } from './photon-routing.js';
import { compactUsdz } from './usdz-package.js';

const sessionsDirectory = resolve('data/photon-sessions');
async function loadConversation(key: string): Promise<Conversation> {
  try { return parseConversation(JSON.parse(await readFile(resolve(sessionsDirectory, `${key}.json`), 'utf8'))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { handledIds: [] }; throw error; }
}
async function saveConversation(key: string, conversation: Conversation): Promise<void> {
  await mkdir(sessionsDirectory, { recursive: true, mode: 0o700 });
  const path = resolve(sessionsDirectory, `${key}.json`), temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(parseConversation(conversation)), { mode: 0o600 });
  await rename(temporary, path);
}
// The installed Photon gRPC transport caps a request at 100 MiB. Leave room
// for the filename and protobuf envelope; this limits delivery, not the build.
export const PHOTON_FILE_LIMIT = 100 * 1024 * 1024 - 64 * 1024;
export function photonReplies(space: Pick<Space, 'send'>): PhotonReply {
  const sendFile = async (bytes: Buffer, name: string, mimeType: string) => {
    const model = mimeType === 'model/vnd.usdz+zip';
    if (model && bytes.length > 8 * 1024 * 1024) {
      try { bytes = await compactUsdz(bytes); }
      catch { console.error('Photon file preparation failed; keeping the original USDZ.'); }
    }
    const retry = mimeType === 'application/pdf' ? '/manual' : model ? '/model' : '/status';
    const tooLarge = `This ${model ? '3D model' : 'file'} is too large to send through iMessage (${(bytes.length / 1024 / 1024).toFixed(1)} MB). Your checked build is saved. Open its build page to download it${model ? ' using Download 3D (.usdz)' : ''}.`;
    if (bytes.length > PHOTON_FILE_LIMIT) throw new PhotonInputError(tooLarge);
    try { await space.send(attachment(bytes, { name, mimeType })); }
    catch (error) {
      const message = error instanceof Error ? error.message : '';
      const kind = /size larger|too large|message.*length|payload.*size/i.test(message) ? 'size'
        : /timeout|timed out|deadline/i.test(message) ? 'timeout' : 'delivery';
      // Keep useful transport evidence without logging payloads, tokens or contacts.
      const grpcCode = (error as { grpcCode?: unknown } | null)?.grpcCode;
      console.error('Photon attachment failed', { name, bytes: bytes.length, kind, ...(typeof grpcCode === 'number' ? { grpcCode } : {}) });
      if (kind === 'size') throw new PhotonInputError(tooLarge);
      throw new PhotonInputError(`${kind === 'timeout' ? 'The file transfer took too long.' : 'The file couldn’t be sent through iMessage.'} Your checked build is saved. Send ${retry} to retry, or download it from its build page.`);
    }
  };
  return {
    text: async value => { await space.send(value); },
    preview: async svg => { await sendFile(await sharp(svg).png().toBuffer(), 'attempt.png', 'image/png'); },
    designPreview: async design => {
      const bytes = await new Promise<Buffer>((resolve, reject) => {
        const worker = new Worker(new URL('./photon-preview-worker.ts', import.meta.url), { workerData: design });
        worker.once('message', (value: Uint8Array) => resolve(Buffer.from(value)));
        worker.once('error', () => reject(new Error('The preview could not be rendered.')));
        worker.once('exit', code => { if (code !== 0) reject(new Error('The preview worker stopped.')); });
      });
      await sendFile(bytes, 'checked-build.png', 'image/png');
    },
    manual: async bytes => { await sendFile(bytes, 'large-lego-model-instructions.pdf', 'application/pdf'); },
    model: async bytes => {
      await sendFile(bytes, 'large-lego-model.usdz', 'model/vnd.usdz+zip');
      try { await space.send('Tap the 3D file to open and rotate your build.'); }
      catch { console.error('Photon accepted the 3D attachment, but its viewing instructions could not be sent.'); }
    },
  };
}

export async function startPhoton(): Promise<void> {
  const missing = ['SPECTRUM_PROJECT_ID', 'SPECTRUM_PROJECT_SECRET'].filter(name => !process.env[name]?.trim());
  if (missing.length) throw new Error(`Missing ${missing.join(', ')}. Add them to .env; see docs/photon-setup.md. No Photon connection was started.`);
  const publicBaseUrl = process.env.PUBLIC_BASE_URL?.trim() || undefined;
  if (publicBaseUrl) {
    const url = new URL(publicBaseUrl);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('PUBLIC_BASE_URL must use HTTPS without embedded credentials.');
  }
  const apiBaseUrl = process.env.PHOTON_API_BASE_URL?.trim() || 'http://127.0.0.1:3001';
  const api = photonJobsApi(apiBaseUrl);
  // Check the same generation service we will use before subscribing to messages.
  const health = await fetch(new URL('/api/status', apiBaseUrl), { signal: AbortSignal.timeout(10_000) });
  const status = await health.json();
  if (!health.ok || !status.gemini) throw new Error('The build API is unavailable or Gemini is not configured. Start npm run dev first.');
  if (status.photonJobPolicy !== 2) throw new Error('The build API needs the current Photon job policy. Restart it after active work is stopped; no Photon connection was started.');
  const app = await Spectrum({ projectId: process.env.SPECTRUM_PROJECT_ID!, projectSecret: process.env.SPECTRUM_PROJECT_SECRET!, providers: [imessage.config()], options: { logLevel: 'error' } });
  const conversations = new Map<string, PhotonConversation>();
  const loading = new Map<string, Promise<PhotonConversation>>();
  async function connect(space: Space): Promise<PhotonConversation> {
    const key = sessionKey('imessage', space.id);
    if (conversations.has(key)) return conversations.get(key)!;
    if (loading.has(key)) return loading.get(key)!;
    const pending = (async () => {
      const saved = await loadConversation(key); saved.spaceId = space.id;
      const conversation = new PhotonConversation(saved, api, photonReplies(space), value => saveConversation(key, value), publicBaseUrl);
      conversations.set(key, conversation); return conversation;
    })();
    loading.set(key, pending);
    try { return await pending; } finally { loading.delete(key); }
  }
  const pending = new Set<Promise<unknown>>();
  let stopping = false;
  const track = (task: Promise<unknown>) => { pending.add(task); void task.finally(() => pending.delete(task)).catch(() => {}); };
  const stop = () => { stopping = true; void app.stop(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  const polling = setInterval(() => {
    if (!stopping) for (const conversation of conversations.values()) track(conversation.poll().catch(() => {
      // A transient API or send error does not start another paid generation.
    }));
  }, 2000);
  try {
    await mkdir(sessionsDirectory, { recursive: true, mode: 0o700 });
    // Only restore conversations that previously sent us a request, never contacts.
    for (const file of await readdir(sessionsDirectory)) {
      if (!/^[a-f0-9]{64}\.json$/.test(file)) continue;
      try {
        const saved = await loadConversation(file.slice(0, -5));
        if (saved.spaceId && saved.jobId && saved.finishedJobId !== saved.jobId && sessionKey('imessage', saved.spaceId) === file.slice(0, -5)) {
          await connect(await imessage(app).space.get(saved.spaceId));
        }
      } catch { console.error('A saved Photon conversation could not reconnect. Incoming messages can retry it.'); }
    }
    console.log('Photon project authenticated and line tokens obtained. Subscribing to inbound messages; a phone round trip is not yet verified.');
    for await (const [space, message] of app.messages) {
      if (stopping) break;
      if (message.direction !== 'inbound' || message.platform !== 'imessage') continue;
      const task = connect(space).then(conversation => conversation.handle(message)).catch(() => { console.error('A Photon conversation request could not be completed.'); });
      track(task);
    }
  } finally {
    stopping = true; clearInterval(polling);
    await Promise.allSettled(pending);
    await app.stop();
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  startPhoton().catch(error => {
    const setup = error instanceof Error && /^(Missing |PUBLIC_BASE_URL|PHOTON_API_BASE_URL|The build API)/.test(error.message);
    console.error(setup ? error.message : 'Photon could not start. Check the dashboard project, line, credentials, and network connection.');
    process.exitCode = 1;
  });
}

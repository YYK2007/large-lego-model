import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import express from 'express';
import { allocateInventory, type Design, type InventoryItem } from '../shared/model.js';

const validId = (id: string) => /^[a-zA-Z0-9_-]{1,80}$/.test(id);
export function instructionToken(id: string, secret: Buffer): string {
  if (!validId(id)) throw new Error('Invalid design ID.');
  return createHmac('sha256', secret).update(`instructions:${id}`).digest('base64url');
}

export async function loadInstructionSecret(): Promise<Buffer> {
  const path = resolve('data/instruction-share-key');
  await mkdir(resolve('data'), { recursive: true, mode: 0o700 });
  try { await writeFile(path, randomBytes(32), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const secret = await readFile(path);
  if (secret.length !== 32) throw new Error('Invalid instruction sharing key.');
  return secret;
}

export function instructionUrl(base: string, id: string, secret: Buffer): string | null {
  if (!base) return null;
  const url = new URL(base);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Instruction links require a public HTTPS URL.');
  url.pathname = '/'; url.search = ''; url.hash = '';
  url.searchParams.set('build', id);
  url.searchParams.set('share', instructionToken(id, secret));
  return url.toString();
}

/** A separate loopback listener exposes only signed, read-only instruction URLs. */
export function instructionGateway(app: express.Express, secret: Buffer, load: (id: string) => Promise<(Design & { inventory?: InventoryItem[] }) | null | undefined>) {
  const gateway = express();
  gateway.disable('x-powered-by');
  gateway.use(async (req, res, next) => {
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'HEAD'].includes(req.method)) return res.status(405).end();
    // Build assets contain no credentials or saved user content.
    if (/^\/assets\/[a-zA-Z0-9_.-]+\.(?:js|css|svg|png|webp|woff2)$/.test(req.path)) return app(req, res, next);
    const api = /^\/api\/designs\/([a-zA-Z0-9_-]{1,80})(?:\/(model\.usdz|mobile\.usdz|manual\.pdf|parts\.csv))?$/.exec(req.path);
    const id = req.path === '/' ? String(req.query.build ?? '') : api?.[1] ?? '';
    const supplied = typeof req.query.share === 'string' ? req.query.share : '';
    if (!validId(id) || !/^[a-zA-Z0-9_-]{43}$/.test(supplied)
      || !timingSafeEqual(Buffer.from(supplied), Buffer.from(instructionToken(id, secret)))) return res.status(404).end();
    res.setHeader('Cache-Control', 'private, no-store');
    const design = await load(id);
    if (!design) return res.status(404).end();
    if (api && !api[2]) {
      // The viewer needs geometry, not private prompts, photos or research.
      const { id, title, description, bricks, source, createdAt, schemaVersion, coordinateSystem, catalogVersion, catalog } = design;
      return res.json({ id, title, description, bricks, source, createdAt, schemaVersion, coordinateSystem, catalogVersion, catalog, prompt: '',
        ...(design.inventory ? { allocation: allocateInventory(design, design.inventory) } : {}) });
    }
    return app(req, res, next);
  });
  gateway.use((_error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(500).json({ error: 'The instructions could not be loaded. Please try again.' }));
  return gateway;
}

/** Quick Look can request only a byte range while opening a native model. */
export function sendInstructionFile(req: express.Request, res: express.Response, bytes: Buffer) {
  res.setHeader('Accept-Ranges', 'bytes');
  const ranges = req.range(bytes.length);
  if (ranges === -1) return res.status(416).setHeader('Content-Range', `bytes */${bytes.length}`).end();
  if (Array.isArray(ranges) && ranges.type === 'bytes' && ranges.length === 1) {
    const { start, end } = ranges[0];
    res.status(206).setHeader('Content-Range', `bytes ${start}-${end}/${bytes.length}`);
    return res.send(bytes.subarray(start, end + 1));
  }
  return res.send(bytes);
}

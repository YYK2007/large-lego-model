import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { Design, InventoryItem } from '../shared/model.js';

type ManualInput = { design: Design; inventory?: InventoryItem[] };
const pending = new Map<string, Promise<Buffer>>();
let queue: Promise<void> = Promise.resolve();
const CACHE_VERSION = 'manual-v4-repeated-placements';
const cacheDirectory = resolve('data/manual-cache');

async function cachedManual(input: ManualInput, key: string): Promise<Buffer> {
  const filename = resolve(cacheDirectory, `${CACHE_VERSION}-${key}.pdf`);
  try {
    const bytes = await readFile(filename);
    if (bytes.subarray(0, 5).toString() === '%PDF-' && bytes.subarray(-20).includes(Buffer.from('%%EOF'))) return bytes;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  // Disk hits never wait behind another design's potentially long render.
  const result = queue.then(async () => {
    const pdf = await renderInWorker(input);
    await mkdir(cacheDirectory, { recursive: true });
    const temporary = `${filename}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, pdf);
      await rename(temporary, filename);
    } finally {
      await rm(temporary, { force: true });
    }
    return pdf;
  });
  queue = result.then(() => {}, () => {});
  return result;
}

function renderInWorker(input: ManualInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./manual-worker.ts', import.meta.url), { workerData: input });
    let pdf: Buffer | undefined;
    worker.once('message', (bytes: Uint8Array) => { pdf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength); });
    worker.once('error', reject);
    worker.once('exit', code => {
      if (code === 0 && pdf) resolve(pdf);
      else reject(new Error('The instruction export stopped before it finished. Please try again.'));
    });
  });
}

/** Keep expensive diagrams off the API thread and render one manual at a time. */
export function generateManualPdf(design: Design, inventory?: InventoryItem[]): Promise<Buffer> {
  // Freeze the exact request now, even when another manual is ahead of it.
  const input = structuredClone({ design, inventory });
  const key = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const existing = pending.get(key);
  if (existing) return existing;
  const result = cachedManual(input, key);
  pending.set(key, result);
  const forget = () => { pending.delete(key); };
  result.then(forget, forget);
  return result;
}

import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import type { Design, InventoryItem } from '../shared/model.js';

type ManualInput = { design: Design; inventory?: InventoryItem[] };
const pending = new Map<string, Promise<Buffer>>();
let queue: Promise<void> = Promise.resolve();

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
  const result = queue.then(() => renderInWorker(input));
  queue = result.then(() => {}, () => {});
  pending.set(key, result);
  const forget = () => { pending.delete(key); };
  result.then(forget, forget);
  return result;
}

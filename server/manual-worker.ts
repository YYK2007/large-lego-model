import { parentPort, workerData } from 'node:worker_threads';
import { renderManualPdf } from './manual-render.js';
import type { Design, InventoryItem } from '../shared/model.js';

const { design, inventory } = workerData as { design: Design; inventory?: InventoryItem[] };
const pdf = await renderManualPdf(design, inventory);
// Use an owned buffer so even a small PDF cannot expose or transfer Node's shared pool.
const bytes = new Uint8Array(pdf);
parentPort!.postMessage(bytes, [bytes.buffer]);

import { parentPort, workerData } from 'node:worker_threads';
import sharp from 'sharp';
import { renderDesignSvg } from '../shared/illustration.js';

// Keep potentially expensive painter ordering off the message listener thread.
const svg = renderDesignSvg(workerData, { width: 960, height: 720 });
parentPort!.postMessage(await sharp(Buffer.from(svg)).png().toBuffer());
parentPort!.close();

import { parentPort, workerData } from 'node:worker_threads';
import { validateDesign } from '../shared/model.js';

parentPort!.postMessage(validateDesign(workerData).valid);
parentPort!.close();

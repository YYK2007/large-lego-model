import { createHash } from 'node:crypto';
import type { EventEmitter } from 'node:events';
import { Worker } from 'node:worker_threads';
import type { Design } from '../shared/model.js';

type ValidationWorker = Pick<EventEmitter, 'once'>;
const checkFailed = () => new Error('The saved build could not be checked. Please try again; your selected build is unchanged.');

/** Keep assembly search off the listener, sharing only successful exact-snapshot checks. */
export function createPhotonDesignValidator(startWorker: (design: Design) => ValidationWorker = design =>
  new Worker(new URL('./photon-validation-worker.ts', import.meta.url), { workerData: design })) {
  const successful = new Set<string>();
  const pending = new Map<string, Promise<boolean>>();
  let queue: Promise<unknown> = Promise.resolve();
  return (design: Design): Promise<boolean> => {
    // Pin both placements and imported geometry/colors before queuing the check.
    const snapshot = structuredClone(design);
    const key = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
    if (successful.has(key)) {
      successful.delete(key); successful.add(key);
      return Promise.resolve(true);
    }
    const existing = pending.get(key);
    if (existing) return existing;
    const result = queue.then(() => new Promise<boolean>((resolve, reject) => {
      let worker: ValidationWorker;
      try { worker = startWorker(snapshot); } catch { reject(checkFailed()); return; }
      let valid: unknown;
      worker.once('message', value => { valid = value; });
      worker.once('error', () => reject(checkFailed()));
      worker.once('exit', code => {
        if (code === 0 && typeof valid === 'boolean') resolve(valid);
        else reject(checkFailed());
      });
    })).then(valid => {
      if (valid) {
        successful.add(key);
        if (successful.size > 32) successful.delete(successful.values().next().value!);
      }
      return valid;
    });
    queue = result.catch(() => {});
    pending.set(key, result);
    const forget = () => { pending.delete(key); };
    result.then(forget, forget);
    return result;
  };
}

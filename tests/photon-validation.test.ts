import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import test from 'node:test';
import { createPhotonDesignValidator } from '../server/photon-validation.js';
import { photonJobsApi } from '../server/photon-api.js';
import { type CatalogPart, type Design } from '../shared/model.js';
import { hangingDesign } from './fixtures/hanging-design.js';

const start = (design: Design) => new Worker(new URL('../server/photon-validation-worker.ts', import.meta.url), { workerData: design });
const simple: Design = { ...hangingDesign, id: 'photon-validation', bricks: [hangingDesign.bricks[0]] };

test('the listener can fetch status and stop while a real assembly check runs in its worker', async () => {
  const design: Design = JSON.parse(readFileSync(new URL('./fixtures/mushroom-cap-assembly.json', import.meta.url), 'utf8'));
  const api = photonJobsApi('http://127.0.0.1:3001', async url => Response.json(String(url).includes('/designs/')
    ? design : { id: 'active', status: String(url).endsWith('/cancel') ? 'cancelled' : 'running', milestones: [] }));
  let finished = false;
  const checking = api.design(design.id).finally(() => { finished = true; });
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(finished, false, 'Assembly must not block the listener until validation completes');
  assert.equal((await api.get('active')).status, 'running');
  assert.equal((await api.stop('active')).status, 'cancelled');
  assert.equal(finished, false);
  assert.deepEqual(await checking, design);
});

test('identical concurrent snapshots share one real check and subsequent successes are cached', async () => {
  let workers = 0;
  const validate = createPhotonDesignValidator(design => { workers++; return start(design); });
  const first = validate(simple), second = validate(structuredClone(simple));
  assert.equal(first, second);
  assert.equal(await first, true);
  assert.equal(await validate(structuredClone(simple)), true);
  assert.equal(workers, 1);
  assert.equal(await validate({ ...simple, description: 'Changed saved metadata' }), true);
  assert.equal(workers, 2, 'The key covers the complete saved snapshot, not only placements or ID');
});

test('same-ID changed geometry is checked again and invalid checks never enter the cache', async () => {
  let workers = 0;
  const validate = createPhotonDesignValidator(design => { workers++; return start(design); });
  assert.equal(await validate(simple), true);
  const invalid = { ...simple, bricks: [...simple.bricks, { ...simple.bricks[0], id: 'overlap' }] };
  assert.equal(await validate(invalid), false);
  assert.equal(await validate(invalid), false);
  assert.equal(workers, 3);
  assert.equal(await validate(simple), true);
  assert.equal(workers, 3, 'A failed revision must not discard the earlier exact valid snapshot');
});

test('pinned catalog color and mesh mutations cannot reuse a previous success', async () => {
  const part: CatalogPart = JSON.parse(readFileSync(new URL('./fixtures/catalog-3021.json', import.meta.url), 'utf8'));
  const design: Design = { ...simple, catalog: { schemaVersion: 1, parts: { [part.id]: structuredClone(part) }, colors: {} },
    bricks: [{ ...simple.bricks[0], partId: part.id, colorId: 4 }] };
  let workers = 0;
  const validate = createPhotonDesignValidator(snapshot => { workers++; return start(snapshot); });
  assert.equal(await validate(design), true);
  design.catalog!.parts[part.id].allowedColors = [15];
  assert.equal(await validate(design), false, 'The unchanged ID and placements cannot authorize an unproduced color');
  design.catalog!.parts[part.id] = structuredClone(part);
  design.catalog!.parts[part.id].geometry!.body.faces[0][0] = 999999;
  assert.equal(await validate(design), false, 'Changed embedded geometry must receive catalog validation');
  assert.equal(workers, 3);
});

test('queued snapshots are detached, unique checks serialize, and successful cache entries are bounded', async () => {
  let workers = 0, release: (() => void) | undefined;
  const snapshots: Design[] = [];
  const validate = createPhotonDesignValidator(design => {
    workers++; snapshots.push(design);
    const worker = new EventEmitter();
    const complete = () => { worker.emit('message', true); worker.emit('exit', 0); };
    if (workers === 1) release = complete;
    else queueMicrotask(complete);
    return worker;
  });
  const first = validate(simple);
  const changed = { ...simple, title: 'Queued snapshot' };
  const second = validate(changed);
  changed.title = 'Changed after submission';
  await Promise.resolve();
  assert.equal(workers, 1);
  release!(); await Promise.all([first, second]);
  assert.equal(snapshots[1].title, 'Queued snapshot');
  for (let i = 0; i < 31; i++) await validate({ ...simple, title: `Other ${i}` });
  assert.equal(workers, 33);
  await validate(simple);
  assert.equal(workers, 34, 'The oldest success is evicted after 32 exact snapshots');
});

test('worker startup, runtime, exit and malformed-result failures reject without caching or poisoning the queue', async () => {
  for (const failure of ['startup', 'error', 'exit', 'missing', 'malformed']) {
    let workers = 0;
    const validate = createPhotonDesignValidator(() => {
      workers++;
      if (workers === 1 && failure === 'startup') throw new Error('PRIVATE_WORKER_PATH');
      const worker = new EventEmitter();
      queueMicrotask(() => {
        if (workers > 1) { worker.emit('message', true); worker.emit('exit', 0); }
        else if (failure === 'error') { worker.emit('error', new Error('PRIVATE_WORKER_PATH')); worker.emit('exit', 1); }
        else { if (failure === 'malformed') worker.emit('message', { valid: true }); worker.emit('exit', failure === 'exit' ? 1 : 0); }
      });
      return worker;
    });
    await assert.rejects(validate(simple), error => error instanceof Error && /could not be checked/.test(error.message) && !error.message.includes('PRIVATE_WORKER_PATH'));
    assert.equal(await validate(simple), true);
    assert.equal(workers, 2);
  }
});

test('HTTP design admission still rejects mismatched revisions and invalid geometry after a valid response', async () => {
  let response = structuredClone(simple);
  const api = photonJobsApi('http://127.0.0.1:3001', async () => Response.json(response));
  assert.deepEqual(await api.design(simple.id), simple);
  response.bricks.push({ ...response.bricks[0], id: 'overlap' });
  await assert.rejects(api.design(simple.id), /did not pass its brick checks/);
  await assert.rejects(api.design('different-revision'), /did not pass its brick checks/);
});

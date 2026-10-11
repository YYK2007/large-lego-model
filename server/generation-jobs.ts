import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { GenerationError, validateInput, type GenerationInput } from './generation.js';
import { loadDesign, saveDesign, type SavedDesign } from './store.js';
import { isActiveJob, jobStageLabels, type GenerationJob, type JobProgress } from '../shared/generation-job.js';
import type { Design } from '../shared/model.js';
import { parseConcept, type ConstructionConcept } from './concept.js';
import { verifyCatalogManifest } from './catalog-resolver.js';
import type { GenerationAttempt } from './generation-attempt.js';

type Record = { version: 1; job: GenerationJob; input: GenerationInput; inputHash: string; concept?: ConstructionConcept };
type Options = {
  directory?: string; maxWorkers?: number; maxQueued?: number; workerUrl?: URL; workerTimeoutMs?: number;
  save?: (design: SavedDesign) => Promise<void>; load?: (id: string) => Promise<SavedDesign | null>;
};
const validId = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
const timestamp = () => new Date().toISOString();
const hashInput = (input: GenerationInput) => createHash('sha256').update(JSON.stringify(input)).digest('hex');

/** One local owner of persisted jobs. Workers do all generation and CPU-heavy checks. */
export class GenerationJobs {
  readonly ready: Promise<void>;
  private records = new Map<string, Record>();
  private workers = new Map<string, { worker: Worker; timer?: ReturnType<typeof setTimeout> }>();
  private operations: Promise<unknown> = Promise.resolve();
  private closed = false;
  private directory: string;
  constructor(private options: Options = {}) {
    this.directory = options.directory ?? resolve('data/generation-jobs');
    this.ready = this.recover();
  }
  get activeCount() { return [...this.records.values()].filter(record => isActiveJob(record.job)).length; }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operations.then(operation);
    this.operations = result.catch(() => {});
    return result;
  }
  private async persist(record: Record) {
    const temporary = join(this.directory, `${record.job.id}.${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(record), { mode: 0o600 });
    await rename(temporary, join(this.directory, `${record.job.id}.json`));
  }
  private async recover() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    for (const file of await readdir(this.directory)) {
      if (!file.endsWith('.json') || !validId(file.slice(0, -5))) continue;
      const record = JSON.parse(await readFile(join(this.directory, file), 'utf8')) as Record;
      if (record.version !== 1 || record.job?.id !== file.slice(0, -5)) throw new Error('A saved generation job has an unsupported format.');
      record.job.continuous ??= false;
      record.job.stopWhenMatched ??= false;
      record.job.attempts ??= [];
      if (isActiveJob(record.job)) {
        record.job.status = 'interrupted'; record.job.finishedAt = record.job.updatedAt = timestamp();
        record.job.error = { message: 'The build server restarted before this job finished. Its saved draft is retained. Resume explicitly to start a new attempt.', checks: [] };
        await this.persist(record);
      }
      this.records.set(record.job.id, record);
    }
  }
  async get(id: string): Promise<GenerationJob> {
    await this.ready;
    // Do not advertise a checkpoint or terminal status before its disk write.
    await this.operations;
    const record = validId(id) && this.records.get(id);
    if (!record) throw new GenerationError('Build job not found.', 404);
    return structuredClone(record.job);
  }
  async concept(id: string): Promise<ConstructionConcept> {
    await this.get(id);
    const concept = this.records.get(id)!.concept;
    if (!concept) throw new GenerationError('This build does not have a saved shape study yet.', 404);
    return parseConcept(concept);
  }
  async attempt(id: string, attempt: number): Promise<GenerationAttempt> {
    const job = await this.get(id);
    if (!Number.isSafeInteger(attempt) || attempt < 1 || !job.attempts?.some(item => item.attempt === attempt)) throw new GenerationError('Build attempt not found.', 404);
    return JSON.parse(await readFile(join(this.directory, id, `${attempt}.json`), 'utf8'));
  }
  async attemptPreview(id: string, attempt: number): Promise<string> {
    const job = await this.get(id);
    if (!Number.isSafeInteger(attempt) || attempt < 1 || !job.attempts?.some(item => item.attempt === attempt && item.previewAvailable)) throw new GenerationError('This attempt does not have a brick preview.', 404);
    return readFile(join(this.directory, id, `${attempt}.svg`), 'utf8');
  }
  async submit(id: string, input: GenerationInput, resume?: { id: string; mode: 'draft' | 'original' }, execution: { continuous?: boolean; stopWhenMatched?: boolean } = {}): Promise<GenerationJob> {
    await this.ready;
    if (!validId(id)) throw new GenerationError('A new build request needs a UUID requestId.', 400);
    const snapshot = structuredClone(input);
    try { await verifyCatalogManifest(snapshot?.previous?.catalog); await verifyCatalogManifest(snapshot?.inventoryCatalog); }
    catch (error) { throw new GenerationError(error instanceof Error ? error.message : 'The part catalog could not be verified.', 400); }
    validateInput(snapshot);
    const hash = hashInput(snapshot);
    const continuous = execution.continuous ?? true;
    const stopWhenMatched = execution.stopWhenMatched ?? false;
    return this.serial(async () => {
      if (this.closed) throw new GenerationError('The build server is shutting down.', 503);
      const existing = this.records.get(id);
      if (existing) {
        if (existing.inputHash !== hash || existing.job.resumedFrom !== resume?.id || existing.job.continuous !== continuous || existing.job.stopWhenMatched !== stopWhenMatched) throw new GenerationError('That request ID already belongs to a different build.', 409);
        return structuredClone(existing.job);
      }
      if (this.activeCount >= (this.options.maxWorkers ?? 2) + (this.options.maxQueued ?? 8)) throw new GenerationError('The build queue is full. Please try again after a build finishes.', 429);
      const now = timestamp();
      const record: Record = { version: 1, input: snapshot, inputHash: hash,
        job: { id, status: 'queued', quality: snapshot.quality ?? 'detailed', continuous, stopWhenMatched, attempts: [], createdAt: now, updatedAt: now, milestones: [],
          ...(resume ? { resumedFrom: resume.id, resumeMode: resume.mode } : {}) } };
      await this.persist(record);
      this.records.set(id, record);
      await this.pump();
      return structuredClone(record.job);
    });
  }
  async resume(id: string, requestId: string): Promise<GenerationJob> {
    await this.get(id);
    const record = this.records.get(id)!;
    if (isActiveJob(record.job) || record.job.status === 'succeeded') throw new GenerationError('Only stopped or unsuccessful jobs can be resumed.', 409);
    const input = structuredClone(record.input);
    const draft = record.job.bestDraftId ? await (this.options.load ?? loadDesign)(record.job.bestDraftId) : null;
    if (draft) input.previous = draft;
    return this.submit(requestId, input, { id, mode: draft ? 'draft' : 'original' }, { continuous: record.job.continuous, stopWhenMatched: record.job.stopWhenMatched });
  }
  async cancel(id: string): Promise<GenerationJob> {
    await this.ready;
    const record = validId(id) && this.records.get(id);
    if (!record) throw new GenerationError('Build job not found.', 404);
    if (!isActiveJob(record.job)) return structuredClone(record.job);
    // Mark synchronously before any pending draft/result disk write can finish.
    record.job.status = 'cancelled'; record.job.finishedAt = record.job.updatedAt = timestamp();
    const running = this.workers.get(id);
    running?.worker.postMessage({ type: 'cancel' });
    await this.serial(async () => { await this.persist(record); await this.stopWorker(id); await this.pump(); });
    return structuredClone(record.job);
  }
  private async stopWorker(id: string) {
    const running = this.workers.get(id);
    if (!running) return;
    clearTimeout(running.timer); this.workers.delete(id);
    await running.worker.terminate();
  }
  private async pump() {
    if (this.closed) return;
    for (const record of this.records.values()) {
      if (this.workers.size >= (this.options.maxWorkers ?? 2)) return;
      if (record.job.status !== 'queued') continue;
      record.job.status = 'running'; record.job.startedAt = record.job.updatedAt = timestamp();
      await this.persist(record);
      const id = record.job.id;
      try {
        const worker = new Worker(this.options.workerUrl ?? new URL('./generation-worker.ts', import.meta.url), { workerData: { input: record.input, continuous: record.job.continuous, stopWhenMatched: record.job.stopWhenMatched } });
        // Quick messaging jobs have one wall-clock deadline, including slow CPU
        // work or visual review. It starts here, never while waiting in the queue.
        const quick = record.job.quality === 'quick' && record.job.stopWhenMatched;
        const timeout = this.options.workerTimeoutMs ?? (quick ? 150_000 : record.job.continuous ? undefined : record.job.quality === 'quick' ? 160_000 : 310_000);
        const timer = timeout === undefined ? undefined : setTimeout(() => { void this.timeLimit(id); }, timeout);
        this.workers.set(id, { worker, timer });
        worker.on('message', message => {
          if (record.job.status !== 'running') return;
          void this.serial(() => this.message(record, message)).catch(() => this.fail(id, 'The build could not be saved. Any previously saved draft is retained.'));
        });
        worker.once('error', () => { void this.fail(id, 'The build worker stopped unexpectedly. Any saved draft is retained.'); });
        worker.once('exit', () => { void this.serial(async () => {
          if (record.job.status === 'running') await this.finish(record, 'failed', { message: 'The build worker exited before saving a result. Any saved draft is retained.', checks: [] });
        }); });
      } catch { await this.finish(record, 'failed', { message: 'The build worker could not start.', checks: [] }); }
    }
  }
  private async fail(id: string, message: string) {
    return this.serial(async () => {
      const record = this.records.get(id);
      if (record && isActiveJob(record.job)) await this.finish(record, 'failed', { message, checks: [] });
    });
  }
  private async timeLimit(id: string) {
    return this.serial(async () => {
      const record = this.records.get(id);
      if (!record || !isActiveJob(record.job)) return;
      if (record.job.quality === 'quick' && record.job.stopWhenMatched) {
        if (record.job.bestDraftId) {
          // This is the exact immutable checked checkpoint. A successful job
          // does not imply its visual review passed; that lives on the design.
          record.job.resultId = record.job.bestDraftId;
          await this.finish(record, 'succeeded');
        } else await this.finish(record, 'failed', { message: 'Quick mode reached its time limit without a connected draft. Try Detailed mode or a simpler interpretation.', checks: [] });
      } else await this.finish(record, 'failed', { message: 'The build reached its time limit. Any saved draft is retained.', checks: [] });
    });
  }
  private async finish(record: Record, status: 'succeeded' | 'failed', error?: GenerationJob['error']) {
    if (!isActiveJob(record.job)) return;
    record.job.status = status; record.job.error = error;
    record.job.finishedAt = record.job.updatedAt = timestamp();
    await this.persist(record); await this.stopWorker(record.job.id); await this.pump();
  }
  private async message(record: Record, message: { type: string; progress?: JobProgress; usage?: GenerationJob['usage']; design?: Design; concept?: unknown; attempt?: GenerationAttempt; previewSvg?: string; sequence?: number; error?: GenerationJob['error'] }) {
    // An attempt received before Stop is still retained, even if its disk write
    // was queued. Other late callbacks must not change the stopped job.
    if (record.job.status !== 'running' && message.type !== 'attempt') return;
    if (message.type === 'attempt' && message.attempt) {
      const attempt = message.attempt;
      const history = record.job.attempts ??= [];
      if (!Number.isSafeInteger(attempt.attempt) || attempt.attempt < 1 || attempt.attempt <= (history.at(-1)?.attempt ?? 0)
        || !['valid', 'invalid'].includes(attempt.status) || !Array.isArray(attempt.checks) || !attempt.checks.every(check => typeof check === 'string')) throw new Error('Invalid worker attempt.');
      // The worker checks complete designs before sending them. Repeating the
      // assembly search here would block status reads and Stop on large builds.
      if (attempt.status === 'valid' && (!attempt.design || attempt.partial)) throw new Error('A valid attempt must contain a checked complete design.');
      const directory = join(this.directory, record.job.id);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      // The summary is published only after its immutable artifacts are durable.
      await writeFile(join(directory, `${attempt.attempt}.json`), JSON.stringify(attempt), { mode: 0o600, flag: 'wx' });
      if (message.previewSvg) await writeFile(join(directory, `${attempt.attempt}.svg`), message.previewSvg, { mode: 0o600, flag: 'wx' });
      let designId: string | undefined;
      if (attempt.status === 'valid' && attempt.design) {
        designId = randomUUID();
        await (this.options.save ?? saveDesign)({ ...attempt.design, id: designId, inventory: record.input.inventory || [], inventoryCatalog: record.input.inventoryCatalog });
      }
      if (designId && !record.job.bestDraftId) record.job.bestDraftId = designId;
      const at = timestamp();
      history.push({ attempt: attempt.attempt, status: attempt.status, checks: attempt.checks.slice(0, 12).map(check => check.slice(0, 4000)), previewAvailable: Boolean(message.previewSvg), ...(attempt.partial ? { partial: true } : {}), ...(designId ? { designId } : {}), at });
      record.job.updatedAt = at;
      await this.persist(record);
      this.workers.get(record.job.id)?.worker.postMessage({ type: 'ack', sequence: message.sequence });
    } else if (message.type === 'usage' && message.usage) {
      const { requests, inputTokens, outputTokens, thinkingTokens, cachedTokens, elapsedMs } = message.usage;
      if (![requests, inputTokens, outputTokens, thinkingTokens, cachedTokens, elapsedMs].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error('Invalid worker usage snapshot.');
      record.job.usage = { requests, inputTokens, outputTokens, thinkingTokens, cachedTokens, elapsedMs };
      record.job.updatedAt = timestamp(); await this.persist(record);
    } else if (message.type === 'concept') {
      record.concept = parseConcept(message.concept); record.job.conceptId = record.job.id; record.job.updatedAt = timestamp();
      await this.persist(record);
      this.workers.get(record.job.id)?.worker.postMessage({ type: 'ack', sequence: message.sequence });
    } else if (message.type === 'progress' && message.progress && Object.hasOwn(jobStageLabels, message.progress.stage)) {
      const progress: JobProgress = { stage: message.progress.stage, attempt: message.progress.attempt, maxAttempts: message.progress.maxAttempts,
        ...(message.progress.detail ? { detail: message.progress.detail.slice(0, 240) } : {}), ...(message.progress.candidate === undefined ? {} : { candidate: message.progress.candidate }) };
      record.job.progress = progress; record.job.updatedAt = timestamp();
      record.job.milestones.push({ ...progress, at: record.job.updatedAt });
      record.job.milestones = record.job.milestones.slice(-80);
      await this.persist(record);
    } else if ((message.type === 'draft' || message.type === 'complete') && message.design) {
      // A later visual review can change metadata on the same generated ID.
      // Drafts get their own immutable saved revision.
      const design = message.type === 'draft' ? { ...message.design, id: randomUUID() } : message.design;
      await (this.options.save ?? saveDesign)({ ...design, inventory: record.input.inventory || [], inventoryCatalog: record.input.inventoryCatalog });
      if (record.job.status !== 'running') return;
      record.job.bestDraftId = design.id; record.job.updatedAt = timestamp();
      if (message.type === 'complete') { record.job.resultId = design.id; await this.finish(record, 'succeeded'); }
      else {
        await this.persist(record);
        this.workers.get(record.job.id)?.worker.postMessage({ type: 'ack', sequence: message.sequence });
      }
    } else if (message.type === 'failure') await this.finish(record, 'failed', {
      message: message.error?.message.slice(0, 1200) || 'The build could not finish.',
      checks: message.error?.checks.filter(value => typeof value === 'string').map(value => value.slice(0, 10000)).slice(-8) || [],
    });
  }
  /** Stop execution without changing records; recovery labels them interrupted. */
  async close() {
    this.closed = true;
    await this.ready;
    await this.serial(async () => {
      for (const id of [...this.workers.keys()]) {
        this.workers.get(id)!.worker.removeAllListeners();
        await this.stopWorker(id);
      }
    });
  }
}

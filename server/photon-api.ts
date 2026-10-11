import { validateDesign, type Design } from '../shared/model.js';
import type { GenerationJob } from '../shared/generation-job.js';
import type { GenerationInput } from './generation.js';
import type { SavedDesign } from './store.js';
import { PhotonInputError } from './photon-routing.js';
export class PhotonApiError extends PhotonInputError {
  constructor(message: string, readonly status: number) { super(message); }
}

export interface PhotonJobsApi {
  submit(id: string, input: GenerationInput): Promise<GenerationJob>;
  get(id: string): Promise<GenerationJob>;
  stop(id: string): Promise<GenerationJob>;
  design(id: string): Promise<SavedDesign>;
  preview(id: string, attempt: number): Promise<Buffer>;
  file(id: string, format: 'manual.pdf' | 'model.usdz'): Promise<Buffer>;
}

/** Uses the API's existing worker queue; never opens a second job-store owner. */
export function photonJobsApi(base = 'http://127.0.0.1:3001', request: typeof fetch = fetch): PhotonJobsApi {
  const origin = new URL(base);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password) throw new Error('PHOTON_API_BASE_URL must be an HTTP(S) URL without credentials.');
  async function response(path: string, body?: unknown, timeout = 15_000) {
    const result = await request(new URL(`/api${path}`, origin), { signal: AbortSignal.timeout(timeout), cache: 'no-store',
      ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    if (!result.ok) {
      const detail = await result.json().catch(() => null);
      throw new PhotonApiError(typeof detail?.error === 'string' ? detail.error.slice(0, 800) : 'The build service could not complete that request. Send /status to reconnect.', result.status);
    }
    return result;
  }
  async function job(path: string, id: string, body?: unknown) {
    const result = await (await response(path, body)).json() as GenerationJob;
    if (result.id !== id || !['queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted'].includes(result.status) || !Array.isArray(result.milestones)) throw new Error('Invalid build-job response.');
    return result;
  }
  const idPath = (id: string) => `/generation-jobs/${encodeURIComponent(id)}`;
  return {
    submit: (id, input) => job('/generation-jobs', id, { requestId: id, input, stopWhenMatched: true }),
    get: id => job(idPath(id), id),
    stop: id => job(`${idPath(id)}/cancel`, id, {}),
    design: async id => {
      const design = await (await response(`/designs/${encodeURIComponent(id)}`)).json() as Design;
      if (design.id !== id || !validateDesign(design).valid) throw new PhotonInputError('That saved build did not pass its brick checks. Your selected build is unchanged.');
      return design;
    },
    preview: async (id, attempt) => Buffer.from(await (await response(`${idPath(id)}/attempts/${attempt}/preview.svg`)).arrayBuffer()),
    file: async (id, format) => Buffer.from(await (await response(`/designs/${encodeURIComponent(id)}/${format}`, undefined, 120_000)).arrayBuffer()),
  };
}

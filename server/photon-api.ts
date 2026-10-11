import type { Design } from '../shared/model.js';
import type { GenerationJob } from '../shared/generation-job.js';
import type { GenerationInput } from './generation.js';
import type { SavedDesign } from './store.js';
import { PhotonInputError } from './photon-routing.js';
import { parsePhotonChatResult, type PhotonChatContext, type PhotonChatResult } from './photon-chat.js';
import { createPhotonDesignValidator } from './photon-validation.js';
export class PhotonApiError extends PhotonInputError {
  constructor(message: string, readonly status: number) { super(message); }
}

export interface PhotonJobsApi {
  submit(id: string, input: GenerationInput): Promise<GenerationJob>;
  get(id: string): Promise<GenerationJob>;
  stop(id: string): Promise<GenerationJob>;
  design(id: string, signal?: AbortSignal): Promise<SavedDesign>;
  instructionsLink?(id: string, signal?: AbortSignal): Promise<string | null>;
  chat?(message: string, context: PhotonChatContext): Promise<PhotonChatResult>;
  preview(id: string, attempt: number): Promise<Buffer>;
  file(id: string, format: 'manual.pdf' | 'model.usdz' | 'mobile.usdz' | 'parts.csv', signal?: AbortSignal): Promise<Buffer>;
}

/** Stop this caller's wait, never the validation shared with another request. */
function waitForValidation(result: Promise<boolean>, signal?: AbortSignal): Promise<boolean> {
  if (!signal) return result;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', abort);
    const abort = () => { cleanup(); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    result.then(valid => { cleanup(); resolve(valid); }, error => { cleanup(); reject(error); });
  });
}

/** Uses the API's existing worker queue; never opens a second job-store owner. */
export function photonJobsApi(base = 'http://127.0.0.1:3001', request: typeof fetch = fetch, visualReview = false): PhotonJobsApi {
  const origin = new URL(base);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password) throw new Error('PHOTON_API_BASE_URL must be an HTTP(S) URL without credentials.');
  const validate = createPhotonDesignValidator();
  async function response(path: string, body?: unknown, timeout = 15_000, callerSignal?: AbortSignal) {
    callerSignal?.throwIfAborted();
    const timeoutSignal = AbortSignal.timeout(timeout);
    const result = await request(new URL(`/api${path}`, origin), { signal: callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal, cache: 'no-store',
      ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    if (!result.ok) {
      const detail = await result.json().catch(() => null);
      callerSignal?.throwIfAborted();
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
    chat: async (message, context) => parsePhotonChatResult(await (await response('/photon/chat', { message, context })).json()),
    submit: (id, input) => job('/generation-jobs', id, { requestId: id, input, stopWhenMatched: true, visualReview }),
    get: id => job(idPath(id), id),
    stop: id => job(`${idPath(id)}/cancel`, id, {}),
    design: async (id, signal) => {
      const design = await (await response(`/designs/${encodeURIComponent(id)}`, undefined, 15_000, signal)).json() as Design;
      signal?.throwIfAborted();
      if (design.id !== id || !await waitForValidation(validate(design), signal)) throw new PhotonInputError('That saved build did not pass its brick checks. Your selected build is unchanged.');
      signal?.throwIfAborted();
      return design;
    },
    instructionsLink: async (id, signal) => {
      const value = await (await response(`/designs/${encodeURIComponent(id)}/instructions-link`, undefined, 15_000, signal)).json() as { url?: unknown };
      signal?.throwIfAborted();
      if (value.url === null) return null;
      if (typeof value.url !== 'string') throw new PhotonInputError('The building guide link is unavailable. Your checked build is saved.');
      const url = new URL(value.url);
      if (url.protocol !== 'https:' || url.username || url.password || url.searchParams.get('build') !== id || !url.searchParams.get('share')) throw new PhotonInputError('The building guide link did not match this build. Your checked build is saved.');
      return url.href;
    },
    preview: async (id, attempt) => Buffer.from(await (await response(`${idPath(id)}/attempts/${attempt}/preview.svg`)).arrayBuffer()),
    // Large manuals contain hundreds of exact assembly steps. Their first
    // export can take minutes; subsequent requests use the PDF content cache.
    file: async (id, format, signal) => {
      const bytes = await (await response(`/designs/${encodeURIComponent(id)}/${format}`, undefined, format === 'manual.pdf' ? 600_000 : 120_000, signal)).arrayBuffer();
      signal?.throwIfAborted();
      return Buffer.from(bytes);
    },
  };
}

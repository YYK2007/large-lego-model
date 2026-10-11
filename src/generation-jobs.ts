import { validateDesign, normalizeDesign, type CatalogManifest, type Design, type InventoryItem } from '../shared/model';
import { isActiveJob, type GenerationJob, type JobAttempt } from '../shared/generation-job';
import { BuildRequestError } from './generation-stream';

export type JobInput = { prompt: string; image?: { data: string; mimeType: string }; previous?: Design; inventory?: InventoryItem[]; inventoryCatalog?: CatalogManifest; inventoryMode?: 'unlimited' | 'owned'; quality: 'quick' | 'detailed' };
export class JobRequestError extends BuildRequestError {
  constructor(message: string, readonly status: number, checks?: unknown) { super(message, checks); }
}
export const JOB_STORAGE_KEY = 'sprout-generation-job';
export const validJobId = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
async function request(path: string, expectedId: string, body?: unknown): Promise<GenerationJob> {
  const response = await fetch(`/api/generation-jobs${path}`, {
    method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(15_000), cache: 'no-store',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const value = await response.json();
  if (!response.ok) throw new JobRequestError(value.error || 'The build server could not complete this request.', response.status, value.checks);
  if (value.id !== expectedId || !validJobId(value.id) || !['queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted'].includes(value.status) || !Array.isArray(value.milestones)) throw new Error('The server returned a different or invalid build job.');
  return value;
}
export const submitJob = (id: string, input: JobInput) => request('', id, { requestId: id, input });
export const readJob = (id: string) => request(`/${encodeURIComponent(id)}`, id);
export const cancelJob = (id: string) => request(`/${encodeURIComponent(id)}/cancel`, id, {});
export const resumeJob = (id: string, requestId: string) => request(`/${encodeURIComponent(id)}/resume`, requestId, { requestId });

export async function stopAndReadAttempt(id: string, attempt: JobAttempt): Promise<{ job: GenerationJob; design: Design }> {
  if (attempt.status !== 'valid' || attempt.partial || !attempt.designId) throw new Error('Only a complete checked attempt can be used as a build.');
  const job = await cancelJob(id);
  if (isActiveJob(job)) throw new Error('Generation has not stopped yet. Your current design is unchanged.');
  if (!job.attempts?.some(saved => saved.attempt === attempt.attempt && saved.status === 'valid' && !saved.partial && saved.designId === attempt.designId)) throw new Error('The checked attempt could not be confirmed. Your current design is unchanged.');
  const response = await fetch(`/api/designs/${encodeURIComponent(attempt.designId)}`, { signal: AbortSignal.timeout(15_000), cache: 'no-store' });
  const design = await response.json();
  if (!response.ok) throw new JobRequestError(design.error || 'The saved build could not be loaded.', response.status, design.checks);
  if (design?.id !== attempt.designId || !validateDesign(design).valid) throw new Error('The saved build is invalid or does not match this attempt. Your current design is unchanged.');
  return { job, design: normalizeDesign(design) };
}

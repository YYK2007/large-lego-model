import { parentPort, workerData } from 'node:worker_threads';
import { generateDesign, GenerationError, type GenerationInput } from './generation.js';
import { validateDesign, type Design } from '../shared/model.js';
import { renderGenerationAttempt, type GenerationAttempt } from './generation-attempt.js';

const port = parentPort!;
const controller = new AbortController();
const acknowledgements = new Map<number, () => void>();
let sequence = 0;
port.on('message', message => {
  if (message.type === 'cancel') controller.abort();
  if (message.type === 'ack') { acknowledgements.get(message.sequence)?.(); acknowledgements.delete(message.sequence); }
});
const draft = async (design: Design) => {
  if (controller.signal.aborted) return;
  if (!validateDesign(design).valid) throw new Error('The generation worker produced an invalid draft.');
  const id = ++sequence;
  const saved = new Promise<void>(resolve => acknowledgements.set(id, resolve));
  port.postMessage({ type: 'draft', sequence: id, design });
  await saved;
};
const concept = async (value: unknown) => {
  if (controller.signal.aborted) return;
  const id = ++sequence;
  const saved = new Promise<void>(resolve => acknowledgements.set(id, resolve));
  port.postMessage({ type: 'concept', sequence: id, concept: value });
  await saved;
};
const attempt = async (value: GenerationAttempt) => {
  if (controller.signal.aborted) return;
  if (value.status === 'valid' && (!value.design || value.partial || !validateDesign(value.design).valid)) throw new Error('The generation worker produced an invalid approved attempt.');
  // SVG geometry work stays in this worker so Stop remains responsive.
  const previewSvg = await renderGenerationAttempt(value);
  if (controller.signal.aborted) return;
  const id = ++sequence;
  const saved = new Promise<void>(resolve => acknowledgements.set(id, resolve));
  port.postMessage({ type: 'attempt', sequence: id, attempt: value, previewSvg });
  await saved;
};
try {
  const design = await generateDesign(workerData.input as GenerationInput,
    progress => port.postMessage({ type: 'progress', progress }), { signal: controller.signal, continuous: workerData.continuous ?? true, stopWhenMatched: workerData.stopWhenMatched ?? false, onAttempt: attempt, onDraft: draft, onConcept: concept,
      onUsage: usage => port.postMessage({ type: 'usage', usage }) });
  if (!controller.signal.aborted) {
    if (!validateDesign(design).valid) throw new Error('The generation worker produced an invalid result.');
    port.postMessage({ type: 'complete', design });
  }
} catch (error) {
  if (!controller.signal.aborted) port.postMessage({ type: 'failure', error: error instanceof GenerationError
    ? { message: error.message, checks: error.checks }
    : { message: 'The build worker stopped before finishing. Your previous design is unchanged.', checks: [] } });
} finally { port.close(); }

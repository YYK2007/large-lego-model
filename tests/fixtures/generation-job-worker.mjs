import { parentPort as port, workerData } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { renderGenerationAttempt } from '../../server/generation-attempt.ts';

const mode = workerData.input.prompt;
const design = {
  id: randomUUID(), title: 'Worker specimen', description: 'A valid worker lifecycle specimen.',
  prompt: mode, source: 'ai', createdAt: new Date().toISOString(), schemaVersion: 2,
  catalogVersion: 'upright-architecture-2', coordinateSystem: 'stud-xy-plate-z',
  bricks: [{ id: 'one', partId: '3005', colorId: 15, x: 0, y: 0, z: 0, rotation: 0 }],
};
const send = (type, fields, sequence) => new Promise(resolve => {
  const ack = message => { if (message.type === 'ack' && message.sequence === sequence) { port.off('message', ack); resolve(); } };
  port.on('message', ack); port.postMessage({ type, ...fields, sequence });
});
port.on('message', message => {
  // Deliberately attempt a late result; cancellation must not accept it.
  if (message.type === 'cancel') setTimeout(() => port.postMessage({ type: 'complete', design }), 15);
});
port.postMessage({ type: 'progress', progress: { stage: 'planning', attempt: 1, maxAttempts: 2 } });
port.postMessage({ type: 'usage', usage: { requests: 2, inputTokens: 100, outputTokens: 40, thinkingTokens: 20, cachedTokens: 30, elapsedMs: 15 } });
if (mode === 'cpu') {
  const end = Date.now() + 1000;
  while (Date.now() < end) Math.sqrt(Math.random());
}
if (mode === 'concept' || mode === 'invalid-concept') {
  await send('concept', { concept: mode === 'invalid-concept' ? '<script>bad</script>' : {
    title: '<script>Shape only</script>', rationale: 'A simple shape study.', features: ['A cube'], limitations: ['Not assembled bricks'],
    components: [{ id: 'cube', featureIndices: [0], role: 'body', parentId: '', connection: 'On table',
      boxes: [{ x: 0, y: 0, z: 0, width: 2, depth: 2, height: 3, colorId: 15 }], profiles: [], partQueries: [] }],
  } }, 1);
}
if (mode !== 'quick-no-draft') await send('draft', { design }, 2);
if (mode === 'quick-retries' || mode === 'quick-no-draft') {
  // Keep producing attempts; none may renew the parent's Quick deadline.
  let attempt = 0;
  setInterval(() => {
    port.postMessage({ type: 'progress', progress: { stage: 'repairing', attempt: ++attempt, maxAttempts: attempt } });
  }, 40);
} else if (mode === 'continuous') {
  for (let attempt = 1; attempt <= 7; attempt++) {
    const invalid = { ...design, bricks: [{ ...design.bricks[0], z: 3 }] };
    const value = { attempt, status: attempt === 7 ? 'valid' : 'invalid', checks: attempt === 7 ? [] : ['A piece does not connect to the ground.'],
      plan: { title: 'Attempt fixture', description: 'A retained attempt', boxes: [] }, ...(attempt >= 5 ? { design: attempt === 7 ? design : invalid } : {}) };
    port.postMessage({ type: 'progress', progress: { stage: 'checking', attempt, maxAttempts: attempt } });
    await send('attempt', { attempt: value, previewSvg: await renderGenerationAttempt(value) }, attempt + 10);
  }
  if (workerData.stopWhenMatched) { port.postMessage({ type: 'complete', design }); port.close(); }
} else if (mode === 'mode') {
  port.postMessage({ type: 'progress', progress: { stage: 'checking', attempt: 1, maxAttempts: 1, detail: `Continuous: ${workerData.continuous}` } });
  port.postMessage({ type: 'complete', design }); port.close();
} else if (workerData.input.previous) {
  port.postMessage({ type: 'progress', progress: { stage: 'repairing', attempt: 2, maxAttempts: 2, detail: `Resumed ${workerData.input.previous.id}` } });
  port.postMessage({ type: 'complete', design }); port.close();
} else if (mode === 'fail') {
  port.postMessage({ type: 'failure', error: { message: 'Fixture failure after draft', checks: ['A later candidate was rejected.'] } }); port.close();
} else if (mode === 'exit') {
  port.close();
} else if (mode !== 'wait') {
  port.postMessage({ type: 'complete', design: { ...design, description: 'Final metadata differs from the earlier draft.' } }); port.close();
}

import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

// Run after `npm run dev`. This uses the curated castle and makes no AI calls.
const base = 'http://127.0.0.1:3001';
const initial = await fetch(`${base}/api/status`);
assert.equal(initial.status, 200, 'Start the local API with npm run dev first.');
const samples = [];
const start = performance.now();
let finished = false;
let finishedAt;
const exportResult = fetch(`${base}/api/designs/sample-castle/manual.pdf`)
  .then(async response => ({ status: response.status, pdf: Buffer.from(await response.arrayBuffer()) }))
  .catch(error => ({ error }))
  .finally(() => { finishedAt = performance.now(); finished = true; });
while (!finished) {
  await new Promise(resolve => setTimeout(resolve, 1000));
  if (finished) break;
  const sent = performance.now();
  const response = await fetch(`${base}/api/status`);
  await response.arrayBuffer();
  samples.push({ elapsedMs: performance.now() - start, latencyMs: performance.now() - sent, status: response.status, duringExport: !finished });
}
const result = await exportResult;
if (result.error) throw result.error;
assert.equal(result.status, 200);
assert.equal(result.pdf.subarray(0, 5).toString(), '%PDF-');
assert.ok(samples.some(sample => sample.duringExport && sample.status === 200), 'The API did not answer while the manual was rendering.');
const latencies = samples.filter(sample => sample.duringExport).map(sample => sample.latencyMs).sort((a, b) => a - b);
const report = { exportMs: finishedAt - start, pdfBytes: result.pdf.length, completedProbesDuringExport: latencies.length, medianStatusMs: latencies[Math.floor(latencies.length / 2)], maxStatusMs: Math.max(...latencies), samples };
await mkdir('output/complex-local', { recursive: true });
await writeFile('output/complex-local/background-export.json', JSON.stringify(report, null, 2));
await writeFile('output/complex-local/background-castle.pdf', result.pdf);
console.log(JSON.stringify({ ...report, samples: undefined }, null, 2));

import express from 'express';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { SAMPLE_DESIGNS } from '../shared/examples.js';
import { resolveCatalog, mergeCatalogManifests, exportCsv, exportLDraw, validateDesign, normalizeDesign } from '../shared/model.js';
import { renderDesignSvg } from '../shared/illustration.js';
import { generateManualPdf } from './manual.js';
import { generateUsdz } from './native-model.js';
import { suggestInventory, validateInventory, GenerationError } from './generation.js';
import { GenerationJobs } from './generation-jobs.js';
import { isActiveJob } from '../shared/generation-job.js';
import { renderConceptSvg } from './concept.js';
import { loadCachedCatalog, loadCatalogIndex, rankCatalogParts, verifyCatalogManifest } from './catalog-resolver.js';
import { importSet } from './inventory.js';
import { loadDesign, saveDesign } from './store.js';
import { readConfig } from './config.js';

readConfig();
const jobs = new GenerationJobs();
await jobs.ready;
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '8mb' }));
app.use((_req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); next(); });
app.get('/api/status', (_req, res) => {
  const config = readConfig();
  res.json({ gemini: Boolean(config.geminiKey), model: config.model, rebrickable: Boolean(config.rebrickableKey), photon: config.photonReady, photonLive: false, photonJobPolicy: 3 });
});
app.get('/api/catalog', async (_req, res) => {
  const catalog = await loadCachedCatalog();
  res.json({ ...resolveCatalog(catalog), catalog });
});
app.get('/api/catalog/search', async (req, res) => {
  const query = String(req.query.q || '').slice(0, 200);
  const offset = Number(req.query.offset || 0), limit = Number(req.query.limit || 40);
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) return res.status(400).json({ error: 'Use a nonnegative offset and a limit from 1 to 500.' });
  const index = rankCatalogParts(await loadCatalogIndex(), query), catalog = resolveCatalog(await loadCachedCatalog());
  res.json({ total: index.length, offset, results: index.slice(offset, offset + limit).map(part => ({ ...part,
    status: catalog.parts[part.partId] ? 'assembly-supported' : 'discovered' })) });
});
app.get('/api/examples', (_req, res) => res.json(SAMPLE_DESIGNS));
app.get('/api/designs/:id', async (req, res) => {
  const design = await loadDesign(req.params.id) || SAMPLE_DESIGNS.find(item => item.id === req.params.id);
  if (!design) return res.status(404).json({ error: 'Design not found.' });
  res.json(design);
});
app.post('/api/generation-jobs', async (req, res) => {
  res.status(202).json(await jobs.submit(req.body.requestId, req.body.input, undefined, { continuous: true, stopWhenMatched: true, visualReview: req.body.visualReview }));
});
app.get('/api/generation-jobs/:id', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await jobs.get(req.params.id));
});
app.get('/api/generation-jobs/:id/attempts/:attempt', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await jobs.attempt(req.params.id, Number(req.params.attempt)));
});
app.get('/api/generation-jobs/:id/attempts/:attempt/preview.svg', async (req, res) => {
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.type('image/svg+xml').send(await jobs.attemptPreview(req.params.id, Number(req.params.attempt)));
});
app.post('/api/generation-jobs/:id/cancel', async (req, res) => res.json(await jobs.cancel(req.params.id)));
app.post('/api/generation-jobs/:id/resume', async (req, res) => res.status(202).json(await jobs.resume(req.params.id, req.body.requestId)));
app.get('/api/generation-jobs/:id/concept.svg', async (req, res) => {
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.type('image/svg+xml').send(renderConceptSvg(await jobs.concept(req.params.id), req.query.view === 'opposite'));
});
// Compatibility for existing clients; execution still shares the worker queue.
app.post('/api/generate', async (req, res) => {
  const streaming = req.get('Accept') === 'application/x-ndjson';
  try {
    let job = await jobs.submit(randomUUID(), req.body, undefined, { continuous: false }), sent = 0;
    while (isActiveJob(job)) {
      if (res.destroyed) return;
      if (streaming) {
        if (!res.headersSent) { res.type('application/x-ndjson'); res.setHeader('Cache-Control', 'no-store'); res.flushHeaders(); }
        for (const event of job.milestones.slice(sent)) res.write(JSON.stringify({ type: 'progress', ...event }) + '\n');
        sent = job.milestones.length;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
      job = await jobs.get(job.id);
    }
    if (job.status !== 'succeeded' || !job.resultId) throw new GenerationError(job.error?.message || 'The build was stopped.', 422, job.error?.checks);
    const design = await loadDesign(job.resultId);
    if (!design) throw new Error('The saved build result is missing.');
    if (streaming) res.end(JSON.stringify({ type: 'design', design }) + '\n');
    else res.json(design);
  } catch (error) {
    if (!res.headersSent) throw error;
    res.end(JSON.stringify({ type: 'error', error: error instanceof GenerationError ? error.message : 'The design could not be saved. Your current design is unchanged.', ...(error instanceof GenerationError && error.checks.length ? { checks: error.checks } : {}) }) + '\n');
  }
});
app.post('/api/inventory/photo', async (req, res) => res.json(await suggestInventory(req.body.image)));
app.post('/api/inventory/set', async (req, res) => res.json(await importSet(req.body.setNumber)));
app.post('/api/designs', async (req, res) => {
  const design = req.body.design;
  try { await verifyCatalogManifest(design?.catalog); await verifyCatalogManifest(req.body.inventoryCatalog); }
  catch (error) { throw new GenerationError(error instanceof Error ? error.message : 'The part catalog could not be verified.', 400); }
  const check = validateDesign(design);
  if (!check.valid) throw new GenerationError('Cannot save an invalid design: ' + check.errors.join('; '), 400);
  validateInventory(req.body.inventory || [], mergeCatalogManifests(design.catalog, req.body.inventoryCatalog));
  // An export freezes this exact collection and geometry. Existing shared links never change.
  const original = await loadDesign(design.id);
  const normalized = normalizeDesign(design);
  const sameGeometry = original && JSON.stringify(normalizeDesign(original).bricks) === JSON.stringify(normalized.bricks)
    && JSON.stringify(original.catalog ?? null) === JSON.stringify(normalized.catalog ?? null);
  // Export snapshots inherit only the stored assessment of these exact placements.
  const snapshot = { ...normalized, research: sameGeometry ? original.research : undefined, id: randomUUID(), inventory: req.body.inventory || [], inventoryCatalog: req.body.inventoryCatalog };
  await saveDesign(snapshot);
  res.json({ id: snapshot.id });
});
app.get('/api/designs/:id/:format', async (req, res) => {
  const saved = await loadDesign(req.params.id);
  const design = saved || SAMPLE_DESIGNS.find(item => item.id === req.params.id);
  if (!design) return res.status(404).json({ error: 'Design not found.' });
  const name = design.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 70) || 'build';
  switch (req.params.format) {
    case 'manual.pdf': res.type('pdf').attachment(`${name}-instructions.pdf`).send(await generateManualPdf(design, saved?.inventory)); break;
    case 'parts.csv': res.type('text/csv').attachment(`${name}-parts.csv`).send(exportCsv(design, saved?.inventory)); break;
    case 'model.ldr': res.type('text/plain').attachment(`${name}.ldr`).send(exportLDraw(design)); break;
    case 'model.usdz': res.type('model/vnd.usdz+zip').attachment(`${name}.usdz`).send(await generateUsdz(design)); break;
    case 'preview.png': res.type('png').send(await sharp(Buffer.from(renderDesignSvg(design, { width: 1200, height: 1000 }))).png().toBuffer()); break;
    default: res.status(404).json({ error: 'Unknown export.' });
  }
});
if (existsSync(resolve('dist'))) {
  app.use(express.static(resolve('dist')));
  app.get('/{*path}', (req, res) => req.path.startsWith('/api/') ? res.status(404).json({ error: 'Not found.' }) : res.sendFile(resolve('dist/index.html')));
}
app.use((error: Error & { status?: number; type?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = error instanceof GenerationError ? error.status : error.status === 413 ? 413 : error instanceof SyntaxError ? 400 : 500;
  res.status(status).json({ error: status === 500 ? 'Something went wrong. Your current design is safe; try again.' : status === 413 ? 'That upload is too large. Use an image under 5 MB.' : error.message, ...(error instanceof GenerationError && error.checks.length ? { checks: error.checks } : {}) });
});
const port = Number(process.env.PORT) || 3001;
const host = process.env.HOST || '127.0.0.1';
app.listen(port, host, () => console.log(`Large Lego Model API: http://${host}:${port}`));

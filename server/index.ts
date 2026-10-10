import express from 'express';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { SAMPLE_DESIGNS } from '../shared/examples.js';
import { PARTS, COLORS, exportCsv, exportLDraw, validateDesign } from '../shared/model.js';
import { renderDesignSvg } from '../shared/illustration.js';
import { generateManualPdf } from './manual.js';
import { generateUsdz } from './native-model.js';
import { generateDesign, suggestInventory, validateInventory, GenerationError } from './generation.js';
import { importSet } from './inventory.js';
import { loadDesign, saveDesign } from './store.js';
import { readConfig } from './config.js';

readConfig();
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '8mb' }));
app.use((_req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); next(); });
app.get('/api/status', (_req, res) => {
  const config = readConfig();
  res.json({ gemini: Boolean(config.geminiKey), model: config.model, rebrickable: Boolean(config.rebrickableKey), photon: config.photonReady, photonLive: false });
});
app.get('/api/catalog', (_req, res) => res.json({ parts: PARTS, colors: COLORS }));
app.get('/api/examples', (_req, res) => res.json(SAMPLE_DESIGNS));
app.get('/api/designs/:id', async (req, res) => {
  const design = await loadDesign(req.params.id) || SAMPLE_DESIGNS.find(item => item.id === req.params.id);
  if (!design) return res.status(404).json({ error: 'Design not found.' });
  res.json(design);
});
let activeGenerations = 0;
app.post('/api/generate', async (req, res) => {
  if (activeGenerations >= 2) throw new GenerationError('Two builds are already being planned. Please try again shortly.', 429);
  activeGenerations++;
  try {
    const design = await generateDesign(req.body);
    await saveDesign({ ...design, inventory: req.body.inventory || [] });
    res.json(design);
  } finally { activeGenerations--; }
});
app.post('/api/inventory/photo', async (req, res) => res.json(await suggestInventory(req.body.image)));
app.post('/api/inventory/set', async (req, res) => res.json(await importSet(req.body.setNumber)));
app.post('/api/designs', async (req, res) => {
  const design = req.body.design;
  const check = validateDesign(design);
  if (!check.valid) throw new GenerationError('Cannot save an invalid design: ' + check.errors.join('; '), 400);
  validateInventory(req.body.inventory || []);
  // An export freezes this exact collection and geometry. Existing shared links never change.
  const snapshot = { ...design, id: randomUUID(), inventory: req.body.inventory || [] };
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

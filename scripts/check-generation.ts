// Explicit live evaluation: uses the configured Gemini API and public references.
// These prompts are evaluation cases only; the generator never imports them.
import { mkdir, writeFile } from 'node:fs/promises';
import { generateDesign, type GenerationUsage } from '../server/generation.js';
import { parseConcept, renderConceptSvg } from '../server/concept.js';
import { readConfig } from '../server/config.js';
import { renderLikenessViews } from '../server/likeness.js';
import { saveDesign } from '../server/store.js';
import { buildSteps, validateDesign } from '../shared/model.js';

const cases: Record<string, string> = {
  apple: 'A red apple',
  sunflower: 'A sunflower',
  turtle: 'A sea turtle',
  matterhorn: 'The Matterhorn',
  wall: 'The Great Wall of China',
  opera: 'The Sydney Opera House',
  elephant: 'An African elephant',
  rose: 'A red rose',
  taj: 'The Taj Mahal',
  windmill: 'A Dutch windmill',
  mushroom: 'A red fly agaric mushroom with white spots',
  lighthouse: 'A coastal lighthouse with a lantern room and balcony',
  bridge: 'The Golden Gate Bridge',
  butterfly: 'A monarch butterfly with spread wings, a three dimensional LEGO sculpture',
};
const [run, ...selected] = process.argv.slice(2);
if (!/^[a-z0-9-]+$/.test(run || '') || !selected.length || selected.some(name => !Object.hasOwn(cases, name))) {
  throw new Error(`Usage: node --import tsx scripts/check-generation.ts RUN CASE...\nCases: ${Object.keys(cases).join(', ')}. This makes paid API calls.`);
}
const directory = `output/generation-evaluation/${run}`;
await mkdir(directory, { recursive: true });
const results: Record<string, unknown>[] = [];
const originalFetch = globalThis.fetch;
for (const name of selected) {
  const started = Date.now();
  const progress: unknown[] = [];
  const path = `${directory}/${name}`;
  await mkdir(path, { recursive: true });
  let providerCalls = 0, draftCount = 0;
  let usage: GenerationUsage | undefined;
  let stopBatch = false;
  const providerKey = readConfig().geminiKey;
  // Keep replayable plan/patch text locally, without request URLs, headers,
  // credentials or reference-image bytes. These files are ignored by Git.
  globalThis.fetch = async (...args) => {
    const response = await originalFetch(...args);
    const requestUrl = args[0] instanceof Request ? args[0].url : String(args[0]);
    if (new URL(requestUrl).hostname === 'generativelanguage.googleapis.com' && !response.ok) {
      const body = await response.clone().json().catch(() => ({})) as { error?: { message?: string; status?: string } };
      const message = String(body.error?.message || '').replaceAll(providerKey, '[redacted]');
      await writeFile(`${path}/provider-error.json`, JSON.stringify({ status: response.status, code: body.error?.status, message }, null, 2));
      stopBatch = [400, 401, 403, 404, 429].includes(response.status);
    }
    if (new URL(requestUrl).hostname === 'generativelanguage.googleapis.com' && response.ok) {
      const body = await response.clone().json() as { usageMetadata?: unknown; candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[] };
      await writeFile(`${path}/usage-${providerCalls + 1}.json`, JSON.stringify(body.usageMetadata || {}, null, 2));
      await writeFile(`${path}/provider-${++providerCalls}.json`, JSON.stringify(body.candidates?.map(candidate => ({
        text: candidate.content?.parts?.flatMap(part => part.text ? [part.text] : []).join('\n'), finishReason: candidate.finishReason,
      })) || [], null, 2));
    }
    return response;
  };
  try {
    const design = await generateDesign({ prompt: cases[name] }, event => {
      const update = { ...event, seconds: (Date.now() - started) / 1000 };
      progress.push(update); console.log(JSON.stringify({ name, ...update }));
    }, {
      onUsage: value => { usage = value; },
      onConcept: async value => {
        const concept = parseConcept(value);
        await writeFile(`${path}/concept.json`, JSON.stringify(concept, null, 2));
        await writeFile(`${path}/concept.svg`, renderConceptSvg(concept));
      },
      onDraft: async design => { await writeFile(`${path}/draft-${++draftCount}.json`, JSON.stringify(design, null, 2)); },
    });
    await writeFile(`${path}/design.json`, JSON.stringify(design, null, 2));
    const result = {
      name, prompt: cases[name], id: design.id, seconds: (Date.now() - started) / 1000,
      usage, pieces: design.bricks.length, steps: buildSteps(design).length,
      partTypes: new Set(design.bricks.map(brick => brick.partId)).size,
      geometry: validateDesign(design), comparison: design.research?.comparison,
      references: design.research?.sources.map(source => ({ title: source.fileTitle, url: source.sourcePageUrl, sha256: source.sha256 })),
      warnings: design.research?.warnings, humanVisualReview: 'pending',
    };
    await saveDesign({ ...design, inventory: [] });
    await writeFile(`${path}/result.json`, JSON.stringify(result, null, 2));
    const views = await renderLikenessViews(design);
    for (const [index, view] of views.entries()) await writeFile(`${path}/view-${index}.png`, Buffer.from(view.inlineData.data, 'base64'));
    results.push(result);
    console.log(JSON.stringify(result));
  } catch (error) {
    const failure = { name, prompt: cases[name], seconds: (Date.now() - started) / 1000, usage, error: (error as Error).message, checks: (error as { checks?: string[] }).checks };
    results.push(failure);
    await writeFile(`${path}/failure.json`, JSON.stringify(failure, null, 2));
    console.log(JSON.stringify(failure));
    process.exitCode = 1;
  } finally {
    globalThis.fetch = originalFetch;
  }
  await writeFile(`${path}/progress.json`, JSON.stringify(progress, null, 2));
  await writeFile(`${directory}/results.json`, JSON.stringify(results, null, 2));
  if (stopBatch) break;
}

import type { Design } from '../shared/model.js';
import { renderDesignSvg } from '../shared/illustration.js';
import type { ShapePlan } from './compiler.js';

/** An attempt is a review artifact, not an admitted design or export. */
export type GenerationAttempt = {
  attempt: number;
  status: 'invalid' | 'valid';
  checks: string[];
  plan?: ShapePlan;
  design?: Design;
  response?: string;
  partial?: boolean;
};

export async function renderGenerationAttempt(attempt: GenerationAttempt): Promise<string | undefined> {
  if (!attempt.design?.bricks.length) return;
  // These are the exact attempted placements, including failed connections.
  // A plan that never packed has JSON output only; do not invent its pieces.
  let model: string;
  try { model = renderDesignSvg(attempt.design, { width: 760, height: 540 }); }
  catch { return; }
  const unfinished = attempt.status === 'invalid' || attempt.partial;
  const heading = `${unfinished ? 'Unfinished attempt' : 'Attempt'} ${attempt.attempt} · ${attempt.partial ? 'partial brick model' : unfinished ? 'brick checks failed' : 'brick checks passed'}`;
  const note = unfinished ? 'Preview only. These placements are not approved for building or export.' : 'Review the attempt’s reference and likeness feedback before choosing this build.';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="610" viewBox="0 0 760 610"><rect width="760" height="610" fill="white"/><rect width="760" height="70" fill="${unfinished ? '#fff0cb' : '#e6f3ed'}"/><text x="20" y="29" font-family="Arial,sans-serif" font-size="20" fill="#172b3a">${heading}</text><text x="20" y="53" font-family="Arial,sans-serif" font-size="13" fill="#384c58">${note}</text><svg y="70">${model}</svg></svg>`;
}

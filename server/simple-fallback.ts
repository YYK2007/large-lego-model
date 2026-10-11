import { COLORS, PARTS } from '../shared/model.js';
import type { ShapePlan } from './compiler.js';

export const SIMPLE_PART_IDS: ReadonlySet<string> = new Set(Object.values(PARTS).filter(part => ['brick', 'plate', 'tile'].includes(part.kind)).map(part => part.id));
export const SIMPLE_COLOR_IDS: ReadonlySet<number> = new Set(Object.keys(COLORS).map(Number));
export const simpleFallbackInstructions = `SIMPLER BUILD: prioritize a working, recognizable draft over difficult construction details. Use only the supplied simplePartIds and simpleColorIds, with each part's verified colors. Keep the reference silhouette, height/width/depth ratios, dominant colors and identifying features. Connect ALL major identifying regions, in their required colors, before adding secondary details. A supporting stem, frame or base alone is not the requested object; never remove its main body or colored feature to pass construction checks. Keep the same defining-feature list for review; do not hide missing details by deleting requirements. Approximate secondary texture, thin appendages and ornate surfaces with connected stepped brick/plate courses. Use ordinary bricks for the connected body and overlapping plates to tie seams together; tiles are surface decoration, never supports for upper bricks. Replace slope runs and specialty parts with supported stepped geometry. Join disconnected sections at supported roots or bridges, and thicken fragile features locally while preserving defining openings and visibly separate layers. Simpler parts do not imply one solid envelope. Avoid isolated one-plate details, floating ornaments, decorative bases and a generic cube. Preserve confirmed stock and the user's explicit budget. Explain visible simplifications in observations.limitations when returning a full plan. Continue from the supplied plan and checker feedback; do not change the subject.`;

/** A fallback is a real parts constraint, not just a prompt suggestion. */
export function assertSimplePlan(plan: ShapePlan): void {
  const visit = (section: Record<string, unknown>) => {
    if (Array.isArray(section.slopes) && section.slopes.length) throw new Error('The simpler build uses stepped bricks and plates instead of slope runs. Replace the slopes with connected supported geometry.');
    for (const field of ['boxes', 'profiles', 'parts', 'repeats', 'components']) {
      if (!Array.isArray(section[field])) continue;
      for (const item of section[field]) {
        if (!item || typeof item !== 'object') continue;
        if ('partId' in item && !SIMPLE_PART_IDS.has(item.partId)) throw new Error(`The simpler build cannot use specialty part ${item.partId}. Replace it with ordinary bricks, plates or surface tiles.`);
        if ('colorId' in item && !SIMPLE_COLOR_IDS.has(item.colorId)) throw new Error('The simpler build needs a standard color from simpleColorIds that exists for the chosen part and confirmed stock.');
        visit(item);
      }
    }
  };
  visit(plan as unknown as Record<string, unknown>);
}

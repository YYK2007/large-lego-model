import type { BuildStep } from './model.js';
import type { AssemblyPoint } from './assembly.js';

export type ManualStepGroup = {
  kind: 'single' | 'placements' | 'stack';
  steps: BuildStep[];
  origins: AssemblyPoint[];
  /** Two checked layers, A then B, make one complete repeated stack cycle. */
  patternLength?: 2;
};
// A page-layout limit, never a limit on the model or checked assembly steps.
export const MAX_REPEATS_PER_PAGE = 8;

function origin(step: BuildStep): AssemblyPoint {
  return step.bricks.reduce((point, brick) => ({ x: Math.min(point.x, brick.x), y: Math.min(point.y, brick.y), z: Math.min(point.z, brick.z) }), { x: Infinity, y: Infinity, z: Infinity });
}

function pattern(step: BuildStep, at: AssemblyPoint): string | undefined {
  if (!step.bricks.length || step.bricks.length !== step.placements.length || step.placements.some(placement => placement.approach !== 'above')) return;
  return JSON.stringify(step.bricks.map((brick, index) => {
    const placement = step.placements[index];
    if (placement.brickId !== brick.id) throw new Error('Manual placement order does not match its checked step.');
    return [brick.partId, brick.colorId, brick.rotation, brick.x - at.x, brick.y - at.y, brick.z - at.z,
      placement.approach, placement.waypoints.map(point => [point.x - at.x, point.y - at.y, point.z - at.z])];
  }));
}

/** Presentation only: preserve every checked step and its piece order exactly. */
export function groupManualSteps(steps: BuildStep[]): ManualStepGroup[] {
  const groups: ManualStepGroup[] = [];
  const prepared = steps.map(step => { const at = origin(step); return { at, signature: pattern(step, at) }; });
  for (let index = 0; index < steps.length;) {
    const first = steps[index], { at: firstOrigin, signature } = prepared[index];
    const group: ManualStepGroup = { kind: 'single', steps: [first], origins: [firstOrigin] };
    const placedInGroup = new Set(first.bricks.map(brick => brick.id));
    while (signature && group.steps.length < MAX_REPEATS_PER_PAGE && index + group.steps.length < steps.length) {
      const next = steps[index + group.steps.length], { at, signature: nextSignature } = prepared[index + group.steps.length], previous = group.steps.at(-1)!, priorOrigin = group.origins.at(-1)!;
      if (next.index !== previous.index + 1 || nextSignature !== signature) break;
      const attachesWithin = next.placements.some(placement => placement.attachedTo.some(id => placedInGroup.has(id)));
      const kind = at.z === firstOrigin.z && (at.x !== priorOrigin.x || at.y !== priorOrigin.y) && !attachesWithin ? 'placements'
        : at.x === firstOrigin.x && at.y === firstOrigin.y && at.z > priorOrigin.z && attachesWithin ? 'stack' : undefined;
      if (!kind || group.kind !== 'single' && group.kind !== kind) break;
      group.kind = kind; group.steps.push(next); group.origins.push(at);
      for (const brick of next.bricks) placedInGroup.add(brick.id);
    }
    // Preserve existing one-layer groups. Only exact, dependent A/B stacks
    // qualify; partial cycles and horizontal/side-entry sequences stay separate.
    const secondSignature = prepared[index + 1]?.signature;
    if (group.kind === 'single' && signature && secondSignature && signature !== secondSignature && index + 3 < steps.length) {
      const uniqueParts = new Set(steps.slice(index, index + 2).flatMap(step => step.bricks.map(brick => `${brick.partId}:${brick.colorId}`)));
      // Keep the parts tray within the existing three-row instruction layout.
      if (uniqueParts.size <= 12) {
        const cycleHeight = prepared[index + 2].at.z - firstOrigin.z;
        let count = 1;
        for (; count < MAX_REPEATS_PER_PAGE * 2 && index + count < steps.length; count++) {
          const next = steps[index + count], previous = steps[index + count - 1];
          const { at, signature: nextSignature } = prepared[index + count], patternIndex = count % 2;
          const template = prepared[index + patternIndex], prior = prepared[index + count - 1];
          const supports = new Set(previous.bricks.map(brick => brick.id));
          if (next.index !== previous.index + 1 || nextSignature !== template.signature
            || at.x !== firstOrigin.x || at.y !== firstOrigin.y || at.z <= prior.at.z
            || at.z !== template.at.z + Math.floor(count / 2) * cycleHeight
            || !next.placements.every(placement => placement.attachedTo.some(id => supports.has(id)))) break;
        }
        count -= count % 2;
        if (count >= 4) {
          group.kind = 'stack'; group.patternLength = 2;
          group.steps = steps.slice(index, index + count);
          group.origins = prepared.slice(index, index + count).map(item => item.at);
        }
      }
    }
    groups.push(group); index += group.steps.length;
  }
  return groups;
}

import type { BuildStep } from '../shared/model.js';
import type { AssemblyPoint } from '../shared/assembly.js';

export type ManualStepGroup = {
  kind: 'single' | 'placements' | 'stack';
  steps: BuildStep[];
  origins: AssemblyPoint[];
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
  for (let index = 0; index < steps.length;) {
    const first = steps[index], firstOrigin = origin(first), signature = pattern(first, firstOrigin);
    const group: ManualStepGroup = { kind: 'single', steps: [first], origins: [firstOrigin] };
    const placedInGroup = new Set(first.bricks.map(brick => brick.id));
    while (signature && group.steps.length < MAX_REPEATS_PER_PAGE && index + group.steps.length < steps.length) {
      const next = steps[index + group.steps.length], at = origin(next), previous = group.steps.at(-1)!, priorOrigin = group.origins.at(-1)!;
      if (next.index !== previous.index + 1 || pattern(next, at) !== signature) break;
      const attachesWithin = next.placements.some(placement => placement.attachedTo.some(id => placedInGroup.has(id)));
      const kind = at.z === firstOrigin.z && (at.x !== priorOrigin.x || at.y !== priorOrigin.y) && !attachesWithin ? 'placements'
        : at.x === firstOrigin.x && at.y === firstOrigin.y && at.z > priorOrigin.z && attachesWithin ? 'stack' : undefined;
      if (!kind || group.kind !== 'single' && group.kind !== kind) break;
      group.kind = kind; group.steps.push(next); group.origins.push(at);
      for (const brick of next.bricks) placedInGroup.add(brick.id);
    }
    groups.push(group); index += group.steps.length;
  }
  return groups;
}

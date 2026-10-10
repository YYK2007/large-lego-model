import type { ShapePlanV2 } from './compiler.js';

export type PlanRepairEdit = { op: 'add' | 'replace' | 'remove'; path: string; valueJson: string };
export const repairSchema = {
  type: 'object', required: ['edits'], properties: {
    // Gemini 3.8 rejected this request with minItems/maxItems despite their
    // documented support. Enforce the edit bounds locally below instead.
    edits: { type: 'array', items: {
      type: 'object', required: ['op', 'path', 'valueJson'], properties: {
        op: { type: 'string', enum: ['add', 'replace', 'remove'] },
        path: { type: 'string', description: 'JSON pointer under /boxes, /slopes, /parts, or /repeats. Use a numeric array index; /- appends.' },
        valueJson: { type: 'string', description: 'The replacement or added value encoded as JSON text. Use an empty string for remove.' },
      },
    } },
  },
};

const roots = new Set(['boxes', 'slopes', 'parts', 'repeats']);
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
type Container = Record<string, unknown> | unknown[];
const isContainer = (value: unknown): value is Container => value !== null && typeof value === 'object';

function pointer(path: string): string[] {
  if (!path.startsWith('/') || /~(?![01])/.test(path)) throw new Error('Repair path must be a valid JSON pointer.');
  const segments = path.slice(1).split('/').map(segment => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (!roots.has(segments[0]) || segments.some(segment => !segment || forbidden.has(segment))) throw new Error('Repair paths may only edit safe geometry fields under boxes, slopes, parts, or repeats.');
  return segments;
}

function arrayIndex(segment: string, length: number, adding = false): number {
  if (adding && segment === '-') return length;
  if (!/^(0|[1-9]\d*)$/.test(segment)) throw new Error('Repair array index must be a nonnegative integer, or - for append.');
  const index = Number(segment);
  if (!Number.isSafeInteger(index) || index >= length + Number(adding)) throw new Error('Repair array index does not exist.');
  return index;
}

function checkValue(value: unknown, depth = 0) {
  if (depth > 32) throw new Error('Repair value is nested too deeply.');
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Repair values must contain finite numbers.');
  if (isContainer(value)) for (const [key, child] of Object.entries(value)) {
    if (forbidden.has(key)) throw new Error('Repair values cannot contain prototype keys.');
    checkValue(child, depth + 1);
  }
}

/** Apply only geometry edits atomically. The normal compiler still validates the resulting complete plan. */
export function applyPlanRepair(plan: ShapePlanV2, edits: unknown): ShapePlanV2 {
  if (!Array.isArray(edits) || edits.length < 1 || edits.length > 80) throw new Error('Provide between 1 and 80 geometry repair edits.');
  const repaired = structuredClone(plan);
  let payloadSize = 0;
  for (const edit of edits) {
    if (!edit || !['add', 'replace', 'remove'].includes(edit.op) || typeof edit.path !== 'string' || typeof edit.valueJson !== 'string') throw new Error('Each repair edit needs op, path, and valueJson strings.');
    payloadSize += edit.path.length + edit.valueJson.length;
    if (edit.path.length > 500 || payloadSize > 100_000) throw new Error('Repair edit payload is too large.');
    const segments = pointer(edit.path);
    let parent: Container = repaired as unknown as Record<string, unknown>;
    for (const segment of segments.slice(0, -1)) {
      const key = Array.isArray(parent) ? arrayIndex(segment, parent.length) : segment;
      if (!Object.hasOwn(parent, key)) throw new Error('Repair parent path does not exist: ' + edit.path);
      const child: unknown = (parent as Record<string | number, unknown>)[key];
      if (!isContainer(child)) throw new Error('Repair parent path is not an object or array.');
      parent = child;
    }
    const last = segments.at(-1)!;
    const key = Array.isArray(parent) ? arrayIndex(last, parent.length, edit.op === 'add') : last;
    if (last === '-' && !Array.isArray(parent)) throw new Error('Append is only valid for an array.');
    if (edit.op !== 'add' && !Object.hasOwn(parent, key)) throw new Error('Repair target path does not exist: ' + edit.path);
    let value: unknown;
    if (edit.op !== 'remove') {
      try { value = JSON.parse(edit.valueJson); } catch { throw new Error('Repair valueJson is not valid JSON.'); }
      checkValue(value);
    }
    if (Array.isArray(parent)) {
      if (edit.op === 'add') parent.splice(key as number, 0, value);
      else if (edit.op === 'remove') parent.splice(key as number, 1);
      else parent[key as number] = value;
    } else if (edit.op === 'remove') delete parent[key];
    else parent[key] = value;
  }
  for (const root of roots) {
    const value = (repaired as unknown as Record<string, unknown>)[root];
    if (value !== undefined && !Array.isArray(value)) throw new Error('Plan geometry roots must remain arrays.');
  }
  return repaired;
}

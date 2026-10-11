import type { Design } from '../shared/model';

export type GenerationProgress = { stage: 'researching' | 'planning' | 'checking' | 'comparing' | 'repairing'; attempt: number; maxAttempts: number };

export class BuildRequestError extends Error {
  readonly checks: string[];
  constructor(message: string, checks: unknown = []) {
    super(message);
    this.checks = Array.isArray(checks) ? checks.filter((check): check is string => typeof check === 'string' && Boolean(check.trim())) : [];
  }
}

/** Summarize the latest rejected plan; keep the exact feedback available separately. */
export function summarizeBuildChecks(checks: string[]): string {
  const latest = checks.at(-1) || '';
  if (/cannot pack.*supported part shapes/i.test(latest)) return 'Some planned details could not be made with the supported part shapes.';
  if (/cannot pack.*inventory|available inventory.*missing|missing.*pieces/i.test(latest)) return 'The last plan could not be built with the available pieces.';
  if (/no stud support|disconnected|without a matching underside/i.test(latest)) return 'The last plan had unsupported or disconnected pieces.';
  if (/overlap|intersect/i.test(latest)) return 'Some part placements in the last plan conflict.';
  if (/exceeds.*grid|beyond.*workspace/i.test(latest)) return 'The last plan extends beyond the supported building area.';
  if (/too flat|thin relief/i.test(latest)) return 'The last plan did not have enough depth to match a three-dimensional build.';
  if (/budget/i.test(latest)) return 'The last plan exceeds the piece limit you requested.';
  if (/dimensions|coordinates|unsupported part|unsupported color|slope run/i.test(latest)) return 'Some planned shapes or parts are outside the supported catalog.';
  if (/JSON|Unexpected token|Unexpected end/i.test(latest)) return 'The planner returned an incomplete or unreadable design.';
  return latest ? latest.length > 180 ? `${latest.slice(0, 177)}...` : latest : '';
}

export async function readGenerationStream(response: Response, onProgress: (event: GenerationProgress) => void): Promise<Design> {
  if (!response.ok) {
    const body = await response.json();
    throw new BuildRequestError(body.error || 'The build request failed. Your current design is unchanged.', body.checks);
  }
  if (!response.body) throw new Error('The connection closed before the design arrived.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let design: Design | undefined;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === 'error') throw new BuildRequestError(event.error, event.checks);
    if (event.type === 'progress') onProgress(event);
    if (event.type === 'design') design = event.design;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;
      lines.forEach(consume);
      if (done) { consume(buffer); break; }
    }
  } finally { reader.releaseLock(); }
  if (!design) throw new Error('The connection ended before the design was saved. Your current design is unchanged.');
  return design;
}

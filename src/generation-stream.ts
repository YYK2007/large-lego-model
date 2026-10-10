import type { Design } from '../shared/model';

export type GenerationProgress = { stage: 'planning' | 'checking' | 'repairing'; attempt: number; maxAttempts: number };

export async function readGenerationStream(response: Response, onProgress: (event: GenerationProgress) => void): Promise<Design> {
  if (!response.ok) {
    const body = await response.json();
    throw new Error(body.error || 'The build request failed. Your current design is unchanged.');
  }
  if (!response.body) throw new Error('The connection closed before the design arrived.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let design: Design | undefined;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === 'error') throw new Error(event.error);
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

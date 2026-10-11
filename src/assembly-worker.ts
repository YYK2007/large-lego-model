import { buildSteps, type Design } from '../shared/model';
import { groupManualSteps } from '../shared/manual-repeats';

self.onmessage = (event: MessageEvent<Design>) => {
  try {
    const steps = buildSteps(event.data);
    self.postMessage({ steps, groups: groupManualSteps(steps).map(group => ({ kind: group.kind, first: group.steps[0].index - 1, last: group.steps.at(-1)!.index - 1, patternLength: group.patternLength ?? 1 })) });
  } catch {
    self.postMessage({ error: 'The step sequence could not be loaded. Your saved model is still available. Please reopen the guide or ask for /manual in Messages.' });
  }
};

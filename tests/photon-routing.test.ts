import assert from 'node:assert/strict';
import test from 'node:test';
import { routeText } from '../server/photon-routing.js';

test('explicit natural Stop requests route deterministically without conversation', () => {
  for (const text of [
    'stop', 'stop.', 'STOP!', 'cancel', '/stop', '/cancel.',
    'please stop', 'stop it', 'stop generating', 'cancel this build',
    'stop please', 'can you stop', 'please stop sending',
    'Could you please stop?', 'Would you stop generating, please?',
    'Please, stop.', 'stop this build', 'cancel the generation',
    'cancel it please', '  please\nstop  ',
  ]) {
    assert.deepEqual(routeText(text), { kind: 'stop', prompt: '' }, text);
  }
});

test('stop subjects, questions and negated requests retain their original prompt', () => {
  for (const text of [
    "don't stop", 'don’t stop', 'do not stop', "please don't stop",
    'can you not stop', "don't cancel this build", 'never stop generating',
    'stop sign', 'a bus stop', 'build a stop sign', 'please build a bus stop',
    'make the stop sign red', 'stop motion camera',
    'why did you stop?', 'when will you stop?', 'how can I stop?',
    'can you stop automatically?', 'what does stop generating mean?',
    'please stop adding windows', 'stop sending? No, keep going.',
    'stop please if the model is ready', 'please stop, not yet',
    'do not stop. Keep generating.',
  ]) {
    const result = routeText(text);
    assert.ok(result.kind === 'conversation' || result.kind === 'design', text);
    assert.equal(result.prompt, text, text);
  }
});

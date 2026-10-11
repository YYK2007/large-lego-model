import assert from 'node:assert/strict';
import test from 'node:test';
import { likenessReviewSchema, parseLikenessReview } from '../server/likeness-review.js';
import { isDesignResearch, type DesignResearch, type FeatureReview } from '../shared/references.js';

const names = ['A continuous wall between two towers', 'Flat crenellated tower roofs'];
const present = (index: number): FeatureReview => ({ index, status: 'present', evidence: `The model visibly preserves feature ${index + 1} in both rendered views.`, correction: '' });
const recognizable = () => ({ status: 'recognizable' as const, perceivedSubject: 'A fortified wall between two towers',
  evidence: 'A long connected rampart joins two taller end towers, each with a visibly crenellated roofline in both views.', correction: '' });
const response = (features: FeatureReview[] = names.map((_, index) => present(index))) => ({ matches: true, summary: 'Both defining features match the reference.', issues: [] as string[], features, identity: recognizable() });
const legacy: DesignResearch = {
  subject: 'A wall', sources: [], uploadedImage: true,
  observations: { silhouette: 'A wall between two towers.', proportions: 'Long and low.', features: names, colors: ['Gray'], limitations: [] },
  comparison: { status: 'matched', summary: 'The visible features match.', issues: [] }, warnings: [],
};

test('complete all-present reviews retain exact indices in observation order without mutating input', () => {
  const withExtraField = { ...present(1), unrelated: 'Do not persist arbitrary critic fields.' };
  const input = response([withExtraField, present(0)]), before = JSON.stringify(input);
  const result = parseLikenessReview(input, names);
  assert.equal(result.status, 'matched');
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.features?.map(feature => feature.index), [0, 1]);
  assert.deepEqual(result.features?.[1], present(1));
  assert.equal(JSON.stringify(input), before);
  assert.equal(isDesignResearch({ ...legacy, comparison: result }), true);
  assert.ok(likenessReviewSchema.required.includes('features'));
  assert.ok(likenessReviewSchema.required.includes('identity'));
  assert.deepEqual(result.identity, recognizable());
});

test('all-present feature claims cannot approve lookalikes with unresolved identity', () => {
  // These are mock critic outputs, not geometric templates or proof that a vision
  // model identifies the subjects correctly. The parser must honor its own doubt.
  const cases = [
    { target: 'A rose', labels: ['Red bloom above a green stem', 'Green lateral leaves'], status: 'ambiguous' as const, perceivedSubject: 'A tomato-like red mass on a stem',
      evidence: 'The head is a closed stepped mass; the visible exterior has no overlapping cupped petal surfaces to distinguish the intended flower from a fruit.',
      correction: 'Form distinct overlapping petal surfaces with visible rims and recesses instead of one solid head.' },
    { target: 'A clock tower', labels: ['Tall masonry shaft', 'Gray stone exterior'], status: 'different' as const, perceivedSubject: 'A plain rectangular box',
      evidence: 'The uninterrupted rectangular outline has neither a separate clock stage nor a narrowing roof silhouette.',
      correction: 'Separate the clock stage and roof in the visible silhouette while preserving the tall shaft proportions.' },
    { target: 'An elephant', labels: ['Gray rounded body', 'Large central body mass'], status: 'ambiguous' as const, perceivedSubject: 'A gray sphere',
      evidence: 'The round body has no visible trunk, ear contours, or separated legs, so its outline does not establish an animal identity.',
      correction: 'Resolve the trunk, broad ears and leg gaps in the silhouette rather than relying on the gray body alone.' },
  ];
  for (const fixture of cases) {
    const { target, labels, ...identity } = fixture;
    const result = parseLikenessReview({ ...response(labels.map((_, index) => present(index))), identity }, labels);
    assert.equal(result.status, 'needs-work', target);
    assert.deepEqual(result.identity, identity);
    assert.ok(result.issues.some(issue => issue.includes(identity.evidence)), target);
    assert.ok(result.issues.some(issue => issue.includes(identity.correction)), target);
    const saved = { ...legacy, subject: target, observations: { ...legacy.observations, features: labels }, comparison: result };
    assert.equal(isDesignResearch(saved), true, target);
    assert.equal(isDesignResearch({ ...saved, comparison: { ...result, status: 'matched' } }), false, target);
  }
});

test('new critic responses require a complete identity gate with an honest correction', () => {
  for (const identity of [undefined, null, [], {},
    { ...recognizable(), status: 'looks-good' },
    { ...recognizable(), perceivedSubject: '' }, { ...recognizable(), perceivedSubject: ' ' },
    { ...recognizable(), evidence: '' }, { ...recognizable(), evidence: ' ' },
    { ...recognizable(), perceivedSubject: 'x'.repeat(601) }, { ...recognizable(), evidence: 'x'.repeat(601) },
    { ...recognizable(), correction: undefined }, { ...recognizable(), correction: 'Change its whole silhouette.' },
    { ...recognizable(), status: 'ambiguous', correction: '' }, { ...recognizable(), status: 'different', correction: ' ' },
    { ...recognizable(), status: 'different', correction: 'x'.repeat(601) },
  ]) assert.throws(() => parseLikenessReview({ ...response(), identity }, names), /identity/i);
});

test('unresolved identity survives the issue bound alongside full feature evidence', () => {
  const labels = Array.from({ length: 16 }, (_, i) => `Visible feature ${i + 1}`);
  const features = labels.map((_, index) => ({ index, status: 'missing' as const, evidence: 'The visible outline omits this feature.', correction: 'Add its distinct connected outline.' }));
  const identity = { ...recognizable(), status: 'different' as const, perceivedSubject: 'A plain block', evidence: 'The silhouette is a single block without the subject-defining sections.', correction: 'Rebuild the main silhouette with the required sections.' };
  const result = parseLikenessReview({ ...response(features), identity }, labels);
  assert.equal(result.status, 'needs-work'); assert.equal(result.issues.length, 16);
  assert.match(result.issues[0], /Subject identity is different/);
  assert.deepEqual(result.features, features);
  assert.equal(isDesignResearch({ ...legacy, observations: { ...legacy.observations, features: labels }, comparison: result }), true);
});

test('a claimed overall match cannot override a missing, incorrect, or uncertain defining feature', () => {
  for (const status of ['missing', 'incorrect', 'uncertain'] as const) {
    const unresolved: FeatureReview = { index: 0, status, evidence: 'The renders show two isolated towers; a connecting rampart is not visible.', correction: 'Construct a continuous rampart and show its connection to both towers.' };
    const result = parseLikenessReview(response([unresolved, present(1)]), names);
    assert.equal(result.status, 'needs-work', status);
    assert.match(result.issues[0], /Feature 1 \(A continuous wall between two towers\)/);
    assert.ok(result.issues[0].includes(unresolved.evidence));
    assert.ok(result.issues[0].includes(unresolved.correction));
    assert.deepEqual(result.features?.[0], unresolved);
    assert.equal(isDesignResearch({ ...legacy, comparison: result }), true);
    assert.equal(isDesignResearch({ ...legacy, comparison: { ...result, status: 'matched' } }), false);
  }
});

test('omitted, duplicate, fractional, and out-of-range feature indices are rejected', () => {
  for (const features of [undefined, [], [present(0)], [present(0), present(0)], [present(0), present(2)], [present(-1), present(1)], [present(0.5), present(1)]]) {
    assert.throws(() => parseLikenessReview({ ...response(), features }, names), /every reference feature index exactly once/);
  }
});

test('malformed critic fields and evidence cannot be silently accepted as a match', () => {
  for (const input of [null, [], { ...response(), matches: 'true' }, { ...response(), summary: '' }, { ...response(), issues: [12] }, { ...response(), issues: [' '] }]) assert.throws(() => parseLikenessReview(input, names), /visual comparison/);
  for (const bad of [
    { status: 'looks-good' }, { evidence: '' }, { evidence: 'x'.repeat(601) }, { correction: undefined },
    { status: 'missing', correction: '' }, { status: 'uncertain', correction: ' ' }, { correction: 'Actually change the roof.' },
  ]) assert.throws(() => parseLikenessReview(response([{ ...present(0), ...bad } as FeatureReview, present(1)]), names), /every reference feature/);
});

test('general issues and an explicit negative verdict remain actionable even when all features are present', () => {
  const general = parseLikenessReview({ ...response(), issues: ['The whole model is too squat.'] }, names);
  assert.equal(general.status, 'needs-work');
  assert.deepEqual(general.issues, ['The whole model is too squat.']);
  const negative = parseLikenessReview({ ...response(), matches: false, summary: 'The overall proportions remain too wide.' }, names);
  assert.equal(negative.status, 'needs-work');
  assert.deepEqual(negative.issues, ['The overall proportions remain too wide.']);
});

test('all unresolved features survive the existing issue bound ahead of general comments', () => {
  const labels = Array.from({ length: 16 }, (_, i) => `Feature ${i}`);
  const features = labels.map((_, index) => ({ index, status: 'missing' as const, evidence: 'This section is absent.', correction: 'Build the section shown in the reference.' }));
  const result = parseLikenessReview({ ...response(features), issues: Array.from({ length: 20 }, (_, i) => `General issue ${i}`) }, labels);
  assert.equal(result.issues.length, 16);
  assert.ok(result.issues.every((issue, index) => issue.startsWith(`Feature ${index + 1} (`)));
  assert.equal(result.features?.length, 16);
  assert.equal(isDesignResearch({ ...legacy, observations: { ...legacy.observations, features: labels }, comparison: result }), true);
});

test('legacy saved research remains valid while optional new feature evidence must match its observations', () => {
  assert.equal(isDesignResearch(legacy), true);
  for (const features of [null, [], [present(0)], [present(0), present(0)], [present(0), present(2)]]) assert.equal(isDesignResearch({ ...legacy, comparison: { ...legacy.comparison, features } }), false);
  const emptyLegacy = { ...legacy, observations: { ...legacy.observations, features: [] } };
  assert.equal(isDesignResearch(emptyLegacy), true);
  assert.equal(isDesignResearch({ ...emptyLegacy, comparison: { ...legacy.comparison, features: [] } }), false);
  for (const labels of [[], [''], [' '], Array.from({ length: 17 }, (_, i) => `Feature ${i}`)]) assert.throws(() => parseLikenessReview(response([]), labels), /1–16 nonempty descriptions/);
});

test('legacy evidence needs no identity field, but malformed newly supplied identity is rejected', () => {
  assert.equal(isDesignResearch(legacy), true);
  assert.equal(isDesignResearch({ ...legacy, comparison: { ...legacy.comparison, identity: recognizable() } }), true);
  for (const identity of [null, [], {}, { ...recognizable(), evidence: '' }, { ...recognizable(), status: 'different', correction: '' }]) {
    assert.equal(isDesignResearch({ ...legacy, comparison: { ...legacy.comparison, identity } }), false);
  }
  const identity = { ...recognizable(), status: 'ambiguous' as const, correction: 'Resolve the distinguishing outline.' };
  assert.equal(isDesignResearch({ ...legacy, comparison: { ...legacy.comparison, identity } }), false);
  assert.equal(isDesignResearch({ ...legacy, comparison: { ...legacy.comparison, status: 'needs-work', identity, issues: [identity.correction] } }), true);
});

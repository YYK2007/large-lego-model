import { isFeatureReviews, isIdentityReview, type DesignResearch } from '../shared/references.js';

export const likenessReviewInstructions = `Judge the actual rendered brick model against the original request and the reference pixels. The independently observed reference features are requirements, not proof that the model contains them.
First name what the geometry itself looks like, ignoring its title and the planner's claims. Decide whether it is recognizable as the requested subject, ambiguous with a plausible lookalike, or a different subject. Cite the visible distinguishing geometry: silhouette, proportions, arrangement, openings, folds, surface layers or other subject-defining structure. Matching colors and a mass in the right location do not establish identity. If a lookalike is more plausible, name it in perceivedSubject and explain the geometric change needed.
Then assess every supplied feature exactly once. A colored blob is not evidence for a layered, folded, perforated or otherwise distinctive surface. State what is actually visible, never what could be imagined inside a solid mass. Use uncertain when the available views cannot establish a feature. Do not excuse a missing identity-defining feature because LEGO parts are discrete; recommend a simpler connected approximation that preserves it. An unrelated or incomplete model cannot be matched merely because it passed brick checks. Return matches=true only when identity is recognizable, every required feature is present in the correct form, and no substantive discrepancy remains.`;

export const likenessReviewSchema = {
  type: 'object', required: ['matches', 'summary', 'issues', 'features', 'identity'], properties: {
    matches: { type: 'boolean' }, summary: { type: 'string' },
    issues: { type: 'array', items: { type: 'string' } },
    identity: { type: 'object', required: ['status', 'perceivedSubject', 'evidence', 'correction'], properties: {
      status: { type: 'string', enum: ['recognizable', 'ambiguous', 'different'] },
      perceivedSubject: { type: 'string', description: 'What the rendered geometry looks like without its title; name a competing lookalike if ambiguous. At most 600 characters.' },
      evidence: { type: 'string', description: 'Visible geometric distinctions that establish or undermine identity, not color or planner claims alone. At most 600 characters.' },
      correction: { type: 'string', description: 'Concrete shape change needed, at most 600 characters. Empty only when recognizable.' },
    } },
    features: { type: 'array', description: 'Assess every observations.features index exactly once, in its original order.', items: {
      type: 'object', required: ['index', 'status', 'evidence', 'correction'], properties: {
        index: { type: 'integer', description: 'Zero-based index in the supplied observations.features array.' },
        status: { type: 'string', enum: ['present', 'incorrect', 'missing', 'uncertain'], description: 'Present means the feature is visibly correct in the actual model; use uncertain when the supplied views cannot establish this.' },
        evidence: { type: 'string', description: 'Concrete visible model/reference evidence, at most 600 characters. Do not repeat the planner claim as proof.' },
        correction: { type: 'string', description: 'Concrete correction or view needed to resolve the discrepancy, at most 600 characters. Empty only for present.' },
      },
    } },
  },
};

/** Admit a complete critic response and derive the verdict from its feature evidence. */
export function parseLikenessReview(value: unknown, featureNames: readonly string[]): DesignResearch['comparison'] {
  if (!Array.isArray(featureNames) || featureNames.length < 1 || featureNames.length > 16 || !featureNames.every(name => typeof name === 'string' && name.trim())) throw new Error('Reference features must be a list of 1–16 nonempty descriptions.');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The visual comparison must be an object.');
  const review = value as { matches?: unknown; summary?: unknown; issues?: unknown; features?: unknown; identity?: unknown };
  if (typeof review.matches !== 'boolean' || typeof review.summary !== 'string' || !review.summary.trim()
    || !Array.isArray(review.issues) || !review.issues.every(issue => typeof issue === 'string' && issue.trim())) throw new Error('The visual comparison needs matches, a summary, and a list of concrete issues.');
  if (!isFeatureReviews(review.features, featureNames.length)) throw new Error('The visual comparison must assess every reference feature index exactly once, with a valid status, visible evidence, and a correction for any unresolved feature.');
  if (!isIdentityReview(review.identity)) throw new Error('The visual comparison must assess subject identity with a valid status, perceived subject, visible geometry evidence, and a correction when ambiguous or different.');
  const identity = { status: review.identity.status, perceivedSubject: review.identity.perceivedSubject.trim(), evidence: review.identity.evidence.trim(), correction: review.identity.correction.trim() };
  const features = review.features.map(feature => ({ index: feature.index, status: feature.status, evidence: feature.evidence.trim(), correction: feature.correction.trim() })).sort((a, b) => a.index - b.index);
  const featureIssues = features.filter(feature => feature.status !== 'present').map(feature =>
    `Feature ${feature.index + 1} (${featureNames[feature.index].slice(0, 600)}): ${feature.status}. ${feature.evidence} ${feature.correction}`);
  // Keep every unresolved feature ahead of general comments within the saved
  // metadata's existing issue bound. Full per-feature evidence is also retained.
  const identityIssues = identity.status === 'recognizable' ? [] : [`Subject identity is ${identity.status}: looks like ${identity.perceivedSubject}. ${identity.evidence} ${identity.correction}`.slice(0, 2000)];
  const issues = [...new Set([...identityIssues, ...featureIssues, ...review.issues.map(issue => (issue as string).trim().slice(0, 600))])].slice(0, 16);
  if (!review.matches && !issues.length) issues.push(review.summary.trim().slice(0, 600));
  return {
    status: review.matches && issues.length === 0 ? 'matched' : 'needs-work',
    summary: review.summary.trim().slice(0, 1000), issues, features, identity,
  };
}

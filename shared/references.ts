export type FeatureReview = {
  index: number;
  status: 'present' | 'incorrect' | 'missing' | 'uncertain';
  evidence: string;
  correction: string;
};

export type IdentityReview = {
  status: 'recognizable' | 'ambiguous' | 'different';
  perceivedSubject: string;
  evidence: string;
  correction: string;
};

export function isIdentityReview(value: unknown): value is IdentityReview {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const identity = value as IdentityReview;
  return ['recognizable', 'ambiguous', 'different'].includes(identity.status)
    && [identity.perceivedSubject, identity.evidence].every(text => typeof text === 'string' && Boolean(text.trim()) && text.length <= 600)
    && typeof identity.correction === 'string' && identity.correction.length <= 600
    && (identity.status === 'recognizable' ? identity.correction.trim() === '' : Boolean(identity.correction.trim()));
}

export type ReferenceComplexity = 'simple' | 'complex' | 'intricate';
export type ReferenceViewHint = 'front' | 'rear' | 'side' | 'north' | 'south' | 'east' | 'west' | 'above' | 'interior' | 'detail';
export type ReferenceTextSource = {
  id: string; title: string; url: string; publisher: 'Wikipedia' | 'Wikidata';
  excerpt: string; fetchedAt: string; sha256: string; revisionId?: number;
  licenseName: string; licenseUrl: string;
};
export type ReferenceModelEvidence = {
  title: string; sourcePageUrl: string; assetUrl: string; artist: string; credit: string; licenseName: string; licenseUrl: string;
  format: 'stl'; geometryRead: true; sha256: string; fetchedAt: string; triangleCount: number;
  bounds: { min: [number, number, number]; max: [number, number, number] }; units: 'unspecified'; viewImageIndices: number[];
};
export type ReferenceResearchBrief = {
  version: 1; subject: string; complexity: ReferenceComplexity; requestedImageCount: number;
  photos: { imageIndex: number; sourcePageUrl: string; sha256: string; viewHints: ReferenceViewHint[]; identityEvidence: 'article-linked' | 'metadata-match' | 'search-only' }[];
  textSources: ReferenceTextSource[];
  statements: { sourceId: string; statement: string; kind: 'dimension' | 'numeric-description' | 'proportion'; basis: 'source-reported'; start: number; end: number }[];
  measurements: { sourceId: string; propertyId: string; label: string; amount: string; unitUrl: string; unitLabel: string; lowerBound?: string; upperBound?: string; statementId: string; referenceUrls: string[]; qualifiers?: { propertyId: string; value: string }[] }[];
  links: { sourceId: string; url: string; label: string; relation: 'article-link' | 'official-website' | 'measurement-reference'; contentFetched: false }[];
  uncertainties: string[];
  models?: ReferenceModelEvidence[];
};

/** Validate persisted source anchors and bounds; this does not certify source truth. */
export function isReferenceResearchBrief(value: unknown): value is ReferenceResearchBrief {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const brief = value as ReferenceResearchBrief;
  const text = (item: unknown, max: number) => typeof item === 'string' && item.length <= max;
  const url = (item: unknown) => {
    if (!text(item, 4000)) return false;
    try { const parsed = new URL(item as string); return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password; } catch { return false; }
  };
  const numeric = (item: unknown) => typeof item === 'string' && item.length <= 80 && /^[+-]?\d+(?:\.\d+)?$/.test(item) && Number.isFinite(Number(item));
  const sha = (item: unknown) => typeof item === 'string' && /^[a-f0-9]{64}$/.test(item);
  if (brief.version !== 1 || !text(brief.subject, 4000) || !['simple', 'complex', 'intricate'].includes(brief.complexity)
    || !Number.isInteger(brief.requestedImageCount) || brief.requestedImageCount < 1 || brief.requestedImageCount > 12
    || !Array.isArray(brief.textSources) || brief.textSources.length > 4 || !Array.isArray(brief.photos) || brief.photos.length > 12
    || !Array.isArray(brief.statements) || brief.statements.length > 16 || !Array.isArray(brief.measurements) || brief.measurements.length > 16
    || !Array.isArray(brief.links) || brief.links.length > 32 || !Array.isArray(brief.uncertainties) || brief.uncertainties.length > 16 || !brief.uncertainties.every(item => text(item, 2000))) return false;
  const sources = new Map<string, ReferenceTextSource>();
  for (const source of brief.textSources) {
    if (!source || typeof source !== 'object' || !text(source.id, 400) || !source.id || sources.has(source.id) || !text(source.title, 300)
      || !['Wikipedia', 'Wikidata'].includes(source.publisher) || !url(source.url) || new URL(source.url).hostname !== (source.publisher === 'Wikipedia' ? 'en.wikipedia.org' : 'www.wikidata.org')
      || !text(source.excerpt, 6000) || !source.excerpt || !text(source.fetchedAt, 64) || !Number.isFinite(Date.parse(source.fetchedAt)) || !sha(source.sha256)
      || !text(source.licenseName, 200) || !url(source.licenseUrl) || source.revisionId !== undefined && (!Number.isSafeInteger(source.revisionId) || source.revisionId < 1)) return false;
    sources.set(source.id, source);
  }
  const photoIndices = new Set<number>();
  for (const photo of brief.photos) {
    if (!photo || !Number.isInteger(photo.imageIndex) || photo.imageIndex < 0 || photo.imageIndex >= 12 || photoIndices.has(photo.imageIndex) || !url(photo.sourcePageUrl) || !sha(photo.sha256)
      || !['article-linked', 'metadata-match', 'search-only'].includes(photo.identityEvidence) || !Array.isArray(photo.viewHints) || photo.viewHints.length > 10
      || !photo.viewHints.every(hint => ['front', 'rear', 'side', 'north', 'south', 'east', 'west', 'above', 'interior', 'detail'].includes(hint))) return false;
    photoIndices.add(photo.imageIndex);
  }
  if (brief.models !== undefined) {
    if (!Array.isArray(brief.models) || brief.models.length > 1) return false;
    for (const model of brief.models) {
      if (!model || !text(model.title, 500) || !url(model.sourcePageUrl) || !url(model.assetUrl) || !text(model.artist, 2000) || !text(model.credit, 2000)
        || !text(model.licenseName, 2000) || !model.licenseName || model.licenseUrl !== '' && !url(model.licenseUrl)
        || model.format !== 'stl' || model.geometryRead !== true || !sha(model.sha256) || !text(model.fetchedAt, 64) || !Number.isFinite(Date.parse(model.fetchedAt))
        || !Number.isSafeInteger(model.triangleCount) || model.triangleCount < 1 || model.triangleCount > 100_000 || model.units !== 'unspecified'
        || !model.bounds || ![model.bounds.min, model.bounds.max].every(point => Array.isArray(point) && point.length === 3 && point.every(value => Number.isFinite(value) && Math.abs(value) <= 1e9))
        || model.bounds.max.some((value, axis) => value <= model.bounds.min[axis]) || !Array.isArray(model.viewImageIndices) || !model.viewImageIndices.length || model.viewImageIndices.length > 3
        || model.viewImageIndices.some(index => !Number.isInteger(index) || index < 0 || index >= 12 || photoIndices.has(index)) || new Set(model.viewImageIndices).size !== model.viewImageIndices.length) return false;
    }
  }
  for (const statement of brief.statements) {
    if (!statement || !sources.has(statement.sourceId) || !text(statement.statement, 700) || !['dimension', 'numeric-description', 'proportion'].includes(statement.kind) || statement.basis !== 'source-reported'
      || !Number.isInteger(statement.start) || !Number.isInteger(statement.end) || statement.start < 0 || statement.end <= statement.start
      || statement.end > sources.get(statement.sourceId)!.excerpt.length || sources.get(statement.sourceId)!.excerpt.slice(statement.start, statement.end) !== statement.statement) return false;
  }
  for (const item of brief.measurements) {
    if (!item || sources.get(item.sourceId)?.publisher !== 'Wikidata' || !/^P[1-9]\d*$/.test(item.propertyId) || !text(item.label, 200) || !numeric(item.amount)
      || !(item.unitUrl === '' || /^https:\/\/www\.wikidata\.org\/entity\/Q[1-9]\d*$/.test(item.unitUrl)) || !text(item.unitLabel, 100) || !text(item.statementId, 200)
      || !Array.isArray(item.referenceUrls) || item.referenceUrls.length > 4 || !item.referenceUrls.every(url)
      || item.lowerBound !== undefined && !numeric(item.lowerBound) || item.upperBound !== undefined && !numeric(item.upperBound)
      || item.qualifiers !== undefined && (!Array.isArray(item.qualifiers) || item.qualifiers.length > 12 || !item.qualifiers.every(qualifier => qualifier && /^P[1-9]\d*$/.test(qualifier.propertyId) && text(qualifier.value, 600)))) return false;
  }
  return brief.links.every(item => item && sources.has(item.sourceId) && url(item.url) && text(item.label, 600) && ['article-link', 'official-website', 'measurement-reference'].includes(item.relation) && item.contentFetched === false);
}

/** Each observation is assessed once; this validates structure, not visual truth. */
export function isFeatureReviews(value: unknown, featureCount: number): value is FeatureReview[] {
  if (!Number.isInteger(featureCount) || featureCount < 1 || featureCount > 16 || !Array.isArray(value) || value.length !== featureCount) return false;
  const indices = new Set<number>();
  for (const feature of value) {
    if (!feature || typeof feature !== 'object' || !Number.isInteger(feature.index) || feature.index < 0 || feature.index >= featureCount || indices.has(feature.index)
      || !['present', 'incorrect', 'missing', 'uncertain'].includes(feature.status)
      || typeof feature.evidence !== 'string' || !feature.evidence.trim() || feature.evidence.length > 600
      || typeof feature.correction !== 'string' || feature.correction.length > 600
      || (feature.status === 'present' ? feature.correction.trim() !== '' : !feature.correction.trim())) return false;
    indices.add(feature.index);
  }
  return true;
}

/** Saved evidence for a design. Image bytes stay on the server during generation. */
export type DesignResearch = {
  subject: string;
  sources: {
    fileTitle: string; sourcePageUrl: string; imageUrl: string;
    artist: string; credit: string; licenseName: string; licenseUrl: string;
    fetchedAt: string; sha256: string;
    mediaType?: 'photo' | 'model-render'; viewLabel?: string;
  }[];
  uploadedImage: boolean;
  observations: {
    silhouette: string;
    proportions: string;
    features: string[];
    colors: string[];
    limitations: string[];
  };
  comparison: {
    status: 'matched' | 'needs-work';
    summary: string;
    issues: string[];
    features?: FeatureReview[];
    identity?: IdentityReview;
  };
  warnings: string[];
  brief?: ReferenceResearchBrief;
};

/** Validate saved/client evidence structurally; this does not authenticate a claim of likeness. */
export function isDesignResearch(value: unknown): value is DesignResearch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const research = value as DesignResearch;
  const text = (item: unknown, max = 2000) => typeof item === 'string' && item.length <= max;
  const texts = (items: unknown) => Array.isArray(items) && items.length <= 16 && items.every(item => text(item));
  const https = (item: unknown, optional = false) => {
    if (optional && item === '') return true;
    if (!text(item, 4000)) return false;
    try { const url = new URL(item as string); return (url.protocol === 'https:' || optional && url.protocol === 'http:') && !url.username && !url.password; } catch { return false; }
  };
  const observation = research.observations, comparison = research.comparison;
  return text(research.subject, 4000) && typeof research.uploadedImage === 'boolean'
    && Array.isArray(research.sources) && research.sources.length <= 12 && research.sources.every(source => source && typeof source === 'object'
      && text(source.fileTitle) && https(source.sourcePageUrl) && https(source.imageUrl)
      && text(source.artist) && text(source.credit) && text(source.licenseName) && https(source.licenseUrl, true)
      && typeof source.sha256 === 'string' && /^[a-f0-9]{64}$/.test(source.sha256)
      && (source.mediaType === undefined || ['photo', 'model-render'].includes(source.mediaType)) && (source.viewLabel === undefined || text(source.viewLabel, 100))
      && text(source.fetchedAt, 64) && Number.isFinite(Date.parse(source.fetchedAt)))
    && Boolean(observation) && text(observation.silhouette) && text(observation.proportions)
    && texts(observation.features) && texts(observation.colors) && texts(observation.limitations)
    && Boolean(comparison) && ['matched', 'needs-work'].includes(comparison.status)
    && text(comparison.summary) && texts(comparison.issues) && texts(research.warnings)
    && (comparison.features === undefined || isFeatureReviews(comparison.features, observation.features.length)
      && (comparison.status !== 'matched' || comparison.issues.length === 0 && comparison.features.every(feature => feature.status === 'present')))
    && (comparison.identity === undefined || isIdentityReview(comparison.identity)
      && (comparison.status !== 'matched' || comparison.identity.status === 'recognizable' && comparison.issues.length === 0))
    && (research.brief === undefined || isReferenceResearchBrief(research.brief) && research.brief.photos.every(photo => research.sources.some(source => source.sha256 === photo.sha256 && source.sourcePageUrl === photo.sourcePageUrl)));
}

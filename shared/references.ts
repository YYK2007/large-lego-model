/** Saved evidence for a design. Image bytes stay on the server during generation. */
export type DesignResearch = {
  subject: string;
  sources: {
    fileTitle: string; sourcePageUrl: string; imageUrl: string;
    artist: string; credit: string; licenseName: string; licenseUrl: string;
    fetchedAt: string; sha256: string;
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
  };
  warnings: string[];
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
    && Array.isArray(research.sources) && research.sources.length <= 3 && research.sources.every(source => source && typeof source === 'object'
      && text(source.fileTitle) && https(source.sourcePageUrl) && https(source.imageUrl)
      && text(source.artist) && text(source.credit) && text(source.licenseName) && https(source.licenseUrl, true)
      && typeof source.sha256 === 'string' && /^[a-f0-9]{64}$/.test(source.sha256)
      && text(source.fetchedAt, 64) && Number.isFinite(Date.parse(source.fetchedAt)))
    && Boolean(observation) && text(observation.silhouette) && text(observation.proportions)
    && texts(observation.features) && texts(observation.colors) && texts(observation.limitations)
    && Boolean(comparison) && ['matched', 'needs-work'].includes(comparison.status)
    && text(comparison.summary) && texts(comparison.issues) && texts(research.warnings);
}

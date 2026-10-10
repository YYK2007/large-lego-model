import { useState } from 'react';
import type { DesignResearch } from '../shared/references';

function publicUrl(value: unknown) {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter(item => typeof item === 'string' && item.trim()) : [];

function ReferencePhoto({ source }: { source: DesignResearch['sources'][number] }) {
  const [failed, setFailed] = useState(false);
  const pageUrl = publicUrl(source.sourcePageUrl);
  const imageUrl = publicUrl(source.imageUrl);
  const title = text(source.fileTitle).replace(/^File:/, '') || 'Reference photograph';
  const artist = text(source.artist);
  const credit = text(source.credit);
  return <figure>
    <a className="reference-photo-link" href={pageUrl} target="_blank" rel="noreferrer" aria-label={`View source: ${title}`}>
      {imageUrl && !failed ? <img src={imageUrl} alt={title} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <span className="reference-photo-unavailable">Photo unavailable here{pageUrl ? ' · open the source' : ''}</span>}
    </a>
    <figcaption><a href={pageUrl} target="_blank" rel="noreferrer">{title}</a>
      {artist && <span>{artist}</span>}{credit && credit !== artist && <span>{credit}</span>}
      <a href={publicUrl(source.licenseUrl) || pageUrl} target="_blank" rel="noreferrer">{text(source.licenseName) || 'Source license'}</a>
    </figcaption>
  </figure>;
}

export function ReferenceReview({ research, sessionPhoto }: { research: DesignResearch; sessionPhoto?: { data: string; mimeType: string } }) {
  const needsWork = research.comparison?.status === 'needs-work';
  const compared = needsWork || research.comparison?.status === 'matched';
  const issues = strings(research.comparison?.issues);
  const sources = Array.isArray(research.sources) ? research.sources.filter(source => source && typeof source === 'object') : [];
  const observations = research.observations;
  const uploadedPhoto = research.uploadedImage && sessionPhoto && ['image/jpeg', 'image/png', 'image/webp'].includes(sessionPhoto.mimeType) ? `data:${sessionPhoto.mimeType};base64,${sessionPhoto.data}` : undefined;
  return <section className="reference-review" aria-label="Reference photos and likeness review">
    <div className="reference-heading"><h3>{research.uploadedImage ? 'Your photo reference' : 'Photo references'}</h3><span className={needsWork ? 'needs-work' : ''}>{needsWork ? 'Needs refinement' : compared ? 'AI comparison' : 'Comparison unavailable'}</span></div>
    {text(research.subject) && <p className="reference-subject">{text(research.subject)}</p>}
    <p>{text(research.comparison?.summary) || 'No visual comparison is available for this saved design.'}</p>
    {issues.length > 0 && <ul>{issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>}
    {research.uploadedImage && !uploadedPhoto && <p>Your original photo is not saved with the design. Attach it again to compare or refine this build.</p>}
    {(uploadedPhoto || sources.length > 0) && <div className="reference-photos">
      {uploadedPhoto && <figure><img src={uploadedPhoto} alt="Your uploaded inspiration photo" /><figcaption>Your uploaded photo<span>Available in this browser session.</span></figcaption></figure>}
      {sources.map((source, index) => <ReferencePhoto key={`${text(source.sha256)}:${index}:${text(source.imageUrl)}`} source={source} />)}
    </div>}
    <details><summary>What the model used from the references</summary><p>{text(observations?.silhouette)}</p><p>{text(observations?.proportions)}</p><ul>{strings(observations?.features).map((feature, index) => <li key={index}>{feature}</li>)}</ul>
      {strings(observations?.colors).length > 0 && <p>Observed colors: {strings(observations?.colors).join(', ')}.</p>}
      {[...strings(observations?.limitations), ...strings(research.warnings)].map((warning, index) => <p key={index}>{warning}</p>)}
    </details>
    <small>AI visual comparison. Review the model yourself; geometry checks do not establish likeness or physical strength.</small>
  </section>;
}

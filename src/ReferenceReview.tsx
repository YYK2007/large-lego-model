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
  const model = source.mediaType === 'model-render';
  return <figure>
    <a className="reference-photo-link" href={pageUrl} target="_blank" rel="noreferrer" aria-label={`View source: ${title}`}>
      {imageUrl && !failed ? <img src={imageUrl} alt={title} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <span className="reference-photo-unavailable">{model ? 'Model thumbnail' : 'Photo'} unavailable here{pageUrl ? ' · open the source' : ''}</span>}
    </a>
    <figcaption><a href={pageUrl} target="_blank" rel="noreferrer">{title}</a>
      {model && <span>3D source thumbnail, not a photograph. Separate views rendered from its geometry guided planning.</span>}
      {artist && <span>{artist}</span>}{credit && credit !== artist && <span>{credit}</span>}
      <a href={publicUrl(source.licenseUrl) || pageUrl} target="_blank" rel="noreferrer">{text(source.licenseName) || 'Source license'}</a>
    </figcaption>
  </figure>;
}

export function ReferenceReview({ research, sessionPhoto }: { research: DesignResearch; sessionPhoto?: { data: string; mimeType: string } }) {
  const notReviewed = research.comparison?.status === 'not-reviewed';
  const needsWork = research.comparison?.status === 'needs-work';
  const compared = needsWork || research.comparison?.status === 'matched';
  const sources = Array.isArray(research.sources) ? research.sources.filter(source => source && typeof source === 'object') : [];
  const visibleSources = sources.filter((source, index) => source.mediaType !== 'model-render' || sources.findIndex(item => item.mediaType === 'model-render' && item.sourcePageUrl === source.sourcePageUrl) === index);
  const observations = research.observations;
  const featureReviews = research.comparison?.features;
  const brief = research.brief;
  // The detailed feature evidence appears below. Keep the short overview from
  // repeating those same observations and corrections a second time.
  const issues = strings(research.comparison?.issues).filter(issue => !featureReviews?.some(feature =>
    feature.status !== 'present' && issue.startsWith(`Feature ${feature.index + 1} (${observations.features[feature.index].slice(0, 600)}):`)));
  const uploadedPhoto = research.uploadedImage && sessionPhoto && ['image/jpeg', 'image/png', 'image/webp'].includes(sessionPhoto.mimeType) ? `data:${sessionPhoto.mimeType};base64,${sessionPhoto.data}` : undefined;
  return <section className="reference-review" aria-label="Visual references and likeness review">
    <div className="reference-heading"><h3>{research.uploadedImage ? 'Your photo reference' : 'Visual references'}</h3><span className={needsWork || notReviewed ? 'needs-work' : ''}>{notReviewed ? 'Not visually reviewed' : needsWork ? 'Needs refinement' : compared ? 'AI comparison' : 'Comparison unavailable'}</span></div>
    {text(research.subject) && <p className="reference-subject">{text(research.subject)}</p>}
    <p>{text(research.comparison?.summary) || 'No visual comparison is available for this saved design.'}</p>
    {issues.length > 0 && <ul>{issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>}
    {research.uploadedImage && !uploadedPhoto && <p>Your original photo is not saved with the design. Attach it again to compare or refine this build.</p>}
    {(uploadedPhoto || sources.length > 0) && <div className="reference-photos">
      {uploadedPhoto && <figure><img src={uploadedPhoto} alt="Your uploaded inspiration photo" /><figcaption>Your uploaded photo<span>Available in this browser session.</span></figcaption></figure>}
      {visibleSources.map((source, index) => <ReferencePhoto key={`${text(source.sha256)}:${index}:${text(source.imageUrl)}`} source={source} />)}
    </div>}
    {brief && <details><summary>Sourced dimensions and reference research</summary>
      <p>{sources.filter(source => source.mediaType !== 'model-render').length} photo sources retained from a target of {brief.requestedImageCount}. Photo view labels come from captions and have not been independently verified.</p>
      {brief.models?.map(model => <p key={model.sha256}><a href={publicUrl(model.sourcePageUrl)} target="_blank" rel="noreferrer">{model.title}</a>: {model.viewImageIndices.length} rendered views from loaded STL geometry. Source orientation and units are unverified; the mesh does not establish colors.</p>)}
      {brief.photos.some(photo => photo.viewHints.length) && <ul>{brief.photos.filter(photo => photo.viewHints.length).map(photo => <li key={photo.imageIndex}>
        <a href={publicUrl(photo.sourcePageUrl)} target="_blank" rel="noreferrer">Reference {photo.imageIndex + 1}</a>: {photo.viewHints.join(', ')} (metadata hint)
      </li>)}</ul>}
      <p>These are source-reported claims. They are separate from the AI’s image observations and are not independent physical measurements.</p>
      {brief.measurements.length > 0 && <ul>{brief.measurements.map((item, index) => {
        const source = brief.textSources.find(source => source.id === item.sourceId);
        return <li key={`${item.statementId}:${index}`}><strong>{item.label}: {item.amount.replace(/^\+/, '')} {item.unitLabel}</strong>
          {' '}<a href={publicUrl(source?.url)} target="_blank" rel="noreferrer">{source?.publisher} source</a>
          {(item.lowerBound || item.upperBound) && <span> · Reported bounds: {item.lowerBound ?? 'unspecified'} to {item.upperBound ?? 'unspecified'}</span>}
          {item.qualifiers?.length ? <details><summary>Scope and date qualifiers</summary><ul>{item.qualifiers.map((qualifier, index) => <li key={index}>{qualifier.propertyId}: {qualifier.value}</li>)}</ul></details> : null}
        </li>;
      })}</ul>}
      {brief.statements.map((item, index) => {
        const source = brief.textSources.find(source => source.id === item.sourceId);
        return <blockquote key={index}><p>{item.statement}</p><cite><a href={publicUrl(source?.url)} target="_blank" rel="noreferrer">{source?.title} · {source?.publisher}</a></cite></blockquote>;
      })}
      {brief.textSources.map(source => <details key={source.id}><summary>{source.title} · {source.publisher} source record</summary>
        <p>{source.excerpt}</p><p><a href={publicUrl(source.url)} target="_blank" rel="noreferrer">Open the source{source.revisionId ? ` at revision ${source.revisionId}` : ''}</a>{' · '}
          <a href={publicUrl(source.licenseUrl)} target="_blank" rel="noreferrer">{source.licenseName}</a>{' · '}Retrieved {source.fetchedAt}</p>
      </details>)}
      {brief.links.length > 0 && <details><summary>Related source links (contents not fetched)</summary><ul>{brief.links.map((item, index) => <li key={index}>
        <a href={publicUrl(item.url)} target="_blank" rel="noreferrer">{item.label}</a>
      </li>)}</ul></details>}
      {brief.uncertainties.map((item, index) => <p key={index}>{item}</p>)}
    </details>}
    {featureReviews?.length ? <details><summary>AI feature checks: {featureReviews.filter(feature => feature.status === 'present').length} of {featureReviews.length} match</summary>
      <ol>{featureReviews.map(feature => <li key={feature.index}>
        <strong>{observations.features[feature.index]}</strong>
        <p>{{ present: 'Matches', incorrect: 'Needs changes', missing: 'Missing', uncertain: 'Unclear' }[feature.status]}: {feature.evidence}</p>
        {feature.correction && <p>Suggested change: {feature.correction}</p>}
      </li>)}</ol>
    </details> : null}
    <details><summary>What the model used from the references</summary><p>{text(observations?.silhouette)}</p><p>{text(observations?.proportions)}</p><ul>{strings(observations?.features).map((feature, index) => <li key={index}>{feature}</li>)}</ul>
      {strings(observations?.colors).length > 0 && <p>Observed colors: {strings(observations?.colors).join(', ')}.</p>}
      {[...strings(observations?.limitations), ...strings(research.warnings)].map((warning, index) => <p key={index}>{warning}</p>)}
    </details>
    <small>{notReviewed ? 'Visual review was skipped.' : 'AI visual comparison.'} Review the model yourself; geometry checks do not establish likeness or physical strength.</small>
  </section>;
}

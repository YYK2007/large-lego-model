import { createHash } from 'node:crypto';
import { discoverReferences, loadArticleEvidence, loadReferenceImages, loadReferenceModel, loadWikidataEntities, referenceViewWarnings, type ReferenceSubject, type ReferenceImage, type ReferenceArticle } from './references.js';
import type { ReferenceComplexity, ReferenceResearchBrief, ReferenceTextSource } from '../shared/references.js';

const photoTargets = { simple: 4, complex: 6, intricate: 12 } as const;
const quantities = { P2048: 'Height', P2049: 'Width', P2043: 'Length', P1101: 'Floors above ground' } as const;
const plain = (value: unknown, limit = 600) => typeof value === 'string' ? value.replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit) : '';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function link(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4000) return '';
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

/** Exact excerpt spans: classification helps retrieval and does not certify the claim. */
export function sourceStatements(source: ReferenceTextSource): ReferenceResearchBrief['statements'] {
  const result: ReferenceResearchBrief['statements'] = [];
  for (const sentence of new Intl.Segmenter('en', { granularity: 'sentence' }).segment(source.excerpt)) {
    const statement = sentence.segment.trim();
    if (statement.length > 700 || statement.length < 12) continue;
    const kind = /\b\d[\d.,]*[\s–-]*(?:m|cm|mm|km|metres?|meters?|kilometres?|kilometers?|feet|foot|ft|inches|inch)\b/i.test(statement) ? 'dimension'
      : /\b(?:twice|half|ratio|proportion|as (?:tall|wide|long)|times (?:as|the))\b/i.test(statement) ? 'proportion'
        : /\b(?:\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i.test(statement) ? 'numeric-description' : undefined;
    if (!kind) continue;
    const start = sentence.index + sentence.segment.indexOf(statement);
    result.push({ sourceId: source.id, statement, kind, basis: 'source-reported', start, end: start + statement.length });
  }
  return result.sort((a, b) => Number(b.kind === 'dimension') - Number(a.kind === 'dimension')).slice(0, 12);
}

async function textEvidence(articles: ReferenceArticle[], signal: AbortSignal, warnings: string[]) {
  const selected = articles.slice(0, 2);
  if (selected.length) {
    try { selected[0] = await loadArticleEvidence(selected[0].source.title, { signal }) || selected[0]; }
    catch (error) { if (signal.aborted) throw error; warnings.push('The full article could not be retrieved; its cached lead remains the available text evidence.'); }
  }
  const textSources = selected.map(article => article.source);
  const measurements: ReferenceResearchBrief['measurements'] = [], links: ReferenceResearchBrief['links'] = [];
  for (const article of selected) for (const url of article.links) links.push({ sourceId: article.source.id, url, label: 'Link cited by the article; contents not fetched', relation: 'article-link', contentFetched: false });
  const ids = [...new Set(selected.flatMap(article => article.entityId ? [article.entityId] : []))];
  if (ids.length) {
    try {
      const data = await loadWikidataEntities(ids, { signal });
      for (const [id, entity] of Object.entries(data.entities)) {
        const sourceId = `wikidata:${id}`, claims = entity.claims || {};
        const lines: string[] = [];
        for (const [propertyId, label] of Object.entries(quantities)) for (const claim of (claims[propertyId] || []).slice(0, 8)) {
          if (claim.rank === 'deprecated' || claim.mainsnak?.snaktype !== 'value' || !claim.id || measurements.length >= 16) continue;
          const value = claim.mainsnak.datavalue?.value as { amount?: unknown; unit?: unknown; lowerBound?: unknown; upperBound?: unknown } | undefined;
          const amount = (input: unknown): input is string => typeof input === 'string' && /^[+-]?\d+(?:\.\d+)?$/.test(input) && input.length <= 80 && Number.isFinite(Number(input));
          if (!value || !amount(value.amount) || typeof value.unit !== 'string' || !(value.unit === '1' || /^https?:\/\/www\.wikidata\.org\/entity\/Q[1-9]\d*$/.test(value.unit))) continue;
          const referenceUrls = [...new Set((claim.references || []).flatMap(reference => (reference.snaks?.P854 || []).map(snak => link(snak.datavalue?.value)).filter(Boolean)))].slice(0, 4);
          const qualifiers = Object.entries(claim.qualifiers || {}).flatMap(([propertyId, snaks]) => snaks.slice(0, 4).map(snak => ({ propertyId, value: plain(JSON.stringify(snak.datavalue?.value), 600) }))).filter(item => /^P\d+$/.test(item.propertyId) && item.value).slice(0, 12);
          const measurement: ReferenceResearchBrief['measurements'][number] = { sourceId, propertyId, label, amount: value.amount, unitUrl: value.unit === '1' ? '' : value.unit.replace(/^http:/, 'https:'),
            unitLabel: value.unit === '1' ? 'count' : value.unit.split('/').at(-1)!, statementId: plain(claim.id, 200), referenceUrls,
            ...(amount(value.lowerBound) ? { lowerBound: value.lowerBound } : {}), ...(amount(value.upperBound) ? { upperBound: value.upperBound } : {}), ...(qualifiers.length ? { qualifiers } : {}),
          };
          measurements.push(measurement);
          lines.push(`${propertyId} ${label}: ${value.amount} ${value.unit}; statement ${measurement.statementId}${qualifiers.length ? '; qualifiers ' + JSON.stringify(qualifiers) : ''}.`);
          for (const url of referenceUrls) links.push({ sourceId, url, label: `${label} reference listed by Wikidata; contents not fetched`, relation: 'measurement-reference', contentFetched: false });
        }
        for (const claim of (claims.P856 || []).slice(0, 3)) {
          if (claim.rank === 'deprecated') continue;
          const url = link(claim.mainsnak?.datavalue?.value);
          if (url) { links.push({ sourceId, url, label: 'Official website listed by Wikidata; contents not fetched', relation: 'official-website', contentFetched: false }); lines.push(`P856 Official website: ${url}.`); }
        }
        if (lines.length) {
          const excerpt = lines.join('\n').slice(0, 6000), revisionId = Number.isSafeInteger(entity.lastrevid) && entity.lastrevid! > 0 ? entity.lastrevid : undefined;
          textSources.push({ id: sourceId, title: plain(entity.labels?.en?.value, 300) || id, url: `https://www.wikidata.org/wiki/${id}` + (revisionId ? `?oldid=${revisionId}` : ''),
            publisher: 'Wikidata', excerpt, fetchedAt: data.fetchedAt, sha256: hash(excerpt), ...(revisionId ? { revisionId } : {}), licenseName: 'CC0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' });
        }
      }
      const unitIds = [...new Set(measurements.flatMap(item => /^Q\d+$/.test(item.unitLabel) ? [item.unitLabel] : []))];
      if (unitIds.length) {
        try {
          const units = await loadWikidataEntities(unitIds, { signal });
          for (const item of measurements) item.unitLabel = plain(units.entities[item.unitLabel]?.labels?.en?.value, 100) || item.unitLabel;
        } catch { warnings.push('Some measurement unit names could not be retrieved; the original unit entity links are retained.'); }
      }
    } catch (error) { if (signal.aborted) throw error; warnings.push('Wikidata measurements were unavailable. No dimensions were invented.'); }
  }
  return { textSources, measurements, links: links.slice(0, 32) };
}

/** Bounded public research; photos and source claims still require subject/visibility checks. */
export async function researchReferences(subject: ReferenceSubject, options: { complexity?: ReferenceComplexity; signal?: AbortSignal } = {}): Promise<{ images: ReferenceImage[]; brief: ReferenceResearchBrief; warnings: string[] }> {
  const complexity = options.complexity ?? 'complex';
  if (!Object.hasOwn(photoTargets, complexity)) throw new Error('Reference complexity must be simple, complex or intricate.');
  const deadline = Date.now() + 25_000;
  const signal = AbortSignal.any([AbortSignal.timeout(25_000), ...(options.signal ? [options.signal] : [])]);
  const found = await discoverReferences(subject, { complexity, signal });
  const warnings = [...found.warnings], requestedImageCount = photoTargets[complexity];
  const results = await Promise.allSettled([loadReferenceImages(found.candidates, { signal, maxImages: requestedImageCount }), textEvidence(found.articles, signal, warnings)]);
  options.signal?.throwIfAborted();
  if (results[0].status === 'rejected') throw results[0].reason;
  const images = results[0].value;
  const viewWarnings = referenceViewWarnings(images);
  warnings.push(...viewWarnings);
  const evidence = results[1].status === 'fulfilled' ? results[1].value : { textSources: found.articles.map(article => article.source), measurements: [], links: [] };
  if (results[1].status === 'rejected') warnings.push('Text research reached its time budget; available article excerpts are retained.');
  if (images.length < requestedImageCount) warnings.push(`Retrieved ${images.length} distinct photos of the ${requestedImageCount} requested. Missing views remain uncertain.`);
  const uncertainties = [
    ...viewWarnings,
    'Source statements and Wikidata quantities are reported claims, not independent physical measurements. Check their scope, date, units and qualifiers.',
    'Photo view labels and identity evidence come from metadata. Verify the actual pixels; distinct files do not prove different camera angles.',
    'Linked external pages were not fetched. A link is not corroboration of its contents.',
  ];
  let model: Awaited<ReturnType<typeof loadReferenceModel>>;
  // Photos and measured/textual evidence get the first share of the same budget.
  // A missing or slow model never invalidates those useful references.
  if (!signal.aborted && deadline - Date.now() >= 1000) {
    try { model = await loadReferenceModel(subject, { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]), deadline }); }
    catch (error) { options.signal?.throwIfAborted(); warnings.push('Optional 3D reference was unavailable or exceeded its bounded budget; the photographs remain usable.'); }
  }
  if (model) {
    images.splice(9); // Keep at least nine photos when twelve were available.
    model.model.viewImageIndices = model.images.map((_image, index) => images.length + index);
    images.push(...model.images);
    uncertainties.push('The external STL is an unverified reference model, not a photograph or a LEGO assembly. Its numeric geometry was read; its scale units, orientation, colors and subject accuracy are not established.');
  } else uncertainties.push('No usable optional 3D geometry was read. Photographs remain the primary reference; any linked model or Blender files are unread.');
  if (!evidence.textSources.length) uncertainties.push('No exact-article text evidence was available for this subject.');
  if (!evidence.measurements.length) uncertainties.push('No supported Wikidata dimensions or counts were available; infer proportions from photos explicitly as estimates.');
  const brief: ReferenceResearchBrief = { version: 1, subject: found.subject, complexity, requestedImageCount,
    photos: images.flatMap((image, imageIndex) => image.metadata.mediaType === 'model-render' ? [] : [{ imageIndex, sourcePageUrl: image.metadata.sourcePageUrl, sha256: image.metadata.sha256, viewHints: image.metadata.viewHints || [], identityEvidence: image.metadata.identityEvidence || 'search-only' }]),
    ...evidence, statements: evidence.textSources.filter(source => source.publisher === 'Wikipedia').flatMap(sourceStatements).slice(0, 16), uncertainties,
    ...(model ? { models: [model.model] } : {}),
  };
  return { images, brief, warnings: [...new Set(warnings)].slice(0, 16) };
}

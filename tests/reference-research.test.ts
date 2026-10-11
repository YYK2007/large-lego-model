import test, { beforeEach, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import sharp from 'sharp';
import { researchReferences, sourceStatements } from '../server/reference-research.js';
import { discoverReferences, loadArticleEvidence, loadWikidataEntities, resetReferenceStateForTests } from '../server/references.js';
import { isDesignResearch, isReferenceResearchBrief, type DesignResearch, type ReferenceTextSource } from '../shared/references.js';
import { ReferenceReview } from '../src/ReferenceReview.js';

beforeEach(resetReferenceStateForTests);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const pages = (value: unknown[]) => json({ query: { pages: value } });
const captions = ['front', 'rear', 'side view', 'north', 'south', 'east', 'west', 'aerial', 'interior', 'detail', 'garden', 'courtyard'];
const articleText = 'The test pavilion has four doors. Its height is 24 metres. Its width is half its height. The roof is green.';
const file = (index: number, name = 'Test pavilion') => ({
  title: `File:${name} ${captions[index]}.jpg`,
  imageinfo: [{ mime: 'image/jpeg', url: `https://upload.wikimedia.org/${index}.jpg`, width: 32, height: 24,
    extmetadata: { Artist: { value: '<b>Alice</b><script>bad()</script>' }, Credit: { value: 'Own work' },
      ImageDescription: { value: `${name} ${captions[index]}` }, LicenseShortName: { value: 'CC BY-SA 4.0' },
      LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0/' } } }],
});

async function archive(t: TestContext, count = 12) {
  const calls: URL[] = [];
  const images = await Promise.all(Array.from({ length: count }, (_, index) => sharp({ create: { width: 32, height: 24, channels: 3,
    background: { r: index * 19, g: 30 + index * 5, b: 210 - index * 15 } } }).jpeg().toBuffer()));
  const photoPages = Array.from({ length: count }, (_, index) => file(index));
  t.mock.method(globalThis, 'fetch', async (input: URL | string) => {
    const url = new URL(String(input)); calls.push(url);
    if (url.hostname === 'upload.wikimedia.org') return new Response(new Uint8Array(images[Number(url.pathname.slice(1).split('.')[0])]), { headers: { 'content-type': 'image/jpeg' } });
    if (url.hostname === 'en.wikipedia.org') return pages([{ title: 'Test pavilion', pageimage: 'Test pavilion front.jpg',
      images: photoPages.map(({ title }) => ({ title })), lastrevid: 123, extract: articleText, pageprops: { wikibase_item: 'Q123' },
      extlinks: [{ url: 'https://official.example/pavilion' }, { url: 'javascript:alert(1)' }] }]);
    if (url.hostname === 'commons.wikimedia.org') return pages(url.searchParams.has('titles') ? photoPages.filter(photo => url.searchParams.get('titles')!.split('|').includes(photo.title)) : photoPages);
    assert.equal(url.hostname, 'www.wikidata.org', 'External source links must never become fetch targets');
    if (url.searchParams.get('ids') === 'Q11573') return json({ entities: { Q11573: { id: 'Q11573', labels: { en: { value: 'metre' } } } } });
    return json({ entities: { Q123: { id: 'Q123', lastrevid: 456, labels: { en: { value: 'Test pavilion' } }, claims: {
      P2048: [{ id: 'Q123$height', rank: 'normal', mainsnak: { snaktype: 'value', datavalue: { value: { amount: '+24', unit: 'http://www.wikidata.org/entity/Q11573', lowerBound: '+23.5', upperBound: '+24.5' } } },
        qualifiers: { P518: [{ datavalue: { value: { 'entity-type': 'item', 'numeric-id': 7, id: 'Q7' } } }], P585: [{ datavalue: { value: { time: '+2020-01-01T00:00:00Z' } } }] },
        references: [{ snaks: { P854: [{ datavalue: { value: 'https://official.example/measurements' } }] } }] },
        { id: 'Q123$old', rank: 'deprecated', mainsnak: { snaktype: 'value', datavalue: { value: { amount: '+999', unit: '1' } } } }],
      P1101: [{ id: 'Q123$floors', mainsnak: { snaktype: 'value', datavalue: { value: { amount: '+2', unit: '1' } } } }],
      P2049: [{ id: 'Q123$unknown', mainsnak: { snaktype: 'novalue' } }],
      P2043: [{ id: 'Q123$malformed', mainsnak: { snaktype: 'value', datavalue: { value: { amount: 'Infinity', unit: '1' } } } }],
      P856: [{ id: 'Q123$site', mainsnak: { snaktype: 'value', datavalue: { value: 'https://official.example/pavilion' } } }],
    } } } });
  });
  return calls;
}

function saved(result: Awaited<ReturnType<typeof researchReferences>>): DesignResearch {
  return { subject: result.brief.subject, sources: result.images.map(image => image.metadata), uploadedImage: false, brief: result.brief,
    observations: { silhouette: 'A rectangular pavilion.', proportions: 'Twice as tall as wide.', features: ['Four doors'], colors: ['Green'], limitations: [] },
    comparison: { status: 'needs-work', summary: 'Review pending.', issues: [] }, warnings: result.warnings };
}

test('adaptive research returns three, six or twelve distinct decoded photos with source claims kept separate', async t => {
  const calls = await archive(t);
  for (const [complexity, count] of [['simple', 3], ['complex', 6], ['intricate', 12]] as const) {
    const result = await researchReferences({ name: 'Test pavilion' }, { complexity });
    assert.equal(result.images.length, count);
    assert.equal(result.brief.requestedImageCount, count);
    assert.equal(new Set(result.images.map(image => image.metadata.sha256)).size, count);
    assert.equal(result.brief.photos.length, count);
    assert.ok(result.images.every(image => image.inlineData.mimeType === 'image/jpeg' && image.metadata.artist === 'Alice'));
    assert.equal(isReferenceResearchBrief(result.brief), true);
    assert.equal(isDesignResearch(saved(result)), true);
    assert.equal(JSON.stringify(result.brief).includes('inlineData'), false);
  }
  assert.ok(calls.every(url => ['en.wikipedia.org', 'commons.wikimedia.org', 'www.wikidata.org', 'upload.wikimedia.org'].includes(url.hostname)));
});

test('text evidence retains exact sentence anchors, source revision/hash, unit scope and unfetched authoritative links', async t => {
  const calls = await archive(t, 3);
  const result = await researchReferences({ name: 'Test pavilion' }, { complexity: 'simple' });
  const wiki = result.brief.textSources.find(source => source.publisher === 'Wikipedia')!;
  assert.equal(wiki.revisionId, 123);
  assert.equal(wiki.sha256, digest(wiki.excerpt));
  assert.match(wiki.url, /oldid=123/);
  assert.equal(wiki.excerpt, articleText);
  assert.deepEqual(result.brief.statements.map(item => item.kind), ['dimension', 'numeric-description', 'proportion']);
  for (const item of result.brief.statements) assert.equal(wiki.excerpt.slice(item.start, item.end), item.statement);
  assert.equal(result.brief.measurements.length, 2, 'Deprecated, no-value and malformed claims are omitted');
  const height = result.brief.measurements[0];
  assert.equal(height.amount, '+24'); assert.equal(height.unitLabel, 'metre');
  assert.equal(height.unitUrl, 'https://www.wikidata.org/entity/Q11573');
  assert.equal(height.lowerBound, '+23.5'); assert.equal(height.upperBound, '+24.5');
  assert.equal(height.statementId, 'Q123$height');
  assert.deepEqual(height.qualifiers?.map(item => item.propertyId), ['P518', 'P585']);
  assert.deepEqual(height.referenceUrls, ['https://official.example/measurements']);
  assert.equal(result.brief.measurements[1].unitLabel, 'count');
  assert.ok(result.brief.links.some(item => item.relation === 'official-website'));
  assert.ok(result.brief.links.every(item => item.contentFetched === false));
  assert.equal(calls.some(url => url.hostname === 'official.example'), false);
  assert.ok(calls.some(url => url.hostname === 'en.wikipedia.org' && !url.searchParams.has('exintro')), 'Full article text is requested, not only the lead');
  const before = calls.length;
  const repeated = await researchReferences({ name: 'Test pavilion' }, { complexity: 'simple' });
  assert.equal(calls.length, before, 'Successful article, entity and photo results are reused');
  assert.deepEqual(repeated.brief, result.brief, 'A cache hit does not invent new retrieval timestamps or hashes');
});

test('independent view metadata outranks edits while ambiguous identity and incidental graphics are excluded', async t => {
  t.mock.method(globalThis, 'fetch', async (input: URL) => {
    const url = new URL(String(input));
    if (url.hostname === 'en.wikipedia.org') return pages([]);
    return pages([file(0), { ...file(0), title: 'File:Test pavilion front edit2.jpg' }, { ...file(0), title: 'File:Test pavilion another front.jpg' }, file(1), file(7), file(0, 'Wrong subject'), file(0, 'Test pavilion logo')]);
  });
  const found = await discoverReferences({ name: 'Test pavilion' }, { complexity: 'complex' });
  assert.deepEqual(found.candidates.slice(0, 3).map(item => item.viewHints), [['front'], ['rear'], ['above']]);
  assert.ok(found.candidates.every(item => !/Wrong|logo/.test(item.fileTitle)));
  assert.equal(found.candidates.at(-1)?.fileTitle, 'File:Test pavilion front edit2.jpg');
  assert.ok(found.candidates.every(item => item.identityEvidence === 'metadata-match'));
  const logo = await discoverReferences({ name: 'Test pavilion logo' }, { complexity: 'complex' });
  assert.equal(logo.candidates.length, 1, 'A requested logo must not be mistaken for an incidental article graphic');
});

test('disambiguation articles supply no factual evidence and insufficient distinct views remain explicit', async t => {
  const image = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#225533' } }).jpeg().toBuffer();
  t.mock.method(globalThis, 'fetch', async (input: URL) => {
    const url = new URL(String(input));
    if (url.hostname === 'en.wikipedia.org') return pages([{ title: 'Test pavilion', extract: 'A disambiguation with 99 doors.', pageprops: { disambiguation: '' } }]);
    if (url.hostname === 'commons.wikimedia.org') return pages([file(0)]);
    return new Response(new Uint8Array(image), { headers: { 'content-type': 'image/jpeg' } });
  });
  const result = await researchReferences({ name: 'Test pavilion' });
  assert.equal(result.images.length, 1);
  assert.deepEqual(result.brief.textSources, []);
  assert.deepEqual(result.brief.statements, []);
  assert.match(result.warnings.join(' '), /1 distinct photos of the 6 requested/);
  assert.match(result.warnings.join(' '), /Only one usable reference photograph.*Other sides/);
  assert.match(result.brief.uncertainties.join(' '), /Only one usable reference photograph/);
  assert.match(result.brief.uncertainties.join(' '), /No exact-article text evidence/);
});

test('article gallery membership cannot admit a neighboring object or turn a geographic name into a viewpoint', async t => {
  const lead = file(0), neighbor = file(1, 'A neighboring fountain'), sameSubject = file(2);
  lead.imageinfo[0].extmetadata.ImageDescription.value = 'Test pavilion in North Carolina.';
  t.mock.method(globalThis, 'fetch', async (input: URL) => {
    const url = new URL(String(input));
    if (url.hostname === 'en.wikipedia.org') return pages([{ title: 'Test pavilion', pageimage: lead.title.slice(5), images: [lead, neighbor, sameSubject].map(({ title }) => ({ title })) }]);
    return pages([lead, neighbor, sameSubject]);
  });
  const result = await discoverReferences({ name: 'Test pavilion' }, { complexity: 'complex' });
  assert.equal(result.candidates.length, 2);
  assert.ok(result.candidates.every(candidate => !candidate.fileTitle.includes('fountain')));
  assert.deepEqual(result.candidates[0].viewHints, ['front']);
  assert.equal(result.candidates[1].matchedBy, 'article-gallery');
});

test('article and entity identifiers cannot introduce arbitrary API hosts and failed entities are not cached', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return calls === 1 ? new Response('', { status: 503 }) : json({ entities: { Q123: { id: 'Q123' } } }); });
  await assert.rejects(loadArticleEvidence('Target|Another'), /exact article/);
  await assert.rejects(loadWikidataEntities(['https://127.0.0.1']));
  assert.equal(calls, 0);
  await assert.rejects(loadWikidataEntities(['Q123']), /503/);
  const value = await loadWikidataEntities(['Q123']);
  assert.deepEqual(Object.keys(value.entities), ['Q123']);
  assert.equal(calls, 2);
  assert.deepEqual(await loadWikidataEntities(['Q123']), value);
  assert.equal(calls, 2);
});

test('caller cancellation stops scheduled richer research requests without fetching queued sources', async t => {
  const controller = new AbortController(); let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; controller.abort(new Error('Research cancelled')); return pages([]); });
  await assert.rejects(researchReferences({ name: 'Test pavilion', location: 'A city' }, { signal: controller.signal }), /Research cancelled/);
  assert.equal(calls, 1);
});

test('entity cache expires without rewriting the original evidence and aborted cache reads still cancel', async t => {
  let now = Date.now(), calls = 0;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'fetch', async () => { calls++; return json({ entities: { Q123: { id: 'Q123', lastrevid: calls } } }); });
  const first = await loadWikidataEntities(['Q123']);
  now += 14 * 60_000;
  assert.deepEqual(await loadWikidataEntities(['Q123']), first);
  await assert.rejects(loadWikidataEntities(['Q123'], { signal: AbortSignal.abort(new Error('Cancelled cached research')) }), /Cancelled cached research/);
  assert.equal(calls, 1);
  now += 2 * 60_000;
  assert.equal((await loadWikidataEntities(['Q123'])).entities.Q123.lastrevid, 2);
  assert.equal(first.entities.Q123.lastrevid, 1);
  assert.equal(calls, 2);
});

test('source statement extraction retains decimal and hyphenated dimensions and exact offsets, without pretending to parse a feature count', () => {
  const excerpt = 'A canopy. Its height is 12.5 metres. It has four doors. The width is half its height. A 172-foot-tall tower stands nearby.';
  const source: ReferenceTextSource = { id: 'wiki', publisher: 'Wikipedia', title: 'Pavilion', url: 'https://en.wikipedia.org/wiki/Pavilion', excerpt,
    sha256: digest(excerpt), fetchedAt: '2026-10-10T00:00:00Z', licenseName: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' };
  assert.deepEqual(sourceStatements(source).map(item => item.statement), ['Its height is 12.5 metres.', 'A 172-foot-tall tower stands nearby.', 'It has four doors.', 'The width is half its height.']);
  assert.ok(sourceStatements(source).every(item => source.excerpt.slice(item.start, item.end) === item.statement && item.basis === 'source-reported'));
});

test('persisted briefs require exact source spans and retained photo anchors while legacy research still loads', async t => {
  await archive(t, 3);
  const result = await researchReferences({ name: 'Test pavilion' }, { complexity: 'simple' });
  const research = saved(result);
  assert.equal(isDesignResearch(research), true);
  const legacy = structuredClone(research); delete legacy.brief;
  assert.equal(isDesignResearch(legacy), true);
  for (const mutate of [
    (value: DesignResearch) => { value.brief!.statements[0].statement = 'Invented measurement.'; },
    (value: DesignResearch) => { value.brief!.statements[0].start++; },
    (value: DesignResearch) => { value.brief!.measurements[0].sourceId = 'unknown'; },
    (value: DesignResearch) => { value.brief!.textSources[0].url = 'https://en.wikipedia.org.evil.test/'; },
    (value: DesignResearch) => { value.brief!.photos[0].sha256 = 'f'.repeat(64); },
    (value: DesignResearch) => { value.brief!.photos[0].imageIndex = 12; },
    (value: DesignResearch) => { value.sources = Array.from({ length: 13 }, () => value.sources[0]); },
    (value: DesignResearch) => { value.brief!.links[0].contentFetched = true as false; },
  ]) {
    const value = structuredClone(research); mutate(value); assert.equal(isDesignResearch(value), false);
  }
});

test('reference review renders escaped evidence, source scope and unfetched-link status', async t => {
  await archive(t, 3);
  const research = saved(await researchReferences({ name: 'Test pavilion' }, { complexity: 'simple' }));
  research.brief!.textSources[0].title = '<img src=x onerror=alert(1)>';
  const markup = renderToStaticMarkup(createElement(ReferenceReview, { research }));
  assert.match(markup, /Height: 24 metre/);
  assert.match(markup, /source-reported claims/);
  assert.match(markup, /contents not fetched/);
  assert.match(markup, /Scope and date qualifiers/);
  assert.match(markup, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.equal(markup.includes('<img src=x'), false);
  delete research.brief;
  assert.doesNotThrow(() => renderToStaticMarkup(createElement(ReferenceReview, { research })));
});

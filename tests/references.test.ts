import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { discoverReferences, loadReferenceImages, type ReferenceCandidate } from '../server/references.js';

const imageUrl = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Tower.jpg/1280px-Tower.jpg';
const sample = (url = imageUrl): ReferenceCandidate => ({ fileTitle: 'File:Tower.jpg', sourcePageUrl: 'https://commons.wikimedia.org/wiki/File:Tower.jpg', imageUrl: url,
  description: 'Bell tower', matchedBy: 'commons-search', query: 'Bell tower', artist: 'Photographer', credit: 'Own work', licenseName: 'CC BY-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', attributionRequired: true, width: 2400, height: 800 });
const json = (pages: unknown[]) => new Response(JSON.stringify({ query: { pages } }), { headers: { 'content-type': 'application/json' } });
const photo = (title = 'File:Tower.jpg') => ({ title, imageinfo: [{ url: imageUrl, thumburl: imageUrl, mime: 'image/jpeg', thumbwidth: 1280, thumbheight: 426,
  extmetadata: { Artist: { value: '<a href="https://example.org">Jane &amp; Doe</a><script>bad()</script>' }, Credit: { value: '<span>Own work</span>' },
    ImageDescription: { value: '<p>Clock below the belfry.</p>' }, LicenseShortName: { value: '<b>CC BY-SA 4.0</b>' },
    LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0/' }, AttributionRequired: { value: 'true' } } }] });

test('discovery retains article evidence, sanitizes attribution, and does not certify ambiguous candidates', async t => {
  const calls: URL[] = [];
  t.mock.method(globalThis, 'fetch', async (input: URL) => {
    const url = new URL(String(input)); calls.push(url);
    if (url.hostname === 'en.wikipedia.org') return json([{ title: 'Morehead-Patterson Bell Tower', fullurl: 'https://en.wikipedia.org/wiki/Morehead-Patterson_Bell_Tower', pageimage: 'Tower.jpg', extract: 'A bell tower at UNC Chapel Hill.' }]);
    if (url.searchParams.has('titles')) return json([photo()]);
    return json([photo(), photo('File:A different tower.jpg')]);
  });
  const found = await discoverReferences({ name: 'Morehead-Patterson Bell Tower', location: 'Chapel Hill' });
  assert.equal(calls.length, 3);
  assert.equal(calls[1].searchParams.get('gsrsearch'), '"Morehead" "Patterson" "Bell" "Tower" "Chapel" "Hill"');
  assert.equal(calls[1].searchParams.get('gsrnamespace'), '6');
  assert.equal(calls[1].searchParams.get('iiurlwidth'), '1280');
  assert.equal(found.candidates.length, 2, 'Duplicate Commons file title removed, alternate result remains a candidate');
  assert.equal(found.candidates[0].matchedBy, 'article-image');
  assert.equal(found.candidates[0].articleExtract, 'A bell tower at UNC Chapel Hill.');
  assert.equal(found.candidates[0].artist, 'Jane & Doe');
  assert.equal(found.candidates[0].credit, 'Own work');
  assert.equal(found.candidates[0].licenseName, 'CC BY-SA 4.0');
  assert.equal(found.candidates[1].matchedBy, 'commons-search');
  assert.equal('verified' in found.candidates[0], false);
  assert.deepEqual(found.warnings, []);
});

test('Commons discovery still works without an article, excluding missing licenses and hostile image URLs', async t => {
  const badHost = photo('File:Bad host.jpg'); badHost.imageinfo[0].thumburl = 'https://upload.wikimedia.org.evil.test/image.jpg';
  const noLicense = photo('File:No license.jpg'); noLicense.imageinfo[0].extmetadata.LicenseShortName.value = '';
  t.mock.method(globalThis, 'fetch', async (input: URL) => new URL(String(input)).hostname === 'en.wikipedia.org' ? new Response('', { status: 503 }) : json([badHost, noLicense, photo()]));
  const found = await discoverReferences({ name: 'A particular flower' });
  assert.equal(found.candidates.length, 1);
  assert.equal(found.candidates[0].matchedBy, 'commons-search');
  assert.match(found.warnings[0], /503/);
});

test('subject-named photographs rank above campus views without claiming visual verification', async t => {
  t.mock.method(globalThis, 'fetch', async (input: URL) => new URL(String(input)).hostname === 'en.wikipedia.org' ? json([]) : json([
    photo('File:UNC Pit campus panorama.jpg'), photo('File:The Morehead Patterson Bell Tower.jpg'), photo('File:Memorial at the Bell Tower.jpg'),
  ]));
  const found = await discoverReferences({ name: 'Morehead-Patterson Bell Tower', location: 'Chapel Hill' });
  assert.equal(found.candidates[0].fileTitle, 'File:The Morehead Patterson Bell Tower.jpg');
  assert.equal(found.candidates.length, 3, 'Ranking does not silently discard alternate views');
  assert.equal(found.candidates[0].matchedBy, 'commons-search');
});

test('reference pixels are real decoded JPEGs, resized and hashed separately from persistable attribution', async t => {
  const original = await sharp({ create: { width: 2400, height: 800, channels: 3, background: '#b04030' } }).png().toBuffer();
  t.mock.method(globalThis, 'fetch', async () => new Response(new Uint8Array(original), { headers: { 'content-type': 'image/png' } }));
  const [result] = await loadReferenceImages([sample()]);
  const bytes = Buffer.from(result.inlineData.data, 'base64');
  const decoded = await sharp(bytes).metadata();
  assert.equal(decoded.format, 'jpeg');
  assert.equal(decoded.width, 1280);
  assert.equal(decoded.height, 427);
  assert.equal(decoded.exif, undefined);
  assert.equal(result.metadata.width, 1280);
  assert.equal(result.metadata.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(result.metadata.artist, 'Photographer');
  assert.equal('inlineData' in result.metadata, false);
  assert.equal('data' in result.metadata, false);
});

test('image network policy blocks private, lookalike, credential, port and redirected destinations', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private' } }); });
  for (const url of ['http://upload.wikimedia.org/image.jpg', 'https://127.0.0.1/x', 'https://upload.wikimedia.org.evil.test/x', 'https://me:secret@upload.wikimedia.org/x', 'https://upload.wikimedia.org:8080/x']) {
    await assert.rejects(loadReferenceImages([sample(url)]), /allowed Wikimedia/);
  }
  assert.equal(calls, 0);
  await assert.rejects(loadReferenceImages([sample()]), /allowed Wikimedia/);
  assert.equal(calls, 1, 'Blocked redirect destination was never fetched');
});

test('official thumbnail redirects work and repeated redirects are bounded', async t => {
  const bytes = await sharp({ create: { width: 30, height: 40, channels: 3, background: '#000' } }).jpeg().toBuffer();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => ++calls === 1 ? new Response(null, { status: 302, headers: { location: 'https://thumb.wikimedia.org/a.jpg' } }) : new Response(new Uint8Array(bytes), { headers: { 'content-type': 'image/jpeg' } }));
  assert.equal((await loadReferenceImages([sample()]))[0].metadata.height, 40);
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 302, headers: { location: imageUrl } }));
  await assert.rejects(loadReferenceImages([sample()]), /redirect limit/);
});

test('header and streamed byte limits apply before image decoding', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('oversized', { headers: { 'content-type': 'image/jpeg', 'content-length': '5000001' } }));
  await assert.rejects(loadReferenceImages([sample()]), /byte limit/);
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(3_000_000)); controller.enqueue(new Uint8Array(2_000_001)); controller.close(); } }), { headers: { 'content-type': 'image/jpeg' } }));
  await assert.rejects(loadReferenceImages([sample()]), /byte limit/);
});

test('HTML, SVG with a false raster header, and compressed oversized images are rejected', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } }));
  await assert.rejects(loadReferenceImages([sample()]), /supported raster/);
  t.mock.method(globalThis, 'fetch', async () => new Response('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"></svg>', { headers: { 'content-type': 'image/png' } }));
  await assert.rejects(loadReferenceImages([sample()]), /single raster/);
  const oversized = await sharp({ create: { width: 5000, height: 5000, channels: 3, background: '#fff' } }).png().toBuffer();
  t.mock.method(globalThis, 'fetch', async () => new Response(new Uint8Array(oversized), { headers: { 'content-type': 'image/png' } }));
  await assert.rejects(loadReferenceImages([sample()]), /pixel limit/);
});

test('caller cancellation stops discovery and retrieval, and reference image count is bounded', async t => {
  let calls = 0;
  const bytes = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#fff' } }).jpeg().toBuffer();
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(new Uint8Array(bytes), { headers: { 'content-type': 'image/jpeg' } }); });
  const signal = AbortSignal.abort(new Error('Cancelled request'));
  await assert.rejects(discoverReferences({ name: '<script>bad()</script>' }), /concise reference subject/);
  await assert.rejects(discoverReferences({ name: '***' }), /concise reference subject/);
  await assert.rejects(discoverReferences({ name: 'Tower' }, { signal }), /Cancelled request/);
  await assert.rejects(loadReferenceImages([sample()], { signal }), /Cancelled request/);
  assert.equal(calls, 0);
  assert.equal((await loadReferenceImages([sample(), sample(), sample()])).length, 2);
  assert.equal((await loadReferenceImages([sample(), sample(), sample()], { maxImages: 3 })).length, 3);
  await assert.rejects(loadReferenceImages([sample()], { maxImages: 4 }), /one to three/);
});

import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { discoverReferences, loadReferenceImages, resetReferenceStateForTests, type ReferenceCandidate } from '../server/references.js';

beforeEach(resetReferenceStateForTests);

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
  assert.equal(calls.length, 4);
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

test('article lookup requests exact canonical titles and aliases, avoiding broad Taj Mahal and Rose namesakes', async t => {
  for (const subject of [
    { name: 'Taj Mahal', aliases: ['Tajmahal'], location: 'Agra, India', unrelated: ['Taj Mahal (musician)', 'Taj Mahal Palace Hotel'] },
    { name: 'Rose', aliases: ['Roses'], location: undefined, unrelated: ['Ruby Rose', 'Pete Rose', 'Axl Rose'] },
  ]) await t.test(subject.name, async t => {
    const calls: URL[] = [];
    t.mock.method(globalThis, 'fetch', async (input: URL) => {
      const url = new URL(String(input)); calls.push(url);
      if (url.hostname === 'en.wikipedia.org') {
        const names = url.searchParams.has('generator') ? subject.unrelated : [subject.name];
        return json(names.map(name => ({ title: name, pageimage: `${name}.jpg`, fullurl: `https://en.wikipedia.org/wiki/${name}`, extract: `The target ${subject.name}${subject.location ? ` in ${subject.location}` : ''}.` })));
      }
      if (url.searchParams.has('titles')) return json(url.searchParams.get('titles')!.split('|').map(title => photo(title)));
      return json([photo(`File:${subject.name} alternate view.jpg`)]);
    });
    const found = await discoverReferences(subject);
    const articleRequest = calls.find(url => url.hostname === 'en.wikipedia.org')!;
    assert.equal(articleRequest.searchParams.get('titles'), [subject.name, ...subject.aliases].join('|'));
    assert.equal(articleRequest.searchParams.get('redirects'), '1');
    assert.equal(articleRequest.searchParams.has('generator'), false);
    assert.equal(articleRequest.searchParams.has('gsrsearch'), false);
    assert.equal(found.candidates[0].articleTitle, subject.name);
    assert.ok(found.candidates.some(item => item.matchedBy === 'commons-search'), 'Exact lookup keeps the Commons alternate-view fallback');
    assert.ok(found.candidates.every(item => !subject.unrelated.includes(item.articleTitle || '')));
    if (subject.location) assert.match(found.candidates[0].articleExtract!, /Agra, India/);
  });
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

test('failed reference images fall through to later ranked candidates and retain the successful source', async t => {
  const bytes = await sharp({ create: { width: 30, height: 40, channels: 3, background: '#345' } }).jpeg().toBuffer();
  const alternate = await sharp({ create: { width: 30, height: 40, channels: 3, background: '#f53' } }).jpeg().toBuffer();
  const candidates = Array.from({ length: 5 }, (_, index) => ({ ...sample(`https://upload.wikimedia.org/${index}.jpg`), fileTitle: `File:Reference ${index}.jpg`, artist: `Photographer ${index}` }));
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: URL) => {
    const url = String(input); calls.push(url);
    if (url.endsWith('/0.jpg')) return new Response('', { status: 404 });
    if (url.endsWith('/1.jpg')) return new Response('not a raster', { headers: { 'content-type': 'image/jpeg' } });
    return new Response(new Uint8Array(url.endsWith('/2.jpg') ? bytes : alternate), { headers: { 'content-type': 'image/jpeg' } });
  });
  const images = await loadReferenceImages(candidates);
  assert.deepEqual(calls, candidates.slice(0, 4).map(item => item.imageUrl), 'Stop after two successes, rather than fetch all candidates');
  assert.deepEqual(images.map(item => item.metadata.fileTitle), ['File:Reference 2.jpg', 'File:Reference 3.jpg']);
  assert.deepEqual(images.map(item => item.metadata.artist), ['Photographer 2', 'Photographer 3']);
  assert.ok(images.every(item => item.metadata.sha256.length === 64 && item.metadata.height === 40));
});

test('failed image fallback is bounded to twelve candidates and preserves the original failure', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: ++calls === 1 ? 404 : 503 }));
  await assert.rejects(loadReferenceImages(Array.from({ length: 20 }, () => sample())), /request failed \(404\)/);
  assert.equal(calls, 12);
});

test('cancellation during failed-image fallback stops before another candidate is fetched', async t => {
  const controller = new AbortController();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    controller.abort(new Error('Cancelled during reference fetch'));
    return new Response('', { status: 404 });
  });
  await assert.rejects(loadReferenceImages([sample(), sample()], { signal: controller.signal }), /Cancelled during reference fetch/);
  assert.equal(calls, 1);
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
  resetReferenceStateForTests();
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
  assert.equal((await loadReferenceImages([sample(), sample(), sample()])).length, 1, 'A requested count never duplicates the same photo');
  assert.equal((await loadReferenceImages([sample(), sample(), sample()], { maxImages: 3 })).length, 1);
  await assert.rejects(loadReferenceImages([sample()], { maxImages: 4 }), /one to three/);
});

test('bounded alternate searches use canonical names and aliases without requiring every location word', async t => {
  for (const subject of [
    { name: 'Sea turtle', aliases: ['Chelonioidea'], location: 'Tropical and subtropical oceans' },
    { name: 'Mountain peak', aliases: ['Cervino'], location: 'Alps, Switzerland and Italy' },
    { name: 'Sunflower', aliases: ['Helianthus annuus'], location: '' },
    { name: 'Historic defensive wall', aliases: ['長城'], location: 'Northern China' },
  ]) {
    const searches: string[] = [];
    t.mock.method(globalThis, 'fetch', async (input: URL) => {
      const url = new URL(String(input));
      if (url.hostname === 'en.wikipedia.org') return json([]);
      searches.push(url.searchParams.get('gsrsearch')!);
      assert.equal(url.searchParams.get('gsrnamespace'), '6');
      assert.equal(url.searchParams.get('gsrlimit'), '12');
      return json([photo(`File:${subject.name} view.jpg`)]);
    });
    const found = await discoverReferences(subject);
    assert.equal(searches.length, 2);
    assert.ok(searches[1].includes(subject.aliases[0].split(' ').map(word => `"${word}"`).join(' ')));
    assert.ok(!subject.location || !searches[1].includes(`"${subject.location.split(/[ ,]/)[0]}"`));
    assert.equal(found.candidates.length, 1);
    assert.match(found.warnings.join(' '), /one distinct reference photo family/);
  }
});

test('derivative credit and edit filenames defer duplicate photo families behind independent views', async t => {
  const renamed = photo('File:Landmark (Edited).jpeg');
  renamed.imageinfo[0].extmetadata.Credit.value = 'Edited version of File:Landmark, City, Country.jpg';
  const original = photo('File:Landmark, City, Country.jpg');
  const edited = photo('File:Landmark, City, Country edit3.jpg');
  edited.imageinfo[0].extmetadata.Credit.value = 'Landmark,_City,_Country_edit2.jpg';
  t.mock.method(globalThis, 'fetch', async (input: URL) => {
    const url = new URL(String(input));
    if (url.hostname === 'en.wikipedia.org') return json([{ title: 'Landmark', pageimage: 'Landmark (Edited).jpeg' }]);
    if (url.searchParams.has('titles')) return json([renamed]);
    return json([original, edited, photo('File:Landmark eastern view.jpg'), photo('File:Landmark north side.jpg'), photo('File:長城.jpg'), photo('File:山峰.jpg')]);
  });
  const found = await discoverReferences({ name: 'Landmark', location: 'City' });
  assert.deepEqual(found.candidates.slice(0, 3).map(item => item.fileTitle), [renamed.title, 'File:Landmark eastern view.jpg', 'File:Landmark north side.jpg']);
  assert.ok(found.candidates.findIndex(item => item.fileTitle === original.title) > 4, 'Original remains available if the preferred edit fails to download');
  assert.equal(found.candidates.filter(item => /長城|山峰/.test(item.fileTitle)).length, 2, 'Unicode file identities are not collapsed to an empty key');
});

async function patternedImage(view: number) {
  const bytes = Buffer.alloc(80 * 64 * 3);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 80; x++) {
    const shape = view === 0 ? (x > 16 && x < 44 && y > 10 && y < 58) : view === 1 ? (x > 10 && x < 65 && y > 26 && y < 43) : ((x - 40) ** 2 + (y - 32) ** 2 < 400);
    const value = shape ? 155 + (x + y) % 25 : 35 + (x * 2 + y) % 40;
    for (let channel = 0; channel < 3; channel++) bytes[(y * 80 + x) * 3 + channel] = value;
  }
  return sharp(bytes, { raw: { width: 80, height: 64, channels: 3 } }).png().toBuffer();
}

test('pixel deduplication skips retouches with unrelated filenames while retaining distinct images and exact credits', async t => {
  const original = await patternedImage(0), side = await patternedImage(1), detail = await patternedImage(2);
  const retouched = await sharp(original).linear(1.1, 12).jpeg({ quality: 91 }).toBuffer();
  const candidates = ['Anchor.jpg', 'Unrelated renamed upload.jpg', 'Side.jpg', 'Detail.jpg'].map((file, index) => ({ ...sample(`https://upload.wikimedia.org/${index}.png`), fileTitle: `File:${file}`, artist: `Artist ${index}` }));
  const data = [original, retouched, side, detail];
  const calls: number[] = [];
  t.mock.method(globalThis, 'fetch', async (input: URL) => {
    const index = Number(new URL(String(input)).pathname.match(/\d+/)![0]); calls.push(index);
    return new Response(new Uint8Array(data[index]), { headers: { 'content-type': index === 1 ? 'image/jpeg' : 'image/png' } });
  });
  const images = await loadReferenceImages(candidates, { maxImages: 3 });
  assert.deepEqual(calls, [0, 1, 2, 3]);
  assert.deepEqual(images.map(image => image.metadata.artist), ['Artist 0', 'Artist 2', 'Artist 3']);
  assert.equal(new Set(images.map(image => image.metadata.sha256)).size, 3);
  for (const image of images) {
    assert.equal(image.metadata.sha256, createHash('sha256').update(Buffer.from(image.inlineData.data, 'base64')).digest('hex'));
    assert.equal(image.metadata.credit, 'Own work');
    assert.equal('signature' in image.metadata, false, 'Comparison features and image data are transient');
  }
});

test('same-family crops are skipped without downloading, but a failed preferred edit allows its original', async t => {
  const bytes = await patternedImage(0), side = await patternedImage(1);
  const edited = { ...sample('https://upload.wikimedia.org/edit.jpg'), fileTitle: 'File:Renamed enhanced.jpg', credit: 'Edited version of File:Subject original.jpg' };
  const original = { ...sample('https://upload.wikimedia.org/original.jpg'), fileTitle: 'File:Subject original.jpg' };
  const cropped = { ...sample('https://upload.wikimedia.org/crop.jpg'), fileTitle: 'File:Subject original cropped2.jpg' };
  const other = { ...sample('https://upload.wikimedia.org/side.jpg'), fileTitle: 'File:Subject side.jpg' };
  let failEdit = false;
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: URL) => {
    const url = String(input); calls.push(url);
    if (failEdit && url.endsWith('/edit.jpg')) return new Response('', { status: 404 });
    return new Response(new Uint8Array(url.endsWith('/side.jpg') ? side : bytes), { headers: { 'content-type': 'image/png' } });
  });
  const images = await loadReferenceImages([edited, original, cropped, other], { maxImages: 3 });
  assert.deepEqual(images.map(image => image.metadata.fileTitle), [edited.fileTitle, other.fileTitle]);
  assert.deepEqual(calls, [edited.imageUrl, other.imageUrl]);
  failEdit = true; calls.length = 0; resetReferenceStateForTests();
  const fallback = await loadReferenceImages([edited, original, cropped, other], { maxImages: 3 });
  assert.deepEqual(fallback.map(image => image.metadata.fileTitle), [other.fileTitle, original.fileTitle]);
  assert.deepEqual(calls, [edited.imageUrl, other.imageUrl, original.imageUrl]);
});

test('successful metadata and pixels are cached without changing source timestamps, hashes or caller isolation', async t => {
  const bytes = await patternedImage(0);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (input: URL) => {
    calls++;
    const url = new URL(String(input));
    if (url.hostname === 'en.wikipedia.org') return json([{ title: 'Tower', pageimage: 'Tower.jpg' }]);
    if (url.hostname === 'commons.wikimedia.org') return json([photo()]);
    return new Response(new Uint8Array(bytes), { headers: { 'content-type': 'image/png' } });
  });
  const first = await discoverReferences({ name: 'Tower' });
  const [image] = await loadReferenceImages(first.candidates);
  const initialCalls = calls, expected = structuredClone(image);
  first.candidates[0].artist = 'Caller mutation';
  image.inlineData.data = 'Caller mutation'; image.metadata.fetchedAt = 'Caller mutation';
  const again = await discoverReferences({ name: 'Tower' });
  const [cached] = await loadReferenceImages(again.candidates);
  assert.equal(calls, initialCalls);
  assert.deepEqual(cached, expected, 'Successful cached pixels keep their original fetchedAt and hash');
  const signal = AbortSignal.abort(new Error('Cancelled cached lookup'));
  await assert.rejects(discoverReferences({ name: 'Tower' }, { signal }), /Cancelled cached lookup/);
  await assert.rejects(loadReferenceImages(again.candidates, { signal }), /Cancelled cached lookup/);
  assert.equal(calls, initialCalls, 'A cache hit never bypasses caller cancellation');
});

test('expired metadata and pixels refetch, while failed and empty API results are never cached', async t => {
  let now = Date.now(), calls = 0, fail = false, empty = false;
  t.mock.method(Date, 'now', () => now);
  const bytes = await patternedImage(0);
  t.mock.method(globalThis, 'fetch', async (input: URL) => {
    calls++;
    if (fail) return new Response('', { status: 503 });
    const url = new URL(String(input));
    if (url.hostname === 'en.wikipedia.org') return json(empty ? [] : [{ title: 'Tower', pageimage: 'Tower.jpg' }]);
    if (url.hostname === 'commons.wikimedia.org') return json(empty ? [] : [photo()]);
    return new Response(new Uint8Array(bytes), { headers: { 'content-type': 'image/png' } });
  });
  const first = await discoverReferences({ name: 'Tower' }); await loadReferenceImages(first.candidates);
  const initial = calls;
  now += 15 * 60_000 + 1;
  const fresh = await discoverReferences({ name: 'Tower' }); await loadReferenceImages(fresh.candidates);
  assert.equal(calls, initial * 2);
  resetReferenceStateForTests(); fail = true;
  await discoverReferences({ name: 'Tower' }); const failures = calls;
  await discoverReferences({ name: 'Tower' }); assert.equal(calls, failures + 2);
  fail = false; empty = true;
  await discoverReferences({ name: 'Tower' }); const empties = calls;
  await discoverReferences({ name: 'Tower' }); assert.equal(calls, empties + 2);
});

test('decoded image cache is LRU bounded and failed decodes are not retained', async t => {
  const bytes = await patternedImage(0), fetched: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: URL) => { fetched.push(String(input)); return new Response(new Uint8Array(bytes), { headers: { 'content-type': 'image/png' } }); });
  const at = (index: number) => ({ ...sample(`https://upload.wikimedia.org/cache-${index}.png`), fileTitle: `File:Cache ${index}.png` });
  for (let i = 0; i < 24; i++) await loadReferenceImages([at(i)]);
  await loadReferenceImages([at(0)]); // Make zero the most recently used entry.
  await loadReferenceImages([at(24)]);
  await loadReferenceImages([at(0)]);
  assert.equal(fetched.length, 25);
  await loadReferenceImages([at(1)]);
  assert.equal(fetched.length, 26, 'The least recently used entry was evicted');
  resetReferenceStateForTests();
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', async () => { attempts++; return new Response(attempts === 1 ? 'bad image' : new Uint8Array(bytes), { headers: { 'content-type': 'image/png' } }); });
  await assert.rejects(loadReferenceImages([sample()]));
  assert.equal((await loadReferenceImages([sample()])).length, 1);
  assert.equal(attempts, 2);
});

test('Wikimedia requests are serialized and a cancelled queued request never reaches fetch', async t => {
  const bytes = await patternedImage(0), calls: string[] = [];
  let release!: () => void, begun!: () => void;
  const started = new Promise<void>(resolve => { begun = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  t.mock.method(globalThis, 'fetch', async (input: URL) => {
    calls.push(String(input));
    if (calls.length === 1) { begun(); await blocked; }
    return new Response(new Uint8Array(bytes), { headers: { 'content-type': 'image/png' } });
  });
  const first = loadReferenceImages([sample('https://upload.wikimedia.org/first.png')]);
  await started;
  const controller = new AbortController();
  const queued = loadReferenceImages([sample('https://upload.wikimedia.org/cancelled.png')], { signal: controller.signal });
  controller.abort(new Error('Cancel queued reference'));
  await assert.rejects(queued, /Cancel queued reference/);
  assert.equal(calls.length, 1);
  release(); await first;
  await loadReferenceImages([sample('https://upload.wikimedia.org/third.png')]);
  assert.deepEqual(calls, ['https://upload.wikimedia.org/first.png', 'https://upload.wikimedia.org/third.png']);
});

test('a short Retry-After is honored once, and a long cooldown suppresses sibling requests without waiting', async t => {
  const bytes = await patternedImage(0);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => ++calls === 1 ? new Response('', { status: 429, headers: { 'retry-after': '0.1' } }) : new Response(new Uint8Array(bytes), { headers: { 'content-type': 'image/png' } }));
  const started = performance.now();
  assert.equal((await loadReferenceImages([sample()])).length, 1);
  assert.ok(performance.now() - started >= 90);
  assert.equal(calls, 2);
  resetReferenceStateForTests(); calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('', { status: 429, headers: { 'retry-after': new Date(Date.now() + 60_000).toUTCString() } }); });
  await assert.rejects(loadReferenceImages([sample()]), /rate limited \(429\)/);
  await assert.rejects(loadReferenceImages([sample('https://upload.wikimedia.org/another.jpg')]), /rate limited \(429\)/);
  assert.equal(calls, 1, 'No long blocking wait or second request during the upstream cooldown');
});

test('repeated 429s stop after one retry and cancellation aborts Retry-After backoff', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('', { status: 429, headers: { 'retry-after': '0' } }); });
  await assert.rejects(loadReferenceImages([sample(), sample('https://upload.wikimedia.org/other.jpg')]), /rate limited \(429\)/);
  assert.equal(calls, 2);
  resetReferenceStateForTests(); calls = 0;
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async () => {
    calls++; setTimeout(() => controller.abort(new Error('Cancel reference backoff')), 10);
    return new Response('', { status: 429, headers: { 'retry-after': '2' } });
  });
  await assert.rejects(loadReferenceImages([sample()], { signal: controller.signal }), /Cancel reference backoff/);
  assert.equal(calls, 1);
});

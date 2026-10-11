import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import express from 'express';
import { instructionGateway, instructionToken, instructionUrl, sendInstructionFile } from '../server/instruction-share.js';
import type { SavedDesign } from '../server/store.js';

const secret = Buffer.alloc(32, 7);
const design: SavedDesign = {
  id: 'approved-revision', title: 'Small tower', description: 'A checked tower', source: 'ai', prompt: 'PRIVATE_PROMPT', createdAt: '2026-10-11T00:00:00Z',
  schemaVersion: 2, coordinateSystem: 'stud-xy-plate-z', catalogVersion: 'upright-architecture-2',
  bricks: [{ id: 'b1', partId: '3005', colorId: 4, x: 0, y: 0, z: 0, rotation: 0 }, { id: 'b2', partId: '3005', colorId: 4, x: 0, y: 0, z: 3, rotation: 0 }],
  inventory: [{ partId: '3005', colorId: 4, quantity: 1, source: 'Confirmed set 1234' }, { partId: '3001', colorId: 15, quantity: 99, source: 'Unrelated collection' }],
};
const token = instructionToken(design.id, secret);
const signed = (path: string, signature = token) => `${path}${path.includes('?') ? '&' : '?'}share=${encodeURIComponent(signature)}`;

async function fixture(run: (request: (path: string, init?: RequestInit) => Promise<Response>, calls: string[], loads: string[]) => Promise<void>, failLoad = false) {
  const app = express(), calls: string[] = [], loads: string[] = [];
  let preparationPolls = 0;
  app.use((req, _res, next) => { calls.push(`${req.method} ${req.path}${req.headers.range ? ` Range:${req.headers.range}` : ''}`); next(); });
  app.get('/', (_req, res) => res.type('html').send('<!doctype html><title>Build guide</title>'));
  app.get('/assets/:file', (req, res) => res.type(req.params.file.endsWith('.css') ? 'css' : 'js').send('public static asset'));
  app.get('/api/designs/:id/:format', (req, res) => {
    if (req.params.format === 'manual.pdf' && req.query.prepare === '1') {
      if (preparationPolls++ === 0) return res.status(202).setHeader('Retry-After', '2').end();
      return res.type('pdf').status(200).end();
    }
    const types: Record<string, string> = { 'model.usdz': 'model/vnd.usdz+zip', 'mobile.usdz': 'model/vnd.usdz+zip', 'manual.pdf': 'application/pdf', 'parts.csv': 'text/csv' };
    res.type(types[req.params.format] || 'text/plain');
    const bytes = Buffer.from(`${req.params.id}:${req.params.format}`);
    if (req.params.format === 'model.usdz' || req.params.format === 'mobile.usdz' || req.params.format === 'manual.pdf') return sendInstructionFile(req, res, bytes);
    return res.send(bytes);
  });
  app.use((_req, res) => res.status(200).send('PRIVATE_DOWNSTREAM_SENTINEL'));
  const server = createServer(instructionGateway(app, secret, async id => {
    loads.push(id);
    if (failLoad) throw new Error('PRIVATE_DISK_ERROR');
    return id === design.id ? { ...structuredClone(design), image: { data: 'PRIVATE_PHOTO' }, research: { private: 'PRIVATE_RESEARCH' } } as unknown as SavedDesign : null;
  }));
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address(); assert.ok(address && typeof address === 'object');
    await run((path, init) => fetch(`http://127.0.0.1:${address.port}${path}`, { redirect: 'manual', ...init }), calls, loads);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

test('instruction links bind the exact revision and key and never preserve base credentials or unrelated query data', () => {
  assert.match(token, /^[a-zA-Z0-9_-]{43}$/);
  assert.equal(token, instructionToken(design.id, Buffer.from(secret)));
  assert.notEqual(token, instructionToken('other-revision', secret));
  assert.notEqual(token, instructionToken(design.id, Buffer.alloc(32, 8)));
  assert.equal(instructionUrl('', design.id, secret), null);
  const url = new URL(instructionUrl('https://guide.example/old/path?private=value#old', design.id, secret)!);
  assert.equal(url.pathname, '/'); assert.equal(url.hash, ''); assert.deepEqual([...url.searchParams], [['build', design.id], ['share', token]]);
  for (const id of ['', '../secret', 'a/b', 'a'.repeat(81), 'a\n']) assert.throws(() => instructionToken(id, secret), /Invalid design/);
  for (const base of ['http://guide.example', 'https://user:password@guide.example']) assert.throws(() => instructionUrl(base, design.id, secret), /public HTTPS/);
});

test('signed PDF preparation polls preserve their revision and query while unsigned requests stay blocked', async () => {
  await fixture(async (request, calls, loads) => {
    const path = `/api/designs/${design.id}/manual.pdf`;
    assert.equal((await request(`${path}?prepare=1`, { method: 'HEAD' })).status, 404);
    assert.deepEqual(calls, []); assert.deepEqual(loads, []);
    const pending = await request(signed(`${path}?prepare=1`), { method: 'HEAD' });
    assert.equal(pending.status, 202); assert.equal(pending.headers.get('retry-after'), '2');
    assert.equal(pending.headers.get('cache-control'), 'private, no-store'); assert.equal(await pending.text(), '');
    const ready = await request(signed(`${path}?prepare=1`), { method: 'HEAD' });
    assert.equal(ready.status, 200); assert.match(ready.headers.get('content-type')!, /application\/pdf/);
    assert.deepEqual(calls, [`HEAD ${path}`, `HEAD ${path}`]); assert.deepEqual(loads, [design.id, design.id]);
    const final = await request(signed(path));
    assert.equal(await final.text(), `${design.id}:manual.pdf`);
  });
});

test('a CDN-converted preparation GET stays bounded and its ready response contains no PDF bytes', async () => {
  await fixture(async (request, calls) => {
    const path = `/api/designs/${design.id}/manual.pdf`;
    assert.equal((await request(`${path}?prepare=1`)).status, 404);
    const pending = await request(signed(`${path}?prepare=1`));
    assert.equal(pending.status, 202); assert.equal(pending.headers.get('retry-after'), '2');
    assert.equal(await pending.text(), '');
    const ready = await request(signed(`${path}?prepare=1`));
    assert.equal(ready.status, 200); assert.match(ready.headers.get('content-type')!, /application\/pdf/);
    assert.equal(await ready.text(), '', 'Preparation GET must not transfer the full PDF');
    assert.deepEqual(calls, [`GET ${path}`, `GET ${path}`]);
    const download = await request(signed(path));
    assert.equal(await download.text(), `${design.id}:manual.pdf`, 'Only the URL without prepare downloads bytes');
  });
});

test('a signed guide exposes only exact geometry and public build fields, with GET and HEAD privacy headers', async () => {
  await fixture(async request => {
    const page = await request(signed(`/?build=${design.id}`));
    assert.equal(page.status, 200); assert.match(await page.text(), /Build guide/);
    const response = await request(signed(`/api/designs/${design.id}`));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    const body = await response.json();
    assert.equal(body.id, design.id); assert.deepEqual(body.bricks, design.bricks); assert.equal(body.prompt, '');
    assert.equal(body.research, undefined); assert.equal(body.image, undefined);
    assert.equal(body.inventory, undefined, 'The public guide must not expose the unrelated owned collection');
    assert.deepEqual(body.allocation, { items: [{ partId: '3005', colorId: 4, quantity: 2, owned: 1, missing: 1, sources: [{ source: 'Confirmed set 1234', quantity: 1 }] }], totalMissing: 1 });
    assert.doesNotMatch(JSON.stringify(body), /Unrelated collection/);
    assert.doesNotMatch(JSON.stringify(body), /PRIVATE_PROMPT|PRIVATE_PHOTO|PRIVATE_RESEARCH/);
    const head = await request(signed(`/api/designs/${design.id}`), { method: 'HEAD' });
    assert.equal(head.status, 200); assert.equal(await head.text(), ''); assert.ok(Number(head.headers.get('content-length')) > 0);
  });
});

test('exact and lightweight model and PDF downloads honor single byte ranges and HEAD through the signed gateway', async () => {
  await fixture(async request => {
    for (const format of ['model.usdz', 'mobile.usdz', 'manual.pdf']) {
      const path = signed(`/api/designs/${design.id}/${format}`), bytes = Buffer.from(`${design.id}:${format}`);
      const cases = [
        { range: 'bytes=0-7', start: 0, end: 7 },
        { range: 'bytes=8-', start: 8, end: bytes.length - 1 },
        { range: 'bytes=-5', start: bytes.length - 5, end: bytes.length - 1 },
        { range: 'bytes=5-999999', start: 5, end: bytes.length - 1 },
      ];
      for (const { range, start, end } of cases) {
        const response = await request(path, { headers: { Range: range } });
        assert.equal(response.status, 206, `${format} ${range}`);
        assert.equal(response.headers.get('accept-ranges'), 'bytes');
        assert.equal(response.headers.get('content-range'), `bytes ${start}-${end}/${bytes.length}`);
        assert.equal(Number(response.headers.get('content-length')), end - start + 1);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes.subarray(start, end + 1));
      }
      const head = await request(path, { method: 'HEAD', headers: { Range: 'bytes=0-7' } });
      assert.equal(head.status, 206); assert.equal(head.headers.get('content-length'), '8'); assert.equal(await head.text(), '');
      const impossible = await request(path, { headers: { Range: 'bytes=999999-' } });
      assert.equal(impossible.status, 416); assert.equal(impossible.headers.get('content-range'), `bytes */${bytes.length}`); assert.equal(await impossible.text(), '');
      for (const range of ['malformed', 'bytes=0-3,8-10', 'other=0-7']) {
        const response = await request(path, { headers: { Range: range } });
        assert.equal(response.status, 200, range); assert.equal(response.headers.get('content-range'), null);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
      }
      const denied = await request(`/api/designs/${design.id}/${format}`, { headers: { Range: 'bytes=0-7' } });
      assert.equal(denied.status, 404); assert.equal(denied.headers.get('content-range'), null);
    }
  });
});

test('wrong-revision, malformed and repeated tokens fail before design loading or main-app routing', async () => {
  await fixture(async (request, calls, loads) => {
    const path = `/api/designs/${design.id}`;
    for (const candidate of [path, signed(path, instructionToken('other-revision', secret)), signed(path, instructionToken(design.id, Buffer.alloc(32, 9))),
      signed(path, token.slice(1)), signed(path, token + 'x'), signed(path, 'é'.repeat(43)), `${signed(path)}&share=${token}`, `${path}?share[]=x`,
      signed(`/?build=../secret`), signed(`/?build=${design.id}&build=other`)]) {
      const response = await request(candidate); assert.equal(response.status, 404, candidate); assert.equal(await response.text(), '');
    }
    assert.deepEqual(calls, []); assert.deepEqual(loads, []);
    assert.equal((await request(signed('/api/designs/other-revision'))).status, 404);
    assert.deepEqual(loads, []);
  });
});

test('public GET/HEAD routing permits only the signed design, its four files and public build assets', async () => {
  await fixture(async (request, calls) => {
    for (const format of ['model.usdz', 'mobile.usdz', 'manual.pdf', 'parts.csv']) {
      const response = await request(signed(`/api/designs/${design.id}/${format}`));
      assert.equal(response.status, 200); assert.equal(await response.text(), `${design.id}:${format}`);
      if (format.endsWith('.usdz')) assert.equal(response.headers.get('content-type'), 'model/vnd.usdz+zip');
      const head = await request(signed(`/api/designs/${design.id}/${format}`), { method: 'HEAD' });
      assert.equal(head.status, 200); assert.equal(await head.text(), '');
    }
    const ranged = await request(signed(`/api/designs/${design.id}/model.usdz`), { headers: { Range: 'bytes=0-7' } });
    await ranged.arrayBuffer();
    assert.ok(calls.includes(`GET /api/designs/${design.id}/model.usdz Range:bytes=0-7`), 'Gateway must preserve Range for the main export handler');
    for (const asset of ['/assets/app-123.js', '/assets/app-123.css', '/assets/assembly-worker-123.js']) {
      assert.equal((await request(asset)).status, 200); assert.equal((await request(asset, { method: 'HEAD' })).status, 200);
    }
    const count = calls.length;
    for (const path of ['/api/status', '/api/catalog', '/api/catalog/search', '/api/examples', '/api/generation-jobs', '/api/generation-jobs/private-job',
      `/api/designs/${design.id}/instructions-link`, `/api/designs/${design.id}/model.ldr`, `/api/designs/${design.id}/preview.png`, '/.env', '/assets/app.js.map',
      '/assets/config.json', '/assets/%2e%2e/.env', '/api/designs/..%2Fprivate', '/api/designs/%61pproved-revision', '/api/designs/approved-revision%2Fparts.csv']) {
      const response = await request(signed(path)); assert.equal(response.status, 404, path); assert.doesNotMatch(await response.text(), /PRIVATE_DOWNSTREAM/);
    }
    assert.equal(calls.length, count);
  });
});

test('all public mutations are rejected even with a valid capability and static path', async () => {
  await fixture(async (request, calls, loads) => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) for (const path of [signed(`/?build=${design.id}`), signed(`/api/designs/${design.id}`), '/api/generation-jobs', '/assets/app.js']) {
      const response = await request(path, { method }); assert.equal(response.status, 405, `${method} ${path}`);
    }
    assert.deepEqual(calls, []); assert.deepEqual(loads, []);
  });
});

test('signed missing designs and disk errors do not leak private internals or reach the main app', async () => {
  await fixture(async (request, calls) => {
    const response = await request(signed('/api/designs/missing', instructionToken('missing', secret)));
    assert.equal(response.status, 404); assert.deepEqual(calls, []);
  });
  await fixture(async (request, calls) => {
    const response = await request(signed(`/api/designs/${design.id}`));
    assert.equal(response.status, 500); assert.doesNotMatch(await response.text(), /PRIVATE_DISK_ERROR|stack|node_modules/); assert.deepEqual(calls, []);
  }, true);
});

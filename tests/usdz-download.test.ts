import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import test from 'node:test';
import { generateUsdz } from '../server/native-model.js';
import { SAMPLE_DESIGNS } from '../shared/examples.js';
import type { Design, InventoryItem } from '../shared/model.js';
import { prepareUsdzDownload } from '../src/usdz-download.js';

const specimen: Design = {
  ...structuredClone(SAMPLE_DESIGNS[0]), id: 'download-specimen', title: 'Clicked / Build',
  bricks: [{ id: 'base', partId: '3001', colorId: 4, x: 0, y: 0, z: 0, rotation: 0 }],
};
const archive = await generateUsdz(specimen);
const inventory: InventoryItem[] = [{ partId: '3001', colorId: 4, quantity: 1, source: 'Clicked collection' }];
type RequestRecord = { method: string; path: string; body?: unknown };

async function fixture(
  exportResponse: (response: ServerResponse) => void,
  run: (fetcher: typeof fetch, requests: RequestRecord[]) => Promise<void>,
  snapshotId = 'frozen-revision',
) {
  const requests: RequestRecord[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString();
    requests.push({ method: request.method!, path: request.url!, ...(body ? { body: JSON.parse(body) } : {}) });
    if (request.method === 'POST' && request.url === '/api/designs') {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id: snapshotId }));
    } else if (request.url === '/api/designs/frozen-revision/model.usdz') exportResponse(response);
    else response.writeHead(404).end();
  });
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const fetcher: typeof fetch = (input, init) => fetch(new URL(String(input), `http://127.0.0.1:${address.port}`), init);
    await run(fetcher, requests);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

function sendArchive(response: ServerResponse, bytes = archive, mimeType = 'model/vnd.usdz+zip') {
  response.writeHead(200, { 'Content-Type': mimeType }).end(bytes);
}

test('a checked download freezes the clicked placements and inventory before any await', async () => {
  await fixture(response => sendArchive(response), async (fetcher, requests) => {
    const clicked = structuredClone(specimen);
    const collection = structuredClone(inventory);
    const pending = prepareUsdzDownload(clicked, collection, { fetch: fetcher });
    clicked.title = 'Other model'; clicked.bricks[0].x = 9; collection[0].quantity = 99;
    const result = await pending;
    assert.equal(result.title, 'Clicked / Build');
    assert.equal(result.filename, 'clicked-build.usdz');
    assert.equal(result.url, '/api/designs/frozen-revision/model.usdz');
    assert.deepEqual(Buffer.from(await result.file.arrayBuffer()), archive);
    assert.equal(result.file.type, 'model/vnd.usdz+zip');
    assert.deepEqual(requests, [
      { method: 'POST', path: '/api/designs', body: { design: specimen, inventory } },
      { method: 'GET', path: '/api/designs/frozen-revision/model.usdz' },
    ]);
  });
});

test('binary octet-stream responses retain a USDZ type and non-ASCII titles get a usable filename', async () => {
  await fixture(response => sendArchive(response, archive, 'application/octet-stream'), async fetcher => {
    const result = await prepareUsdzDownload({ ...specimen, title: '城堡' }, [], { fetch: fetcher });
    assert.equal(result.filename, 'build.usdz');
    assert.equal(result.file.type, 'model/vnd.usdz+zip');
  });
});

test('an invalid snapshot response fails before requesting a file', async () => {
  for (const id of ['', '../escape', 'x'.repeat(81)]) await fixture(response => sendArchive(response), async (fetcher, requests) => {
    await assert.rejects(prepareUsdzDownload(specimen, [], { fetch: fetcher }), /snapshot|revision/i);
    assert.equal(requests.length, 1);
  }, id);
});

test('API failures keep a useful message and non-JSON failures use a download-specific fallback', async () => {
  for (const [status, body, type, expected] of [
    [503, '{"error":"Export unavailable. Retry shortly."}', 'application/json', /Export unavailable/],
    [502, '<html>Bad gateway</html>', 'text/html', /3D|USDZ/i],
    [500, '{"error":{"private":"unexpected shape"}}', 'application/json', /3D|USDZ/i],
  ] as const) await fixture(response => { response.writeHead(status, { 'Content-Type': type }).end(body); }, async fetcher => {
    await assert.rejects(prepareUsdzDownload(specimen, [], { fetch: fetcher }), expected);
  });
});

test('successful HTML, JSON, empty and incomplete archives never become download results', async () => {
  const compressed = Buffer.from(archive); compressed.writeUInt16LE(8, 8);
  const misaligned = Buffer.from(archive); misaligned.writeUInt16LE(misaligned.readUInt16LE(28) + 1, 28);
  const falseDirectory = Buffer.from(archive); falseDirectory.writeUInt32LE(0, falseDirectory.length - 22 + 16);
  for (const [bytes, type] of [
    [Buffer.from('<html>Studio</html>'), 'text/html'],
    [Buffer.from('{"error":"not a model"}'), 'application/json'],
    [Buffer.alloc(0), 'model/vnd.usdz+zip'],
    [archive.subarray(0, 64), 'model/vnd.usdz+zip'],
    [archive.subarray(0, archive.length - 1), 'model/vnd.usdz+zip'],
    [compressed, 'model/vnd.usdz+zip'],
    [misaligned, 'model/vnd.usdz+zip'],
    [falseDirectory, 'model/vnd.usdz+zip'],
  ] as const) await fixture(response => sendArchive(response, bytes, type), async fetcher => {
    await assert.rejects(prepareUsdzDownload(specimen, [], { fetch: fetcher }), /USDZ|3D|incomplete|invalid/i);
  });
});

test('an interrupted stream rejects and a subsequent request can download successfully', async () => {
  let attempts = 0;
  await fixture(response => {
    if (attempts++ > 0) { sendArchive(response); return; }
    response.writeHead(200, { 'Content-Type': 'model/vnd.usdz+zip', 'Content-Length': archive.length });
    response.write(archive.subarray(0, 64));
    setTimeout(() => response.destroy(), 20);
  }, async fetcher => {
    await assert.rejects(prepareUsdzDownload(specimen, [], { fetch: fetcher }));
    const retry = await prepareUsdzDownload(specimen, [], { fetch: fetcher });
    assert.equal(retry.file.size, archive.length);
  });
});

test('caller cancellation stops a response stalled after its headers', async () => {
  const controller = new AbortController();
  await fixture(response => {
    response.writeHead(200, { 'Content-Type': 'model/vnd.usdz+zip' }); response.flushHeaders();
    setTimeout(() => controller.abort(), 20);
  }, async fetcher => {
    await assert.rejects(prepareUsdzDownload(specimen, [], { fetch: fetcher, signal: controller.signal }), (error: Error) => error.name === 'AbortError');
  });
});

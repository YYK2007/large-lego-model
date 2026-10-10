import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer as createHttpServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createViteServer } from 'vite';
import config from '../vite.config.js';
import { readGenerationStream, type GenerationProgress } from '../src/generation-stream.js';

test('development proxy closes an interrupted generation stream and preserves a completed stream', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sprout-proxy-test-'));
  const progress = '{"type":"progress","stage":"planning","attempt":1,"maxAttempts":2}\n';
  const complete = '{"type":"design","design":{"id":"finished"}}\n';
  const upstream = createHttpServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    response.write(progress);
    if (request.url === '/api/complete') response.end(complete);
    else setTimeout(() => response.destroy(), 30);
  });
  let vite: Awaited<ReturnType<typeof createViteServer>> | undefined;
  try {
    await new Promise<void>((resolve, reject) => { upstream.once('error', reject); upstream.listen(0, '127.0.0.1', resolve); });
    const address = upstream.address();
    assert.ok(address && typeof address === 'object');
    const proxy = config.server?.proxy?.['/api'];
    assert.ok(proxy && typeof proxy === 'object');
    vite = await createViteServer({ configFile: false, root, logLevel: 'silent', server: {
      host: '127.0.0.1', port: 0, hmr: false, watch: null,
      proxy: { '/api': { ...proxy, target: `http://127.0.0.1:${address.port}` } },
    } });
    await vite.listen();
    const proxyAddress = vite.httpServer?.address();
    assert.ok(proxyAddress && typeof proxyAddress === 'object');
    const base = `http://127.0.0.1:${proxyAddress.port}`;
    const success = await fetch(`${base}/api/complete`, { signal: AbortSignal.timeout(2500) });
    assert.equal(await success.text(), progress + complete);
    const interrupted = await fetch(`${base}/api/interrupted`, { signal: AbortSignal.timeout(2500) });
    assert.equal(interrupted.status, 200, 'Headers and progress arrived before the API socket closed');
    const events: GenerationProgress[] = [];
    await assert.rejects(readGenerationStream(interrupted, event => events.push(event)), (error: Error) => {
      assert.notEqual(error.name, 'TimeoutError', 'The broken stream must close before the client deadline');
      assert.match(error.message, /terminated|connection (closed|ended)/i);
      return true;
    });
    assert.equal(events.length, 1, 'Progress still reaches the client before the interrupted stream closes');
  } finally {
    await vite?.close();
    upstream.closeAllConnections();
    await new Promise<void>(resolve => upstream.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

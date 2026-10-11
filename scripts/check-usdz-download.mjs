import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { SAMPLE_DESIGNS } from '../shared/examples.ts';
import { archiveFiles, verifyBatchedUsdz } from '../tests/usdz-artifact.ts';

// Run with node --import tsx; Playwright is a development-only prerequisite.
// NODE_PATH may point to a bundled runtime instead of adding a product dependency.
const { chromium } = createRequire(import.meta.url)('playwright');
const base = process.env.USDZ_TEST_BASE || 'http://127.0.0.1:3001';
const output = resolve('output/usdz-download');
const regressionsOnly = process.argv.includes('--regressions-only');
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
const report = { browser: browser.version(), base, checks: [] };
await mkdir(output, { recursive: true });

async function studio(width = 1440, shortDeadline = false) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, acceptDownloads: true });
  context.setDefaultTimeout(15_000);
  if (shortDeadline) await context.addInitScript(() => {
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    AbortSignal.timeout = ms => timeout(ms === 120_000 ? 300 : ms);
  });
  const page = await context.newPage();
  await page.goto(base + '/?design=sample-castle');
  await page.waitForLoadState('networkidle');
  await page.getByRole('heading', { name: 'Courtyard castle.' }).waitFor();
  return { context, page };
}

const directButton = page => page.getByRole('button', { name: 'Download 3D (.usdz)', exact: true });

function archiveReport(bytes, design) {
  const files = archiveFiles(bytes);
  const { parts, ...geometry } = verifyBatchedUsdz(files, design, false);
  return { bytes: bytes.length, files: files.size, ...geometry, units: 'meters, Y-up' };
}

try {
  for (const scenario of ['html', 'empty', '503', 'interrupted', 'timeout']) {
    const { context, page } = await studio(1440, scenario === 'timeout');
    try {
      let downloads = 0;
      page.on('download', () => downloads++);
      await page.route('**/api/designs/*/model.usdz', async route => {
        if (scenario === 'timeout') {
          await new Promise(resolve => setTimeout(resolve, 600));
          await route.abort().catch(() => {});
        } else if (scenario === 'interrupted') {
          await route.abort('connectionreset');
        } else await route.fulfill({
          status: scenario === '503' ? 503 : 200,
          contentType: scenario === 'html' ? 'text/html' : scenario === '503' ? 'application/json' : 'model/vnd.usdz+zip',
          body: scenario === 'html' ? '<html>Studio, not a model</html>' : scenario === '503' ? '{"error":"Export unavailable. Retry shortly."}' : '',
        });
      });
      await directButton(page).click();
      const alert = page.getByRole('alert');
      await alert.waitFor({ timeout: 5000 });
      assert.match(await alert.innerText(), scenario === '503' ? /Export unavailable/ : scenario === 'timeout' ? /timed out/i : /USDZ|3D/i);
      assert.equal(downloads, 0, 'Failed responses must not trigger downloads');
      assert.ok(await directButton(page).isEnabled(), 'Retry enabled');
      assert.equal(await page.getByRole('heading', { name: 'Courtyard castle.' }).count(), 1);
      await page.screenshot({ path: resolve(output, `${scenario}.png`), fullPage: true });
      report.checks.push({ scenario, passed: true });
    } finally { await context.close(); }
  }

  if (!regressionsOnly) {
    const castle = SAMPLE_DESIGNS.find(design => design.id === 'sample-castle');
    for (const width of [1440, 390]) {
      const { context, page } = await studio(width);
      try {
        const downloadPromise = page.waitForEvent('download');
        await directButton(page).click();
        const download = await downloadPromise;
        assert.equal(download.suggestedFilename(), 'courtyard-castle.usdz');
        const path = resolve(output, `castle-${width}.usdz`);
        await download.saveAs(path);
        assert.equal(await download.failure(), null);
        const artifact = archiveReport(await readFile(path), castle);
        await page.getByRole('link', { name: 'Save USDZ file' }).waitFor();
        const fallback = await page.getByRole('link', { name: 'Save USDZ file' }).getAttribute('href');
        const response = await fetch(new URL(fallback, base));
        assert.equal(response.status, 200);
        assert.match(response.headers.get('content-disposition'), /attachment/);
        archiveReport(Buffer.from(await response.arrayBuffer()), castle);
        const fallbackDownload = page.waitForEvent('download');
        await page.getByRole('link', { name: 'Save USDZ file' }).click();
        const savedFallback = await fallbackDownload;
        const fallbackPath = resolve(output, `castle-fallback-${width}.usdz`);
        await savedFallback.saveAs(fallbackPath);
        archiveReport(await readFile(fallbackPath), castle);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        assert.equal(overflow, false, 'No horizontal overflow');
        await page.screenshot({ path: resolve(output, `desktop-${width}.png`), fullPage: true });
        report.checks.push({ scenario: 'actual download and HTTP fallback', width, passed: true, ...artifact });
      } finally { await context.close(); }
    }

    const { context, page } = await studio();
    let release;
    try {
      let snapshots = 0, exports = 0;
      page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/designs') snapshots++; });
      const waiting = new Promise(resolve => { release = resolve; });
      await page.route('**/api/designs/*/model.usdz', async route => { exports++; await waiting; await route.continue(); });
      const downloadPromise = page.waitForEvent('download');
      await directButton(page).evaluate(button => { button.click(); button.click(); });
      await page.getByRole('button', { name: 'Preparing 3D model…', exact: true }).waitFor();
      await page.getByRole('button', { name: /Orbit/ }).click();
      await page.getByRole('heading', { name: 'Orbit explorer.' }).waitFor();
      release();
      const download = await downloadPromise;
      const path = resolve(output, 'castle-during-switch.usdz');
      await download.saveAs(path);
      archiveReport(await readFile(path), castle);
      assert.equal(download.suggestedFilename(), 'courtyard-castle.usdz');
      assert.equal(snapshots, 1, 'One snapshot for rapid duplicate clicks');
      assert.equal(exports, 1, 'One export for rapid duplicate clicks');
      await page.getByRole('link', { name: 'Save USDZ file' }).waitFor();
      assert.match(await page.locator('.model-file').innerText(), /Courtyard castle/);
      assert.equal(await page.getByRole('heading', { name: 'Orbit explorer.' }).count(), 1);
      report.checks.push({ scenario: 'revision switching and duplicate clicks', passed: true });
      await page.unroute('**/api/designs/*/model.usdz');
      await page.route('**/api/designs/*/model.usdz', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Retry this export."}' }));
      await directButton(page).click();
      await page.getByRole('alert').waitFor();
      assert.match(await page.locator('.model-file').innerText(), /Courtyard castle/);
      assert.ok(await directButton(page).isEnabled());
      await page.unroute('**/api/designs/*/model.usdz');
      await page.getByRole('button', { name: /Let’s build/ }).click();
      const retryPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: /Native 3D model/ }).click();
      const retry = await retryPromise;
      const retryPath = resolve(output, 'orbit-from-dialog.usdz');
      await retry.saveAs(retryPath);
      archiveReport(await readFile(retryPath), SAMPLE_DESIGNS.find(design => design.id === 'sample-rocket'));
      assert.equal(retry.suggestedFilename(), 'orbit-explorer.usdz');
      await page.getByRole('link', { name: 'Save USDZ file' }).waitFor();
      assert.match(await page.locator('.model-file').innerText(), /Orbit explorer/);
      report.checks.push({ scenario: 'failed request preserves prior link; dialog retry succeeds', passed: true });

      for (const [name, extension, signature] of [
        [/Build manual/, 'pdf', '%PDF-'],
        [/Parts & collection list/, 'csv', '"Part ID"'],
        [/LDraw model/, 'ldr', '0 '],
        [/Design preview/, 'png', '\u0089PNG'],
      ]) {
        await page.getByRole('button', { name: /Let’s build/ }).click();
        const pending = page.waitForEvent('download');
        await page.getByRole('button', { name }).click();
        const file = await pending;
        const path = resolve(output, `orbit-smoke.${extension}`);
        await file.saveAs(path);
        assert.ok((await readFile(path)).toString('latin1').startsWith(signature), `${extension} signature`);
        const close = page.getByRole('button', { name: 'Close dialog' });
        if (await close.isVisible()) await close.click();
        report.checks.push({ scenario: `${extension} export smoke`, passed: true });
      }
    } finally { release?.(); await context.close(); }
  }
  await writeFile(resolve(output, 'browser-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }

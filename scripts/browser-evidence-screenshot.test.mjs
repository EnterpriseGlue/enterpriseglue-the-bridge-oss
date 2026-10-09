import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { webkit } from '@playwright/test';
import { captureEvidenceScreenshot } from '../test/e2e/utils/evidence-screenshot.ts';

const frontendRequire = createRequire(new URL('../packages/frontend-host/package.json', import.meta.url));
const font = readFileSync(frontendRequire.resolve('@ibm/plex-sans/fonts/split/woff2/IBMPlexSans-Regular-Latin1.woff2'));

for (const failUsedFont of [false, true]) {
  test(`WebKit evidence verifies the used font (failure=${failUsedFont}) despite an unrelated pending face`, async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'eg-font-evidence-'));
    const server = createServer((request, response) => {
      if (request.url === '/pending.woff2') return; // unrelated FontFace stays pending
      if (request.url === '/font.woff2') {
        response.writeHead(failUsedFont ? 404 : 200, { 'Content-Type': 'font/woff2' });
        response.end(failUsedFont ? '' : font);
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<style>@font-face{font-family:"IBM Plex Sans";src:url(/font.woff2)} p{font:400 16px "IBM Plex Sans",sans-serif}</style><p>Engine tenancy evidence</p>');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await webkit.launch();
    const previous = process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY;
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => {
        const face = new FontFace('UnrelatedPending', 'url(/pending.woff2)');
        document.fonts.add(face);
        void face.load().catch(() => {});
      });
      assert.equal(await page.evaluate(() => document.fonts.status), 'loading');
      const output = path.join(directory, 'evidence.png');
      if (failUsedFont) {
        await assert.rejects(captureEvidenceScreenshot(page, output), /font|NetworkError|network/i);
        assert.equal(existsSync(output), false, 'missing used fonts must never produce passing evidence');
      } else {
        await captureEvidenceScreenshot(page, output);
        assert.deepEqual([...readFileSync(output).subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
      }
      assert.equal(process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY, previous);
    } finally {
      await browser.close();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

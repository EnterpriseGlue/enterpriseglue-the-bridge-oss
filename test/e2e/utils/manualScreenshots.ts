import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';

export const manualScreenshotDirectory = process.env.MANUAL_UI_SCREENSHOT_DIR;

export async function captureManualScreenshot(
  page: Page,
  fileName: string,
  options: { stabilize?: boolean } = {},
): Promise<void> {
  if (!manualScreenshotDirectory) return;
  await mkdir(manualScreenshotDirectory, { recursive: true });
  if (options.stabilize !== false) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
      document.querySelectorAll<HTMLElement>('main, [role="main"], .cds--content')
        .forEach((element) => { element.scrollTop = 0; });
    });
    await page.mouse.move(0, 0);
  }
  await page.screenshot({
    path: resolve(manualScreenshotDirectory, fileName),
    type: 'jpeg',
    quality: 90,
    animations: 'disabled',
    caret: 'hide',
  });
}

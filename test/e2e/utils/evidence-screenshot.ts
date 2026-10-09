import type { Page } from '@playwright/test';

/**
 * FontFaceSet.ready can remain pending in WebKit after the fonts used by the
 * page have loaded (the scheduled trace stopped there with font HTTP 200s).
 * Verify the actual rendered fonts instead, with a bounded failure, before
 * bypassing only Playwright's redundant all-fonts wait for this capture.
 */
export async function captureEvidenceScreenshot(page: Page, path: string): Promise<void> {
  await page.evaluate(async () => {
    const fonts = new Map<string, string>();
    for (const element of document.body.querySelectorAll('*')) {
      const text = [...element.childNodes]
        .filter(node => node.nodeType === Node.TEXT_NODE)
        .map(node => node.textContent || '').join('').trim();
      if (!text || !element.getBoundingClientRect().width) continue;
      const style = getComputedStyle(element);
      if (style.visibility !== 'visible' || style.display === 'none') continue;
      const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      fonts.set(font, (fonts.get(font) || '') + text);
    }
    if (!fonts.size) throw new Error('Evidence screenshot has no visible text to verify');
    let timeout: ReturnType<typeof setTimeout>;
    try {
      await Promise.race([
        Promise.all([...fonts].map(async ([font, text]) => {
          const faces = await document.fonts.load(font, text);
          if (!document.fonts.check(font, text) || faces.some(face => face.status !== 'loaded')) {
            throw new Error(`Rendered evidence font did not load: ${font}`);
          }
          if (font.includes('IBM Plex') && !faces.length) {
            throw new Error(`Rendered IBM Plex evidence font is not registered: ${font}`);
          }
        })),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Rendered evidence fonts did not load within 10 seconds')), 10000);
        }),
      ]);
    } finally {
      clearTimeout(timeout!);
    }
  });
  // Playwright workers execute one test at a time. Restore the pinned driver's
  // switch even if capture fails; other screenshots keep their default policy.
  const previous = process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY;
  process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = '1';
  try {
    await page.screenshot({ path, fullPage: true, animations: 'disabled', timeout: 15000 });
  } finally {
    if (previous === undefined) delete process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY;
    else process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = previous;
  }
}

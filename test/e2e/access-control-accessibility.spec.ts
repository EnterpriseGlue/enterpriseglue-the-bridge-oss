import { expect, test, type Locator, type Page } from '@playwright/test';
import { MockBrowserIdentityStack } from './utils/mockIdentityStack';

const permission = {
  key: 'engine:instance:view',
  label: 'View engine instances',
  description: 'View process instances without changing runtime state.',
  scope: 'engine',
  category: 'Mission Control',
  kind: 'system',
};

// The isolated Linux WebKit container can finish hydrating this route after
// Playwright's default 10-second assertion window, even once navigation has
// completed. Keep the readiness assertion explicit so every browser validates
// the same rendered interface instead of intermittently racing hydration.
const accessControlReadyTimeoutMs = 30_000;

async function openPermissions(page: Page, failPermissions = false): Promise<void> {
  const identityStack = new MockBrowserIdentityStack();
  await identityStack.install(page, process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173');
  await page.route('**/api/authz/permissions', (route) => route.fulfill({
    status: failPermissions ? 503 : 200,
    contentType: 'application/json',
    body: JSON.stringify(failPermissions ? { error: 'Permission catalog unavailable' } : [permission]),
  }));
  await page.goto('/admin/access-control');
  await expect(page.getByRole('heading', { name: 'Access Control' })).toBeVisible({
    timeout: accessControlReadyTimeoutMs,
  });
  await page.getByRole('tab', { name: 'Permissions', exact: true }).click();
}

async function contrastRatio(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    const parseRgb = (value: string): [number, number, number] => {
      const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number);
      if (!channels || channels.length !== 3) throw new Error(`Unsupported color: ${value}`);
      return channels as [number, number, number];
    };
    const luminance = (value: string): number => {
      const [red, green, blue] = parseRgb(value).map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.04045
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
    };

    const foreground = window.getComputedStyle(element).color;
    let backgroundElement: Element | null = element;
    let background = 'rgba(0, 0, 0, 0)';
    while (backgroundElement) {
      background = window.getComputedStyle(backgroundElement).backgroundColor;
      if (!background.endsWith(', 0)') && background !== 'transparent') break;
      backgroundElement = backgroundElement.parentElement;
    }
    const foregroundLuminance = luminance(foreground);
    const backgroundLuminance = luminance(background);
    return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
      / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
  });
}

test.describe('Access Control accessibility release checks', () => {
  test('announces permission-loading failures through an assertive error region @accessibility', async ({ page }) => {
    await openPermissions(page, true);

    const error = page.getByText('Unable to load permissions', { exact: true });
    await expect(error).toBeVisible();
    await expect(error.locator('xpath=ancestor-or-self::*[@role="alert" or @aria-live="assertive"][1]')).toHaveCount(1);
  });

  test('keeps primary Access Control text above WCAG AA contrast @accessibility', async ({ page }) => {
    await openPermissions(page);

    const samples = [
      page.getByRole('heading', { name: 'Access Control' }),
      page.getByRole('tab', { name: 'Permissions', exact: true }),
      page.getByText(permission.label, { exact: true }),
      page.getByRole('button', { name: 'Add Permission' }),
    ];
    for (const sample of samples) {
      await expect(sample).toBeVisible();
      await expect(contrastRatio(sample)).resolves.toBeGreaterThanOrEqual(4.5);
    }
  });

  test('reflows the page shell at 200 percent without viewport-level horizontal scrolling @accessibility', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openPermissions(page);
    await page.evaluate(() => {
      document.documentElement.style.zoom = '2';
    });

    await expect.poll(() => page.evaluate(() =>
      document.documentElement.scrollWidth <= document.documentElement.clientWidth
    )).toBe(true);
    await expect(page.getByText(permission.label, { exact: true })).toBeVisible();
  });

  test('keeps the permission workflow usable when reduced motion is requested @accessibility', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openPermissions(page);

    await expect(page.getByText(permission.label, { exact: true })).toBeVisible();
    await expect(page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)).resolves.toBe(true);
    await page.getByRole('combobox', { name: 'Quick filter' }).click();
    await expect(page.getByRole('option', { name: 'All permissions', exact: true })).toBeVisible();
  });
});

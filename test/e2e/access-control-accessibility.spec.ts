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
  await page.getByRole('link', { name: 'Permissions', exact: true }).click();
}

function permissionLabelCell(page: Page): Locator {
  // The cell deliberately exposes the human label first and the immutable
  // permission key as secondary administrative detail.
  return page.getByRole('cell', { name: new RegExp(`^${permission.label}\\b`) });
}

async function contrastRatio(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    type Rgba = [number, number, number, number];
    const parseRgb = (value: string): Rgba => {
      const channels = value.match(/[\d.]+/g)?.map(Number);
      if (!channels || channels.length < 3) throw new Error(`Unsupported color: ${value}`);
      return [channels[0], channels[1], channels[2], channels[3] ?? 1];
    };
    const composite = (foreground: Rgba, background: Rgba): Rgba => {
      const alpha = foreground[3] + (background[3] * (1 - foreground[3]));
      if (alpha === 0) return [0, 0, 0, 0];
      return [
        ((foreground[0] * foreground[3]) + (background[0] * background[3] * (1 - foreground[3]))) / alpha,
        ((foreground[1] * foreground[3]) + (background[1] * background[3] * (1 - foreground[3]))) / alpha,
        ((foreground[2] * foreground[3]) + (background[2] * background[3] * (1 - foreground[3]))) / alpha,
        alpha,
      ];
    };
    const luminance = (value: Rgba): number => {
      const [red, green, blue] = value.slice(0, 3).map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.04045
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
    };

    const foreground = parseRgb(window.getComputedStyle(element).color);
    let backgroundElement: Element | null = element;
    const backgroundLayers: Rgba[] = [];
    while (backgroundElement) {
      const layer = parseRgb(window.getComputedStyle(backgroundElement).backgroundColor);
      if (layer[3] > 0) backgroundLayers.push(layer);
      if (layer[3] === 1) break;
      backgroundElement = backgroundElement.parentElement;
    }
    const background = backgroundLayers
      .reverse()
      .reduce((rendered, layer) => composite(layer, rendered), [255, 255, 255, 1] as Rgba);
    const renderedForeground = composite(foreground, background);
    const foregroundLuminance = luminance(renderedForeground);
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
      { name: 'page heading', locator: page.getByRole('heading', { name: 'Access Control' }) },
      { name: 'active section link', locator: page.getByRole('link', { name: 'Permissions', exact: true }) },
      { name: 'permission label', locator: permissionLabelCell(page) },
      { name: 'primary action', locator: page.getByRole('button', { name: 'Add permission' }) },
    ];
    for (const sample of samples) {
      await expect(sample.locator).toBeVisible();
      expect(await contrastRatio(sample.locator), sample.name).toBeGreaterThanOrEqual(4.5);
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
    await expect(permissionLabelCell(page)).toBeVisible();
  });

  test('keeps the permission workflow usable when reduced motion is requested @accessibility', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openPermissions(page);

    await expect(permissionLabelCell(page)).toBeVisible();
    await expect(page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)).resolves.toBe(true);
    await page.getByRole('combobox', { name: 'Permission capability' }).click();
    await expect(page.getByRole('option', { name: 'All permissions', exact: true })).toBeVisible();
  });

  test('aligns the permission filter with the primary toolbar action @accessibility', async ({ page }) => {
    await openPermissions(page);

    const quickFilter = page.getByRole('combobox', { name: 'Permission capability' });
    const addPermission = page.getByRole('button', { name: 'Add permission' });
    await expect(quickFilter).toBeVisible();
    await expect(addPermission).toBeVisible();

    await expect.poll(() => quickFilter.evaluate((element) => {
      const button = Array.from(document.querySelectorAll('button'))
        .find((candidate) => candidate.textContent?.includes('Add permission'));
      if (!button) return null;
      const filter = element.getBoundingClientRect();
      const action = button.getBoundingClientRect();
      return {
        filterTop: filter.top,
        filterBottom: filter.bottom,
        actionTop: action.top,
        actionBottom: action.bottom,
        borderBottom: getComputedStyle(element).borderBottomWidth,
      };
    })).toEqual(expect.objectContaining({
      borderBottom: '0px',
      filterTop: expect.any(Number),
      filterBottom: expect.any(Number),
      actionTop: expect.any(Number),
      actionBottom: expect.any(Number),
    }));

    const geometry = await quickFilter.evaluate((element) => {
      const button = Array.from(document.querySelectorAll('button'))
        .find((candidate) => candidate.textContent?.includes('Add permission'))!;
      const filter = element.getBoundingClientRect();
      const action = button.getBoundingClientRect();
      return { topDifference: Math.abs(filter.top - action.top), bottomDifference: Math.abs(filter.bottom - action.bottom) };
    });
    expect(geometry.topDifference).toBeLessThanOrEqual(1);
    expect(geometry.bottomDifference).toBeLessThanOrEqual(1);
  });
});

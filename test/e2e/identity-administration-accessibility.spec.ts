import { expect, test, type Page, type Route } from '@playwright/test';
import { MockBrowserIdentityStack } from './utils/mockIdentityStack';

const fulfillJson = (route: Route, body: unknown, status = 200) => route.fulfill({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

async function openIdentitySettings(page: Page, tabName: 'Identity Providers' | 'Identity Mappings'): Promise<MockBrowserIdentityStack> {
  const stack = new MockBrowserIdentityStack();
  await stack.install(page, process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173');
  await page.goto('/admin/settings');
  const tab = page.getByRole('tab', { name: tabName, exact: true });
  await tab.focus();
  await page.keyboard.press('Enter');
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  return stack;
}

test.describe('Identity Provider and Mapping accessibility release checks', () => {
  test('supports keyboard-only tab selection and announces provider and mapping loading errors @identity-accessibility', async ({ page }) => {
    const stack = new MockBrowserIdentityStack();
    await stack.install(page, process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173');
    await page.route('**/api/identity/providers', (route) => fulfillJson(route, { error: 'Identity provider service unavailable' }, 503));
    await page.route('**/api/identity/mappings', (route) => fulfillJson(route, { error: 'Identity mapping service unavailable' }, 503));

    await page.goto('/admin/settings');
    const providersTab = page.getByRole('tab', { name: 'Identity Providers', exact: true });
    await providersTab.focus();
    await page.keyboard.press('Enter');
    const providerError = page.getByText('Identity providers could not be loaded', { exact: true });
    await expect(providerError).toBeVisible();
    await expect(providerError.locator('xpath=ancestor-or-self::*[@role="alert" or @aria-live="assertive"][1]')).toHaveCount(1);

    const mappingsTab = page.getByRole('tab', { name: 'Identity Mappings', exact: true });
    await mappingsTab.focus();
    await page.keyboard.press('Enter');
    const mappingError = page.getByText('Identity mappings could not be loaded', { exact: true });
    await expect(mappingError).toBeVisible();
    await expect(mappingError.locator('xpath=ancestor-or-self::*[@role="alert" or @aria-live="assertive"][1]')).toHaveCount(1);
  });

  test('keeps identity administration usable at 200 percent zoom and reduced motion @identity-accessibility', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await openIdentitySettings(page, 'Identity Providers');
    await expect(page.getByLabel('Identity Providers', { exact: true })).toBeVisible();
    await page.evaluate(() => { document.documentElement.style.zoom = '2'; });

    await expect.poll(() => page.evaluate(() =>
      document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    )).toBe(true);
    await expect(page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)).resolves.toBe(true);

    await page.getByRole('tab', { name: 'Identity Mappings', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Identity Mappings', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add mapping', exact: true })).toBeVisible();
  });

  test('renders config-lock badges and blocks provider/mapping mutations after a configuration refresh @identity-accessibility', async ({ page }) => {
    const stack = await openIdentitySettings(page, 'Identity Providers');
    const providersPanel = page.getByLabel('Identity Providers', { exact: true });
    await expect(providersPanel.getByText('Managed by config', { exact: true })).toBeVisible();
    await providersPanel.getByRole('button', { name: 'Provider actions' }).click();
    await expect(page.getByRole('menuitem', { name: 'Edit' })).toBeDisabled();
    await expect(page.getByRole('menuitem', { name: 'Archive' })).toBeDisabled();

    await page.route('**/api/identity/mappings', (route) => fulfillJson(route, [{
      ...stack.mapping,
      sourceRef: 'config_bundle:e2e.identity.lifecycle',
    }]));
    await page.reload();
    await page.getByRole('tab', { name: 'Identity Mappings', exact: true }).click();
    const mappingsPanel = page.getByLabel('Identity Mappings', { exact: true });
    await expect(mappingsPanel.getByText('Managed by config', { exact: true })).toBeVisible();
    await mappingsPanel.getByRole('button', { name: 'Mapping actions' }).click();
    await expect(page.getByRole('menuitem', { name: 'Edit' })).toBeDisabled();
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeDisabled();
  });

  test('keeps config-warning provider mutations available while showing the ownership warning @identity-accessibility', async ({ page }) => {
    const stack = new MockBrowserIdentityStack();
    await stack.install(page, process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173');
    await page.route('**/api/identity/providers', (route) => fulfillJson(route, [{
      ...stack.provider,
      ownershipMode: 'config_warn',
      sourceRef: 'config_bundle:e2e.identity.warning',
    }]));
    await page.goto('/admin/settings');
    await page.getByRole('tab', { name: 'Identity Providers', exact: true }).click();
    const providersPanel = page.getByLabel('Identity Providers', { exact: true });
    await expect(providersPanel.getByText('Config warning', { exact: true })).toBeVisible();
    await providersPanel.getByRole('button', { name: 'Provider actions' }).click();
    await expect(page.getByRole('menuitem', { name: 'Edit' })).toBeEnabled();
    await expect(page.getByRole('menuitem', { name: 'Archive' })).toBeEnabled();
  });

  test('keeps config-warning mapping edits available while preserving configuration deletion safety @identity-accessibility', async ({ page }) => {
    const stack = new MockBrowserIdentityStack();
    await stack.install(page, process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173');
    await page.route('**/api/identity/mappings', (route) => fulfillJson(route, [{
      ...stack.mapping,
      sourceRef: 'config_bundle:e2e.identity.warning',
      ownershipMode: 'config_warn',
    }]));
    await page.goto('/admin/settings');
    await page.getByRole('tab', { name: 'Identity Mappings', exact: true }).click();
    const mappingsPanel = page.getByLabel('Identity Mappings', { exact: true });
    await expect(mappingsPanel.getByText('Config warning', { exact: true })).toBeVisible();
    await mappingsPanel.getByRole('button', { name: 'Mapping actions' }).click();
    await expect(page.getByRole('menuitem', { name: 'Edit' })).toBeEnabled();
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeDisabled();
  });

  test('keeps the OIDC configuration visible above the provider modal footer @identity-accessibility', async ({ page }) => {
    await openIdentitySettings(page, 'Identity Providers');
    await page.getByRole('button', { name: 'Add provider', exact: true }).click();

    const issuer = page.getByLabel('Issuer URL', { exact: true });
    const scopes = page.getByLabel('Scopes', { exact: true });
    await expect(issuer).toBeVisible();
    await expect(scopes).toBeVisible();

    const layout = await scopes.evaluate((element) => {
      const dialog = element.closest('[role="dialog"]');
      const footer = dialog?.querySelector('.cds--modal-footer');
      if (!footer) return null;
      const input = element.getBoundingClientRect();
      const footerBox = footer.getBoundingClientRect();
      return { visibleAboveFooter: input.bottom <= footerBox.top, inputBottom: input.bottom, footerTop: footerBox.top };
    });
    expect(layout).toMatchObject({ visibleAboveFooter: true });
  });
});

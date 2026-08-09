import { expect, test, type Page, type Route } from '@playwright/test';
import { MockBrowserIdentityStack } from './utils/mockIdentityStack';
import { captureManualScreenshot } from './utils/manualScreenshots';

const fulfillJson = (route: Route, body: unknown, status = 200) => route.fulfill({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

async function activateSettingsTab(page: Page, tabName: 'Identity Providers' | 'Identity Mappings'): Promise<void> {
  const tab = page.getByRole('tab', { name: tabName, exact: true });
  await tab.focus();
  await page.keyboard.press('Enter');
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

async function openIdentitySettings(page: Page, tabName: 'Identity Providers' | 'Identity Mappings'): Promise<MockBrowserIdentityStack> {
  const stack = new MockBrowserIdentityStack();
  await stack.install(page, process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173');
  await page.goto('/admin/settings');
  await activateSettingsTab(page, tabName);
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
    await expect(providerError.locator('xpath=ancestor-or-self::*[@role="alert" or @role="alertdialog" or @aria-live="assertive"][1]')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();

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
    await captureManualScreenshot(page, '60-identity-administration-200-percent-zoom.jpg', { stabilize: false });

    await page.getByRole('tab', { name: 'Identity Mappings', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Identity Mappings', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add mapping', exact: true })).toBeVisible();
  });

  test('keeps identity administration keyboard-usable without page-level horizontal scrolling at narrow width @identity-accessibility', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openIdentitySettings(page, 'Identity Providers');
    await expect(page.getByLabel('Identity Providers', { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() =>
      document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    )).toBe(true);

    const mappingsTab = page.getByRole('tab', { name: 'Identity Mappings', exact: true });
    await mappingsTab.focus();
    await page.keyboard.press('Enter');
    await expect(mappingsTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('button', { name: 'Add mapping', exact: true })).toBeVisible();
    await expect.poll(() => mappingsTab.evaluate((tab) => {
      const tabList = tab.closest('[role="tablist"]');
      if (!tabList) return false;
      const tabBounds = tab.getBoundingClientRect();
      const listBounds = tabList.getBoundingClientRect();
      return tabBounds.left >= listBounds.left && tabBounds.right <= listBounds.right;
    })).toBe(true);
    await expect.poll(() => page.evaluate(() =>
      document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    )).toBe(true);
    await captureManualScreenshot(page, '73-identity-administration-narrow.jpg', { stabilize: false });
  });

  test('renders config-lock badges and blocks provider/mapping mutations after a configuration refresh @identity-accessibility', async ({ page }) => {
    const stack = await openIdentitySettings(page, 'Identity Providers');
    const providersPanel = page.getByLabel('Identity Providers', { exact: true });
    await expect(providersPanel.getByText('Managed by configuration', { exact: true })).toBeVisible();
    await providersPanel.getByRole('button', { name: 'Provider actions' }).click();
    await captureManualScreenshot(page, '42-provider-config-lock.jpg');
    await expect(page.getByRole('menuitem', { name: 'View configuration' })).toBeEnabled();
    await expect(page.getByRole('menuitem', { name: 'Disable provider' })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'View configuration' }).click();
    await expect(page.getByRole('heading', { name: 'View identity provider configuration' })).toBeVisible();
    await expect(page.getByLabel('Sign-in name')).toBeDisabled();
    await captureManualScreenshot(page, '42a-provider-config-view-only.jpg');
    await page.getByRole('button', { name: 'Close' }).click();

    await page.route('**/api/identity/mappings', (route) => fulfillJson(route, [{
      ...stack.mapping,
      sourceRef: 'config_bundle:e2e.identity.lifecycle',
    }]));
    await page.reload();
    await activateSettingsTab(page, 'Identity Mappings');
    const mappingsPanel = page.getByLabel('Identity Mappings', { exact: true });
    await expect(mappingsPanel.getByText('Managed by configuration', { exact: true })).toBeVisible();
    await mappingsPanel.getByRole('button', { name: 'Mapping actions' }).click();
    await captureManualScreenshot(page, '43-mapping-config-lock.jpg');
    await expect(page.getByRole('menuitem', { name: 'View configuration' })).toBeEnabled();
    await expect(page.getByRole('menuitem', { name: 'Grant engine access' })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'View configuration' }).click();
    await expect(page.getByRole('heading', { name: 'View identity mapping configuration' })).toBeVisible();
    await expect(page.getByLabel('External identity data type')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Preview with sample claims' })).toBeEnabled();
    await captureManualScreenshot(page, '43a-mapping-config-view-only.jpg');
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
    await activateSettingsTab(page, 'Identity Providers');
    const providersPanel = page.getByLabel('Identity Providers', { exact: true });
    await expect(providersPanel.getByText('Configuration-linked', { exact: true })).toBeVisible();
    await expect(providersPanel.getByText('Local changes are allowed, but the next configuration apply may overwrite them.', { exact: true })).toBeVisible();
    await captureManualScreenshot(page, '80-provider-configuration-linked.jpg');
    await providersPanel.getByRole('button', { name: 'Provider actions' }).click();
    await expect(page.getByRole('menuitem', { name: 'Edit' })).toBeEnabled();
    await expect(page.getByRole('menuitem', { name: 'Disable provider' })).toBeEnabled();
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
    await activateSettingsTab(page, 'Identity Mappings');
    const mappingsPanel = page.getByLabel('Identity Mappings', { exact: true });
    await expect(mappingsPanel.getByText('Configuration-linked', { exact: true })).toBeVisible();
    await expect(mappingsPanel.getByText('Local changes are allowed, but the next configuration apply may overwrite them.', { exact: true })).toBeVisible();
    await expect(mappingsPanel.getByText('Browser operators', { exact: true })).toBeVisible();
    await captureManualScreenshot(page, '81-mapping-configuration-linked.jpg');
    await mappingsPanel.getByRole('button', { name: 'Mapping actions' }).click();
    await expect(page.getByRole('menuitem', { name: 'Grant engine access' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Edit' })).toBeEnabled();
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeDisabled();
  });

  test('shows authoritative and add-only membership behavior together @identity-accessibility', async ({ page }) => {
    const stack = new MockBrowserIdentityStack();
    await stack.install(page, process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173');
    await page.route('**/api/identity/mappings', (route) => fulfillJson(route, [
      { ...stack.mapping, id: 'mapping-authoritative', externalId: 'operators', syncMode: 'authoritative' },
      { ...stack.mapping, id: 'mapping-additive', externalId: 'contractors', syncMode: 'additive' },
    ]));
    await page.goto('/admin/settings');
    await activateSettingsTab(page, 'Identity Mappings');
    const mappingsPanel = page.getByLabel('Identity Mappings', { exact: true });
    await expect(mappingsPanel.getByText('Keep in sync', { exact: true })).toBeVisible();
    await expect(mappingsPanel.getByText('Add and remove members', { exact: true })).toBeVisible();
    await expect(mappingsPanel.getByText('Add only', { exact: true })).toBeVisible();
    await expect(mappingsPanel.getByText('Never remove automatically', { exact: true })).toBeVisible();
    await captureManualScreenshot(page, '84-mapping-membership-update-modes.jpg');
  });

  test('shows partial saved-membership application with an explicit continuation @identity-accessibility', async ({ page }) => {
    await openIdentitySettings(page, 'Identity Providers');
    await page.route('**/api/identity/providers/identity.oidc.browser-mock/replay-memberships', (route) => fulfillJson(route, {
      runId: 'browser-partial-replay',
      scanned: 500,
      created: 12,
      removed: 3,
      failed: 1,
      truncated: true,
      nextCursor: 'next-page',
    }));
    const providersPanel = page.getByLabel('Identity Providers', { exact: true });
    await providersPanel.getByRole('button', { name: 'Provider actions' }).click();
    await page.getByRole('menuitem', { name: 'Apply saved membership data' }).click();
    await page.getByRole('dialog', { name: 'Apply saved membership data?' })
      .getByRole('button', { name: /Apply changes/ })
      .click();
    await expect(providersPanel.getByText('Part of the saved membership data was applied', { exact: true })).toBeVisible();
    await expect(providersPanel.getByText(/1 record failed, and more records remain/)).toBeVisible();
    await expect(providersPanel.getByText(/Review the refresh history for the failed record, then apply the remaining data/)).toBeVisible();
    await expect(providersPanel.getByRole('button', { name: 'View refresh history' })).toBeVisible();
    await providersPanel.getByRole('button', { name: 'Provider actions' }).click();
    await expect(page.getByRole('menuitem', { name: 'Continue applying saved data' })).toBeVisible();
    await captureManualScreenshot(page, '85-saved-membership-application-partial.jpg');
  });

  test('shows a safe provider-connection failure without nested backend diagnostics @identity-accessibility', async ({ page }) => {
    await openIdentitySettings(page, 'Identity Providers');
    await page.route('**/api/identity/providers/identity.oidc.browser-mock/test-connection', (route) => fulfillJson(route, {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Provider connection could not be verified',
        stack: 'IdentityProviderFailure: client_secret=should-never-be-rendered',
      },
    }, 502));

    const providersPanel = page.getByLabel('Identity Providers', { exact: true });
    await providersPanel.getByRole('button', { name: 'Provider actions' }).click();
    await page.getByRole('menuitem', { name: 'Test connection' }).click();
    await expect(providersPanel.getByText('Provider connection could not be verified', { exact: false })).toBeVisible();
    await expect(providersPanel.getByText('Review the relevant settings, then try again.', { exact: false })).toBeVisible();
    await expect(providersPanel.getByText('client_secret=should-never-be-rendered', { exact: false })).toHaveCount(0);
    await expect(providersPanel.getByText('IdentityProviderFailure:', { exact: false })).toHaveCount(0);
    await captureManualScreenshot(page, '44-provider-connection-failure-redacted.jpg');
  });

  test('keeps the OIDC configuration visible above the provider modal footer @identity-accessibility', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const stack = await openIdentitySettings(page, 'Identity Providers');
    Object.assign(stack.provider, {
      ownershipMode: 'manual',
      sourceRef: null,
    });
    await page.reload();
    await activateSettingsTab(page, 'Identity Providers');
    await captureManualScreenshot(page, '18-identity-providers-list.jpg');
    const providersPanel = page.getByLabel('Identity Providers', { exact: true });
    await providersPanel.getByRole('button', { name: 'Provider actions' }).click();
    await captureManualScreenshot(page, '33-identity-provider-enabled-oidc.jpg');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Add provider', exact: true }).click();
    const providerDialog = page.getByRole('dialog', { name: 'Add identity provider' });
    await expect(providerDialog.getByText('Complete the highlighted fields')).toHaveCount(0);
    await expect(providerDialog.getByLabel('Sign-in name')).toBeFocused();
    await captureManualScreenshot(page, '19-identity-provider-editor-oidc.jpg');

    const issuer = page.getByLabel('Issuer URL', { exact: true });
    const scopes = page.getByLabel('Scopes', { exact: true });
    await expect(issuer).toBeVisible();
    await expect(scopes).toBeVisible();
    await providerDialog.getByRole('button', { name: 'Create provider', exact: true }).click();
    await expect(providerDialog.getByText('Complete the highlighted fields')).toBeVisible();
    await expect(providerDialog.getByLabel('Sign-in name')).toBeFocused();
    await scopes.scrollIntoViewIfNeeded();
    await captureManualScreenshot(page, '45-provider-validation-oidc.jpg');

    const layout = await scopes.evaluate((element) => {
      const dialog = element.closest('[role="dialog"]');
      const footer = dialog?.querySelector('.cds--modal-footer');
      if (!footer) return null;
      const input = element.getBoundingClientRect();
      const footerBox = footer.getBoundingClientRect();
      return { visibleAboveFooter: input.bottom <= footerBox.top, inputBottom: input.bottom, footerTop: footerBox.top };
    });
    expect(layout).toMatchObject({ visibleAboveFooter: true });

    await providerDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Add provider', exact: true }).click();
    await page.getByLabel('Protocol', { exact: true }).selectOption('saml');
    const entityId = page.getByLabel('EnterpriseGlue service provider entity ID', { exact: true });
    await expect(entityId).toBeVisible();
    await entityId.scrollIntoViewIfNeeded();
    await captureManualScreenshot(page, '20-identity-provider-editor-saml.jpg');
    await providerDialog.getByRole('button', { name: 'Create provider', exact: true }).click();
    await expect(providerDialog.getByText('Complete the highlighted fields')).toBeVisible();
    await entityId.scrollIntoViewIfNeeded();
    await captureManualScreenshot(page, '46-provider-validation-saml.jpg');

    await providerDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Add provider', exact: true }).click();
    await page.getByLabel('Protocol', { exact: true }).selectOption('ldap');
    const ldapUrl = page.getByLabel('LDAPS URL', { exact: true });
    await expect(ldapUrl).toBeVisible();
    await ldapUrl.scrollIntoViewIfNeeded();
    await captureManualScreenshot(page, '21-identity-provider-editor-ldap.jpg');
    await providerDialog.getByRole('button', { name: 'Create provider', exact: true }).click();
    await expect(providerDialog.getByText('Complete the highlighted fields')).toBeVisible();
    await ldapUrl.scrollIntoViewIfNeeded();
    await captureManualScreenshot(page, '47-provider-validation-ldap.jpg');
  });
});

import { expect, test, type Page, type Route } from '@playwright/test';
import { MockBrowserIdentityStack } from './utils/mockIdentityStack';
import { captureManualScreenshot } from './utils/manualScreenshots';

const fulfillJson = (route: Route, body: unknown, status = 200) => route.fulfill({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

const settingsSection = {
  'Identity Providers': { path: 'identity-providers', label: 'Identity providers' },
  'Identity Mappings': { path: 'identity-mappings', label: 'Identity mappings' },
} as const;

async function activateSettingsSection(page: Page, sectionName: keyof typeof settingsSection): Promise<void> {
  const link = page.getByRole('link', { name: settingsSection[sectionName].label, exact: true });
  await link.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/admin/settings/${settingsSection[sectionName].path}$`));
  await expect(link).toHaveAttribute('aria-current', 'page');
}

async function discardProviderWorkflow(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Leave without saving?' });
  await expect(dialog.getByRole('button', { name: 'Keep editing' })).toBeFocused();
  await dialog.locator('button.cds--btn--danger', { hasText: 'Leave' }).click();
}

async function openIdentitySettings(page: Page, sectionName: keyof typeof settingsSection): Promise<MockBrowserIdentityStack> {
  const stack = new MockBrowserIdentityStack();
  await stack.install(page, process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173');
  await page.goto(`/admin/settings/${settingsSection[sectionName].path}`);
  return stack;
}

test.describe('Identity Provider and Mapping accessibility release checks', () => {
  test('supports keyboard-only settings navigation and announces provider and mapping loading errors @identity-accessibility', async ({ page }) => {
    const stack = new MockBrowserIdentityStack();
    await stack.install(page, process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173');
    await page.route('**/api/identity/providers', (route) => fulfillJson(route, { error: 'Identity provider service unavailable' }, 503));
    await page.route('**/api/identity/mappings', (route) => fulfillJson(route, { error: 'Identity mapping service unavailable' }, 503));

    await page.goto('/admin/settings/identity-providers');
    const providerError = page.getByText('Identity providers could not be loaded', { exact: true });
    await expect(providerError).toBeVisible();
    await expect(providerError.locator('xpath=ancestor-or-self::*[@role="alert" or @role="alertdialog" or @aria-live="assertive"][1]')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();

    await activateSettingsSection(page, 'Identity Mappings');
    const mappingError = page.getByText('Identity mappings could not be loaded', { exact: true });
    await expect(mappingError).toBeVisible();
    await expect(mappingError.locator('xpath=ancestor-or-self::*[@role="alert" or @aria-live="assertive"][1]')).toHaveCount(1);
  });

  test('keeps identity administration usable at 200 percent zoom and reduced motion @identity-accessibility', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await openIdentitySettings(page, 'Identity Providers');
    await expect(page.getByLabel('Identity providers', { exact: true })).toBeVisible();
    await page.evaluate(() => { document.documentElement.style.zoom = '2'; });

    await expect.poll(() => page.evaluate(() =>
      document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    )).toBe(true);
    await expect(page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)).resolves.toBe(true);
    await captureManualScreenshot(page, '60-identity-administration-200-percent-zoom.jpg', { stabilize: false });

    await activateSettingsSection(page, 'Identity Mappings');
    await expect(page.getByLabel('Identity mappings', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create mapping', exact: true })).toBeVisible();
  });

  test('keeps identity administration keyboard-usable without page-level horizontal scrolling at narrow width @identity-accessibility', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openIdentitySettings(page, 'Identity Providers');
    await expect(page.getByLabel('Identity providers', { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() =>
      document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    )).toBe(true);

    const sectionSelector = page.getByRole('combobox', { name: 'Settings section' });
    await sectionSelector.click();
    await page.getByRole('option', { name: 'Identity mappings', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/settings\/identity-mappings$/);
    await expect(page.getByRole('button', { name: 'Create mapping', exact: true })).toBeVisible();
    await expect(sectionSelector).toBeVisible();
    await expect.poll(() => page.evaluate(() =>
      document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    )).toBe(true);
    await captureManualScreenshot(page, '73-identity-administration-narrow.jpg', { stabilize: false });
  });

  test('renders config-lock badges and blocks provider/mapping mutations after a configuration refresh @identity-accessibility', async ({ page }) => {
    const stack = await openIdentitySettings(page, 'Identity Providers');
    const providersPanel = page.getByLabel('Identity providers', { exact: true });
    await expect(providersPanel.getByText('Managed by configuration', { exact: true })).toBeVisible();
    await providersPanel.getByRole('button', { name: 'Provider actions' }).click();
    await captureManualScreenshot(page, '42-provider-config-lock.jpg');
    await expect(page.getByRole('menuitem', { name: 'View configuration' })).toBeEnabled();
    await expect(page.getByRole('menuitem', { name: 'Disable provider' })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'View configuration' }).click();
    await expect(page.getByRole('heading', { name: 'View identity provider configuration' })).toBeVisible();
    const providerDetails = page.getByRole('region', { name: 'Identity provider configuration details' });
    await expect(providerDetails.getByText('Sign-in name', { exact: true })).toBeVisible();
    await expect(providerDetails.getByRole('textbox')).toHaveCount(0);
    await expect(providerDetails.getByRole('button', { name: 'Continue' })).toHaveCount(0);
    await captureManualScreenshot(page, '42a-provider-config-view-only.jpg');
    await page.getByRole('button', { name: 'Close' }).click();

    await page.route('**/api/identity/mappings', (route) => fulfillJson(route, [{
      ...stack.mapping,
      sourceRef: 'config_bundle:e2e.identity.lifecycle',
    }]));
    await page.reload();
    await page.goto('/admin/settings/identity-mappings');
    const mappingsPanel = page.getByLabel('Identity mappings', { exact: true });
    await expect(mappingsPanel.getByText('Managed by configuration', { exact: true })).toBeVisible();
    await mappingsPanel.getByRole('button', { name: 'Mapping actions' }).click();
    await captureManualScreenshot(page, '43-mapping-config-lock.jpg');
    await expect(page.getByRole('menuitem', { name: 'View configuration' })).toBeEnabled();
    await expect(page.getByRole('menuitem', { name: 'Grant engine access' })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'View configuration' }).click();
    await expect(page.getByRole('heading', { name: 'View identity mapping configuration' })).toBeVisible();
    const mappingDetails = page.getByRole('region', { name: 'Identity mapping configuration details' });
    await expect(mappingDetails.getByText('External identity data type', { exact: true })).toBeVisible();
    await expect(mappingDetails.getByRole('combobox')).toHaveCount(0);
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
    await page.goto('/admin/settings/identity-providers');
    const providersPanel = page.getByLabel('Identity providers', { exact: true });
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
    await page.goto('/admin/settings/identity-mappings');
    const mappingsPanel = page.getByLabel('Identity mappings', { exact: true });
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
    await page.goto('/admin/settings/identity-mappings');
    const mappingsPanel = page.getByLabel('Identity mappings', { exact: true });
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
    const providersPanel = page.getByLabel('Identity providers', { exact: true });
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

    const providersPanel = page.getByLabel('Identity providers', { exact: true });
    await providersPanel.getByRole('button', { name: 'Provider actions' }).click();
    await page.getByRole('menuitem', { name: 'Test connection' }).click();
    await expect(providersPanel.getByText('Provider connection could not be verified', { exact: false })).toBeVisible();
    await expect(providersPanel.getByText('Review the relevant settings, then try again.', { exact: false })).toBeVisible();
    await expect(providersPanel.getByText('client_secret=should-never-be-rendered', { exact: false })).toHaveCount(0);
    await expect(providersPanel.getByText('IdentityProviderFailure:', { exact: false })).toHaveCount(0);
    await captureManualScreenshot(page, '44-provider-connection-failure-redacted.jpg');
  });

  test('keeps each provider step visible above the in-page workflow actions @identity-accessibility', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const stack = await openIdentitySettings(page, 'Identity Providers');
    Object.assign(stack.provider, {
      ownershipMode: 'manual',
      sourceRef: null,
    });
    await page.reload();
    await captureManualScreenshot(page, '18-identity-providers-list.jpg');
    const providersPanel = page.getByLabel('Identity providers', { exact: true });
    await providersPanel.getByRole('button', { name: 'Provider actions' }).click();
    await captureManualScreenshot(page, '33-identity-provider-enabled-oidc.jpg');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Create provider', exact: true }).click();
    const providerWorkflow = page.getByRole('region', { name: 'Create identity provider' });
    await expect(providerWorkflow.getByText('Complete the highlighted fields')).toHaveCount(0);
    await expect(providerWorkflow.getByRole('heading', { name: 'Identity', exact: true })).toBeFocused();
    const identityContinue = providerWorkflow.getByRole('button', { name: 'Continue', exact: true });
    await expect(identityContinue).toBeDisabled();
    await captureManualScreenshot(page, '19-identity-provider-editor-oidc.jpg');

    await providerWorkflow.getByLabel('Sign-in name').focus();
    await providerWorkflow.getByLabel('Sign-in name').blur();
    await expect(providerWorkflow.getByText('Enter the provider name users will recognize on the sign-in screen.')).toBeVisible();
    await expect(identityContinue).toBeDisabled();
    await captureManualScreenshot(page, '45-provider-validation-identity.jpg');

    await providerWorkflow.getByLabel('Sign-in name').fill('OIDC evidence');
    await providerWorkflow.getByLabel('Provider key').fill('oidc-evidence');
    await providerWorkflow.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(providerWorkflow.getByRole('heading', { name: 'Connection', exact: true })).toBeFocused();
    const issuer = page.getByLabel('Issuer URL', { exact: true });
    const scopes = page.getByLabel('Scopes', { exact: true });
    await expect(issuer).toBeVisible();
    await expect(scopes).toBeVisible();
    await captureManualScreenshot(page, '19a-identity-provider-connection-oidc.jpg');
    await expect(providerWorkflow.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
    await issuer.focus();
    await issuer.blur();
    await expect(providerWorkflow.getByText(/Enter an HTTPS issuer URL/)).toBeVisible();
    await scopes.scrollIntoViewIfNeeded();
    await captureManualScreenshot(page, '45-provider-validation-oidc.jpg');

    const layout = await scopes.evaluate((element) => {
      const workflow = element.closest('.eg-settings-workflow');
      const footer = workflow?.querySelector('.eg-settings-workflow__actions');
      if (!footer) return null;
      const input = element.getBoundingClientRect();
      const footerBox = footer.getBoundingClientRect();
      return { visibleAboveFooter: input.bottom <= footerBox.top, inputBottom: input.bottom, footerTop: footerBox.top };
    });
    expect(layout).toMatchObject({ visibleAboveFooter: true });

    await discardProviderWorkflow(page);
    await page.getByRole('button', { name: 'Create provider', exact: true }).click();
    await page.getByLabel('Protocol', { exact: true }).selectOption('saml');
    await page.getByLabel('Sign-in name').fill('SAML evidence');
    await page.getByLabel('Provider key').fill('saml-evidence');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    const entityId = page.getByLabel('EnterpriseGlue service provider entity ID', { exact: true });
    await expect(entityId).toBeVisible();
    await entityId.scrollIntoViewIfNeeded();
    await captureManualScreenshot(page, '20-identity-provider-editor-saml.jpg');
    await expect(providerWorkflow.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
    await entityId.focus();
    await entityId.blur();
    await expect(providerWorkflow.getByText('Service provider entity ID is required.')).toBeVisible();
    await entityId.scrollIntoViewIfNeeded();
    await captureManualScreenshot(page, '46-provider-validation-saml.jpg');

    await discardProviderWorkflow(page);
    await page.getByRole('button', { name: 'Create provider', exact: true }).click();
    await page.getByLabel('Protocol', { exact: true }).selectOption('ldap');
    await page.getByLabel('Sign-in name').fill('LDAP evidence');
    await page.getByLabel('Provider key').fill('ldap-evidence');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    const ldapUrl = page.getByLabel('LDAPS URL', { exact: true });
    await expect(ldapUrl).toBeVisible();
    await ldapUrl.scrollIntoViewIfNeeded();
    await captureManualScreenshot(page, '21-identity-provider-editor-ldap.jpg');
    await expect(providerWorkflow.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
    await ldapUrl.focus();
    await ldapUrl.blur();
    await expect(providerWorkflow.getByText('Use an ldaps:// directory endpoint.')).toBeVisible();
    await ldapUrl.scrollIntoViewIfNeeded();
    await captureManualScreenshot(page, '47-provider-validation-ldap.jpg');
  });

  test('keeps source-aware users, lifecycle actions, and horizontal tabs reachable at narrow width @identity-accessibility', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const stack = new MockBrowserIdentityStack();
    await stack.install(page, process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173');

    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { name: 'User management' })).toBeVisible();
    await expect(page.getByLabel('Search users')).toBeVisible();
    const directoryFilters = page.getByLabel('User directory filters');
    await expect(directoryFilters.getByLabel('Status')).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    await page.getByLabel('Search users').focus();
    await expect(page.getByLabel('Search users')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(directoryFilters.getByLabel('Status')).toBeFocused();

    await page.goto('/admin/users/browser-directory-user');
    await expect(page.getByRole('heading', { name: 'Ada Lovelace' })).toBeVisible();
    await expect(page.getByText('Directory-managed identity')).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    const revoke = page.getByRole('button', { name: /Revoke sessions/ }).first();
    const deactivate = page.getByRole('button', { name: /Deactivate/ }).first();
    await expect(revoke).toBeVisible();
    await expect(deactivate).toBeVisible();
    await expect(revoke.evaluate((element) => element.getBoundingClientRect().right <= window.innerWidth)).resolves.toBe(true);
    await expect(deactivate.evaluate((element) => element.getBoundingClientRect().right <= window.innerWidth)).resolves.toBe(true);

    await page.getByRole('tab', { name: 'Overview' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Linked identities' })).toBeFocused();

    await deactivate.click();
    const dialog = page.getByRole('dialog', { name: 'Deactivate user' });
    await expect(dialog.getByLabel('Audit reason')).toBeVisible();
    await expect(dialog.getByText('Reason required')).toBeVisible();
  });

  test('keeps provisioning controls, credential disclosure, and diagnostics usable without page overflow @identity-accessibility', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const stack = new MockBrowserIdentityStack();
    await stack.install(page, process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173');

    await page.goto('/admin/settings/identity-provisioning');
    await expect(page.getByRole('heading', { name: 'Provisioning directories' })).toBeVisible();
    await expect(page.getByLabel('Provisioning directory', { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await expect(page.getByText('authoritative', { exact: true })).toBeVisible();

    await page.getByRole('tab', { name: 'Credentials' }).click();
    await page.getByRole('button', { name: 'Create credential' }).click();
    const createDialog = page.getByRole('dialog', { name: 'Create provisioning credential' });
    await expect(createDialog.getByLabel('Credential name')).toBeVisible();
    await createDialog.getByRole('button', { name: 'Create credential' }).click();

    const revealDialog = page.getByRole('dialog', { name: 'Copy the client credential now' });
    await expect(revealDialog.getByText('Reveal once')).toBeVisible();
    await expect(revealDialog.getByText('browser-new-credential')).toBeVisible();
    await expect(revealDialog.getByText(/eg_scim_.*reveal_once/)).toBeVisible();
    await expect(revealDialog.getByText(`${process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173'}/scim/v2/entra-workforce/oauth/token`)).toBeVisible();
    const storedCredentialButton = revealDialog.getByRole('button', { name: "I've stored the credential" });
    await expect(storedCredentialButton).toBeDisabled();
    await revealDialog.getByRole('button', { name: 'Close' }).click();
    await expect(revealDialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(revealDialog).toBeVisible();
    await revealDialog.getByText('I have stored the client secret in the approved secret manager', { exact: true }).click();
    await expect(storedCredentialButton).toBeEnabled();
    await storedCredentialButton.click();
    await expect(revealDialog).toBeHidden();
    await expect(page.getByText('browser-new-credential')).toHaveCount(0);
    await expect(page.getByText(/eg_scim_.*reveal_once/)).toHaveCount(0);

    await page.getByRole('tab', { name: 'Diagnostics' }).click();
    await expect(page.getByText(/Raw request bodies and credentials are never retained/)).toBeVisible();
    await expect(page.getByText('User.patch')).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});

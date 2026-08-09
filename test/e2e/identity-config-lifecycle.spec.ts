import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect, test, type Route } from '@playwright/test';
import { MockBrowserIdentityStack } from './utils/mockIdentityStack';
import { captureManualScreenshot } from './utils/manualScreenshots';

const canonicalHash = 'a'.repeat(64);

const bundle = {
  bundle: {
    apiVersion: 'enterpriseglue.ai/v1beta1', kind: 'EnterpriseGlueConfigBundle',
    metadata: { key: 'e2e.identity.lifecycle', owner: 'platform' }, tenantKey: 'default', mode: 'authoritative',
    imports: ['./groups.json', './identity-providers.json', './identity-mappings.json'],
  },
  files: {
    './groups.json': { groups: [{ key: 'group.browser-operators', name: 'Browser operators' }] },
    './identity-providers.json': { identityProviders: [{
      key: 'identity.oidc.browser-mock', protocol: 'oidc', enabled: true, authenticationMode: 'direct',
      configuration: { issuerUrl: 'https://identity-browser-mock.test', clientId: 'browser-lifecycle', callbackUrl: 'https://app.example.test/api/auth/identity/callback', scopes: ['openid', 'profile', 'email'] },
    }] },
    './identity-mappings.json': { identityMappings: [{ key: 'mapping.browser-operators', providerKey: 'identity.oidc.browser-mock', source: { type: 'group', externalId: 'operators' }, targetGroupKey: 'group.browser-operators', syncMode: 'authoritative' }] },
  },
};

const fulfillJson = (route: Route, body: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });

const evidenceByTest = new Map<string, MockBrowserIdentityStack>();
const evidenceKey = (titlePath: string[]) => titlePath.join(' > ');

test.afterEach(async ({}, testInfo) => {
  const artifactPath = process.env.IDENTITY_TEST_EVIDENCE_PATH;
  const identityStack = evidenceByTest.get(evidenceKey(testInfo.titlePath));
  if (!artifactPath || !identityStack) return;

  evidenceByTest.delete(evidenceKey(testInfo.titlePath));
  await mkdir(dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify({
    schemaVersion: 1,
    source: 'browser-local-identity-stack',
    status: testInfo.status,
    failureDiagnostic: testInfo.status === 'passed' ? null : 'browser_lifecycle_failed',
    providerKey: identityStack.provider.key,
    syncRunIds: ['browser-sync-run', 'browser-replay-run'],
    lifecycleEvents: identityStack.events,
  }, null, 2)}\n`, 'utf8');
});

test.describe('Identity configuration browser lifecycle', () => {
  test('configures, applies, signs in, and reconciles against the browser-local identity stack @identity-lifecycle', async ({ page }, testInfo) => {
    const appOrigin = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173';
    const identityStack = new MockBrowserIdentityStack();
    evidenceByTest.set(evidenceKey(testInfo.titlePath), identityStack);
    await identityStack.install(page, appOrigin);

    const appliedBodies: unknown[] = [];
    await page.route('**/api/authz/config-bundles/preview', (route) => fulfillJson(route, { valid: true, canonicalHash, errors: [], counts: { groups: 1, identityProviders: 1, identityMappings: 1 } }));
    await page.route('**/api/authz/config-bundles/diff', (route) => fulfillJson(route, {
      valid: true, canonicalHash, errors: [], counts: {}, warnings: [], requiredAcknowledgements: [],
      affectedPrincipals: { affectedGroupCount: 0, affectedUserCount: 0, externalIdentityMappingChangeCount: 1 },
      changes: [
        { objectType: 'identity_provider', key: 'identity.oidc.browser-mock', operation: 'create', reason: 'Provider will be configured.' },
        { objectType: 'identity_mapping', key: 'mapping.browser-operators', operation: 'create', reason: 'Mapping will be configured.' },
      ],
    }));
    await page.route('**/api/authz/config-bundles/apply', async (route) => {
      appliedBodies.push(route.request().postDataJSON());
      return fulfillJson(route, { reconciliation: { engineSetCount: 0, runtimeResourceSetCount: 0, engineCount: 0, identitySnapshot: { mode: 'apply', status: 'completed', providerCount: 1, scanned: 0, created: 0, removed: 0, failed: 0 } } });
    });
    await page.route('**/api/authz/config-bundles/runs?limit=10', (route) => fulfillJson(route, []));

    await page.goto('/admin/settings');
    await page.getByRole('tab', { name: 'Configuration' }).click();
    await page.getByLabel('Configuration bundle JSON').fill(JSON.stringify(bundle, null, 2));
    await page.getByRole('button', { name: 'Preview changes' }).click();
    await expect(page.getByText('Preview valid')).toBeVisible();
    await page.getByRole('button', { name: 'Apply exact preview' }).click();
    await expect(page.getByText('Configuration applied')).toBeVisible();
    await expect(page.getByText(/No engine or identity changes were needed|Checked \d+ engine sets?/)).toBeVisible();
    const platformSettingsHeading = page.getByRole('heading', { name: 'Platform Settings' });
    await platformSettingsHeading.scrollIntoViewIfNeeded();
    await expect(platformSettingsHeading).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Configuration' })).toHaveAttribute('aria-selected', 'true');
    await captureManualScreenshot(page, '48-identity-configuration-applied.jpg');
    expect(appliedBodies).toHaveLength(1);
    expect(appliedBodies[0]).toMatchObject({ expectedPreviewHash: canonicalHash, identityReconciliationMode: 'apply' });

    identityStack.beginExternalLogin();
    await page.evaluate(() => localStorage.clear());
    await page.goto('/login');
    await page.getByRole('button', { name: /^Continue with Browser identity provider/ }).click();
    await expect(page).toHaveURL(new RegExp(`${appOrigin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/?$`));
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
    expect(identityStack.events).toEqual(expect.arrayContaining(['provider_listed', 'authorization_started', 'token_issued', 'session_created']));

    await page.goto('/admin/settings');
    await page.getByRole('tab', { name: 'Identity Providers' }).click();
    const providersPanel = page.getByLabel('Identity Providers', { exact: true });
    await expect(providersPanel.getByText('identity.oidc.browser-mock', { exact: true })).toBeVisible();
    await providersPanel.getByRole('button', { name: 'Provider actions' }).click();
    await page.getByRole('menuitem', { name: 'Test connection' }).click();
    await expect(providersPanel.getByText('Provider metadata reachable: Browser identity provider')).toBeVisible();
    await captureManualScreenshot(page, '49-provider-connection-success.jpg');
    await providersPanel.getByRole('button', { name: 'Provider actions' }).click();
    await page.getByRole('menuitem', { name: 'Preview memberships' }).click();
    await expect(providersPanel.getByText(/Checked 3 saved identity records. 1 membership would be added and 1 membership removed. No access was changed, and the provider was not contacted./)).toBeVisible();
    await expect(providersPanel.getByText('Provider metadata reachable: Browser identity provider')).toHaveCount(0);
    await captureManualScreenshot(page, '50-provider-membership-preview.jpg');
    await providersPanel.getByRole('button', { name: 'Provider actions' }).click();
    await page.getByRole('menuitem', { name: 'View refresh history' }).click();
    const synchronizationHistoryHeading = providersPanel.getByText(
      'Refresh history: Browser identity provider',
    );
    await expect(synchronizationHistoryHeading).toBeVisible();
    await expect(providersPanel.getByText('1 membership added, 1 membership removed')).toBeVisible();
    await synchronizationHistoryHeading.evaluate((element) => {
      element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
    });
    await captureManualScreenshot(page, '51-provider-sync-history.jpg', { stabilize: false });
    await providersPanel.getByRole('button', { name: 'Provider actions' }).click();
    await page.getByRole('menuitem', { name: 'Apply saved membership data' }).click();
    const applySavedDataDialog = page.getByRole('dialog', { name: 'Apply saved membership data?' });
    await expect(applySavedDataDialog).toContainText('It will not contact the provider');
    await expect(applySavedDataDialog).toContainText('access changes take effect immediately');
    await captureManualScreenshot(page, '77-apply-saved-membership-data-confirmation.jpg');
    await applySavedDataDialog.getByRole('button', { name: /Apply changes/ }).click();
    await expect(providersPanel.getByText('Saved membership data applied: Browser identity provider')).toBeVisible();
    await expect(providersPanel.getByText(/Browser identity provider: Checked 1 saved identity record. Added 1 membership and removed 0 memberships. Access changes took effect immediately./)).toBeVisible();
    await expect(providersPanel.getByText(/Checked 3 saved identity records/)).toHaveCount(0);
    await captureManualScreenshot(page, '52-provider-membership-replay.jpg');

    identityStack.failNextConnectionTest();
    await providersPanel.getByRole('button', { name: 'Provider actions' }).click();
    await page.getByRole('menuitem', { name: 'Test connection' }).click();
    await expect(providersPanel.getByText('Provider connection could not be verified')).toBeVisible();
    await expect(providersPanel.getByText('Saved membership data applied: Browser identity provider')).toHaveCount(0);
    await expect(providersPanel.getByText(/browser-stack-secret/)).toHaveCount(0);

    await page.getByRole('tab', { name: 'Identity Mappings' }).click();
    const mappingsPanel = page.getByLabel('Identity Mappings', { exact: true });
    await expect(mappingsPanel.getByText('group.browser-operators', { exact: true })).toBeVisible();
    await mappingsPanel.getByRole('button', { name: 'Mapping actions' }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await page.getByRole('button', { name: 'Preview with sample claims' }).click();
    const mappingPreview = page.getByText('The sample matches this mapping through the “operators” external group. One matching external value was found. No identity or access was changed.');
    await expect(mappingPreview).toBeVisible();
    const mappingPreviewNotification = mappingPreview.locator(
      'xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " cds--inline-notification ")][1]',
    );
    await expect(mappingPreviewNotification).toBeVisible();
    await expect.poll(async () => (await mappingPreviewNotification.boundingBox())?.height || 0)
      .toBeGreaterThan(40);
    await expect.poll(() => mappingPreviewNotification.evaluate((element) => {
      const modalContent = element.closest('.cds--modal-content');
      if (!modalContent) return false;
      return element.getBoundingClientRect().bottom
        <= modalContent.getBoundingClientRect().bottom - 64;
    }))
      .toBe(true);
    await expect(page.getByRole('heading', { name: 'Edit identity mapping' })).toBeVisible();
    await captureManualScreenshot(page, '25-identity-mapping-preview.jpg');
    await page.getByRole('button', { name: 'Check saved identities' }).click();
    const storedIdentityPreview = page.getByText('2 saved identities would match and 1 saved identity would not. No identity or access was changed.');
    await expect(storedIdentityPreview).toBeVisible();
    await storedIdentityPreview.scrollIntoViewIfNeeded();
    await captureManualScreenshot(page, '54-mapping-test-and-stored-preview.jpg');

    const enabledMapping = page.getByRole('checkbox', { name: 'Enable mapping' });
    await enabledMapping.uncheck({ force: true });
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(mappingsPanel.getByText('Identity mapping disabled', { exact: true })).toBeVisible();
    await expect(mappingsPanel.getByText('Access from this mapping has been revoked. Memberships from manual changes and other providers are unchanged.', { exact: true })).toBeVisible();
    await captureManualScreenshot(page, '56-mapping-disabled-recovery.jpg');

    await mappingsPanel.getByRole('button', { name: 'Mapping actions' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    const deleteMappingDialog = page.getByRole('dialog', { name: 'Delete this identity mapping?' });
    await expect(deleteMappingDialog).toContainText('Memberships created only by this mapping will be removed immediately');
    await expect(deleteMappingDialog).toContainText('Manual memberships and memberships from other providers will remain');
    await captureManualScreenshot(page, '78-mapping-delete-access-impact.jpg');
    await deleteMappingDialog.getByRole('button', { name: 'Cancel' }).click();

    identityStack.makeProviderManual();
    await page.getByRole('tab', { name: 'Identity Providers' }).click();
    await page.reload();
    await page.getByRole('tab', { name: 'Identity Providers' }).click();
    const manualProvidersPanel = page.getByLabel('Identity Providers', { exact: true });
    await manualProvidersPanel.getByRole('button', { name: 'Provider actions' }).click();
    await page.getByRole('menuitem', { name: 'Disable provider' }).click();
    const disableProviderDialog = page.getByRole('dialog', { name: 'Disable Browser identity provider?' });
    await expect(disableProviderDialog).toContainText('Provider-managed group memberships will be removed immediately');
    await expect(disableProviderDialog).toContainText('Manual and API-managed access will not change');
    await captureManualScreenshot(page, '57-provider-disable-confirmation.jpg');
    await disableProviderDialog.getByRole('button', { name: /Disable provider/ }).click();
    const manualProviderRow = manualProvidersPanel.getByRole('row').filter({ hasText: identityStack.provider.key });
    await expect(manualProviderRow.getByTitle('Disabled')).toBeVisible();
    await expect(manualProviderRow.getByText('Preferred', { exact: true })).toHaveCount(0);
    await captureManualScreenshot(page, '79-provider-disabled.jpg');

    expect(identityStack.events).toEqual(expect.arrayContaining(['connection_tested', 'membership_previewed', 'membership_replayed', 'mapping_tested', 'mapping_previewed']));
  });
});

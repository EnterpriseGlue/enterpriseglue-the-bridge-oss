import { expect, test, type Route } from '@playwright/test';
import { MockBrowserIdentityStack } from './utils/mockIdentityStack';

const canonicalHash = 'a'.repeat(64);

const bundle = {
  bundle: {
    apiVersion: 'enterpriseglue.ai/v1alpha1', kind: 'EnterpriseGlueConfigBundle',
    metadata: { key: 'e2e.identity.lifecycle', owner: 'platform' }, tenantKey: 'default', mode: 'authoritative', settings: {},
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

test.describe('Identity configuration browser lifecycle', () => {
  test('configures, applies, signs in, and reconciles against the browser-local identity stack @identity-lifecycle', async ({ page }) => {
    const appOrigin = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173';
    const identityStack = new MockBrowserIdentityStack();
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
    expect(appliedBodies).toHaveLength(1);
    expect(appliedBodies[0]).toMatchObject({ expectedPreviewHash: canonicalHash, identityReconciliationMode: 'apply' });

    identityStack.beginExternalLogin();
    await page.evaluate(() => localStorage.clear());
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign in with identity.oidc.browser-mock' }).click();
    await expect(page).toHaveURL(new RegExp(`${appOrigin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/?$`));
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
    expect(identityStack.events).toEqual(expect.arrayContaining(['provider_listed', 'authorization_started', 'token_issued', 'session_created']));

    await page.goto('/admin/settings');
    await page.getByRole('tab', { name: 'Identity Providers' }).click();
    await expect(page.getByText('identity.oidc.browser-mock', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Provider actions' }).click();
    await page.getByRole('menuitem', { name: 'Replay stored memberships' }).click();
    await expect(page.getByText('Stored membership replay: identity.oidc.browser-mock')).toBeVisible();
    expect(identityStack.events).toContain('membership_replayed');
  });
});

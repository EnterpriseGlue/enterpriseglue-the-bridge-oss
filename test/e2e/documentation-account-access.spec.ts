import { test, expect } from '@playwright/test';

test('documentation sign-in is an account-only journey on desktop and mobile @documentation-account', async ({ page }, testInfo) => {
  const writes: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/api/**', async (route) => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (!path.startsWith('/api/')) return route.continue();
    if (request.method() === 'POST') writes.push(path);
    const body = path === '/api/tenancy/capabilities' ? { mode: 'pooled', rootTenantAliasesEnabled: false, tenantScopedLoginRequired: true, databaseIsolation: 'postgres-rls', customDomainsEnabled: true, organizationDiscoveryEnabled: true, signedPlacementAssertionsEnabled: true }
      : path === '/api/plugins/v1/frontend' ? { apiVersion: 'frontend-bootstrap.plugin.enterpriseglue.io/v1', revision: 1, issues: [], plugins: [] }
      : path === '/api/auth/cloud-signup/providers' ? [{ id: 'google', displayName: 'Google', protocol: 'oidc' }]
      : {};
    await route.fulfill({ status: ['/api/auth/me', '/api/auth/refresh'].includes(path) ? 401 : 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/documentation/access?state=${'s'.repeat(43)}&challenge=${'c'.repeat(43)}`);
  await expect(page.getByRole('heading', { name: 'Documentation access' }), errors.join('\n')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.getByText(/No Cloud organization or workspace is required/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create an organization' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Create free account' }).focus();
  await expect(page.getByRole('link', { name: 'Create free account' })).toBeFocused();
  // Capture canonical visual evidence once; exercise the journey in every browser.
  if (testInfo.project.name === 'chromium') await page.screenshot({ path: testInfo.outputPath('documentation-account-desktop-1440x900.png') });
  await page.getByRole('link', { name: 'Create free account' }).click();
  await expect(page).toHaveURL(/\/signup\?intent=documentation$/);
  await expect(page.getByRole('heading', { name: 'Create your EnterpriseGlue account' })).toBeVisible();
  await page.getByRole('link', { name: 'Continue with email' }).click();
  await expect(page).toHaveURL(/\/signup\/email\?intent=documentation$/);
  expect(writes.some((path) => path.startsWith('/api/platform/cloud'))).toBe(false);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('textbox', { name: 'Email address' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (testInfo.project.name === 'chromium') await page.screenshot({ path: testInfo.outputPath('documentation-account-mobile.png') });
});

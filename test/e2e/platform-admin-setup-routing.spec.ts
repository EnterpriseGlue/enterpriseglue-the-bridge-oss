import { expect, test } from '@playwright/test';
import { MockBrowserIdentityStack } from './utils/mockIdentityStack';

test.describe('single-tenant platform setup routing @access-control-layout', () => {
  for (const [path, destination] of [
    ['/admin/tenants', '/admin/settings'],
    ['/t/default/admin/tenants', '/t/default/admin/settings'],
    ['/admin/access-control', '/admin/settings'],
  ]) {
    test(`opens settings from ${path} when setup is incomplete`, async ({ page }) => {
      const origin = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173';
      await new MockBrowserIdentityStack().install(page, origin);
      await page.route('**/api/admin/setup-status', route => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ isConfigured: false, checks: { hasDefaultTenant: true, hasAdminUser: true, hasEmailConfig: false }, requiredActions: ['Configure email'] }),
      }));
      await page.goto(path);
      await expect(page).toHaveURL(`${origin}${destination}`);
      await expect(page.getByRole('heading', { name: 'Platform settings', exact: true })).toBeVisible();
      await expect(page.getByText('Unexpected Application Error!')).toHaveCount(0);
    });
  }

  test('leaves settings after setup is completed without retaining the earlier redirect', async ({ page }) => {
    const origin = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173';
    await new MockBrowserIdentityStack().install(page, origin);
    let configured = false;
    await page.route('**/api/admin/setup-status', route => route.fulfill({
      contentType: 'application/json', body: JSON.stringify({ isConfigured: configured }),
    }));
    await page.goto('/admin/access-control');
    await expect(page.getByRole('heading', { name: 'Platform settings', exact: true })).toBeVisible();
    configured = true;
    await page.getByRole('link', { name: 'Admin', exact: true }).click();
    await page.getByRole('link', { name: 'User Management', exact: true }).click();
    await expect(page).toHaveURL(`${origin}/admin/users`);
    await expect(page.getByText('ada.lovelace@example.test', { exact: true })).toBeVisible();
  });
});

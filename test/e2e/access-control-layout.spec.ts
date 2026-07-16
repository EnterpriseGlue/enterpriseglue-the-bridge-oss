import { expect, test } from '@playwright/test';
import { MockBrowserIdentityStack } from './utils/mockIdentityStack';

const longPermissionLabel = 'Manage production deployment approvals across all regulated business processes';

test.describe('Access Control responsive layout', () => {
  test('keeps long permission labels within the tablet viewport @access-control-layout', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 });

    const identityStack = new MockBrowserIdentityStack();
    await identityStack.install(page, process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173');
    await page.route('**/api/authz/permissions', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([{
        key: 'engine:deployment:production-approval',
        label: longPermissionLabel,
        description: 'Allows the designated approval workflow for production deployments.',
        scope: 'engine',
        category: 'Deployment controls',
        kind: 'system',
      }]),
    }));

    await page.goto('/admin/access-control');
    await expect(page.getByRole('heading', { name: 'Access Control' })).toBeVisible();
    await page.getByRole('tab', { name: 'Permissions', exact: true }).click();
    const permissionLabel = page.locator('td:visible', { hasText: longPermissionLabel });
    await expect(permissionLabel).toBeVisible();

    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(permissionLabel.evaluate((element) => {
      const style = window.getComputedStyle(element);
      return style.overflowWrap === 'anywhere' || style.wordBreak === 'break-word';
    })).resolves.toBe(true);
  });
});

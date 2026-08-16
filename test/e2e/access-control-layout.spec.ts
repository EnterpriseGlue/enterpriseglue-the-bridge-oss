import { expect, test } from '@playwright/test';
import { MockBrowserIdentityStack } from './utils/mockIdentityStack';
import { captureManualScreenshot } from './utils/manualScreenshots';

const longPermissionLabel = 'Manage production deployment approvals across all regulated business processes';

test.describe('Access Control responsive layout', () => {
  test('keeps long permission labels within the tablet viewport @access-control-layout', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 });

    const identityStack = new MockBrowserIdentityStack();
    await identityStack.install(page, process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173');
    await page.route('**/api/authz/permissions', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([
        {
          key: 'engine:deployment:production-approval',
          label: longPermissionLabel,
          description: 'Allows the designated approval workflow for production deployments.',
          scope: 'engine',
          category: 'Deployment controls',
          kind: 'system',
        },
        {
          key: 'engine:variables:edit',
          label: 'Edit process variable values',
          description: 'Change process variable values for an assigned engine.',
          scope: 'engine',
          category: 'Mission Control variables',
          kind: 'system',
        },
      ]),
    }));

    await page.goto('/admin/access-control');
    await expect(page.getByRole('heading', { name: 'Access Control' })).toBeVisible();
    const sectionSelector = page.getByRole('combobox', { name: 'Access Control section', exact: true });
    if (await sectionSelector.isVisible()) {
      await sectionSelector.click();
      await page.getByRole('option', { name: 'Permissions', exact: true }).click();
    } else {
      await page.getByRole('link', { name: 'Permissions', exact: true }).click();
    }
    await expect(page.getByRole('heading', { name: 'Permissions', exact: true })).toBeVisible();
    const permissionLabel = page.locator('td:visible', { hasText: longPermissionLabel });
    await expect(permissionLabel).toBeVisible();

    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(permissionLabel.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= window.innerWidth;
    })).resolves.toBe(true);

    await page.getByRole('searchbox', { name: 'Filter table' }).fill('Edit process variable values');
    await expect(page.getByText('View variable names and metadata', { exact: true })).toBeVisible();
    await expect(page.getByText('View process variable values', { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await captureManualScreenshot(page, '76-permission-dependencies-narrow.jpg', { stabilize: false });
  });
});

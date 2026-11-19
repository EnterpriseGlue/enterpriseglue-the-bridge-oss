import { expect, test } from '@playwright/test';
import { MockBrowserIdentityStack } from './utils/mockIdentityStack';

const longName = 'Customer onboarding production engine for the European region';

test.describe('Engine selector layout', () => {
  test('shows full friendly engine names on unclipped rows @access-control-layout', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const identityStack = new MockBrowserIdentityStack();
    await identityStack.install(page, process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173');
    const engineIds = ['engine-0f3a9c2e-long-technical-identifier', 'engine-7b1d'];
    await page.route('**/api/authz/me/permissions', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      userId: 'browser-admin-user', tenantId: null,
      platform: ['platform:dashboard:view'],
      projects: [],
      engines: engineIds.map((resourceId) => ({ resourceId, permissions: ['engine:view', 'engine:instance:view', 'engine:definition:view'], runtimePermissions: [] })),
      generatedAt: Date.now(), authorizationVersion: 'browser-engine-selector-v1',
    }) }));
    let inventoryRequests = 0;
    await page.route(/\/engines-api\/engines(?:\?.*)?$/, (route) => {
      inventoryRequests += 1;
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify([
        { id: 'engine-0f3a9c2e-long-technical-identifier', name: longName, baseUrl: 'https://engine-eu.example.test/engine-rest' },
        { id: 'engine-7b1d', name: null, baseUrl: 'https://orders.example.test:8443/engine-rest' },
      ]) });
    });

    await page.goto('/mission-control/processes');
    const selector = page.getByRole('combobox', { name: 'Engine', exact: true });
    await expect(selector).toBeVisible();
    await selector.click();
    const options = page.getByRole('option');
    await expect(options).toHaveCount(2);
    await expect(page.getByRole('option', { name: longName, exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: 'orders.example.test:8443', exact: true })).toBeVisible();
    // No raw engine ID is shown anywhere in the open menu.
    await expect(page.getByRole('listbox')).not.toContainText('engine-0f3a9c2e');
    // Every option is fully visible: not clipped vertically or horizontally.
    for (const option of await options.all()) {
      const fits = await option.evaluate((element) => {
        const label = element.querySelector('.cds--list-box__menu-item__option') ?? element;
        return label.scrollHeight <= label.clientHeight + 1 && label.scrollWidth <= label.clientWidth + 1;
      });
      expect(fits).toBe(true);
    }
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(inventoryRequests).toBeGreaterThan(0);
  });
});

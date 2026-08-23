import { expect, test, type Route } from '@playwright/test';
import { MockBrowserIdentityStack } from './utils/mockIdentityStack';
import { captureManualScreenshot } from './utils/manualScreenshots';

const now = '2026-08-19T00:00:00.000Z';

function json(route: Route, body: unknown) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

test.describe('Plugin platform settings layout', () => {
  test('keeps safe plugin administration inside Operations settings @plugin-platform-layout', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    const identityStack = new MockBrowserIdentityStack();
    await identityStack.install(page, process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173');
    await page.route('**/api/plugin-platform/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/plugins')) {
        return json(route, {
          apiVersion: 'control.plugin.enterpriseglue.io/v1',
          revision: 3,
          plugins: [{
            pluginId: 'io.enterpriseglue.ion-support',
            version: '0.1.0',
            displayName: 'ION Support Agent',
            state: 'enabled',
            enabled: true,
            healthy: true,
            compatible: true,
            entitled: 'active',
            reasonCode: 'none',
            revision: 3,
          }],
        });
      }
      if (path.endsWith('/emergency-control')) {
        return json(route, {
          apiVersion: 'emergency-control.plugin.enterpriseglue.io/v1',
          disabled: false,
          revision: 3,
          reasonCode: 'none',
          updatedAt: now,
        });
      }
      if (path.endsWith('/audit')) {
        return json(route, {
          apiVersion: 'audit.plugin.enterpriseglue.io/v1',
          events: [],
        });
      }
      if (path.endsWith('/deployment-execution')) {
        return json(route, {
          apiVersion: 'deployment-execution-observation.plugin.enterpriseglue.io/v1',
          observedFrom: 'local_execution_mirror',
          workloadReconciliation: 'not_checked',
          observationState: 'not_started',
          observationReason: 'execution_not_found',
          desiredRevision: 3,
          planSha256: null,
          execution: null,
        });
      }
      if (path.endsWith('/events/dead-letters')) {
        return json(route, {
          apiVersion: 'event-dead-letter-list.plugin.enterpriseglue.io/v1',
          items: [],
          nextCursor: null,
        });
      }
      if (path.endsWith('/capabilities')) {
        return json(route, {
          apiVersion: 'platform-capabilities.plugin.enterpriseglue.io/v1',
          kind: 'EnterpriseGluePluginPlatformCapabilities',
          metadata: { catalogRevision: '2026-08-19.1' },
          compatibility: {
            hostVersion: '0.13.1',
            sdkVersion: '0.2.0',
            sharedFrontend: true,
            supportWindow: {
              policy: 'current-and-previous-minor-when-available',
              hostMinorLines: ['0.13'],
              sdkMinorLines: ['0.2'],
              sdkVersions: ['0.2.0'],
              exactPrivateCiHostEvidenceRequired: true,
            },
          },
          permissions: [],
          slots: [],
          events: [],
          egressPolicies: [],
          trustedPublishers: [],
        });
      }
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"Unknown plugin endpoint"}' });
    });

    await page.goto('/admin/settings/plugins');

    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Plugins', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Installed plugins' })).toBeVisible();
    await expect(page.getByText('ION Support Agent', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Actions for ION Support Agent' })).toBeEnabled();
    await expect(page.getByRole('heading', { name: 'Advanced operations' })).toBeVisible();
    await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true);

    await captureManualScreenshot(page, 'plugin-platform-installed-1440x900.jpg');

    await page.getByText('Emergency controls', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'Stop all plugins' })).toBeVisible();
    await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
    await page.waitForTimeout(100);
    await captureManualScreenshot(page, 'plugin-platform-emergency-controls-1440x900.jpg', { stabilize: false });

    await page.setViewportSize({ width: 720, height: 900 });
    await expect(page.getByText('ION Support Agent', { exact: true })).toBeVisible();
    await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true);
  });
});

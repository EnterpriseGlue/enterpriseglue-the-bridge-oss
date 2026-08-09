import { expect, test } from '@playwright/test';

function isLocalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ['localhost', '127.0.0.1', '::1'].includes(url.hostname) || url.hostname.endsWith('.local');
  } catch {
    return false;
  }
}

const baseUrl = process.env.PLAYWRIGHT_BASE_URL || 'https://localhost:5443';
const enabled = process.env.LOCAL_OIDC_REHEARSAL === 'true' && isLocalUrl(baseUrl);
const providerKey = process.env.LOCAL_OIDC_PROVIDER_KEY || 'local-keycloak-oidc';
const username = process.env.LOCAL_OIDC_TEST_USERNAME || 'oidc-operator';
const password = process.env.LOCAL_OIDC_TEST_PASSWORD || 'local-oidc-operator';

test.describe('Local OIDC rehearsal', () => {
  test.skip(!enabled, 'Set LOCAL_OIDC_REHEARSAL=true with a localhost Playwright base URL.');

  test('completes the Keycloak redirect and establishes an app session @local-oidc-live', async ({ page }) => {
    await page.goto(`/api/auth/identity/${encodeURIComponent(providerKey)}/start`);

    await page.locator('input[name="username"]').fill(username);
    await page.locator('input[name="password"]').fill(password);
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page).toHaveURL(new RegExp(`${baseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(?:$|[?#])`));
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
  });
});

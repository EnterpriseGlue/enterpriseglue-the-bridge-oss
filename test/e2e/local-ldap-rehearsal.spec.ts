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
const enabled = process.env.LOCAL_LDAP_REHEARSAL === 'true' && isLocalUrl(baseUrl);
const providerKey = process.env.LOCAL_LDAP_PROVIDER_KEY || 'local-openldap';
const username = process.env.LOCAL_LDAP_TEST_USERNAME || 'browser-login@identity-mock.test';
const password = process.env.LOCAL_LDAP_TEST_PASSWORD || '';

test.describe('Local LDAP rehearsal', () => {
  test.skip(!enabled || !password, 'Set LOCAL_LDAP_REHEARSAL=true with a localhost Playwright base URL and disposable fixture password.');

  test('signs in through the direct LDAP form and establishes an app session @local-ldap-live', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: `Sign in with ${providerKey}` }).click();
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password').fill(password);
    const loginResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === 'POST' && /^\/api\/auth\/providers\/[^/]+\/login$/.test(url.pathname);
    });
    await page.getByRole('button', { name: `Sign in with ${providerKey}` }).click();
    expect((await loginResponse).status()).toBe(200);

    await expect(page).toHaveURL(new RegExp(`${baseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/t/default/(?:$|[?#])`));
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
  });
});

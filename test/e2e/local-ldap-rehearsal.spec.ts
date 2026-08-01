import { expect, test, type Page } from '@playwright/test';

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
const adminEmail = process.env.LOCAL_LDAP_ADMIN_EMAIL || '';
const adminPassword = process.env.LOCAL_LDAP_ADMIN_PASSWORD || '';

async function loginLocalAdministrator(page: Page): Promise<void> {
  await page.goto('/admin-recovery');
  await page.getByLabel(/email/i).fill(adminEmail);
  await page.getByLabel('Password', { exact: true }).fill(adminPassword);
  await page.getByRole('button', { name: 'Sign in for recovery', exact: true }).click();
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
}

test.describe('Local LDAP rehearsal', () => {
  test.skip(!enabled || !password, 'Set LOCAL_LDAP_REHEARSAL=true with a localhost Playwright base URL and disposable fixture password.');

  test('reconciles the scheduled nested-group directory configuration through the real backend @local-ldap-live @identity-lifecycle-live', async ({ browser }) => {
    test.skip(!adminEmail || !adminPassword, 'Local administrator credentials are required for LDAP reconciliation.');
    const adminContext = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: baseUrl });
    const admin = await adminContext.newPage();
    try {
      await loginLocalAdministrator(admin);
      const csrf = await admin.request.get('/api/csrf-token');
      expect(csrf.status()).toBe(200);
      const csrfToken = csrf.headers()['x-csrf-token'];
      expect(csrfToken).toBeTruthy();

      const reconciliation = await admin.request.post(`/api/identity/providers/${encodeURIComponent(providerKey)}/reconcile`, {
        headers: { 'X-CSRF-Token': csrfToken },
      });
      const result = await reconciliation.json().catch(() => null) as { processed?: number; runId?: string | null } | null;
      expect(reconciliation.status(), JSON.stringify(result)).toBe(200);
      expect(result?.processed).toBeGreaterThanOrEqual(3);
      expect(result?.runId).toBeTruthy();

      const runs = await admin.request.get(`/api/identity/providers/${encodeURIComponent(providerKey)}/sync-runs?limit=5`);
      const syncRuns = await runs.json().catch(() => null) as Array<{ id: string; trigger: string; status: string }> | null;
      expect(runs.status(), JSON.stringify(syncRuns)).toBe(200);
      expect(syncRuns).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: result?.runId, trigger: 'manual', status: 'success' }),
      ]));
    } finally {
      await adminContext.close();
    }
  });

  test('signs in through the direct LDAP form and establishes an app session @local-ldap-live', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: `Continue with ${providerKey}` }).click();
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password').fill(password);
    const loginResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === 'POST' && /^\/api\/auth\/providers\/[^/]+\/login$/.test(url.pathname);
    });
    await page.getByRole('button', { name: /^Sign in$/ }).click();
    expect((await loginResponse).status()).toBe(200);

    await expect(page).toHaveURL(new RegExp(`${baseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/t/default/(?:$|[?#])`));
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
  });
});

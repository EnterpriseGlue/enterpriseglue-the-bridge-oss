import { expect, test, type Page } from '@playwright/test';
import { monitorBrowserDiagnostics } from '../utils/browserDiagnostics';
import { getE2ECredentials, hasE2ECredentials } from '../utils/credentials';

const shouldSkip = !hasE2ECredentials();

async function login(page: Page) {
  const { email, password } = getE2ECredentials();
  if (!email || !password) throw new Error('Missing E2E credentials');
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
}

test.describe('Smoke: Mission Control engine health', () => {
  test.skip(shouldSkip, 'E2E_USER/E2E_PASSWORD not set');

  test('engine inventory and repeated health polling stay valid @smoke @mission-control', async ({ page }) => {
    await login(page);
    const diagnostics = monitorBrowserDiagnostics(page);
    const inventoryResponse = page.waitForResponse((response) => (
      response.request().method() === 'GET'
      && /\/engines-api\/engines(?:\?|$)/.test(response.url())
    ));
    const healthResponse = page.waitForResponse((response) => (
      response.request().method() === 'GET'
      && /\/engines-api\/engines\/[^/]+\/health(?:\?|$)/.test(response.url())
    ));

    await page.goto('/t/default/engines');
    await expect(page.getByRole('heading', { name: 'Engines', exact: true })).toBeVisible();
    expect((await inventoryResponse).status()).toBe(200);
    const firstHealthResponse = await healthResponse;
    expect(firstHealthResponse.status()).toBe(200);
    expect(Number.isSafeInteger((await firstHealthResponse.json()).checkedAt)).toBe(true);
    for (let poll = 0; poll < 2; poll += 1) {
      const response = await page.request.get(firstHealthResponse.url());
      expect(response.status(), `engine health poll ${poll + 2}`).toBe(200);
      expect(Number.isSafeInteger((await response.json()).checkedAt)).toBe(true);
    }
    await expect(page.getByText(/Connected|Disconnected|Unknown/).first()).toBeVisible();

    await page.waitForTimeout(2_000);
    await diagnostics.expectClean('Mission Control engine health polling');
    diagnostics.dispose();
  });
});

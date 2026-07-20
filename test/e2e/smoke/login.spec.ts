import { test, expect } from '@playwright/test';
import { getE2ECredentials, hasE2ECredentials } from '../utils/credentials';

const shouldSkip = !hasE2ECredentials();

test.describe('Smoke: login', () => {
  test.skip(shouldSkip, 'E2E_USER/E2E_PASSWORD not set');

  test('login happy path @smoke', async ({ page }) => {
    const { email, password } = getE2ECredentials();
    if (!email || !password) throw new Error('Missing E2E credentials');
    await page.goto('/login?local=1');

    await page.getByLabel(/email/i).pressSequentially(email);
    await page.getByLabel(/password/i).pressSequentially(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
  });
});

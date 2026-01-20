import { test, expect } from '@playwright/test';
import { getE2ECredentials, hasE2ECredentials } from '../utils/credentials';

const shouldSkip = !hasE2ECredentials();

test.describe('Smoke: Mission Control decisions', () => {
  test.skip(shouldSkip, 'E2E_USER/E2E_PASSWORD not set');

  test('decisions list loads @smoke', async ({ page }) => {
    const { email, password } = getE2ECredentials();
    if (!email || !password) throw new Error('Missing E2E credentials');

    await page.goto('/login');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();

    await page.goto('/mission-control/decisions');
    await expect(page.getByText('Decisions')).toBeVisible();
  });
});

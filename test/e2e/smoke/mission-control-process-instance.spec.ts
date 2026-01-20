import { test, expect } from '@playwright/test';
import { getE2ECredentials, hasE2ECredentials } from '../utils/credentials';

const shouldSkip = !hasE2ECredentials();

const instanceId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

test.describe('Smoke: Mission Control process instance detail', () => {
  test.skip(shouldSkip, 'E2E_USER/E2E_PASSWORD not set');

  test('process instance detail loads @smoke', async ({ page }) => {
    const { email, password } = getE2ECredentials();
    if (!email || !password) throw new Error('Missing E2E credentials');

    await page.goto('/login');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();

    await page.goto(`/mission-control/processes/instances/${instanceId}`);
    await expect(page.getByRole('tab', { name: 'Variables' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /instance history/i })).toBeVisible();
  });
});

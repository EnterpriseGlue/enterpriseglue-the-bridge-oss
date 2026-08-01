import { test, expect, type Page } from '@playwright/test';
import { getE2ECredentials, hasE2ECredentials } from '../utils/credentials';

const shouldSkip = !hasE2ECredentials();

async function login(page: Page) {
  const { email, password } = getE2ECredentials();
  if (!email || !password) throw new Error('Missing E2E credentials');
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
}

test.describe('Smoke: identity provider administration', () => {
  test.skip(shouldSkip, 'E2E_USER/E2E_PASSWORD not set');

  test('shows the complete direct LDAP configuration form @smoke', async ({ page }) => {
    await login(page);
    await page.goto('/admin/settings');
    await page.getByRole('tab', { name: 'Identity Providers' }).click();
    await page.getByRole('button', { name: 'Add provider' }).click();
    await page.getByLabel('Protocol').selectOption('ldap');

    await expect(page.getByLabel('LDAPS URL')).toBeVisible();
    await expect(page.getByLabel('Service bind DN')).toBeVisible();
    await expect(page.getByLabel('Service bind password reference')).toBeVisible();
    await expect(page.getByLabel('User base DN')).toBeVisible();
    await expect(page.getByLabel('User search filter')).toHaveValue('(uid={username})');
    await expect(page.getByLabel('Group base DN')).toBeVisible();
    await expect(page.getByLabel('Group identifier attribute')).toHaveValue('cn');
    await expect(page.getByLabel('Group membership lookup')).toBeVisible();
  });
});

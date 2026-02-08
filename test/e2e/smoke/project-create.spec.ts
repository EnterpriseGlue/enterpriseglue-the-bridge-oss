import { test, expect, type Page } from '@playwright/test';
import { getE2ECredentials, hasE2ECredentials } from '../utils/credentials';

const shouldSkip = !hasE2ECredentials();

async function login(page: Page) {
  const { email, password } = getE2ECredentials();
  if (!email || !password) throw new Error('Missing E2E credentials');
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
  await page.goto('/starbase');
  await expect(page.getByRole('heading', { name: /starbase/i })).toBeVisible();
}

test.describe('Smoke: create project', () => {
  test.skip(shouldSkip, 'E2E_USER/E2E_PASSWORD not set');

  test('create project happy path @smoke', async ({ page }) => {
    await login(page);

    const projectName = `e2e-smoke-project-${Date.now()}`;

    await page.getByRole('button', { name: /create project/i }).first().click();
    await page.getByLabel(/project name/i).fill(projectName);
    await page.getByRole('dialog').getByRole('button', { name: /create project/i }).click();

    await expect(page.getByRole('heading', { name: projectName })).toBeVisible();
  });
});

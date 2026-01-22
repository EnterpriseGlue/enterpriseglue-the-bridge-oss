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

test.describe('Smoke: download project', () => {
  test.skip(shouldSkip, 'E2E_USER/E2E_PASSWORD not set');

  test('download project zip @smoke', async ({ page }) => {
    await login(page);

    const projectName = `Smoke Download ${Date.now()}`;

    await page.getByRole('button', { name: /new project|create project/i }).click();
    await page.getByLabel(/project name/i).fill(projectName);
    await page.getByRole('dialog').getByRole('button', { name: /create project/i }).click();

    await expect(page.getByRole('heading', { name: projectName })).toBeVisible();

    await page.getByRole('button', { name: /project options/i }).click();

    const downloadResponse = page.waitForResponse((response) => {
      return response.url().includes('/starbase-api/projects/')
        && response.url().includes('/download');
    });

    await page.getByRole('menuitem', { name: /download project/i }).click();
    const response = await downloadResponse;
    expect([200, 204]).toContain(response.status());
  });
});

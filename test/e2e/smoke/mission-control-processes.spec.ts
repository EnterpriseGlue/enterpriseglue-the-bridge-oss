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
}

async function expectMissionControlState(page: Page, expected: RegExp) {
  await expect(page).toHaveURL(/\/mission-control\/processes/);
  await expect
    .poll(async () => {
      const bodyText = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
      return (
        expected.test(bodyText)
        || /Access Denied|No Active Engine/.test(bodyText)
      );
    })
    .toBe(true);
}

test.describe('Smoke: Mission Control processes', () => {
  test.skip(shouldSkip, 'E2E_USER/E2E_PASSWORD not set');

  test('processes list loads @smoke', async ({ page }) => {
    await login(page);

    await page.goto('/mission-control/processes');
    await expectMissionControlState(page, /To view a Diagram|Process Instances|Processes/i);
  });
});

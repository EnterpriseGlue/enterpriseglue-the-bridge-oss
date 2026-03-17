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

function extractProjectId(url: string) {
  return url.match(/\/starbase\/project\/([^/?#]+)/)?.[1] || null;
}

function displayName(fileName: string) {
  return fileName.replace(/\.(bpmn|dmn)$/i, '');
}

async function createDiagramViaUi(page: Page, type: 'bpmn' | 'dmn', name: string) {
  await page.getByRole('button', { name: /create new/i }).click();
  await page.getByRole('menuitem', { name: type === 'bpmn' ? /bpmn diagram/i : /dmn diagram/i }).click();
  await page.getByLabel(/file name/i).fill(name);
  await page.getByRole('dialog').getByRole('button', { name: /^create$/i }).click();
}

async function deleteFileViaProjectTable(page: Page, fileName: string) {
  const row = page.locator('tr', { hasText: displayName(fileName) }).first();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: /options/i }).click();
  await page.getByRole('menuitem', { name: /delete/i }).click();
  await expect(page.getByText(`You're about to delete the file "${fileName}".`)).toBeVisible();
  await page.getByRole('button', { name: /delete file/i }).click();
}

test.describe('Smoke: Starbase delete isolation', () => {
  test.skip(shouldSkip, 'E2E_USER/E2E_PASSWORD not set');

  test('deleting one file does not impact other files in the project @smoke', async ({ page }) => {
    await login(page);
    await page.goto('/starbase');
    await expect(page.getByRole('heading', { name: /starbase/i })).toBeVisible();

    const projectName = `e2e-delete-isolation-${Date.now()}`;
    const firstFileName = `delete-source-${Date.now()}.bpmn`;
    const secondFileName = `delete-target-${Date.now()}.bpmn`;

    await page.getByRole('button', { name: /new project|create project/i }).first().click();
    await page.getByLabel(/project name/i).fill(projectName);
    await page.getByRole('dialog').getByRole('button', { name: /create project/i }).click();

    await expect(page.getByRole('heading', { name: projectName })).toBeVisible();
    const projectId = extractProjectId(page.url());
    if (!projectId) throw new Error(`Could not determine project id from URL: ${page.url()}`);

    await createDiagramViaUi(page, 'bpmn', firstFileName);
    await expect(page).toHaveURL(/\/starbase\/editor\/[^/?#]+$/);
    await expect(page.getByRole('button', { name: /versions/i })).toBeVisible();

    await page.goto(`/starbase/project/${projectId}`);
    await expect(page.getByRole('heading', { name: projectName })).toBeVisible();

    await createDiagramViaUi(page, 'bpmn', secondFileName);
    await expect(page).toHaveURL(/\/starbase\/editor\/[^/?#]+$/);
    await expect(page.getByRole('button', { name: /versions/i })).toBeVisible();

    await page.goto(`/starbase/project/${projectId}`);
    await expect(page.getByRole('heading', { name: projectName })).toBeVisible();
    await expect(page.locator('tr', { hasText: displayName(firstFileName) }).first()).toBeVisible();
    await expect(page.locator('tr', { hasText: displayName(secondFileName) }).first()).toBeVisible();

    await deleteFileViaProjectTable(page, firstFileName);

    await expect(page.getByText(/file deleted/i)).toBeVisible();
    await expect(page.locator('tr', { hasText: displayName(firstFileName) })).toHaveCount(0);
    await expect(page.locator('tr', { hasText: displayName(secondFileName) }).first()).toBeVisible();

    await page.locator('tr', { hasText: displayName(secondFileName) }).first().getByText(displayName(secondFileName)).click();
    await expect(page).toHaveURL(/\/starbase\/editor\/[^/?#]+$/);
    await expect(page.getByRole('button', { name: /versions/i })).toBeVisible();
  });
});

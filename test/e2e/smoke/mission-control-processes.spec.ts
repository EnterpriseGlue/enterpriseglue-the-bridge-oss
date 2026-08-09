import { test, expect, type Page } from '@playwright/test';
import { getE2ECredentials, hasE2ECredentials } from '../utils/credentials';
import { getMockProcessFixture } from '../utils/mockCamundaFixture';

const shouldSkip = !hasE2ECredentials();
const requireMock = process.env.E2E_REQUIRE_MISSION_CONTROL_MOCK === 'true';

async function login(page: Page) {
  const { email, password } = getE2ECredentials();
  if (!email || !password) throw new Error('Missing E2E credentials');

  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
}

async function waitForJsonResponse(page: Page, pathFragment: string) {
  const response = await page.waitForResponse((candidate) => {
    return candidate.request().method() === 'GET' && candidate.url().includes(pathFragment);
  });
  expect(response.status()).toBe(200);
  return response.json();
}

async function expectMissionControlState(page: Page, expected: RegExp) {
  await expect(page).toHaveURL(/\/mission-control\/processes/);
  await expect
    .poll(async () => {
      const bodyText = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
      if (requireMock) {
        return expected.test(bodyText) && !/Access Denied|No Active Engine|Failed to load/i.test(bodyText);
      }
      return (
        expected.test(bodyText)
        || /Access Denied|No Active Engine|Failed to load/i.test(bodyText)
      );
    })
    .toBe(true);
}

test.describe('Smoke: Mission Control processes', () => {
  test.skip(shouldSkip, 'E2E_USER/E2E_PASSWORD not set');

  test('processes list loads @smoke @mission-control', async ({ page }) => {
    const fixture = requireMock ? await getMockProcessFixture() : null;
    await login(page);
    const definitionsPromise = requireMock
      ? waitForJsonResponse(page, '/mission-control-api/process-definitions')
      : Promise.resolve(null);
    const instancesPromise = requireMock
      ? waitForJsonResponse(page, '/mission-control-api/process-instances')
      : Promise.resolve(null);

    await page.goto('/mission-control/processes');
    const [definitions, instances] = await Promise.all([definitionsPromise, instancesPromise]);
    if (requireMock) {
      expect(Array.isArray(definitions)).toBe(true);
      expect(Array.isArray(instances)).toBe(true);
      expect(definitions.some((definition: any) => {
        return definition?.key === fixture?.listProcessDefinitionKey && definition?.name === fixture?.listProcessDefinitionName;
      })).toBe(true);
    }
    await expectMissionControlState(page, requireMock && fixture?.listProcessDefinitionName
      ? new RegExp(`Processes|${fixture.listProcessDefinitionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i')
      : /To view a diagram|Process Instances|Processes/i);
  });
});

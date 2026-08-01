import { test, expect, type Page } from '@playwright/test';
import { getE2ECredentials, hasE2ECredentials } from '../utils/credentials';
import { getMockDecisionFixture } from '../utils/mockCamundaFixture';

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

async function waitForDecisionDefinitionXml(page: Page) {
  const response = await page.waitForResponse((candidate) => {
    return candidate.request().method() === 'GET'
      && /\/mission-control-api\/decision-definitions\/[^/]+\/xml(?:\?|$)/.test(candidate.url());
  });
  expect(response.status()).toBe(200);
  return response.json() as Promise<{ dmnXml?: string }>;
}

async function expectDecisionsState(page: Page) {
  await expect(page).toHaveURL(/\/mission-control\/decisions/);
  await expect
    .poll(async () => {
      const bodyText = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
      if (requireMock) {
        return /Decisions|Decision Instances|Invoice Risk/i.test(bodyText) && !/Access Denied|No Active Engine|Failed to load/i.test(bodyText);
      }
      return /Decisions|Decision Instances|Access Denied|No Active Engine|Failed to load/i.test(bodyText);
    })
    .toBe(true);
}

test.describe('Smoke: Mission Control decisions', () => {
  test.skip(shouldSkip, 'E2E_USER/E2E_PASSWORD not set');

  test('decisions list loads @smoke @mission-control', async ({ page }) => {
    const fixture = requireMock ? await getMockDecisionFixture() : null;
    await login(page);
    const definitionsPromise = requireMock
      ? waitForJsonResponse(page, '/mission-control-api/decision-definitions')
      : Promise.resolve(null);
    const historyPromise = requireMock
      ? waitForJsonResponse(page, '/mission-control-api/history/decisions')
      : Promise.resolve(null);
    const xmlPromise = requireMock && fixture?.decisionDefinitionKey && fixture?.decisionDefinitionVersion !== null
      ? waitForDecisionDefinitionXml(page)
      : Promise.resolve(null);

    const query = requireMock && fixture?.decisionDefinitionKey && fixture?.decisionDefinitionVersion !== null
      ? `?decision=${encodeURIComponent(fixture.decisionDefinitionKey)}&version=${fixture.decisionDefinitionVersion}`
      : '';

    await page.goto(`/mission-control/decisions${query}`);
    const [definitions, history, xml] = await Promise.all([definitionsPromise, historyPromise, xmlPromise]);
    if (requireMock) {
      expect(Array.isArray(definitions)).toBe(true);
      expect(Array.isArray(history)).toBe(true);
      expect(definitions.some((definition: any) => {
        return definition?.key === fixture?.decisionDefinitionKey && definition?.name === fixture?.decisionDefinitionName;
      })).toBe(true);
      expect(history.some((entry: any) => {
        return entry?.decisionDefinitionKey === fixture?.decisionDefinitionKey && entry?.decisionDefinitionName === fixture?.decisionDefinitionName;
      })).toBe(true);
      expect(typeof xml?.dmnXml).toBe('string');
      expect(/<(?:dmn:)?definitions\b/.test(String(xml?.dmnXml || ''))).toBe(true);
      await expect(page.locator('.dmn-decision-table-container .tjs-table')).toBeVisible();
      await expect(page.locator('body')).not.toContainText(/Error loading decision table|Loading decision table/i);
    }
    await expectDecisionsState(page);
  });
});

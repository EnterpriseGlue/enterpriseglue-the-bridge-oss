import { test, expect, type Page } from '@playwright/test';
import { getE2ECredentials, hasE2ECredentials } from '../utils/credentials';
import { getMockProcessFixture } from '../utils/mockCamundaFixture';

const shouldSkip = !hasE2ECredentials();
const requireMock = process.env.E2E_REQUIRE_MISSION_CONTROL_MOCK === 'true';
const fallbackInstanceId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

async function login(page: Page) {
  const { email, password } = getE2ECredentials();
  if (!email || !password) throw new Error('Missing E2E credentials');

  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
}

async function enableInstanceCounts(page: Page) {
  await page.evaluate(() => {
    window.localStorage.setItem('mission-control-show-instance-counts', '1');
  });
}

async function waitForJsonResponse(page: Page, pathFragment: string) {
  const response = await page.waitForResponse((candidate) => {
    return candidate.request().method() === 'GET' && candidate.url().includes(pathFragment);
  });
  expect(response.status()).toBe(200);
  return response.json();
}

async function waitForProcessDefinitionXml(page: Page) {
  const response = await page.waitForResponse((candidate) => {
    return candidate.request().method() === 'GET'
      && /\/mission-control-api\/process-definitions\/[^/]+\/xml(?:\?|$)/.test(candidate.url());
  });
  expect(response.status()).toBe(200);
  return response.json() as Promise<{ bpmn20Xml?: string }>;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function expectProcessInstanceState(page: Page, instanceId: string) {
  await expect(page).toHaveURL(new RegExp(`/mission-control/processes/instances/${escapeRegExp(instanceId)}$`));
  await expect
    .poll(async () => {
      const bodyText = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
      if (requireMock) {
        return /Variables|Instance History/i.test(bodyText) && !/Access Denied|No Active Engine|Failed to load/i.test(bodyText);
      }
      return /Variables|Instance History|Access Denied|No Active Engine|Failed to load/i.test(bodyText);
    })
    .toBe(true);
}

test.describe('Smoke: Mission Control process instance detail', () => {
  test.skip(shouldSkip, 'E2E_USER/E2E_PASSWORD not set');

  test('process instance detail loads @smoke @mission-control', async ({ page }) => {
    const fixture = requireMock ? await getMockProcessFixture() : null;
    const instanceId = fixture?.primaryInstanceId || fallbackInstanceId;
    await login(page);
    await enableInstanceCounts(page);
    const historicPromise = requireMock
      ? waitForJsonResponse(page, `/mission-control-api/history/process-instances/${instanceId}`)
      : Promise.resolve(null);
    const variablesPromise = requireMock
      ? waitForJsonResponse(page, `/mission-control-api/process-instances/${instanceId}/variables`)
      : Promise.resolve(null);
    const activityHistoryPromise = requireMock
      ? waitForJsonResponse(page, `/mission-control-api/process-instances/${instanceId}/history/activity-instances`)
      : Promise.resolve(null);
    const xmlPromise = requireMock
      ? waitForProcessDefinitionXml(page)
      : Promise.resolve(null);

    await page.goto(`/mission-control/processes/instances/${instanceId}`);
    const [historic, variables, activityHistory, xml] = await Promise.all([historicPromise, variablesPromise, activityHistoryPromise, xmlPromise]);
    if (requireMock) {
      expect(historic?.processDefinitionKey).toBe(fixture?.primaryProcessDefinitionKey);
      expect(variables && typeof variables === 'object').toBe(true);
      if (fixture?.primaryVariableName) {
        const variableEntry = variables?.[fixture.primaryVariableName];
        if (variableEntry) {
          expect(variableEntry?.value).toEqual(fixture.primaryVariableValue);
        }
      }
      expect(Array.isArray(activityHistory)).toBe(true);
      if (fixture?.primaryActivityId || fixture?.primaryActivityName) {
        expect(activityHistory.some((entry: any) => {
          return (!fixture?.primaryActivityId || entry?.activityId === fixture.primaryActivityId)
            && (!fixture?.primaryActivityName || entry?.activityName === fixture.primaryActivityName);
        })).toBe(true);
      }
      expect(typeof xml?.bpmn20Xml).toBe('string');
      expect(/<(?:bpmn:)?definitions\b/.test(String(xml?.bpmn20Xml || ''))).toBe(true);
      await expect(page.locator('.djs-container svg[data-element-id]')).toBeVisible();
      await expect(page.locator('body')).not.toContainText(/Failed to load|Error loading XML|No diagram XML/i);
    }
    await expectProcessInstanceState(page, instanceId);
  });
});

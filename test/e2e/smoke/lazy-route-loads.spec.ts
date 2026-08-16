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
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
}

function createPageErrorTrap(page: Page) {
  const errors: string[] = [];
  const handler = (error: Error) => {
    errors.push(error?.stack || error?.message || String(error));
  };

  page.on('pageerror', handler);

  return {
    clear() {
      errors.splice(0, errors.length);
    },
    current() {
      return [...errors].filter((value) => !/ResizeObserver loop limit exceeded/i.test(value));
    },
    dispose() {
      page.off('pageerror', handler);
    },
  };
}

async function expectNoRuntimeRouteFailure(page: Page, routeLabel: string, trap: ReturnType<typeof createPageErrorTrap>) {
  await page.waitForTimeout(250);
  await expect(page.locator('body')).not.toContainText(/Unexpected Application Error/i);
  const errors = trap.current();
  expect(errors, `${routeLabel} runtime errors:\n${errors.join('\n\n')}`).toHaveLength(0);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractProjectId(url: string) {
  return url.match(/\/starbase\/project\/([^/?#]+)/)?.[1] || null;
}

async function createDiagramViaUi(page: Page, type: 'bpmn' | 'dmn', name: string) {
  await page.getByRole('button', { name: /create new/i }).click();
  await page.getByRole('menuitem', { name: type === 'bpmn' ? /bpmn diagram/i : /dmn diagram/i }).click();
  await page.getByLabel(/file name/i).fill(name);
  await page.getByRole('dialog').getByRole('button', { name: /^create$/i }).click();
}

async function expectMissionControlProcessesState(page: Page) {
  await expect(page).toHaveURL(/\/mission-control\/processes/);
  await expect
    .poll(async () => {
      const bodyText = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
      return /Processes|To view a diagram|Process Instances|Access Denied|No Active Engine|Failed to load/i.test(bodyText);
    })
    .toBe(true);
}

async function expectProcessInstanceState(page: Page, instanceId: string) {
  await expect(page).toHaveURL(new RegExp(`/mission-control/processes/instances/${escapeRegExp(instanceId)}$`));
  await expect
    .poll(async () => {
      const bodyText = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
      return /Variables|Instance History|Access Denied|No Active Engine|Failed to load/i.test(bodyText);
    })
    .toBe(true);
}

test.describe('Smoke: lazy-loaded routes', () => {
  test.skip(shouldSkip, 'E2E_USER/E2E_PASSWORD not set');

  test('Starbase lazy routes load without runtime errors @smoke @lazy-routes', async ({ page }) => {
    const trap = createPageErrorTrap(page);

    try {
      await login(page);

      trap.clear();
      await page.goto('/starbase');
      await expect(page.getByRole('heading', { name: /starbase/i })).toBeVisible();
      await expectNoRuntimeRouteFailure(page, 'Starbase overview', trap);

      const projectName = `e2e-lazy-project-${Date.now()}`;
      trap.clear();
      await page.getByRole('button', { name: /new project|create project/i }).first().click();
      await page.getByLabel(/project name/i).fill(projectName);
      await page.getByRole('dialog').getByRole('button', { name: /create project/i }).click();
      await expect(page.getByRole('heading', { name: projectName })).toBeVisible();
      await expectNoRuntimeRouteFailure(page, 'Starbase project detail', trap);

      const projectId = extractProjectId(page.url());
      if (!projectId) throw new Error(`Could not determine project id from URL: ${page.url()}`);

      const bpmnName = `lazy-bpmn-${Date.now()}.bpmn`;
      trap.clear();
      await createDiagramViaUi(page, 'bpmn', bpmnName);
      await expect(page).toHaveURL(/\/starbase\/editor\/[^/?#]+$/);
      await expect(page.getByRole('tab', { name: /design/i })).toBeVisible();
      await expect(page.getByRole('tab', { name: /implement/i })).toBeVisible();
      await expect(page.locator('.djs-container svg[data-element-id]').first()).toBeVisible();
      await expect(page.getByRole('button', { name: /versions/i })).toBeVisible();
      await expectNoRuntimeRouteFailure(page, 'BPMN editor', trap);

      trap.clear();
      await page.goto(`/starbase/project/${projectId}`);
      await expect(page.getByRole('heading', { name: projectName })).toBeVisible();
      await expectNoRuntimeRouteFailure(page, 'Starbase project detail return', trap);

      const dmnName = `lazy-dmn-${Date.now()}.dmn`;
      trap.clear();
      await createDiagramViaUi(page, 'dmn', dmnName);
      await expect(page).toHaveURL(/\/starbase\/editor\/[^/?#]+$/);
      await expect(page.getByRole('button', { name: /show evaluate panel|hide evaluate panel/i })).toBeVisible();
      await expect(page.locator('.dmn-decision-table-container .tjs-table, .dmn-literal-expression-container, .djs-container svg[data-element-id]').first()).toBeVisible();
      await expect(page.getByRole('button', { name: /versions/i })).toBeVisible();
      await expectNoRuntimeRouteFailure(page, 'DMN editor', trap);
    } finally {
      trap.dispose();
    }
  });

  test('Mission Control process routes load without runtime errors @smoke @lazy-routes @mission-control', async ({ page }) => {
    const trap = createPageErrorTrap(page);

    try {
      const fixture = requireMock ? await getMockProcessFixture() : null;
      const instanceId = fixture?.primaryInstanceId || fallbackInstanceId;

      await login(page);
      await page.evaluate(() => {
        window.localStorage.setItem('mission-control-show-instance-counts', '1');
      });

      trap.clear();
      await page.goto('/mission-control/processes');
      await expectMissionControlProcessesState(page);
      await expectNoRuntimeRouteFailure(page, 'Mission Control processes', trap);

      trap.clear();
      await page.goto(`/mission-control/processes/instances/${instanceId}`);
      await expectProcessInstanceState(page, instanceId);
      await expectNoRuntimeRouteFailure(page, 'Mission Control process instance detail', trap);
    } finally {
      trap.dispose();
    }
  });
});

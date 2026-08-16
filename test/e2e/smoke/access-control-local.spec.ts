import { expect, test } from '@playwright/test';
import { getE2ECredentials, getE2EFineGrainedFixture, hasE2ECredentials } from '../utils/credentials';

const shouldSkip = !hasE2ECredentials();
const fineGrained = getE2EFineGrainedFixture();

async function enterLocalCredentials(page: import('@playwright/test').Page, email: string, password: string) {
  await page.getByLabel(/email/i).pressSequentially(email);
  await page.getByLabel('Password', { exact: true }).pressSequentially(password);
}

async function selectUser(panel: import('@playwright/test').Locator, email: string) {
  const input = panel.getByRole('textbox', { name: 'User', exact: true });
  await input.fill(email);
  const suggestion = panel.getByRole('button').filter({ hasText: email }).first();
  await expect(suggestion).toBeVisible();
  await suggestion.click();
  await expect(input).toHaveValue(email);
}

async function selectComboBoxItem(
  page: import('@playwright/test').Page,
  panel: import('@playwright/test').Locator,
  label: string,
  item: string,
) {
  const comboBox = panel.getByRole('combobox', { name: label, exact: true });
  const selectedItem = comboBox.locator('xpath=..').getByRole('button', { name: 'Clear selected item' });
  if (await comboBox.inputValue() === item && await selectedItem.isVisible()) return;
  await comboBox.click();
  await page.getByRole('option', { name: item, exact: true }).click();
  await expect(comboBox).toHaveValue(item);
  await expect(selectedItem).toBeVisible();
}

test.describe('Smoke: local Access Control authorization', () => {
  test.skip(shouldSkip, 'E2E_USER/E2E_PASSWORD not set');

  test('an authenticated local administrator can open Access Control', async ({ page }) => {
    const { email, password } = getE2ECredentials();
    if (!email || !password) throw new Error('Missing E2E credentials');

    await page.goto('/login?local=1');
    await enterLocalCredentials(page, email, password);
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();

    await page.goto('/t/default/admin/access-control');
    await expect(page.getByRole('heading', { name: 'Access Control' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Assignments', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Runtime Resources', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Roles', exact: true })).toHaveAttribute('aria-current', 'page');

    await page.getByRole('link', { name: 'Runtime Resources', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Runtime Resources', exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Engine' })).toBeVisible();

    await page.getByRole('link', { name: 'Effective Access', exact: true }).click();
    const panel = page.getByRole('tabpanel', { name: 'Effective Access' });
    const unnamedVisibleControls = await panel.locator('input, button, [role="combobox"]').evaluateAll((elements) => elements
      .filter((element) => (element as HTMLElement).offsetParent !== null)
      .map((element) => {
        const input = element as HTMLInputElement;
        const hasLabel = input.labels?.length || element.getAttribute('aria-label') || element.getAttribute('aria-labelledby') || element.textContent?.trim();
        return hasLabel ? null : element.outerHTML;
      })
      .filter(Boolean));
    expect(unnamedVisibleControls).toEqual([]);
    const userInput = panel.getByRole('textbox', { name: 'User', exact: true });
    await userInput.focus();
    expect(await panel.locator('#effective-user').evaluate((element) => document.activeElement === element)).toBe(true);
    await page.keyboard.press('Tab');
    expect(await panel.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    const session = await page.evaluate(async () => (await fetch('/api/auth/me')).json());
    const permissions = await page.evaluate(async () => (await fetch('/api/authz/permissions')).json());
    const userId = session.user?.id || session.id;
    const permission = permissions.find((item: { key: string; label: string; scope: string }) => item.key === 'platform.authz.roles.read')
      || permissions.find((item: { key: string; label: string; scope: string }) => item.scope === 'platform');
    if (!userId || !permission) throw new Error('Local administrator identity or platform permission is unavailable');

    await selectUser(panel, email);
    await panel.getByRole('combobox', { name: 'Permission' }).click();
    await page.getByRole('option', { name: `${permission.label} (${permission.key})` }).click();
    await expect(panel.getByRole('button', { name: 'Check access' })).toBeEnabled();
    await panel.getByRole('button', { name: 'Check access' }).click();
    await expect(panel.getByText('Access is allowed')).toBeVisible();
    await expect(panel.getByText('Why this access decision was made')).toBeVisible();
    await expect(panel.getByRole('table')).toBeVisible();
  });

  test('Effective Access displays the same engine decisions and source details as its evaluation API', async ({ page }) => {
    test.skip(!fineGrained.email || !fineGrained.scopedUserId || !fineGrained.scopedEngineId || !fineGrained.scopedEngineName || !fineGrained.scopedEngineAssignmentExpiresAt || !fineGrained.runtimeScopedEmail || !fineGrained.runtimeScopedUserId || !fineGrained.runtimeScopedEngineId || !fineGrained.scopeAssignmentEngineName || !fineGrained.runtimeAllowedResourceId || !fineGrained.groupEmail || !fineGrained.groupScopedUserId || !fineGrained.groupScopedEngineId || !fineGrained.groupScopedEngineName || !fineGrained.expiredEmail || !fineGrained.expiredUserId || !fineGrained.expiredEngineId || !fineGrained.expiredEngineName, 'Fine-grained fixture is unavailable');
    const { email, password } = getE2ECredentials();
    if (!email || !password) throw new Error('Missing E2E credentials');

    await page.goto('/login?local=1');
    await enterLocalCredentials(page, email, password);
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
    await page.goto('/t/default/admin/access-control');
    await page.getByRole('link', { name: 'Effective Access', exact: true }).click();
    const panel = page.getByRole('tabpanel', { name: 'Effective Access' });
    await expect(panel).toBeVisible();

    const catalog = await page.evaluate(async () => (await fetch('/api/authz/permissions')).json());
    const permission = catalog.find((item: { key: string }) => item.key === 'engine:instance:view');
    if (!permission) throw new Error('Engine instance-view permission is unavailable');

    const evaluate = async (userEmail: string, engineName: string) => {
      await selectUser(panel, userEmail);
      await panel.getByRole('combobox', { name: 'Resource type' }).click();
      await page.getByRole('option', { name: 'Engine', exact: true }).click();
      await selectComboBoxItem(page, panel, 'Engine', engineName);
      await panel.getByRole('combobox', { name: 'Permission' }).click();
      await page.getByRole('option', { name: `${permission.label} (${permission.key})` }).click();
      const response = page.waitForResponse((candidate) => candidate.url().includes('/api/authz/evaluate') && candidate.request().method() === 'POST');
      await panel.getByRole('button', { name: 'Check access' }).click();
      return (await response).json();
    };
    const evaluateRuntimeResource = async () => {
      await selectUser(panel, fineGrained.runtimeScopedEmail!);
      await panel.getByRole('combobox', { name: 'Resource type' }).click();
      await page.getByRole('option', { name: 'Runtime resource', exact: true }).click();
      await selectComboBoxItem(page, panel, 'Engine', fineGrained.scopeAssignmentEngineName!);
      await selectComboBoxItem(page, panel, 'Runtime resource', 'invoice-process');
      await panel.getByRole('combobox', { name: 'Permission' }).click();
      await page.getByRole('option', { name: `${permission.label} (${permission.key})` }).click();
      const response = page.waitForResponse((candidate) => candidate.url().includes('/api/authz/evaluate') && candidate.request().method() === 'POST');
      await panel.getByRole('button', { name: 'Check access' }).click();
      return (await response).json();
    };

    const allowed = await evaluate(fineGrained.email!, fineGrained.scopedEngineName!);
    expect(allowed.allowed).toBe(true);
    expect(allowed.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ scopeType: 'engine', scopeId: fineGrained.scopedEngineId }),
    ]));
    expect(allowed.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ tenantId: 'tenant-default', expiresAt: fineGrained.scopedEngineAssignmentExpiresAt }),
    ]));
    await expect(panel.getByText('Access is allowed')).toBeVisible();
    await expect(panel.getByRole('table')).toContainText('engine');
    await expect(panel.getByRole('table')).toContainText('tenant-default');
    await expect(panel.getByRole('table')).toContainText(new Date(fineGrained.scopedEngineAssignmentExpiresAt!).toISOString());

    const group = await evaluate(fineGrained.groupEmail!, fineGrained.groupScopedEngineName!);
    expect(group.allowed).toBe(true);
    expect(group.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ principalType: 'group', scopeType: 'engine', scopeId: fineGrained.groupScopedEngineId }),
    ]));
    await expect(panel.getByText('Access is allowed')).toBeVisible();
    await expect(panel.getByRole('table')).toContainText('group:');

    const runtime = await evaluateRuntimeResource();
    expect(runtime.allowed).toBe(true);
    expect(runtime.resolvedRuntimeResource).toMatchObject({
      engineId: fineGrained.runtimeScopedEngineId,
      resourceKey: 'invoice-process',
    });
    expect(runtime.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ scopeType: 'engine_runtime_resource', scopeId: fineGrained.runtimeAllowedResourceId }),
    ]));
    await expect(panel.getByText('Access is allowed')).toBeVisible();
    await expect(panel.getByText(/resolved runtime resource/i)).toBeVisible();

    const expired = await evaluate(fineGrained.expiredEmail!, fineGrained.expiredEngineName!);
    expect(expired.allowed).toBe(false);
    expect(expired.reason).toBe('no-permission');
    expect(expired.sources).toEqual([]);
    await expect(panel.getByText('Access is denied')).toBeVisible();
    await expect(panel.getByText('No authorization sources')).toBeVisible();
  });
});

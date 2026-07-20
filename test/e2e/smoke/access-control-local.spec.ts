import { expect, test } from '@playwright/test';
import { getE2ECredentials, getE2EFineGrainedFixture, hasE2ECredentials } from '../utils/credentials';

const shouldSkip = !hasE2ECredentials();
const fineGrained = getE2EFineGrainedFixture();

test.describe('Smoke: local Access Control authorization', () => {
  test.skip(shouldSkip, 'E2E_USER/E2E_PASSWORD not set');

  test('an authenticated local administrator can open Access Control', async ({ page }) => {
    const { email, password } = getE2ECredentials();
    if (!email || !password) throw new Error('Missing E2E credentials');

    await page.goto('/login?local=1');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();

    await page.goto('/t/default/admin/access-control');
    await expect(page.getByRole('heading', { name: 'Access Control' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Assignments', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Runtime Resources', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Roles', exact: true })).toHaveAttribute('aria-selected', 'true');

    await page.getByRole('tab', { name: 'Runtime Resources', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Runtime Resources' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Engine' })).toBeVisible();

    await page.getByRole('tab', { name: 'Effective Access', exact: true }).click();
    const panel = page.getByRole('tabpanel', { name: 'Effective Access' });
    const session = await page.evaluate(async () => (await fetch('/api/auth/me')).json());
    const permissions = await page.evaluate(async () => (await fetch('/api/authz/permissions')).json());
    const userId = session.user?.id || session.id;
    const permission = permissions.find((item: { key: string; label: string; scope: string }) => item.key === 'platform.authz.roles.read')
      || permissions.find((item: { key: string; label: string; scope: string }) => item.scope === 'platform');
    if (!userId || !permission) throw new Error('Local administrator identity or platform permission is unavailable');

    await panel.getByRole('textbox', { name: 'User ID' }).fill(userId);
    await panel.getByRole('combobox', { name: 'Permission' }).click();
    await page.getByRole('option', { name: `${permission.label} (${permission.key})` }).click();
    await expect(panel.getByRole('button', { name: 'Evaluate' })).toBeEnabled();
    await panel.getByRole('button', { name: 'Evaluate' }).click();
    await expect(panel.getByText('Access allowed')).toBeVisible();
  });

  test('Effective Access displays the same engine decisions and source details as its evaluation API', async ({ page }) => {
    test.skip(!fineGrained.scopedUserId || !fineGrained.scopedEngineId || !fineGrained.groupScopedUserId || !fineGrained.groupScopedEngineId || !fineGrained.expiredUserId || !fineGrained.expiredEngineId, 'Fine-grained fixture is unavailable');
    const { email, password } = getE2ECredentials();
    if (!email || !password) throw new Error('Missing E2E credentials');

    await page.goto('/login?local=1');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
    await page.goto('/t/default/admin/access-control');
    await page.getByRole('tab', { name: 'Effective Access', exact: true }).click();
    const panel = page.getByRole('tabpanel', { name: 'Effective Access' });
    await expect(panel).toBeVisible();

    const catalog = await page.evaluate(async () => (await fetch('/api/authz/permissions')).json());
    const permission = catalog.find((item: { key: string }) => item.key === 'engine:instance:view');
    if (!permission) throw new Error('Engine instance-view permission is unavailable');

    const evaluate = async (userId: string, engineId: string) => {
      await panel.getByRole('textbox', { name: 'User ID' }).fill(userId);
      await panel.getByRole('combobox', { name: 'Resource type' }).click();
      await page.getByRole('option', { name: 'Engine', exact: true }).click();
      await panel.getByRole('textbox', { name: 'Resource ID' }).fill(engineId);
      await panel.getByRole('combobox', { name: 'Permission' }).click();
      await page.getByRole('option', { name: `${permission.label} (${permission.key})` }).click();
      const response = page.waitForResponse((candidate) => candidate.url().includes('/api/authz/evaluate') && candidate.request().method() === 'POST');
      await panel.getByRole('button', { name: 'Evaluate' }).click();
      return (await response).json();
    };

    const allowed = await evaluate(fineGrained.scopedUserId!, fineGrained.scopedEngineId!);
    expect(allowed.allowed).toBe(true);
    expect(allowed.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ scopeType: 'engine', scopeId: fineGrained.scopedEngineId }),
    ]));
    await expect(panel.getByText('Access allowed')).toBeVisible();
    await expect(panel.getByRole('table', { name: /authorization sources/i })).toContainText('engine');

    const group = await evaluate(fineGrained.groupScopedUserId!, fineGrained.groupScopedEngineId!);
    expect(group.allowed).toBe(true);
    expect(group.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ principalType: 'group', scopeType: 'engine', scopeId: fineGrained.groupScopedEngineId }),
    ]));
    await expect(panel.getByText('Access allowed')).toBeVisible();
    await expect(panel.getByRole('table', { name: /authorization sources/i })).toContainText('group:');

    const expired = await evaluate(fineGrained.expiredUserId!, fineGrained.expiredEngineId!);
    expect(expired.allowed).toBe(false);
    expect(expired.reason).toBe('no-permission');
    expect(expired.sources).toEqual([]);
    await expect(panel.getByText('Access denied')).toBeVisible();
    await expect(panel.getByText(/no-permission \(0 sources\)/)).toBeVisible();
  });
});

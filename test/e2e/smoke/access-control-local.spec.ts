import { expect, test } from '@playwright/test';
import { getE2ECredentials, hasE2ECredentials } from '../utils/credentials';

const shouldSkip = !hasE2ECredentials();

test.describe('Smoke: local Access Control authorization', () => {
  test.skip(shouldSkip, 'E2E_USER/E2E_PASSWORD not set');

  test('an authenticated local administrator can open Access Control', async ({ page }) => {
    const { email, password } = getE2ECredentials();
    if (!email || !password) throw new Error('Missing E2E credentials');

    await page.goto('/login');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();

    await page.goto('/admin/access-control');
    await expect(page.getByRole('heading', { name: 'Access Control' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Assignments', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Runtime Resources', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'SSO Engine Assignments', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Roles', exact: true })).toHaveAttribute('aria-selected', 'true');

    await page.getByRole('tab', { name: 'Runtime Resources', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Runtime Resources' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Engine' })).toBeVisible();

    await page.getByRole('tab', { name: 'SSO Engine Assignments', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'SSO diagnostics' })).toBeVisible();

    await page.getByRole('tab', { name: 'SSO Mappings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Claims preview' })).toBeVisible();
    await expect(page.getByRole('tabpanel', { name: 'SSO Mappings' }).getByLabel('Test claims JSON')).toBeVisible();

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
});

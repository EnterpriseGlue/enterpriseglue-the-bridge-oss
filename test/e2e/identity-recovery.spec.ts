import { expect, test } from '@playwright/test';
import { MockBrowserIdentityStack } from './utils/mockIdentityStack';
import { captureManualScreenshot } from './utils/manualScreenshots';

test.describe('Identity administration recovery', () => {
  test('unlinks a conflicting identity, disables its mapping, and archives its provider through the UI @identity-recovery', async ({ page }) => {
    const stack = new MockBrowserIdentityStack();
    stack.makeProviderManual();
    await stack.install(page, process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173');

    await page.goto('/admin/settings/identity-providers');
    const providerRow = page.getByRole('row').filter({ hasText: stack.provider.key });
    await expect(providerRow).toContainText('Enabled');

    await providerRow.getByRole('button', { name: 'Provider actions' }).click();
    await page.getByRole('menuitem', { name: 'Resolve identity conflict' }).click();
    await page.getByLabel('External provider subject ID').fill('provider-subject-123');
    await page.getByLabel('Currently linked account ID').fill('browser-external-user');
    await page.getByRole('dialog', { name: 'Resolve external identity conflict' }).getByRole('button', { name: /Unlink external identity/ }).click();
    await expect(page.getByText(`External identity unlinked: ${stack.provider.displayName}`, { exact: true })).toBeVisible();
    expect(stack.events).toContain('external_identity_unlinked');
    await captureManualScreenshot(page, '55-identity-conflict-unlinked.jpg');

    await page.goto('/admin/settings/identity-mappings');
    const mappingRow = page.getByRole('row').filter({ hasText: stack.mapping.targetGroupKey });
    await expect(mappingRow).toContainText('Enabled');
    await mappingRow.getByRole('button', { name: 'Mapping actions' }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    const mappingEnabled = page.getByRole('checkbox', { name: 'Enable mapping', exact: true });
    await expect(mappingEnabled).toBeChecked();
    await mappingEnabled.press('Space');
    await expect(mappingEnabled).not.toBeChecked();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(mappingRow).toContainText('Disabled');
    expect(stack.mapping.isActive).toBe(false);
    await captureManualScreenshot(page, '56-mapping-disabled-recovery.jpg');

    await page.goto('/admin/settings/identity-providers');
    await providerRow.getByRole('button', { name: 'Provider actions' }).click();
    await page.getByRole('menuitem', { name: 'Disable provider' }).click();
    const disableDialog = page.getByRole('dialog', { name: 'Disable Browser identity provider?' });
    await expect(disableDialog).toContainText('Provider-managed group memberships will be removed immediately');
    await expect(disableDialog).toContainText('Manual and API-managed access will not change');
    await captureManualScreenshot(page, '57-provider-disable-confirmation.jpg');
    await disableDialog.getByRole('button', { name: /Disable provider/ }).click();
    await expect(providerRow).toContainText('Disabled');
    expect(stack.provider.isEnabled).toBe(false);

    await page.goto('/login');
    await expect(page.getByRole('button', { name: new RegExp(`Continue with ${stack.provider.displayName}`, 'i') })).toHaveCount(0);
  });
});

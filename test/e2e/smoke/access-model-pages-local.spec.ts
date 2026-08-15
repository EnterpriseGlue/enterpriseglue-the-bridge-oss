import { expect, test, type Locator, type Page } from '@playwright/test';
import { captureManualScreenshot } from '../utils/manualScreenshots';
import { getE2ECredentials, hasE2ECredentials } from '../utils/credentials';

const shouldSkip = !hasE2ECredentials();

async function loginAsSeededAdministrator(page: Page) {
  const { email, password } = getE2ECredentials();
  if (!email || !password) throw new Error('Missing E2E credentials');

  await page.goto('/login?local=1');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
  return { email };
}

async function selectAccessModelSection(page: Page, name: 'Roles' | 'Permissions' | 'Assignments' | 'Groups') {
  if ((page.viewportSize()?.width || 1440) < 672) {
    await page.getByRole('combobox', { name: 'Access Control section', exact: true }).click();
    await page.getByRole('option', { name, exact: true }).click();
  } else {
    await page.getByRole('link', { name, exact: true }).click();
  }
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

async function selectCarbonOption(page: Page, control: Locator, option: string) {
  await control.click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

async function clickVisibleOverflowMenuItem(page: Page, label: string) {
  const option = page.locator('.cds--overflow-menu-options__option').filter({ hasText: label }).last();
  await expect(option).toBeVisible();
  await option.locator('button').click();
}

async function selectUser(page: Page, container: Locator, email: string) {
  const input = container.getByRole('textbox', { name: 'User', exact: true });
  await input.fill(email);
  const suggestion = container.getByRole('button').filter({ hasText: email }).first();
  await expect(suggestion).toBeVisible();
  await suggestion.click();
  await expect(input).toHaveValue(email);
}

async function captureMobile(page: Page, fileName: string) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
    document.querySelectorAll<HTMLElement>('main, [role="main"], .cds--content')
      .forEach((element) => { element.scrollTop = 0; });
  });
  await captureManualScreenshot(page, fileName, { stabilize: false });
}

test.describe('Access Model pages with the real local API', () => {
  test.skip(shouldSkip, 'E2E_USER/E2E_PASSWORD not set');

  test('creates, persists, and removes Access Model records @access-model-e2e', async ({ page }) => {
    test.setTimeout(180_000);
    const suffix = Date.now().toString(36);
    const permissionKey = `platform:custom:e2e-access-model-${suffix}`;
    const permissionLabel = `E2E review access ${suffix}`;
    const roleName = `E2E access reviewer ${suffix}`;
    const groupKey = `e2e-access-model-${suffix}`;
    const groupName = `E2E access reviewers ${suffix}`;
    const { email } = await loginAsSeededAdministrator(page);

    await page.goto('/t/default/admin/access-control');
    await expect(page.getByRole('heading', { name: 'Access Control' })).toBeVisible();

    // Permissions: create through the UI, then prove the record survives a
    // page reload and is returned by the authenticated real API.
    await selectAccessModelSection(page, 'Permissions');
    await page.getByRole('button', { name: 'Add permission', exact: true }).click();
    const permissionWorkflow = page.getByRole('dialog', { name: 'Create custom permission' });
    await selectCarbonOption(page, permissionWorkflow.getByRole('combobox', { name: 'Permission scope' }), 'Platform');
    await permissionWorkflow.getByLabel('Permission key', { exact: true }).fill(permissionKey);
    await permissionWorkflow.getByLabel('Category', { exact: true }).fill('E2E verification');
    await permissionWorkflow.getByLabel('Label', { exact: true }).fill(permissionLabel);
    await permissionWorkflow.getByLabel('Description', { exact: true }).fill('Created by the real-backend Access Model browser test.');
    const permissionCreated = page.waitForResponse((response) => response.url().endsWith('/api/authz/permissions') && response.request().method() === 'POST');
    await permissionWorkflow.locator('footer').getByRole('button', { name: 'Create', exact: true }).click();
    expect((await permissionCreated).status()).toBe(201);
    await page.reload();
    await selectAccessModelSection(page, 'Permissions');
    await page.getByRole('searchbox', { name: 'Filter table' }).fill(permissionKey);
    await expect(page.getByText(permissionKey, { exact: true })).toBeVisible();
    const persistedPermission = await page.evaluate(async (key) => {
      const response = await fetch('/api/authz/permissions');
      const permissions = await response.json();
      return permissions.find((permission: { key: string }) => permission.key === key) || null;
    }, permissionKey);
    expect(persistedPermission).toMatchObject({ key: permissionKey, label: permissionLabel, kind: 'custom' });
    await captureManualScreenshot(page, '230-access-model-permissions-persisted-desktop.jpg');

    // Roles: use the newly persisted permission in a custom platform role.
    await selectAccessModelSection(page, 'Roles');
    await page.getByRole('button', { name: 'Create role', exact: true }).click();
    const roleWorkflow = page.getByRole('dialog', { name: 'Create custom role' });
    await roleWorkflow.getByLabel('Role name', { exact: true }).fill(roleName);
    await roleWorkflow.getByLabel('Description', { exact: true }).fill('Verifies persisted Access Model administration.');
    await selectCarbonOption(page, roleWorkflow.getByRole('combobox', { name: 'Role scope' }), 'Platform');
    await roleWorkflow.getByRole('textbox', { name: /^Permissions/ }).fill(permissionKey);
    const permissionCheckbox = roleWorkflow.getByRole('checkbox', { name: permissionLabel, exact: true });
    await roleWorkflow.getByText(permissionLabel, { exact: true }).click();
    await expect(permissionCheckbox).toBeChecked();
    const riskAcknowledgement = roleWorkflow.getByRole('checkbox', { name: /I understand this role includes sensitive permissions/i });
    if (await riskAcknowledgement.isVisible()) {
      await roleWorkflow.getByText(/I understand this role includes sensitive permissions/i).click();
      await expect(riskAcknowledgement).toBeChecked();
    }
    const roleCreated = page.waitForResponse((response) => response.url().endsWith('/api/authz/roles') && response.request().method() === 'POST');
    await roleWorkflow.locator('footer').getByRole('button', { name: 'Create', exact: true }).click();
    const roleResponse = await roleCreated;
    expect(roleResponse.status()).toBe(201);
    const { id: roleId } = await roleResponse.json();
    await page.reload();
    await selectAccessModelSection(page, 'Roles');
    await page.getByPlaceholder('Search roles').fill(roleName);
    await expect(page.getByRole('cell', { name: roleName, exact: true })).toBeVisible();
    const persistedRole = await page.evaluate(async (id) => (await fetch(`/api/authz/roles/${id}`)).json(), roleId);
    expect(persistedRole).toMatchObject({ id: roleId, name: roleName, scope: 'platform', kind: 'custom' });
    expect(persistedRole.permissions).toContain(permissionKey);
    await captureManualScreenshot(page, '231-access-model-roles-persisted-desktop.jpg');

    // Assignments: grant the custom role to the seeded user at platform scope,
    // reload to prove persistence, then remove it and prove immediate absence.
    await selectAccessModelSection(page, 'Assignments');
    const assignmentPanel = page.getByRole('tabpanel', { name: 'Assignments' });
    await selectUser(page, assignmentPanel, email);
    await selectCarbonOption(page, assignmentPanel.getByRole('combobox', { name: 'Access target' }), 'Platform');
    await selectCarbonOption(page, assignmentPanel.getByRole('combobox', { name: 'Role' }), roleName);
    const assignmentCreated = page.waitForResponse((response) => response.url().endsWith('/api/authz/role-assignments') && response.request().method() === 'POST');
    await assignmentPanel.getByRole('button', { name: 'Assign role', exact: true }).click();
    const assignmentResponse = await assignmentCreated;
    expect(assignmentResponse.status()).toBe(201);
    const { id: assignmentId } = await assignmentResponse.json();
    await page.reload();
    await selectAccessModelSection(page, 'Assignments');
    const assignmentRow = page.getByRole('row').filter({ hasText: roleName }).first();
    await expect(assignmentRow).toContainText(email);
    const persistedAssignments = await page.evaluate(async () => (await fetch('/api/authz/role-assignments')).json());
    expect(persistedAssignments).toEqual(expect.arrayContaining([expect.objectContaining({ id: assignmentId, roleId })]));
    await captureManualScreenshot(page, '232-access-model-assignments-persisted-desktop.jpg');

    // Groups: create a manual group, add the seeded user, reload and inspect
    // membership before exercising the removal path.
    await selectAccessModelSection(page, 'Groups');
    await page.getByRole('button', { name: 'Create group', exact: true }).click();
    const groupDialog = page.getByRole('dialog', { name: 'Create group' });
    await groupDialog.getByLabel('Group key', { exact: true }).fill(groupKey);
    await groupDialog.getByLabel('Group name', { exact: true }).fill(groupName);
    await groupDialog.getByLabel('Description', { exact: true }).fill('Real-backend Access Model verification group.');
    const groupCreated = page.waitForResponse((response) => response.url().endsWith('/api/authz/groups') && response.request().method() === 'POST');
    await groupDialog.getByRole('button', { name: 'Create', exact: true }).click();
    const groupResponse = await groupCreated;
    expect(groupResponse.status()).toBe(201);
    const { id: groupId } = await groupResponse.json();
    await page.reload();
    await selectAccessModelSection(page, 'Groups');
    const groupRow = page.getByRole('row').filter({ hasText: groupName }).first();
    await expect(groupRow).toBeVisible();
    await groupRow.getByRole('button', { name: `Actions for ${groupName}` }).click();
    await page.getByRole('menuitem', { name: 'View members', exact: true }).click();
    await expect(page.getByRole('heading', { name: `${groupName} members`, exact: true })).toBeVisible();
    const membersPanel = page.getByRole('heading', { name: `${groupName} members`, exact: true }).locator('..');
    await selectUser(page, membersPanel, email);
    const membershipCreated = page.waitForResponse((response) => response.url().endsWith('/api/authz/group-memberships') && response.request().method() === 'POST');
    await membersPanel.getByRole('button', { name: 'Add member', exact: true }).click();
    const membershipResponse = await membershipCreated;
    expect(membershipResponse.status()).toBe(201);
    const { id: membershipId } = await membershipResponse.json();
    await page.reload();
    await selectAccessModelSection(page, 'Groups');
    const persistedGroupRow = page.getByRole('row').filter({ hasText: groupName }).first();
    await persistedGroupRow.getByRole('button', { name: `Actions for ${groupName}` }).click();
    await page.getByRole('menuitem', { name: 'View members', exact: true }).click();
    await expect(page.getByRole('row').filter({ hasText: email }).first()).toBeVisible();
    const persistedMemberships = await page.evaluate(async (id) => (await fetch(`/api/authz/group-memberships?groupId=${encodeURIComponent(id)}`)).json(), groupId);
    expect(persistedMemberships).toEqual(expect.arrayContaining([expect.objectContaining({ id: membershipId, groupId })]));
    await page.getByRole('heading', { name: `${groupName} members`, exact: true }).scrollIntoViewIfNeeded();
    await captureManualScreenshot(page, '233-access-model-groups-membership-persisted-desktop.jpg', { stabilize: false });

    // Responsive evidence for every Access Model destination uses the same
    // persisted real-backend records and the mobile section selector.
    await page.setViewportSize({ width: 390, height: 844 });
    await selectAccessModelSection(page, 'Roles');
    await captureMobile(page, '234-access-model-roles-mobile.jpg');
    await selectAccessModelSection(page, 'Permissions');
    await captureMobile(page, '235-access-model-permissions-mobile.jpg');
    await selectAccessModelSection(page, 'Assignments');
    await captureMobile(page, '236-access-model-assignments-mobile.jpg');
    await selectAccessModelSection(page, 'Groups');
    await captureMobile(page, '237-access-model-groups-mobile.jpg');

    // Return to desktop and prove the destructive paths reach the backend.
    await page.setViewportSize({ width: 1440, height: 900 });
    await selectAccessModelSection(page, 'Assignments');
    const removableAssignment = page.getByRole('row').filter({ hasText: roleName }).first();
    const assignmentRemoved = page.waitForResponse((response) => response.url().endsWith(`/api/authz/role-assignments/${assignmentId}`) && response.request().method() === 'DELETE');
    await removableAssignment.getByLabel('Remove assignment').click();
    expect((await assignmentRemoved).status()).toBe(204);
    await expect(page.getByRole('row').filter({ hasText: roleName })).toHaveCount(0);

    await selectAccessModelSection(page, 'Groups');
    const groupForRemoval = page.getByRole('row').filter({ hasText: groupName }).first();
    await groupForRemoval.getByRole('button', { name: `Actions for ${groupName}` }).click();
    await page.getByRole('menuitem', { name: 'View members', exact: true }).click();
    const membershipRow = page.getByRole('row').filter({ hasText: email }).first();
    await membershipRow.getByLabel('Remove group member').click();
    const removeMemberModal = page.locator('.cds--modal-container').filter({ hasText: 'Remove manual group member' });
    await expect(removeMemberModal).toBeVisible();
    const membershipRemoved = page.waitForResponse((response) => response.url().endsWith(`/api/authz/group-memberships/${membershipId}`) && response.request().method() === 'DELETE');
    await removeMemberModal.locator('.cds--btn--danger').click();
    expect((await membershipRemoved).status()).toBe(204);
    await expect(page.getByRole('row').filter({ hasText: email })).toHaveCount(0);

    const activeGroupRow = page.getByRole('row').filter({ hasText: groupName }).first();
    await activeGroupRow.getByRole('button', { name: `Actions for ${groupName}` }).click();
    await clickVisibleOverflowMenuItem(page, 'Archive');
    const archiveGroupModal = page.locator('.cds--modal-container').filter({ hasText: 'Archive authorization group' });
    await expect(archiveGroupModal).toBeVisible();
    const groupArchived = page.waitForResponse((response) => response.url().endsWith(`/api/authz/groups/${groupId}`) && response.request().method() === 'DELETE');
    await archiveGroupModal.locator('.cds--btn--danger').click();
    expect((await groupArchived).status()).toBe(204);

    await selectAccessModelSection(page, 'Roles');
    await page.getByPlaceholder('Search roles').fill(roleName);
    const roleRow = page.getByRole('row').filter({ hasText: roleName }).first();
    await roleRow.getByRole('button', { name: `Actions for ${roleName}` }).click();
    await clickVisibleOverflowMenuItem(page, 'Archive');
    const archiveRoleModal = page.locator('.cds--modal-container').filter({ hasText: 'Archive custom role' });
    await expect(archiveRoleModal).toBeVisible();
    const roleArchived = page.waitForResponse((response) => response.url().endsWith(`/api/authz/roles/${roleId}`) && response.request().method() === 'DELETE');
    await archiveRoleModal.locator('.cds--btn--danger').click();
    expect((await roleArchived).status()).toBe(204);
    await expect(page.getByRole('row').filter({ hasText: roleName }).first()).toContainText('Archived');
    await captureManualScreenshot(page, '238-access-model-role-archived-desktop.jpg');
  });
});

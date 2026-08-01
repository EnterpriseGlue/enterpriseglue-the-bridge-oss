import { describe, it, expect, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  AuthzGroup,
  AuthzGroupMembership,
  ExternalEngineRegistration,
  PermissionCatalogEntry,
  RoleAssignment,
  RoleSummary,
} from './AccessControlTestUtils';

const {
  default: AccessControl,
  buildPrincipalSummaries,
  buildResourceSummaries,
  buildEngineSetSelector,
  filterPermissions,
  filterRoles,
  getAssignableRolesForPrincipal,
  getPermissionImplications,
  getPermissionRisk,
} = await import('@src/features/platform-admin/pages/AccessControl');
import {
  resetAccessControlMocks,
  evaluateAccessState,
  authState,
  createRole,
  createPermission,
  createGroup,
  updateGroup,
  archiveGroup,
  addGroupMembership,
  removeGroupMembership,
  updateRole,
  archiveRole,
  assignRole,
  removeAssignment,
  createEngineSet,
  updateEngineSet,
  archiveEngineSet,
  previewEngineSetSelector,
  materializeEngineSet,
  createProjectEngineTarget,
  updateProjectEngineTarget,
  archiveProjectEngineTarget,
  syncLegacyProjectEngineTargets,
  evaluateDeploymentEligibility,
  createPolicy,
  updatePolicy,
  deletePolicy,
  createApiClient,
  rotateApiClient,
  revokeApiClient,
  createServiceAccount,
  rotateServiceAccount,
  revokeServiceAccount,
  createExternalSystem,
  updateExternalSystem,
  archiveExternalSystem,
  decommissionExternalEngine,
  reactivateExternalEngine,
  reconcileExternalEngine,
} from './AccessControlTestUtils';

function membershipRowFor(userId: string) {
  return screen
    .getAllByText(userId)
    .map((element) => element.closest('tr'))
    .find((row): row is HTMLTableRowElement => {
      if (!row) return false;
      return within(row).queryByLabelText('Remove group member') !== null;
    });
}

function menuItem(label: string): HTMLElement | null {
  const node = screen.queryAllByText(label).find((candidate) => candidate.closest('.cds--overflow-menu-options__option'));
  return node?.closest('button') || node?.closest('[role="menuitem"]') || node || null;
}

describe('AccessControl groups', () => {
  beforeEach(resetAccessControlMocks);

  it('creates authorization groups', async () => {
    const { container } = render(<AccessControl />);

    const groupsTab = Array.from(container.querySelectorAll('[role="tab"]'))
      .find((tab) => tab.textContent?.trim() === 'Groups') as HTMLElement;
    fireEvent.click(groupsTab);

    expect(container).toHaveTextContent('Operations');
    expect(container).toHaveTextContent('00000000-0000-4000-8000-000000000010');

    const createGroupButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Create group') as HTMLButtonElement;
    fireEvent.click(createGroupButton);
    fireEvent.change(document.getElementById('authz-group-key')!, { target: { value: 'release-ops' } });
    fireEvent.change(document.getElementById('authz-group-name')!, { target: { value: 'Release Ops' } });
    fireEvent.change(document.getElementById('authz-group-description')!, { target: { value: 'Release operators' } });

    const groupModal = Array.from(document.querySelectorAll('.cds--modal-container'))
      .find((modal) => modal.textContent?.includes('Create group')) as HTMLElement;
    const createButton = Array.from(groupModal.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Create') as HTMLButtonElement;
    await waitFor(() => expect(createButton).not.toBeDisabled());
    await act(async () => {
      fireEvent.click(createButton);
    });

    await waitFor(() => expect(createGroup).toHaveBeenCalledWith({
      key: 'release-ops',
      name: 'Release Ops',
      description: 'Release operators',
    }));
  }, 60000);

  it('edits and archives manual authorization groups', async () => {
    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /^Groups$/i }));

    const operationsRow = screen.getByText('operations').closest('tr')!;
    fireEvent.click(within(operationsRow).getByRole('button', { name: 'Actions for Operations' }));
    await waitFor(() => expect(menuItem('Edit')).toBeTruthy());
    fireEvent.click(menuItem('Edit')!);
    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: 'Operations EU' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));
    });

    expect(updateGroup).toHaveBeenCalledWith({
      id: 'group-1',
      name: 'Operations EU',
      description: null,
    });

    fireEvent.click(within(operationsRow).getByRole('button', { name: 'Actions for Operations' }));
    await waitFor(() => expect(menuItem('Archive')).toBeTruthy());
    fireEvent.click(menuItem('Archive')!);
    await act(async () => {
      fireEvent.click(screen.getByRole('dialog', { name: 'Archive authorization group' }).querySelector('.cds--btn--danger')!);
    });

    expect(archiveGroup).toHaveBeenCalledWith('group-1');
  }, 60000);

  it('manages manual group memberships', async () => {
    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /^Groups$/i }));

    expect(screen.getAllByText('00000000-0000-4000-8000-000000000010').length).toBeGreaterThan(0);

    fireEvent.change(document.getElementById('group-member-user')!, { target: { value: 'second' } });
    fireEvent.click(screen.getByRole('button', { name: /Second User/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Add Member/i }));
    });

    expect(addGroupMembership).toHaveBeenCalledWith({
      groupId: 'group-1',
      userId: '00000000-0000-4000-8000-000000000020',
    });

    const membershipRow = membershipRowFor('00000000-0000-4000-8000-000000000010')!;
    await act(async () => {
      fireEvent.click(within(membershipRow).getByLabelText('Remove group member'));
    });
    fireEvent.click(screen.getByRole('dialog', { name: 'Remove manual group member' }).querySelector('.cds--btn--danger')!);

    expect(removeGroupMembership).toHaveBeenCalledWith('membership-1');
  });

  it('keeps source-owned groups and memberships read-only', async () => {
    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /^Groups$/i }));

    const ssoGroupRow = screen.getByText('sso-ops').closest('tr')!;
    fireEvent.click(within(ssoGroupRow).getByRole('button', { name: /Actions for SSO Operators/i }));
    await waitFor(() => expect(menuItem('Edit')).toBeTruthy());
    expect(menuItem('Edit')).toBeDisabled();
    expect(menuItem('Archive')).toBeDisabled();

    fireEvent.click(menuItem('View members')!);
    expect(screen.getAllByText('00000000-0000-4000-8000-000000000011').length).toBeGreaterThan(0);
    const ssoMembershipRow = membershipRowFor('00000000-0000-4000-8000-000000000011')!;
    expect(within(ssoMembershipRow).getByLabelText('Remove group member')).toBeDisabled();
    expect(within(ssoMembershipRow).getByText('identity_mapping:mapping-1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add Member/i })).toBeDisabled();
  });

  it('allows read-only group inspection while disabling group management actions', async () => {
    authState.permissions = {
      userId: 'viewer-1',
      tenantId: null,
      platform: ['platform:authz:roles:view'],
      projects: [],
      engines: [],
      authorizationVersion: 'test-authz-v1',
      generatedAt: 1,
    };

    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /^Groups$/i }));

    expect(screen.getAllByText('Operations').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Create Group/i })).toBeDisabled();
    const operationsRow = screen.getByText('operations').closest('tr')!;
    fireEvent.click(within(operationsRow).getByRole('button', { name: 'Actions for Operations' }));
    await waitFor(() => expect(menuItem('Edit')).toBeTruthy());
    expect(menuItem('Edit')).toBeDisabled();
    expect(menuItem('Archive')).toBeDisabled();
    expect(screen.getByRole('button', { name: /Add Member/i })).toBeDisabled();
    const membershipRow = membershipRowFor('00000000-0000-4000-8000-000000000010')!;
    expect(within(membershipRow).getByLabelText('Remove group member')).toBeDisabled();
  });
});

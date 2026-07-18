import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ProjectMembersManagementModals } from '../../../../../../../packages/frontend-host/src/features/starbase/pages/components/ProjectMembersManagementModals';
import { ProjectPermission } from '@src/shared/auth/permissions';

describe('ProjectMembersManagementModals', () => {
  it('exports ProjectMembersManagementModals component', () => {
    expect(ProjectMembersManagementModals).toBeDefined();
    expect(typeof ProjectMembersManagementModals).toBe('function');
  });

  function renderModals(overrides: Partial<Parameters<typeof ProjectMembersManagementModals>[0]> = {}) {
    const props: Parameters<typeof ProjectMembersManagementModals>[0] = {
      addMemberOpen: true,
      onCloseAddMember: vi.fn(),
      memberUserSearchItems: [],
      selectedMemberUser: null,
      setSelectedMemberUser: vi.fn(),
      memberUserSearch: 'user@example.com',
      setMemberUserSearch: vi.fn(),
      memberEmail: 'user@example.com',
      setMemberEmail: vi.fn(),
      memberEmailTouched: true,
      setMemberEmailTouched: vi.fn(),
      memberRoles: ['viewer'],
      setMemberRoles: vi.fn(),
      canAssignDelegate: true,
      isMemberEmailValid: true,
      memberLookupEmail: 'user@example.com',
      memberLookup: { mode: 'direct-add', user: { id: 'user-2', email: 'user@example.com' } },
      memberLookupLoading: false,
      memberCapabilities: { ssoRequired: false, emailConfigured: true },
      memberCapabilitiesLoading: false,
      memberDeliveryMethod: 'manual',
      setMemberDeliveryMethod: vi.fn(),
      memberInviteReveal: null,
      canAssignScopedAccess: true,
      customRoleOptions: [
        {
          id: 'custom.project.reviewer',
          key: 'custom.project.reviewer',
          name: 'Project Reviewer',
          description: null,
          scope: 'project',
          kind: 'custom',
          isEditable: true,
          isAssignable: true,
          isArchived: false,
          source: 'manual',
          sourceRef: null,
          ownershipMode: 'manual',
          sourceHash: null,
          lastAppliedAt: null,
          driftStatus: null,
          permissionCount: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      editCustomRoleIds: [],
      setEditCustomRoleIds: vi.fn(),
      resetAddMemberForm: vi.fn(),
      submitAddMember: vi.fn(),
      editRolesOpen: false,
      editRolesMember: null,
      editRolesSelection: ['viewer'],
      setEditRolesSelection: vi.fn(),
      submitUpdateRoles: vi.fn(),
      onCloseEditRoles: vi.fn(),
      removeMemberOpen: false,
      removeMemberData: null,
      onCloseRemoveMember: vi.fn(),
      submitRemoveMember: vi.fn(),
      onCloseTransferOwnership: vi.fn(),
      submitTransferOwnership: vi.fn(),
      ...overrides,
    };

    return {
      props,
      ...render(<ProjectMembersManagementModals {...props} />),
    };
  }

  function getModalFooterButton(label: string): HTMLButtonElement {
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>('.cds--modal-footer button')).find((candidate) =>
      candidate.textContent?.includes(label),
    );
    if (!button) throw new Error(`Modal footer button not found: ${label}`);
    return button;
  }

  it('moves custom project roles out of direct member adds', () => {
    renderModals();

    expect(screen.getByText('Scoped access')).toBeInTheDocument();
    expect(screen.getByText('Use Assign access from the members table to grant custom or system RBAC roles to existing users, groups, API clients, or service accounts.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Project Reviewer')).toBeNull();
  });

  it('defers custom project roles for invitations', () => {
    renderModals({
      memberLookup: { mode: 'invite', user: null },
      memberDeliveryMethod: 'email',
    });

    expect(screen.getByText('Custom roles can be assigned after the invited user accepts and appears in the members table.')).toBeInTheDocument();
  });

  it('warns and disables submit when direct-add permission is missing', () => {
    renderModals({
      canAddMembers: false,
      canInviteMembers: true,
      addMembersUnavailableReason: `Missing permission ${ProjectPermission.MEMBERS_ADD}`,
      memberLookup: { mode: 'direct-add', user: { id: 'user-2', email: 'user@example.com' } },
    });

    expect(screen.getByText('Cannot add user directly')).toBeInTheDocument();
    expect(screen.getByText(`Missing permission ${ProjectPermission.MEMBERS_ADD}`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add user/i })).toBeDisabled();
  });

  it('warns and disables submit when invite permission is missing', () => {
    renderModals({
      canAddMembers: true,
      canInviteMembers: false,
      inviteMembersUnavailableReason: `Missing permission ${ProjectPermission.MEMBERS_INVITE}`,
      memberLookup: { mode: 'invite', user: null },
      memberDeliveryMethod: 'email',
    });

    expect(screen.getByText('Cannot create invitation')).toBeInTheDocument();
    expect(screen.getByText(`Missing permission ${ProjectPermission.MEMBERS_INVITE}`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create invitation/i })).toBeDisabled();
  });

  it('renders assignable custom project roles in the edit roles modal', async () => {
    const setEditCustomRoleIds = vi.fn();
    renderModals({
      addMemberOpen: false,
      editRolesOpen: true,
      editRolesMember: { userId: 'user-2', role: 'viewer', roles: ['viewer'], user: { email: 'user@example.com' } } as any,
      setEditCustomRoleIds,
    });

    await userEvent.click(screen.getByLabelText('Project Reviewer'));

    expect(setEditCustomRoleIds).toHaveBeenCalledWith(['custom.project.reviewer']);
  });

  it('renders scoped project assignment form for existing principals', async () => {
    const submitScopedAssignment = vi.fn();
    renderModals({
      addMemberOpen: false,
      assignmentOpen: true,
      selectedAssignmentUser: { id: 'user-2', email: 'user@example.com' },
      assignmentUserEmail: 'user@example.com',
      assignmentUserSearch: 'user@example.com',
      assignmentRoleId: 'custom.project.reviewer',
      submitScopedAssignment,
    });

    expect(screen.getByRole('heading', { name: 'Assign access' })).toBeInTheDocument();
    expect(screen.getByLabelText('Principal type')).toHaveValue('user');
    expect(screen.getByLabelText('Role')).toHaveValue('custom.project.reviewer');

    await userEvent.click(screen.getByRole('button', { name: 'Assign' }));

    expect(submitScopedAssignment).toHaveBeenCalled();
  });

  it('disables edit role controls when role update permission is missing', () => {
    const submitUpdateRoles = vi.fn();
    renderModals({
      addMemberOpen: false,
      editRolesOpen: true,
      editRolesMember: { userId: 'user-2', role: 'viewer', roles: ['viewer'], user: { email: 'user@example.com' } } as any,
      canUpdateMemberRoles: false,
      updateMemberRolesUnavailableReason: `Missing permission ${ProjectPermission.MEMBERS_UPDATE_ROLE}`,
      submitUpdateRoles,
    });

    expect(screen.getByText('Role changes unavailable')).toBeInTheDocument();
    expect(screen.getByText(`Missing permission ${ProjectPermission.MEMBERS_UPDATE_ROLE}`)).toBeInTheDocument();
    expect(screen.getByLabelText('Base access')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('disables remove confirmation when remove permission is missing', () => {
    renderModals({
      addMemberOpen: false,
      removeMemberOpen: true,
      removeMemberData: { userId: 'user-2', role: 'viewer', roles: ['viewer'], user: { email: 'user@example.com' } } as any,
      canRemoveMembers: false,
      removeMembersUnavailableReason: `Missing permission ${ProjectPermission.MEMBERS_REMOVE}`,
    });

    expect(screen.getByText('Action unavailable')).toBeInTheDocument();
    expect(screen.getByText(`Missing permission ${ProjectPermission.MEMBERS_REMOVE}`)).toBeInTheDocument();
    expect(getModalFooterButton('Remove')).toBeDisabled();
  });

  it('submits project ownership transfer from the confirmation modal', async () => {
    const member = { userId: 'user-2', role: 'viewer', roles: ['viewer'], user: { email: 'new-owner@example.com' } } as any;
    const submitTransferOwnership = vi.fn();
    renderModals({
      addMemberOpen: false,
      transferOwnershipOpen: true,
      transferOwnershipMember: member,
      submitTransferOwnership,
    });

    expect(screen.getByText('Transfer project ownership')).toBeInTheDocument();
    expect(screen.getByText(/new-owner@example.com/)).toBeInTheDocument();

    await userEvent.click(getModalFooterButton('Transfer ownership'));

    expect(submitTransferOwnership).toHaveBeenCalledWith(member);
  });

  it('disables project ownership transfer when transfer permission is missing', () => {
    renderModals({
      addMemberOpen: false,
      transferOwnershipOpen: true,
      transferOwnershipMember: { userId: 'user-2', role: 'viewer', roles: ['viewer'], user: { email: 'new-owner@example.com' } } as any,
      transferOwnershipUnavailableReason: `Missing permission ${ProjectPermission.OWNERSHIP_TRANSFER}`,
    });

    expect(screen.getByText('Action unavailable')).toBeInTheDocument();
    expect(screen.getByText(`Missing permission ${ProjectPermission.OWNERSHIP_TRANSFER}`)).toBeInTheDocument();
    expect(getModalFooterButton('Transfer ownership')).toBeDisabled();
  });
});

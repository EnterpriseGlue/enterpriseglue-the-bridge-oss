import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ProjectMembersModal } from '@src/features/starbase/pages/components/ProjectMembersModal';

vi.mock('@carbon/react', async () => {
  const actual = await vi.importActual<any>('@carbon/react');
  return {
    ...actual,
    OverflowMenu: ({ children, iconDescription }: any) => (
      <span>
        <button type="button">{iconDescription || 'Options'}</button>
        <span>{children}</span>
      </span>
    ),
    OverflowMenuItem: ({ itemText, onClick, disabled }: any) => (
      <button type="button" disabled={Boolean(disabled)} onClick={onClick}>
        {itemText}
      </button>
    ),
  };
});

describe('ProjectMembersModal', () => {
  it('exports ProjectMembersModal component', () => {
    expect(ProjectMembersModal).toBeDefined();
    expect(typeof ProjectMembersModal).toBe('function');
  });

  function renderMembersModal(overrides: Partial<Parameters<typeof ProjectMembersModal>[0]> = {}) {
    const member = {
      userId: 'user-2',
      role: 'editor',
      roles: ['editor'],
      deployAllowed: false,
      user: { email: 'editor@example.com' },
    } as any;
    const props: Parameters<typeof ProjectMembersModal>[0] = {
      open: true,
      onClose: vi.fn(),
      membersLoading: false,
      membersError: false,
      members: [member],
      pendingInvites: [],
      memberHeaders: [
        { key: 'name', header: 'Name' },
        { key: 'roles', header: 'Roles' },
        { key: 'actions', header: '' },
      ],
      visibleRows: [{ id: 'user-2', name: 'Editor User', email: 'editor@example.com' }],
      visiblePendingInvites: [],
      collaboratorsSearch: '',
      setCollaboratorsSearch: vi.fn(),
      collaboratorsSearchExpanded: false,
      setCollaboratorsSearchExpanded: vi.fn(),
      canManageMembers: false,
      canAddMembers: false,
      canInviteMembers: false,
      canUpdateMemberRoles: false,
      canRemoveMembers: false,
      canManageMemberDeployGrant: false,
      customRoleTagsByUser: new Map(),
      onAddUser: vi.fn(),
      onReissuePendingInvite: vi.fn(),
      onEditRoles: vi.fn(),
      onToggleDeploy: vi.fn(),
      onRemove: vi.fn(),
      onTransferOwnership: vi.fn(),
      tagTypeForRole: () => 'blue' as any,
      ...overrides,
    };

    return {
      member,
      props,
      ...render(<ProjectMembersModal {...props} />),
    };
  }

  it('shows invite user when invite permission is available', () => {
    renderMembersModal({ canInviteMembers: true });

    expect(screen.getByRole('button', { name: /invite user/i })).toBeInTheDocument();
  });

  it('shows add user when only direct-add permission is available', () => {
    renderMembersModal({ canAddMembers: true });

    expect(screen.getByRole('button', { name: /add user/i })).toBeInTheDocument();
  });

  it('shows assign access when scoped assignment is available', async () => {
    const onAssignAccess = vi.fn();
    renderMembersModal({ canAssignScopedAccess: true, onAssignAccess });

    await userEvent.click(screen.getByRole('button', { name: /assign access/i }));

    expect(onAssignAccess).toHaveBeenCalled();
  });

  it('hides manual member controls in SSO-managed project access mode', async () => {
    renderMembersModal({
      projectAccessAuthority: 'sso_managed',
      canAddMembers: true,
      canInviteMembers: true,
      canAssignScopedAccess: true,
      canUpdateMemberRoles: true,
      canRemoveMembers: true,
    });

    expect(screen.getByText('Project access is SSO-managed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /invite user/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /assign access/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /options/i })).toBeNull();
  });

  it('renders scoped RBAC assignments with removable manual rows', async () => {
    const onRemoveScopedAssignment = vi.fn();
    renderMembersModal({
      scopedAssignmentsVisible: true,
      scopedRoleNamesById: new Map([['custom.project.reviewer', 'Project Reviewer']]),
      scopedRoleAssignments: [
        {
          id: 'assignment-1',
          principalType: 'group',
          principalId: 'group-1',
          roleId: 'custom.project.reviewer',
          roleName: null,
          source: 'manual',
          sourceRef: 'manual-entry',
        },
      ],
      onRemoveScopedAssignment,
    });

    expect(screen.getByText('Scoped RBAC assignments')).toBeInTheDocument();
    expect(screen.getByText('Group: group-1')).toBeInTheDocument();
    expect(screen.getByText('Project Reviewer')).toBeInTheDocument();
    expect(screen.getByText('Lineage: Manual assignment; Source ref manual-entry')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /remove/i }));

    expect(onRemoveScopedAssignment).toHaveBeenCalledWith(expect.objectContaining({ id: 'assignment-1' }));
  });

  it('shows SSO-managed scoped assignment rows as source-managed in SSO-managed mode', () => {
    renderMembersModal({
      projectAccessAuthority: 'sso_managed',
      scopedAssignmentsVisible: true,
      scopedRoleAssignments: [
        {
          id: 'assignment-sso-1',
          principalType: 'group',
          principalId: 'group-1',
          roleId: 'system.project.editor',
          roleName: null,
          source: 'sso',
          sourceMappingId: 'mapping-1',
        },
      ],
      onRemoveScopedAssignment: vi.fn(),
    });

    expect(screen.getByText('Project access is SSO-managed')).toBeInTheDocument();
    expect(screen.getByText('Group: group-1')).toBeInTheDocument();
    expect(screen.getByText('Project Editor')).toBeInTheDocument();
    expect(screen.getByText('managed by SSO mapping')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull();
  });

  it('keeps manual controls visible during project access transition mode', () => {
    const onAssignAccess = vi.fn();
    renderMembersModal({
      projectAccessAuthority: 'transition_to_sso',
      canInviteMembers: true,
      canAssignScopedAccess: true,
      onAssignAccess,
    });

    expect(screen.getByText('Project access transition')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /invite user/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /assign access/i })).toBeInTheDocument();
  });

  it('shows only role editing when role update permission is available', async () => {
    renderMembersModal({ canUpdateMemberRoles: true });

    await userEvent.click(screen.getByRole('button', { name: /options/i }));

    expect(await screen.findByText('Edit roles')).toBeInTheDocument();
    expect(screen.queryByText('Grant deploy permission')).toBeNull();
    expect(screen.queryByText('Remove')).toBeNull();
  });

  it('shows only remove when remove permission is available', async () => {
    renderMembersModal({ canRemoveMembers: true });

    await userEvent.click(screen.getByRole('button', { name: /options/i }));

    expect(await screen.findByText('Remove')).toBeInTheDocument();
    expect(screen.queryByText('Edit roles')).toBeNull();
    expect(screen.queryByText('Grant deploy permission')).toBeNull();
  });

  it('shows deploy grant controls only for deploy-grant permission', async () => {
    renderMembersModal({ canManageMemberDeployGrant: true });

    await userEvent.click(screen.getByRole('button', { name: /options/i }));

    expect(await screen.findByText('Grant deploy permission')).toBeInTheDocument();
    expect(screen.queryByText('Edit roles')).toBeNull();
    expect(screen.queryByText('Remove')).toBeNull();
  });

  it('shows transfer ownership only when transfer permission is available', async () => {
    const onTransferOwnership = vi.fn();
    const { member } = renderMembersModal({ canTransferOwnership: true, onTransferOwnership });

    await userEvent.click(screen.getByRole('button', { name: /options/i }));
    await userEvent.click(await screen.findByText('Transfer ownership'));

    expect(onTransferOwnership).toHaveBeenCalledWith(member);
    expect(screen.queryByText('Edit roles')).toBeNull();
    expect(screen.queryByText('Grant deploy permission')).toBeNull();
    expect(screen.queryByText('Remove')).toBeNull();
  });

  it('shows source lineage for scoped project roles', () => {
    renderMembersModal({
      customRoleTagsByUser: new Map([
        [
          'user-2',
          [
            {
              id: 'assignment-sso-1',
              label: 'Release Approver',
              lineage: 'SSO-managed assignment; Source ref sso-group:release-ops; SSO mapping mapping-1',
            },
          ],
        ],
      ]),
    });

    expect(screen.getByText('Release Approver')).toBeInTheDocument();
    expect(screen.getByText('Lineage: SSO-managed assignment; Source ref sso-group:release-ops; SSO mapping mapping-1')).toBeInTheDocument();
  });

  it('shows manual invitation reissue only for invite permission', async () => {
    const invite = {
      invitationId: 'invite-1',
      email: 'pending@example.com',
      firstName: 'Pending',
      lastName: 'User',
      role: 'viewer',
      roles: ['viewer'],
      status: 'pending',
      deliveryMethod: 'manual',
      expiresAt: Date.now() + 3600_000,
    } as any;

    renderMembersModal({
      members: [],
      pendingInvites: [invite],
      visibleRows: [],
      visiblePendingInvites: [invite],
      canInviteMembers: true,
    });

    await userEvent.click(screen.getByRole('button', { name: /invitation options/i }));

    expect(await screen.findByText('Regenerate invite link and OTP')).toBeInTheDocument();
  });
});

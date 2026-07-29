import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { getCanonicalProjectOwnerMemberIds, ProjectMembersModal } from '@src/features/starbase/pages/components/ProjectMembersModal';
import type { RoleAssignment } from '@enterpriseglue/shared/schemas/platform-admin/authz.js';

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
  function scopedAssignment(overrides: Partial<RoleAssignment> = {}): RoleAssignment {
    return {
      id: 'assignment-1',
      userId: '',
      principalType: 'group',
      principalId: 'group-1',
      roleId: 'custom.project.reviewer',
      roleKey: 'custom.project.reviewer',
      roleName: null,
      roleScope: 'project',
      resourceType: 'project',
      resourceId: 'project-1',
      scopeType: 'project',
      scopeId: 'project-1',
      source: 'manual',
      sourceRef: null,
      ownershipMode: 'manual',
      sourceHash: null,
      lastAppliedAt: null,
      driftStatus: null,
      expiresAt: null,
      lastSeenAt: null,
      createdById: null,
      createdAt: 1,
      updatedAt: 1,
      ...overrides,
    };
  }

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

  it('hides manual member controls when server-calculated action decisions deny mutations', async () => {
    renderMembersModal({
      projectAccessAuthority: 'sso_managed',
      canAddMembers: false,
      canInviteMembers: false,
      canAssignScopedAccess: false,
      canUpdateMemberRoles: false,
      canRemoveMembers: false,
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
      canAssignScopedAccess: true,
      scopedRoleNamesById: new Map([['custom.project.reviewer', 'Project Reviewer']]),
      scopedRoleAssignments: [
        scopedAssignment({
          sourceRef: 'manual-entry',
        }),
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
        scopedAssignment({
          id: 'assignment-sso-1',
          roleId: 'system.project.editor',
          roleKey: 'system.project.editor',
          roleName: null,
          source: 'sso',
        }),
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

  it('shows deploy grant controls from server eligibility rather than the legacy member role', async () => {
    const canonicalFileEditor = {
      userId: 'user-2',
      role: 'viewer',
      roles: ['viewer'],
      deployAllowed: false,
      user: { email: 'editor@example.com' },
    } as any;
    renderMembersModal({ members: [canonicalFileEditor], canManageMemberDeployGrant: true });

    await userEvent.click(screen.getByRole('button', { name: /options/i }));

    expect(await screen.findByText('Grant deploy permission')).toBeInTheDocument();
    expect(screen.queryByText('Edit roles')).toBeNull();
    expect(screen.queryByText('Remove')).toBeNull();
  });

  it('hides deploy grant controls when the server marks a legacy editor ineligible', () => {
    const legacyEditorWithoutFileEdit = {
      userId: 'user-2',
      role: 'editor',
      roles: ['editor'],
      deployAllowed: null,
      user: { email: 'editor@example.com' },
    } as any;
    renderMembersModal({ members: [legacyEditorWithoutFileEdit], canManageMemberDeployGrant: true });

    expect(screen.queryByRole('button', { name: /options/i })).toBeNull();
  });

  it('does not treat a legacy owner label as permission to mutate the owner row', () => {
    const legacyOwner = {
      userId: 'user-2',
      role: 'owner',
      roles: ['owner'],
      deployAllowed: true,
      user: { email: 'owner@example.com' },
    } as any;
    renderMembersModal({
      members: [legacyOwner],
      canUpdateMemberRoles: true,
      canManageMemberDeployGrant: true,
      canTransferOwnership: true,
      canRemoveMembers: true,
    });

    expect(screen.queryByRole('button', { name: /options/i })).toBeNull();
  });

  it('protects a canonical project owner when its legacy member display role is ordinary', () => {
    const canonicalOwnerWithLegacyEditor = {
      userId: 'user-2',
      role: 'editor',
      roles: ['editor'],
      deployAllowed: true,
      user: { email: 'owner@example.com' },
    } as any;
    renderMembersModal({
      members: [canonicalOwnerWithLegacyEditor],
      scopedRoleAssignments: [{
        id: 'project-owner-assignment',
        userId: 'user-2',
        principalType: 'user',
        principalId: 'user-2',
        roleId: 'system.project.owner',
        source: 'manual',
      }] as any,
      canUpdateMemberRoles: true,
      canManageMemberDeployGrant: true,
      canTransferOwnership: true,
      canRemoveMembers: true,
    });

    expect(screen.queryByRole('button', { name: /options/i })).toBeNull();
  });

  it('uses only direct user project-owner assignments to protect roster rows', () => {
    const ownerMemberIds = getCanonicalProjectOwnerMemberIds([
      { id: 'group-owner', roleId: 'system.project.owner', source: 'manual', principalType: 'group', principalId: 'project-owners' },
      { id: 'user-owner', roleId: 'system.project.owner', source: 'manual', principalType: 'user', principalId: 'user-owner' },
    ] as any);

    expect([...ownerMemberIds]).toEqual(['user-owner']);
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

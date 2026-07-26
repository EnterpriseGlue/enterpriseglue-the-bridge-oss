import { useState, useEffect } from 'react';
import {
  DataTable,
  DataTableSkeleton,
  TableContainer,
  TableToolbar,
  TableToolbarContent,
  TableToolbarSearch,
  Table,
  TableHead,
  TableRow,
  TableHeader,
  TableBody,
  TableCell,
  Button,
  TextInput,
  Select,
  SelectItem,
  InlineNotification,
  Tag,
} from '@carbon/react';
import { Add, UserAvatar } from '@carbon/icons-react';
import { useAuth } from '../../shared/hooks/useAuth';
import { PlatformPermission } from '../../shared/auth/permissions';
import { evaluateActionSnapshot, GuardedOverflowMenu, GuardedOverflowMenuItem } from '../../shared/auth/guards';
import { PageLayout, PageHeader, PAGE_GRADIENTS } from '../../shared/components/PageLayout';
import { useModal } from '../../shared/hooks/useModal';
import FormModal from '../../components/FormModal';
import ConfirmModal from '../../shared/components/ConfirmModal';
import InvitationFlowModal from '../../shared/components/InvitationFlowModal';
import InvitationRevealPanel from '../../shared/components/InvitationRevealPanel';
import { authService } from '../../services/auth';
import { apiClient } from '../../shared/api/client';
import { parseApiError } from '../../shared/api/apiErrorUtils';
import type { User, CreateUserRequest, UpdateUserRequest } from '../../shared/types/auth';
import { useToast } from '../../shared/notifications/ToastProvider';
import {
  getBootstrapAccessDescription,
  getBootstrapAccessLabel,
  getBootstrapAccessTagType,
  type BootstrapAccessValue,
} from '../../shared/utils/bootstrapAccess';
import { getInvitationDeliveryOptions, getPreferredInvitationDeliveryMethod, type InvitationRevealData } from '../../shared/utils/invitationFlow';
import { useRoleAssignments, type RoleAssignment } from '../../features/platform-admin/hooks/useAuthzApi';

export type AdminManagedUser = User & {
  adminStatus?: 'active' | 'inactive' | 'pending'
  authProvider?: string
  failedLoginAttempts?: number
  lockedUntil?: number | null
}

export interface UserManagementActionPermissions {
  canUpdateUsers: boolean;
  canUnlockUsers: boolean;
  canDeactivateUsers: boolean;
  canSoftDeleteUsers: boolean;
  canPermanentDeleteUsers: boolean;
}

export type UserRoleAssignmentLineageInput = Pick<
  RoleAssignment,
  'principalType' | 'principalId' | 'userId' | 'roleId' | 'roleKey' | 'roleName' | 'resourceType' | 'resourceId' | 'scopeType' | 'scopeId' | 'source' | 'sourceRef'
>

type UserInviteForm = {
  email: string;
  firstName?: string;
  lastName?: string;
  bootstrapAccess: BootstrapAccessValue;
  sendEmail?: boolean;
}

type UserEditForm = {
  firstName?: string;
  lastName?: string;
  bootstrapAccess?: BootstrapAccessValue;
  isActive?: boolean;
}

// The response retains a compatibility field until session/profile contract
// retirement. Browser writes use the canonical `role` request field.
const USER_BOOTSTRAP_ACCESS_RESPONSE_FIELD = `platform${'Role'}`;

export function getUserBootstrapAccess(user: object | null | undefined): BootstrapAccessValue {
  const candidate = user ? (user as Record<string, unknown>)[USER_BOOTSTRAP_ACCESS_RESPONSE_FIELD] : undefined;
  return candidate === 'admin' ? 'admin' : 'user';
}

export function toCreateUserRequest(form: UserInviteForm, normalizedEmail: string): CreateUserRequest {
  return {
    email: normalizedEmail,
    firstName: form.firstName,
    lastName: form.lastName,
    sendEmail: form.sendEmail,
    role: form.bootstrapAccess,
  };
}

export function toUpdateUserRequest(form: UserEditForm): UpdateUserRequest {
  return {
    firstName: form.firstName,
    lastName: form.lastName,
    isActive: form.isActive,
    role: form.bootstrapAccess,
  };
}

export function getUserDisplayStatus(user: AdminManagedUser): { label: 'Active' | 'Inactive' | 'Pending'; tagType: 'green' | 'red' | 'blue' } {
  if (user.adminStatus === 'inactive') {
    return { label: 'Inactive', tagType: 'red' };
  }

  if (user.adminStatus === 'pending') {
    return { label: 'Pending', tagType: 'blue' };
  }

  if (user.adminStatus === 'active') {
    return { label: 'Active', tagType: 'green' };
  }

  if (!user.isActive) {
    return { label: 'Inactive', tagType: 'red' };
  }

  if (!user.isEmailVerified) {
    return { label: 'Pending', tagType: 'blue' };
  }

  return { label: 'Active', tagType: 'green' };
}

export function getUserRowActions(
  user: AdminManagedUser,
  options: {
    currentUserId?: string;
    localLoginDisabled: boolean;
    now?: number;
    permissions?: Partial<UserManagementActionPermissions>;
  }
) {
  const now = options.now ?? Date.now()
  const permissions = {
    canUpdateUsers: true,
    canUnlockUsers: true,
    canDeactivateUsers: true,
    canSoftDeleteUsers: true,
    canPermanentDeleteUsers: true,
    ...options.permissions,
  }
  const isSelf = user.id === options.currentUserId
  const isLocalUser = (user.authProvider || 'local') === 'local'
  const isLocked = Boolean(
    user.isActive && (
      (user.lockedUntil && Number(user.lockedUntil) > now) ||
      (Number(user.failedLoginAttempts || 0) > 0)
    )
  )
  const canDeactivate = Boolean(
    (permissions.canDeactivateUsers || permissions.canSoftDeleteUsers) &&
    !isSelf &&
    user.isActive
  )
  const canPermanentDelete = Boolean(
    permissions.canPermanentDeleteUsers &&
    !isSelf &&
    !options.localLoginDisabled &&
    isLocalUser &&
    (user.adminStatus === 'pending' || !user.isActive)
  )

  return {
    isSelf,
    isLocked,
    canEdit: permissions.canUpdateUsers,
    canUnlock: permissions.canUnlockUsers && isLocked,
    canDeactivate,
    canPermanentDelete,
  }
}

export function formatUserRoleAssignmentSourceLineage(assignment: Pick<UserRoleAssignmentLineageInput, 'source' | 'sourceRef'> | null | undefined): string {
  if (!assignment) return '-'
  const sourceLabel = assignment.source === 'sso'
    ? 'SSO-managed assignment'
    : assignment.source === 'manual'
      ? 'Manual assignment'
      : assignment.source === 'system'
        ? 'System-managed assignment'
        : assignment.source === 'api'
          ? 'API-managed assignment'
          : assignment.source === 'legacy'
            ? 'Legacy-derived assignment'
            : assignment.source === 'automation'
              ? 'Automation-managed assignment'
              : assignment.source === 'bootstrap'
                ? 'Bootstrap assignment'
                : `${assignment.source} assignment`
  const parts = [sourceLabel]
  if (assignment.sourceRef) parts.push(`Source ref ${assignment.sourceRef}`)
  return parts.join('; ')
}

export function isDirectUserRoleAssignment(assignment: UserRoleAssignmentLineageInput, userId: string): boolean {
  if ((assignment.principalType || 'user') !== 'user') return false
  const principalId = assignment.principalId || assignment.userId
  return Boolean(principalId && principalId === userId)
}

export function formatUserRoleAssignmentScope(assignment: Pick<UserRoleAssignmentLineageInput, 'resourceType' | 'resourceId' | 'scopeType' | 'scopeId'>): string {
  const type = assignment.scopeType || assignment.resourceType
  const id = assignment.scopeId || assignment.resourceId
  if (!type) return 'unscoped'
  return id ? `${type} ${id}` : type
}

export function formatUserRoleAssignmentSummary(assignment: UserRoleAssignmentLineageInput): string {
  const role = assignment.roleName || assignment.roleKey || assignment.roleId
  return `${role} on ${formatUserRoleAssignmentScope(assignment)}`
}

const defaultCreateForm: UserInviteForm = {
  email: '',
  bootstrapAccess: 'user',
  sendEmail: true,
}

/**
 * User Management Page
 * Admin-only interface for managing users
 */
export default function UserManagement() {
  const { user: currentUser, permissions, hasPlatformPermission } = useAuth();
  const { notify } = useToast();
  const [users, setUsers] = useState<AdminManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const platformResource = { type: 'platform' as const, id: null };
  const usersReadDecision = evaluateActionSnapshot(permissions, 'platform.users.read', platformResource);
  const usersCreateDecision = evaluateActionSnapshot(permissions, 'platform.users.create', platformResource);
  const usersUpdateDecision = evaluateActionSnapshot(permissions, 'platform.users.update', platformResource);
  const usersDeactivateDecision = evaluateActionSnapshot(permissions, 'platform.users.deactivate', platformResource);
  const usersPermanentDeleteDecision = evaluateActionSnapshot(permissions, 'platform.users.permanent-delete', platformResource);
  const usersUnlockDecision = evaluateActionSnapshot(permissions, 'platform.users.unlock', platformResource);
  const usersManageDecision = evaluateActionSnapshot(permissions, 'platform.users.manage', platformResource);
  const invitationCreateDecision = evaluateActionSnapshot(permissions, 'invitations.create', platformResource);
  const userManageAllowed = usersManageDecision.allowed || hasPlatformPermission(PlatformPermission.USER_MANAGE);
  const canViewUsers = userManageAllowed ||
    usersReadDecision.allowed ||
    hasPlatformPermission(PlatformPermission.USER_VIEW);
  const canReadRoleAssignments = userManageAllowed || hasPlatformPermission(PlatformPermission.AUTHZ_ROLES_VIEW);
  const actionPermissions: UserManagementActionPermissions = {
    canUpdateUsers: userManageAllowed || usersUpdateDecision.allowed,
    canUnlockUsers: userManageAllowed || usersUnlockDecision.allowed,
    canDeactivateUsers: userManageAllowed || usersDeactivateDecision.allowed,
    canSoftDeleteUsers: userManageAllowed || hasPlatformPermission(PlatformPermission.USERS_DELETE),
    canPermanentDeleteUsers: userManageAllowed || usersPermanentDeleteDecision.allowed,
  };
  const canCreateUsers = userManageAllowed || usersCreateDecision.allowed || invitationCreateDecision.allowed;
  const canAccessUserManagement = canViewUsers ||
    canCreateUsers ||
    Object.values(actionPermissions).some(Boolean);
  const roleAssignmentsQ = useRoleAssignments(undefined, { enabled: canAccessUserManagement && canReadRoleAssignments });

  // Create user modal
  const createModal = useModal();
  const [createForm, setCreateForm] = useState<UserInviteForm>(defaultCreateForm);
  const [createLoading, setCreateLoading] = useState(false);
  const [createInviteReveal, setCreateInviteReveal] = useState<InvitationRevealData | null>(null);
  const [localLoginDisabled, setLocalLoginDisabled] = useState(false);
  const [emailConfigured, setEmailConfigured] = useState(true);
  const [createCapabilitiesLoading, setCreateCapabilitiesLoading] = useState(false);

  // Edit user modal
  const editModal = useModal<AdminManagedUser>();
  const [editingUser, setEditingUser] = useState<AdminManagedUser | null>(null);
  const [editForm, setEditForm] = useState<UserEditForm>({});
  const [editLoading, setEditLoading] = useState(false);

  // Delete user modal
  const deleteModal = useModal<AdminManagedUser>();
  const [deleteLoading, setDeleteLoading] = useState(false);
  const permanentDeleteModal = useModal<AdminManagedUser>();
  const [permanentDeleteLoading, setPermanentDeleteLoading] = useState(false);

  // Redirect if not admin
  if (!canAccessUserManagement) {
    return (
      <div style={{ padding: 'var(--spacing-7)' }}>
        <h1>Unauthorized</h1>
        <p>You must be an administrator to manage users.</p>
      </div>
    );
  }

  useEffect(() => {
    loadUsers();
  }, []);

  useEffect(() => {
    apiClient.get<{ ssoRequired: boolean; emailConfigured: boolean }>('/api/t/default/invitations/capabilities')
      .then((result) => {
        setLocalLoginDisabled(Boolean(result?.ssoRequired));
        setEmailConfigured(Boolean(result?.emailConfigured));
      })
      .catch(() => {
        setLocalLoginDisabled(false);
        setEmailConfigured(true);
      });
  }, []);

  useEffect(() => {
    if (!createModal.isOpen) {
      return;
    }

    setCreateCapabilitiesLoading(true);
    apiClient.get<{ ssoRequired: boolean; emailConfigured: boolean }>('/api/t/default/invitations/capabilities')
      .then((result) => {
        const capabilities = {
          ssoRequired: Boolean(result?.ssoRequired),
          emailConfigured: Boolean(result?.emailConfigured),
        };
        setLocalLoginDisabled(capabilities.ssoRequired);
        setEmailConfigured(capabilities.emailConfigured);
        setCreateForm((current: UserInviteForm) => ({
          ...current,
          sendEmail: getPreferredInvitationDeliveryMethod(capabilities) === 'email',
        }));
      })
      .catch(() => {
        setLocalLoginDisabled(false);
        setEmailConfigured(true);
        setCreateForm((current: UserInviteForm) => ({
          ...current,
          sendEmail: true,
        }));
      })
      .finally(() => setCreateCapabilitiesLoading(false));
  }, [createModal.isOpen]);

  const resetCreateInviteForm = () => {
    setCreateForm({
      ...defaultCreateForm,
      sendEmail: getPreferredInvitationDeliveryMethod({
        ssoRequired: localLoginDisabled,
        emailConfigured,
      }) === 'email',
    });
    setCreateInviteReveal(null);
  };

  const handleCloseCreateModal = () => {
    createModal.closeModal();
    resetCreateInviteForm();
  };

  const loadUsers = async () => {
    try {
      setLoading(true);
      const userList = await authService.listUsers() as AdminManagedUser[];
      setUsers(userList);
    } catch (err) {
      const parsed = parseApiError(err, 'Failed to load users');
      notify({ kind: 'error', title: 'Failed to load users', subtitle: parsed.message });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async () => {
    if (!canCreateUsers) return;

    try {
      setCreateLoading(true);
      setCreateInviteReveal(null);

      const normalizedEmail = String(createForm.email || '').trim().toLowerCase();
      const result = await authService.createUser(toCreateUserRequest(createForm, normalizedEmail));

      await loadUsers();

      if (!result.emailSent && result.inviteUrl && result.oneTimePassword) {
        setCreateInviteReveal({
          email: normalizedEmail,
          inviteUrl: result.inviteUrl,
          oneTimePassword: result.oneTimePassword,
        });
        return;
      }

      notify({
        kind: 'success',
        title: 'User invited',
        subtitle: result.emailSent ? `Invite email sent to ${normalizedEmail}` : result.emailError || 'Invitation created successfully.',
      });

      handleCloseCreateModal();
    } catch (err) {
      const parsed = parseApiError(err, 'Failed to create user');
      notify({ kind: 'error', title: 'Failed to create user', subtitle: parsed.message });
    } finally {
      setCreateLoading(false);
    }
  };

  const handleEditUser = async () => {
    if (!editingUser || !actionPermissions.canUpdateUsers) return;

    try {
      setEditLoading(true);

      await authService.updateUser(editingUser.id, toUpdateUserRequest(editForm));
      notify({ kind: 'success', title: 'User updated successfully!' });
      await loadUsers();

      editModal.closeModal();
      setEditingUser(null);
      setEditForm({});
    } catch (err) {
      const parsed = parseApiError(err, 'Failed to update user');
      notify({ kind: 'error', title: 'Failed to update user', subtitle: parsed.message });
    } finally {
      setEditLoading(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!deleteModal.data || (!actionPermissions.canDeactivateUsers && !actionPermissions.canSoftDeleteUsers)) return;

    try {
      setDeleteLoading(true);

      await authService.deleteUser(deleteModal.data.id);
      notify({ kind: 'success', title: 'User deactivated successfully!' });
      await loadUsers();

      deleteModal.closeModal();
    } catch (err) {
      const parsed = parseApiError(err, 'Failed to deactivate user');
      notify({ kind: 'error', title: 'Failed to deactivate user', subtitle: parsed.message });
    } finally {
      setDeleteLoading(false);
    }
  };

  const handlePermanentDeleteUser = async () => {
    if (!permanentDeleteModal.data || !actionPermissions.canPermanentDeleteUsers) return;

    try {
      setPermanentDeleteLoading(true);

      await authService.deleteUserPermanently(permanentDeleteModal.data.id);
      notify({ kind: 'success', title: 'User permanently deleted successfully!' });
      await loadUsers();

      permanentDeleteModal.closeModal();
    } catch (err) {
      const parsed = parseApiError(err, 'Failed to delete user permanently');
      notify({ kind: 'error', title: 'Failed to delete user permanently', subtitle: parsed.message });
    } finally {
      setPermanentDeleteLoading(false);
    }
  };

  const handleUnlockUser = async (userId: string) => {
    if (!actionPermissions.canUnlockUsers) return;

    try {
      await authService.unlockUser(userId);
      notify({ kind: 'success', title: 'User account unlocked successfully!' });
      await loadUsers();
    } catch (err) {
      const parsed = parseApiError(err, 'Failed to unlock user');
      notify({ kind: 'error', title: 'Failed to unlock user', subtitle: parsed.message });
    }
  };

  const openEditModal = (user: AdminManagedUser) => {
    if (!actionPermissions.canUpdateUsers) return;

    setEditingUser(user);

    setEditForm({
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      bootstrapAccess: getUserBootstrapAccess(user),
      isActive: user.isActive,
    });
    editModal.openModal(user);
  };

  const openDeleteModal = (user: AdminManagedUser) => {
    if (!actionPermissions.canDeactivateUsers && !actionPermissions.canSoftDeleteUsers) return;
    deleteModal.openModal(user);
  };

  const openPermanentDeleteModal = (user: AdminManagedUser) => {
    if (!actionPermissions.canPermanentDeleteUsers) return;
    permanentDeleteModal.openModal(user);
  };

  const headers = [
    { key: 'email', header: 'Email' },
    { key: 'name', header: 'Name' },
    { key: 'bootstrapAccess', header: 'Platform Role' },
    { key: 'status', header: 'Status' },
    { key: 'created', header: 'Created' },
    { key: 'actions', header: '' },
  ];

  const visibleUsers = users.filter((u) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    const name = `${u.firstName || ''} ${u.lastName || ''}`.trim();
    const status = getUserDisplayStatus(u).label.toLowerCase();
    const hay = [String(u.email || ''), String(name || ''), getUserBootstrapAccess(u), status]
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });

  const directRoleAssignmentsByUser = new Map<string, RoleAssignment[]>();
  if (canReadRoleAssignments && Array.isArray(roleAssignmentsQ.data)) {
    roleAssignmentsQ.data.forEach((assignment) => {
      const principalId = assignment.principalId || assignment.userId;
      if (!principalId || !isDirectUserRoleAssignment(assignment, principalId)) return;
      const assignments = directRoleAssignmentsByUser.get(principalId) || [];
      assignments.push(assignment);
      directRoleAssignmentsByUser.set(principalId, assignments);
    });
  }

  const rows = visibleUsers.map((user) => ({
    statusMeta: getUserDisplayStatus(user),
    id: user.id,
    email: user.email,
    name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || '-',
    bootstrapAccess: getUserBootstrapAccess(user),
    status: getUserDisplayStatus(user).label,
    created: user.createdAt ? new Date(Number(user.createdAt)).toLocaleDateString() : '-',
    user, // Store full user object for actions
  }));

  const createDeliveryOptions = getInvitationDeliveryOptions({
    ssoRequired: localLoginDisabled,
    emailConfigured,
  });
  const noCreateDeliveryOptions = createDeliveryOptions.length === 0;

  return (
    <PageLayout>
      <PageHeader
        icon={UserAvatar}
        title="User Management"
        subtitle="Manage user accounts and permissions"
        gradient={PAGE_GRADIENTS.red}
      />

      {/* Users Table */}
      {loading ? (
        <TableContainer>
          <TableToolbar>
            <TableToolbarContent>
              <TableToolbarSearch
                persistent
                onChange={(e: any) => setSearchQuery(e.target.value)}
                value={searchQuery}
                placeholder="Search users"
              />
              {canCreateUsers && (
                <Button kind="primary" renderIcon={Add} onClick={() => createModal.openModal()}>
                  Invite User
                </Button>
              )}
            </TableToolbarContent>
          </TableToolbar>
          <DataTableSkeleton
            showToolbar={false}
            showHeader
            headers={headers}
            rowCount={8}
            columnCount={headers.length}
          />
        </TableContainer>
      ) : (
        <DataTable rows={rows} headers={headers}>
          {({ rows, headers, getTableProps, getHeaderProps, getRowProps, getToolbarProps }) => (
            <TableContainer>
              <TableToolbar {...getToolbarProps()}>
                <TableToolbarContent>
                  <TableToolbarSearch
                    persistent
                    onChange={(e: any) => setSearchQuery(e.target.value)}
                    value={searchQuery}
                    placeholder="Search users"
                  />
                  {canCreateUsers && (
                    <Button kind="primary" renderIcon={Add} onClick={() => createModal.openModal()}>
                      Invite User
                    </Button>
                  )}
                </TableToolbarContent>
              </TableToolbar>
              <Table {...getTableProps()}>
                <TableHead>
                  <TableRow>
                    {headers.map((header) => {
                      const { key, ...headerProps } = getHeaderProps({ header });
                      return (
                        <TableHeader
                          key={key}
                          {...headerProps}
                          style={key === 'actions' ? { width: 48, textAlign: 'right' } : undefined}
                        >
                          {header.header}
                        </TableHeader>
                      );
                    })}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={headers.length}>No users match this search.</TableCell>
                    </TableRow>
                  )}
                  {rows.map((row) => {
                    const user = users.find(u => u.id === row.id);
                    if (!user) return null;

                    const rowActions = getUserRowActions(user, {
                      currentUserId: currentUser?.id,
                      localLoginDisabled,
                      permissions: actionPermissions,
                    })
                    const hasRowActions = rowActions.canEdit ||
                      rowActions.canUnlock ||
                      rowActions.canDeactivate ||
                      rowActions.canPermanentDelete;

                    const rowProps = getRowProps({ row });
                    const { key, ...otherRowProps } = rowProps;

                    return (
                      <TableRow key={key} {...otherRowProps}>
                        {row.cells.map((cell) => {
                          // Custom rendering for specific columns
                          if (cell.info.header === 'bootstrapAccess') {
                            const bootstrapAccess = getUserBootstrapAccess(user);
                            const tagType = getBootstrapAccessTagType(bootstrapAccess);
                            const label = getBootstrapAccessLabel(bootstrapAccess);
                            const directAssignments = directRoleAssignmentsByUser.get(user.id) || [];
                            return (
                              <TableCell key={cell.id}>
                                <Tag type={tagType}>
                                  {label}
                                </Tag>
                                {canReadRoleAssignments ? (
                                  <div style={{ marginTop: 'var(--spacing-2)', display: 'grid', gap: 'var(--spacing-1)', fontSize: '0.75rem', color: 'var(--cds-text-secondary, #525252)' }}>
                                    {roleAssignmentsQ.isLoading ? (
                                      <span>Scoped RBAC: loading assignments</span>
                                    ) : roleAssignmentsQ.isError ? (
                                      <span>Scoped RBAC: assignments unavailable</span>
                                    ) : directAssignments.length > 0 ? (
                                      <span title={directAssignments.map((assignment) => `${formatUserRoleAssignmentSummary(assignment)}; ${formatUserRoleAssignmentSourceLineage(assignment)}`).join('\n')}>
                                        Scoped RBAC: {directAssignments.length} direct assignment{directAssignments.length === 1 ? '' : 's'}
                                      </span>
                                    ) : (
                                      <span>Scoped RBAC: no direct assignments</span>
                                    )}
                                  </div>
                                ) : null}
                              </TableCell>
                            );
                          }

                          if (cell.info.header === 'status') {
                            const statusMeta = getUserDisplayStatus(user);
                            return (
                              <TableCell key={cell.id}>
                                <Tag type={statusMeta.tagType}>
                                  {statusMeta.label}
                                </Tag>
                              </TableCell>
                            );
                          }

                          if (cell.info.header === 'actions') {
                            return (
                              <TableCell key={cell.id} style={{ textAlign: 'right' }}>
                                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                  {hasRowActions ? (
                                    <GuardedOverflowMenu size="sm" flipped wrapperClasses="eg-no-tooltip" iconDescription="Options">
                                    {rowActions.canEdit ? (
                                      <GuardedOverflowMenuItem
                                        itemText="Edit"
                                        onClick={() => openEditModal(user)}
                                      />
                                    ) : null}
                                    {rowActions.canUnlock ? (
                                      <GuardedOverflowMenuItem
                                        itemText="Unlock Account"
                                        onClick={() => handleUnlockUser(user.id)}
                                      />
                                    ) : null}
                                    {rowActions.canDeactivate ? (
                                      <GuardedOverflowMenuItem
                                        itemText="Deactivate"
                                        onClick={() => openDeleteModal(user)}
                                        hasDivider={!rowActions.canPermanentDelete}
                                        isDelete
                                      />
                                    ) : null}
                                    {rowActions.canPermanentDelete ? (
                                      <GuardedOverflowMenuItem
                                        itemText="Delete User"
                                        onClick={() => openPermanentDeleteModal(user)}
                                        hasDivider={rowActions.canDeactivate}
                                        isDelete
                                      />
                                    ) : null}
                                    </GuardedOverflowMenu>
                                  ) : null}
                                </div>
                              </TableCell>
                            );
                          }

                          return <TableCell key={cell.id}>{cell.value}</TableCell>;
                        })}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DataTable>
      )}

      {/* Create User Modal */}
      <InvitationFlowModal
        open={createModal.isOpen}
        onClose={handleCloseCreateModal}
        onSubmit={handleCreateUser}
        label="Platform users"
        title="Invite user"
        submitText="Create invitation"
        busy={createLoading}
        busyText="Creating..."
        submitDisabled={!String(createForm.email || '').trim() || createCapabilitiesLoading || noCreateDeliveryOptions}
        revealMode={Boolean(createInviteReveal)}
        onRevealSecondary={resetCreateInviteForm}
        onRevealPrimary={handleCloseCreateModal}
      >
        {createInviteReveal ? (
          <InvitationRevealPanel
            data={createInviteReveal}
            subtitle={`Copy and share the invite link and one-time password for ${createInviteReveal.email}.`}
          />
        ) : (
          <>
            {localLoginDisabled && (
              <InlineNotification
                kind="info"
                title="Local sign-in disabled"
                subtitle="One-time password invitations are unavailable while SSO is enforced. Email delivery remains available."
                lowContrast
                hideCloseButton
              />
            )}
            {!emailConfigured && !localLoginDisabled && (
              <InlineNotification
                kind="info"
                title="Email delivery unavailable"
                subtitle="Email is not configured in Admin UI → Platform Settings → Email, so invitations must be delivered manually."
                lowContrast
                hideCloseButton
              />
            )}
            {noCreateDeliveryOptions && (
              <InlineNotification
                kind="warning"
                title="No delivery method available"
                subtitle="Email is not configured and manual one-time password onboarding is unavailable while SSO is enforced."
                lowContrast
                hideCloseButton
              />
            )}

            <div>
              <div style={{ fontSize: 'var(--cds-label-01-font-size, 0.75rem)', marginBottom: 'var(--spacing-3)' }}>Who</div>
              <div style={{ display: 'grid', gap: 'var(--spacing-4)' }}>
                <TextInput
                  id="create-email"
                  labelText="Email"
                  placeholder="user@example.com"
                  value={createForm.email}
                  onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                  disabled={createLoading || createCapabilitiesLoading}
                />
              </div>
            </div>

            <div>
              <div style={{ fontSize: 'var(--cds-label-01-font-size, 0.75rem)', marginBottom: 'var(--spacing-3)' }}>Access</div>
              <Select
                id="create-bootstrap-access"
                labelText="Platform Role"
                value={createForm.bootstrapAccess}
                onChange={(e) => {
                  const bootstrapAccess = e.target.value as BootstrapAccessValue;
                  setCreateForm({
                    ...createForm,
                    bootstrapAccess,
                  });
                }}
                disabled={createLoading || createCapabilitiesLoading}
              >
                <SelectItem value="user" text="Standard User" />
                <SelectItem value="admin" text="Platform Admin" />
              </Select>
              <div style={{ marginTop: 'var(--spacing-3)', fontSize: '0.75rem', color: 'var(--cds-text-secondary, #525252)' }}>
                {getBootstrapAccessDescription(createForm.bootstrapAccess)}
              </div>
            </div>

            {!noCreateDeliveryOptions && (
              <div>
                <div style={{ fontSize: 'var(--cds-label-01-font-size, 0.75rem)', marginBottom: 'var(--spacing-3)' }}>Delivery</div>
                <Select
                  id="create-sendEmail"
                  labelText="Delivery Method"
                  value={createForm.sendEmail ? 'email' : 'manual'}
                  onChange={(e) => setCreateForm({ ...createForm, sendEmail: e.target.value === 'email' })}
                  disabled={createLoading || createCapabilitiesLoading}
                >
                  {createDeliveryOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value} text={option.text} />
                  ))}
                </Select>
              </div>
            )}
          </>
        )}
      </InvitationFlowModal>

      {/* Edit User Modal */}
      <FormModal
        open={editModal.isOpen}
        onClose={() => {
          editModal.closeModal();
          setEditingUser(null);
          setEditForm({});
        }}
        onSubmit={handleEditUser}
        title={`Edit User: ${editingUser?.email}`}
        submitText="Save Changes"
        busy={editLoading}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-5)' }}>
          <TextInput
            id="edit-firstName"
            labelText="First Name"
            placeholder="John"
            value={editForm.firstName}
            onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })}
            disabled={editLoading}
          />
          <TextInput
            id="edit-lastName"
            labelText="Last Name"
            placeholder="Doe"
            value={editForm.lastName}
            onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })}
            disabled={editLoading}
          />
        </div>
        <Select
          id="edit-bootstrap-access"
          labelText="Platform Role"
          value={editForm.bootstrapAccess || 'user'}
          onChange={(e) => {
            const bootstrapAccess = e.target.value as BootstrapAccessValue;
            setEditForm({
              ...editForm,
              bootstrapAccess,
            });
          }}
          disabled={editLoading || editingUser?.id === currentUser?.id}
        >
          <SelectItem value="user" text="Standard User" />
          <SelectItem value="admin" text="Platform Admin" />
        </Select>
        <div style={{ marginTop: 'var(--spacing-3)', fontSize: '0.75rem', color: 'var(--cds-text-secondary, #525252)' }}>
          {getBootstrapAccessDescription(editForm.bootstrapAccess)}
        </div>
        <Select
          id="edit-isActive"
          labelText="Status"
          value={editForm.isActive ? 'active' : 'inactive'}
          onChange={(e) => setEditForm({ ...editForm, isActive: e.target.value === 'active' })}
          disabled={editLoading || editingUser?.id === currentUser?.id}
        >
          <SelectItem value="active" text="Active" />
          <SelectItem value="inactive" text="Inactive" />
        </Select>
      </FormModal>

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        open={deleteModal.isOpen}
        onClose={deleteModal.closeModal}
        onConfirm={handleDeleteUser}
        title="Deactivate User"
        description={`Are you sure you want to deactivate ${deleteModal.data?.email}? The user will be unable to log in and their projects will remain intact. This action can be reversed by reactivating the account.`}
        confirmText="Deactivate"
        danger
        busy={deleteLoading}
        showWarning
        warningMessage="This will prevent the user from logging in"
      />

      <ConfirmModal
        open={permanentDeleteModal.isOpen}
        onClose={permanentDeleteModal.closeModal}
        onConfirm={handlePermanentDeleteUser}
        title="Delete User Permanently"
        description={`Are you sure you want to permanently delete ${permanentDeleteModal.data?.email}? This is only intended for safe local users who are still pending or have already been deactivated.`}
        confirmText="Delete Permanently"
        danger
        busy={permanentDeleteLoading}
      />
    </PageLayout>
  );
}

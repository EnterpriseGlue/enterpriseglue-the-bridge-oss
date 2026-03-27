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
  OverflowMenu,
  OverflowMenuItem,
} from '@carbon/react';
import { Add, UserAvatar } from '@carbon/icons-react';
import { useAuth } from '../../shared/hooks/useAuth';
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
import { getPlatformRoleDescription, getPlatformRoleLabel, getPlatformRoleTagType } from '../../shared/utils/platformRole';
import { getInvitationDeliveryOptions, getPreferredInvitationDeliveryMethod, type InvitationRevealData } from '../../shared/utils/invitationFlow';

export type AdminManagedUser = User & {
  adminStatus?: 'active' | 'inactive' | 'pending'
  authProvider?: string
  failedLoginAttempts?: number
  lockedUntil?: number | null
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

export function getUserRowActions(user: AdminManagedUser, options: { currentUserId?: string; localLoginDisabled: boolean; now?: number }) {
  const now = options.now ?? Date.now()
  const isSelf = user.id === options.currentUserId
  const isLocalUser = (user.authProvider || 'local') === 'local'
  const isLocked = Boolean(
    user.isActive && (
      (user.lockedUntil && Number(user.lockedUntil) > now) ||
      (Number(user.failedLoginAttempts || 0) > 0)
    )
  )
  const canDeactivate = !isSelf && user.isActive
  const canPermanentDelete = Boolean(
    !isSelf &&
    !options.localLoginDisabled &&
    isLocalUser &&
    (user.adminStatus === 'pending' || !user.isActive)
  )

  return {
    isSelf,
    isLocked,
    canUnlock: isLocked,
    canDeactivate,
    canPermanentDelete,
  }
}

const defaultCreateForm: CreateUserRequest = {
  email: '',
  platformRole: 'user',
  sendEmail: true,
}

/**
 * User Management Page
 * Admin-only interface for managing users
 */
export default function UserManagement() {
  const { user: currentUser } = useAuth();
  const { notify } = useToast();
  const [users, setUsers] = useState<AdminManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const canManageUsers = Boolean(currentUser?.capabilities?.canManageUsers);

  // Create user modal
  const createModal = useModal();
  const [createForm, setCreateForm] = useState<CreateUserRequest>(defaultCreateForm);
  const [createLoading, setCreateLoading] = useState(false);
  const [createInviteReveal, setCreateInviteReveal] = useState<InvitationRevealData | null>(null);
  const [localLoginDisabled, setLocalLoginDisabled] = useState(false);
  const [emailConfigured, setEmailConfigured] = useState(true);
  const [createCapabilitiesLoading, setCreateCapabilitiesLoading] = useState(false);

  // Edit user modal
  const editModal = useModal<AdminManagedUser>();
  const [editingUser, setEditingUser] = useState<AdminManagedUser | null>(null);
  const [editForm, setEditForm] = useState<UpdateUserRequest>({});
  const [editLoading, setEditLoading] = useState(false);

  // Delete user modal
  const deleteModal = useModal<AdminManagedUser>();
  const [deleteLoading, setDeleteLoading] = useState(false);
  const permanentDeleteModal = useModal<AdminManagedUser>();
  const [permanentDeleteLoading, setPermanentDeleteLoading] = useState(false);

  // Redirect if not admin
  if (!canManageUsers) {
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
        setCreateForm((current: CreateUserRequest) => ({
          ...current,
          sendEmail: getPreferredInvitationDeliveryMethod(capabilities) === 'email',
        }));
      })
      .catch(() => {
        setLocalLoginDisabled(false);
        setEmailConfigured(true);
        setCreateForm((current: CreateUserRequest) => ({
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
    try {
      setCreateLoading(true);
      setCreateInviteReveal(null);

      const normalizedEmail = String(createForm.email || '').trim().toLowerCase();
      const result = await authService.createUser({
        ...createForm,
        email: normalizedEmail,
      });

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
    if (!editingUser) return;

    try {
      setEditLoading(true);

      await authService.updateUser(editingUser.id, editForm);
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
    if (!deleteModal.data) return;

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
    if (!permanentDeleteModal.data) return;

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
    setEditingUser(user);

    const platformRole = user.platformRole === 'admin' ? 'admin' : 'user';
    setEditForm({
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      platformRole,
      isActive: user.isActive,
    });
    editModal.openModal(user);
  };

  const openDeleteModal = (user: AdminManagedUser) => {
    deleteModal.openModal(user);
  };

  const openPermanentDeleteModal = (user: AdminManagedUser) => {
    permanentDeleteModal.openModal(user);
  };

  const headers = [
    { key: 'email', header: 'Email' },
    { key: 'name', header: 'Name' },
    { key: 'platformRole', header: 'Platform Role' },
    { key: 'status', header: 'Status' },
    { key: 'created', header: 'Created' },
    { key: 'actions', header: '' },
  ];

  const visibleUsers = users.filter((u) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    const name = `${u.firstName || ''} ${u.lastName || ''}`.trim();
    const status = getUserDisplayStatus(u).label.toLowerCase();
    const hay = [String(u.email || ''), String(name || ''), String(u.platformRole || ''), status]
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });

  const rows = visibleUsers.map((user) => ({
    statusMeta: getUserDisplayStatus(user),
    id: user.id,
    email: user.email,
    name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || '-',
    platformRole: user.platformRole || 'user',
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
              <Button kind="primary" renderIcon={Add} onClick={() => createModal.openModal()}>
                Invite User
              </Button>
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
                  <Button kind="primary" renderIcon={Add} onClick={() => createModal.openModal()}>
                    Invite User
                  </Button>
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
                    })

                    const rowProps = getRowProps({ row });
                    const { key, ...otherRowProps } = rowProps;

                    return (
                      <TableRow key={key} {...otherRowProps}>
                        {row.cells.map((cell) => {
                          // Custom rendering for specific columns
                          if (cell.info.header === 'platformRole') {
                            const platformRole = user.platformRole || 'user';
                            const tagType = getPlatformRoleTagType(platformRole);
                            const label = getPlatformRoleLabel(platformRole);
                            return (
                              <TableCell key={cell.id}>
                                <Tag type={tagType}>
                                  {label}
                                </Tag>
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
                                  <OverflowMenu size="sm" flipped wrapperClasses="eg-no-tooltip" iconDescription="Options">
                                    <OverflowMenuItem
                                      itemText="Edit"
                                      onClick={() => openEditModal(user)}
                                    />
                                    {rowActions.canUnlock ? (
                                      <OverflowMenuItem
                                        itemText="Unlock Account"
                                        onClick={() => handleUnlockUser(user.id)}
                                      />
                                    ) : null}
                                    {rowActions.canDeactivate ? (
                                      <OverflowMenuItem
                                        itemText="Deactivate"
                                        onClick={() => openDeleteModal(user)}
                                        hasDivider={!rowActions.canPermanentDelete}
                                        isDelete
                                      />
                                    ) : null}
                                    {rowActions.canPermanentDelete ? (
                                      <OverflowMenuItem
                                        itemText="Delete User"
                                        onClick={() => openPermanentDeleteModal(user)}
                                        hasDivider={rowActions.canDeactivate}
                                        isDelete
                                      />
                                    ) : null}
                                  </OverflowMenu>
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
                id="create-platformRole"
                labelText="Platform Role"
                value={createForm.platformRole || 'user'}
                onChange={(e) => {
                  const platformRole = e.target.value as 'admin' | 'user';
                  setCreateForm({
                    ...createForm,
                    platformRole,
                  });
                }}
                disabled={createLoading || createCapabilitiesLoading}
              >
                <SelectItem value="user" text="Standard User" />
                <SelectItem value="admin" text="Platform Admin" />
              </Select>
              <div style={{ marginTop: 'var(--spacing-3)', fontSize: '0.75rem', color: 'var(--cds-text-secondary, #525252)' }}>
                {getPlatformRoleDescription(createForm.platformRole)}
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
          id="edit-platformRole"
          labelText="Platform Role"
          value={editForm.platformRole || 'user'}
          onChange={(e) => {
            const platformRole = e.target.value as 'admin' | 'user';
            setEditForm({
              ...editForm,
              platformRole,
            });
          }}
          disabled={editLoading || editingUser?.id === currentUser?.id}
        >
          <SelectItem value="user" text="Standard User" />
          <SelectItem value="admin" text="Platform Admin" />
        </Select>
        <div style={{ marginTop: 'var(--spacing-3)', fontSize: '0.75rem', color: 'var(--cds-text-secondary, #525252)' }}>
          {getPlatformRoleDescription(editForm.platformRole)}
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

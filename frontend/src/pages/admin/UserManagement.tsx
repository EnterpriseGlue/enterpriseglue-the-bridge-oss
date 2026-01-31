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
  Modal,
  TextInput,
  Select,
  SelectItem,
  InlineNotification,
  Tag,
  OverflowMenu,
  OverflowMenuItem,
} from '@carbon/react';
import { Add, Edit, TrashCan, Locked, Unlocked, UserAvatar } from '@carbon/icons-react';
import { useAuth } from '../../shared/hooks/useAuth';
import { PageLayout, PageHeader, PAGE_GRADIENTS } from '../../shared/components/PageLayout';
import { useModal } from '../../shared/hooks/useModal';
import FormModal from '../../components/FormModal';
import ConfirmModal from '../../shared/components/ConfirmModal';
import { authService } from '../../services/auth';
import { parseApiError } from '../../shared/api/apiErrorUtils';
import type { User, CreateUserRequest, UpdateUserRequest } from '../../shared/types/auth';
import { useToast } from '../../shared/notifications/ToastProvider';
import { getPlatformRoleLabel, getPlatformRoleTagType } from '../../shared/utils/platformRole';

/**
 * User Management Page
 * Admin-only interface for managing users
 */
export default function UserManagement() {
  const { user: currentUser } = useAuth();
  const { notify } = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const canManageUsers = Boolean(currentUser?.capabilities?.canManageUsers);

  // Create user modal
  const createModal = useModal();
  const [createForm, setCreateForm] = useState<CreateUserRequest>({
    email: '',
    firstName: '',
    lastName: '',
    platformRole: 'user',
    sendEmail: true,
  });
  const [createLoading, setCreateLoading] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState('');

  // Edit user modal
  const editModal = useModal<User>();
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editForm, setEditForm] = useState<UpdateUserRequest>({});
  const [editLoading, setEditLoading] = useState(false);

  // Delete user modal
  const deleteModal = useModal<User>();
  const [deleteLoading, setDeleteLoading] = useState(false);

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

  const loadUsers = async () => {
    try {
      setLoading(true);
      const userList = await authService.listUsers();
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
      setTemporaryPassword('');

      const result = await authService.createUser(createForm);

      if (!result.emailSent && result.temporaryPassword) {
        setTemporaryPassword(result.temporaryPassword);
      }

      notify({
        kind: 'success',
        title: 'User created',
        subtitle: result.emailSent ? 'Welcome email sent.' : undefined,
      });
      await loadUsers();

      // Reset form if email was sent (otherwise keep modal open to show password)
      if (result.emailSent) {
        createModal.closeModal();
        setCreateForm({
          email: '',
          firstName: '',
          lastName: '',
          platformRole: 'user',
          sendEmail: true,
        });
      }
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

  const openEditModal = (user: User) => {
    setEditingUser(user);

    const platformRole = user.platformRole || 'user';
    setEditForm({
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      platformRole,
      isActive: user.isActive,
    });
    editModal.openModal(user);
  };

  const openDeleteModal = (user: User) => {
    deleteModal.openModal(user);
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
    const status = u.isActive ? 'active' : 'inactive';
    const hay = [String(u.email || ''), String(name || ''), String(u.platformRole || ''), status]
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });

  const rows = visibleUsers.map((user) => ({
    id: user.id,
    email: user.email,
    name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || '-',
    platformRole: user.platformRole || 'user',
    status: user.isActive ? 'Active' : 'Inactive',
    created: user.createdAt ? new Date(Number(user.createdAt)).toLocaleDateString() : '-',
    user, // Store full user object for actions
  }));

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
                Create User
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
                    Create User
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
                            return (
                              <TableCell key={cell.id}>
                                <Tag type={user.isActive ? 'green' : 'red'}>
                                  {cell.value}
                                </Tag>
                              </TableCell>
                            );
                          }

                          if (cell.info.header === 'actions') {
                            const isSelf = user.id === currentUser?.id;
                            return (
                              <TableCell key={cell.id} style={{ textAlign: 'right' }}>
                                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                  <OverflowMenu size="sm" flipped wrapperClasses="eg-no-tooltip" iconDescription="Options">
                                  <OverflowMenuItem
                                    itemText="Edit"
                                    onClick={() => openEditModal(user)}
                                  />
                                  <OverflowMenuItem
                                    itemText="Unlock Account"
                                    onClick={() => handleUnlockUser(user.id)}
                                    disabled={user.isActive}
                                  />
                                  <OverflowMenuItem
                                    itemText="Deactivate"
                                    onClick={() => openDeleteModal(user)}
                                    disabled={isSelf || !user.isActive}
                                    hasDivider
                                    isDelete
                                  />
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
      <FormModal
        open={createModal.isOpen}
        onClose={() => {
          createModal.closeModal();
          setTemporaryPassword('');
          setCreateForm({
            email: '',
            firstName: '',
            lastName: '',
            platformRole: 'user',
            sendEmail: true,
          });
        }}
        onSubmit={handleCreateUser}
        title="Create New User"
        submitText="Create User"
        busy={createLoading}
        submitDisabled={!createForm.email}
      >
        <TextInput
          id="create-email"
          labelText="Email *"
          placeholder="user@example.com"
          value={createForm.email}
          onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
          disabled={createLoading}
          required
        />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-5)' }}>
          <TextInput
            id="create-firstName"
            labelText="First Name"
            placeholder="John"
            value={createForm.firstName}
            onChange={(e) => setCreateForm({ ...createForm, firstName: e.target.value })}
            disabled={createLoading}
          />
          <TextInput
            id="create-lastName"
            labelText="Last Name"
            placeholder="Doe"
            value={createForm.lastName}
            onChange={(e) => setCreateForm({ ...createForm, lastName: e.target.value })}
            disabled={createLoading}
          />
        </div>
        <Select
          id="create-platformRole"
          labelText="Platform Role"
          value={createForm.platformRole || 'user'}
          onChange={(e) => {
            const platformRole = e.target.value as 'admin' | 'developer' | 'user';
            setCreateForm({
              ...createForm,
              platformRole,
            });
          }}
          disabled={createLoading}
        >
          <SelectItem value="user" text="User" />
          <SelectItem value="developer" text="Developer" />
          <SelectItem value="admin" text="Admin" />
        </Select>
        <Select
          id="create-sendEmail"
          labelText="Send Welcome Email"
          value={createForm.sendEmail ? 'yes' : 'no'}
          onChange={(e) => setCreateForm({ ...createForm, sendEmail: e.target.value === 'yes' })}
          disabled={createLoading}
        >
          <SelectItem value="yes" text="Yes - Email temporary password" />
          <SelectItem value="no" text="No - Show password here" />
        </Select>
        {temporaryPassword && (
          <InlineNotification
            kind="warning"
            title="Temporary Password"
            subtitle={`Password: ${temporaryPassword}`}
            lowContrast
            hideCloseButton
          />
        )}
      </FormModal>

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
            const platformRole = e.target.value as 'admin' | 'developer' | 'user';
            setEditForm({
              ...editForm,
              platformRole,
            });
          }}
          disabled={editLoading || editingUser?.id === currentUser?.id}
        >
          <SelectItem value="user" text="User" />
          <SelectItem value="developer" text="Developer" />
          <SelectItem value="admin" text="Admin" />
        </Select>
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
    </PageLayout>
  );
}

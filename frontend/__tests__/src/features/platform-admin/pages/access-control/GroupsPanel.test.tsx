import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GroupsPanel } from '@src/features/platform-admin/pages/access-control/GroupsPanel';

vi.mock('@src/features/platform-admin/hooks/useAdminApi', () => ({
  useUserSearch: (query: string) => ({
    data: query.length >= 2 ? [{ id: 'user-2', email: 'test.user@example.com', firstName: 'Test', lastName: 'User' }] : [],
    isFetching: false,
  }),
}));

const manualGroup = {
  id: 'group-1',
  tenantId: 'tenant-1',
  key: 'engineering',
  name: 'Engineering',
  description: null,
  source: 'manual' as const,
  sourceRef: null,
  ownershipMode: 'manual' as const,
  sourceHash: null,
  lastAppliedAt: null,
  driftStatus: null,
  isSystem: false,
  isArchived: false,
  createdById: 'admin-1',
  createdAt: 1,
  updatedAt: 1,
};

function renderPanel(overrides: Partial<React.ComponentProps<typeof GroupsPanel>> = {}) {
  const props: React.ComponentProps<typeof GroupsPanel> = {
    groups: [manualGroup],
    memberships: [],
    loading: false,
    membershipsLoading: false,
    pending: false,
    selectedGroupId: 'group-1',
    canManage: true,
    onSelectGroup: vi.fn(),
    onCreate: vi.fn(),
    onEdit: vi.fn(),
    onArchive: vi.fn(),
    onAddMembership: vi.fn(),
    onRemoveMembership: vi.fn(),
    ...overrides,
  };
  render(<GroupsPanel {...props} />);
  return props;
}

function menuItem(label: string): HTMLElement | null {
  const node = screen.queryAllByText(label).find((candidate) => candidate.closest('.cds--overflow-menu-options__option'));
  return node?.closest('button') || node?.closest('[role="menuitem"]') || node || null;
}

describe('GroupsPanel', () => {
  it('adds a member only through the selected editable group', () => {
    const props = renderPanel();

    fireEvent.change(screen.getByLabelText('User'), { target: { value: 'test' } });
    fireEvent.click(screen.getByRole('button', { name: /Test User/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add member' }));

    expect(props.onAddMembership).toHaveBeenCalledWith('user-2');
  });

  it('keeps config-locked groups visible but blocks their mutation controls', async () => {
    renderPanel({
      groups: [{ ...manualGroup, source: 'config', ownershipMode: 'config_locked' }],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Engineering' }));
    await waitFor(() => expect(menuItem('Edit')).toBeTruthy());
    expect(menuItem('Edit')).toBeDisabled();
    expect(menuItem('Archive')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add member' })).toBeDisabled();
    expect(screen.getAllByTitle('This group is locked by its configuration bundle.')).toHaveLength(3);
  });

  it('groups duplicate membership lineage into one human-readable user row', () => {
    renderPanel({
      memberships: [
        {
          id: 'membership-manual',
          tenantId: 'tenant-1',
          groupId: 'group-1',
          groupKey: 'engineering',
          groupName: 'Engineering',
          userId: 'user-1',
          userDisplayName: 'Opal Operator',
          userEmail: 'opal@example.com',
          source: 'manual',
          sourceRef: null,
          expiresAt: null,
          createdById: 'admin-1',
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'membership-sso',
          tenantId: 'tenant-1',
          groupId: 'group-1',
          groupKey: 'engineering',
          groupName: 'Engineering',
          userId: 'user-1',
          userDisplayName: 'Opal Operator',
          userEmail: 'opal@example.com',
          source: 'identity_provider',
          sourceRef: 'identity_mapping:mapping-1',
          expiresAt: null,
          createdById: null,
          createdAt: 2,
          updatedAt: 2,
        },
      ],
    });

    expect(screen.getAllByText('Opal Operator')).toHaveLength(1);
    expect(screen.getAllByText('user-1')).toHaveLength(1);
    expect(screen.getByText('Manual administrator change')).toBeInTheDocument();
    expect(screen.getByText('identity_mapping:mapping-1')).toBeInTheDocument();
  });

  it('presents bootstrap and recovery membership sources before their technical references', () => {
    renderPanel({
      memberships: [
        {
          id: 'membership-bootstrap',
          tenantId: 'tenant-1',
          groupId: 'group-1',
          groupKey: 'engineering',
          groupName: 'Engineering',
          userId: 'user-1',
          userDisplayName: 'Opal Operator',
          userEmail: 'opal@example.com',
          source: 'system',
          sourceRef: 'bootstrap:initial-admin',
          expiresAt: null,
          createdById: null,
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'membership-recovery-review',
          tenantId: 'tenant-1',
          groupId: 'group-1',
          groupKey: 'engineering',
          groupName: 'Engineering',
          userId: 'user-1',
          userDisplayName: 'Opal Operator',
          userEmail: 'opal@example.com',
          source: 'manual',
          sourceRef: 'admin:break-glass-review',
          expiresAt: null,
          createdById: 'admin-1',
          createdAt: 2,
          updatedAt: 2,
        },
      ],
    });

    expect(screen.getByText('Initial platform administrator')).toBeInTheDocument();
    expect(screen.getByText('Administrator recovery review')).toBeInTheDocument();
    expect(screen.getByText('bootstrap:initial-admin')).toBeInTheDocument();
    expect(screen.getByText('admin:break-glass-review')).toBeInTheDocument();
  });

  it('shows the member name, email, and immutable ID before removal', () => {
    renderPanel({
      memberships: [{
        id: 'membership-manual',
        tenantId: 'tenant-1',
        groupId: 'group-1',
        groupKey: 'engineering',
        groupName: 'Engineering',
        userId: 'user-1',
        userDisplayName: 'Opal Operator',
        userEmail: 'opal@example.com',
        source: 'manual',
        sourceRef: null,
        expiresAt: null,
        createdById: 'admin-1',
        createdAt: 1,
        updatedAt: 1,
      }],
    });

    fireEvent.click(screen.getByLabelText('Remove group member'));

    const dialog = screen.getByRole('dialog', { name: 'Remove manual group member' });
    expect(dialog).toHaveTextContent('Opal Operator');
    expect(dialog).toHaveTextContent('Email: opal@example.com');
    expect(dialog).toHaveTextContent('User ID: user-1');
  });
});

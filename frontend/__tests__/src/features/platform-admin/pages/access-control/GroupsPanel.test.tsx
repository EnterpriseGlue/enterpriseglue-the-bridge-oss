import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GroupsPanel } from '@src/features/platform-admin/pages/access-control/GroupsPanel';

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

describe('GroupsPanel', () => {
  it('adds a member only through the selected editable group', () => {
    const props = renderPanel();

    fireEvent.change(screen.getByLabelText('User ID'), { target: { value: 'user-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Member' }));

    expect(props.onAddMembership).toHaveBeenCalledWith('user-2');
  });

  it('keeps config-locked groups visible but blocks their mutation controls', () => {
    renderPanel({
      groups: [{ ...manualGroup, source: 'config', ownershipMode: 'config_locked' }],
    });

    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add Member' })).toBeDisabled();
    expect(screen.getAllByTitle('This group is locked by its configuration bundle')).toHaveLength(3);
  });
});

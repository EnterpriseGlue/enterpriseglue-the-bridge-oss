import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RoleLibrarySettingsTab from '@src/features/platform-admin/components/RoleLibrarySettingsTab';
import { apiClient } from '@src/shared/api/client';
import type { CurrentUserPermissions } from '@src/shared/types/auth';

const authState = vi.hoisted(() => ({
  permissions: { userId: 'admin-1', platform: ['platform:authz:roles:view', 'platform:authz:roles:manage'], projects: [], engines: [], generatedAt: 1 } as CurrentUserPermissions,
}));

vi.mock('@src/shared/api/client', () => ({ apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('@src/shared/hooks/useAuth', () => ({ useAuth: () => authState }));

const roles = [
  { id: 'role-system', key: 'system.engine.operator', name: 'System Operator', description: 'Default operator', scope: 'engine', kind: 'system', isEditable: false, isArchived: false, permissionCount: 1 },
  { id: 'role-custom', key: 'custom.engine.operator', name: 'Custom Operator', description: 'Editable role', scope: 'engine', kind: 'custom', isEditable: true, isArchived: false, permissionCount: 1 },
  { id: 'role-config', key: 'custom.engine.locked', name: 'Config Locked Operator', description: 'Bundle-owned role', scope: 'engine', kind: 'custom', isEditable: true, isArchived: false, source: 'config', ownershipMode: 'config_locked', permissionCount: 1 },
];
const permissions = [
  { key: 'engine:instance:view', scope: 'engine', category: 'Runtime', label: 'View instances', description: 'View runtime instances' },
  { key: 'engine:members:manage', scope: 'engine', category: 'Access', label: 'Manage members', description: 'Change engine membership' },
];

function renderTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><RoleLibrarySettingsTab /></QueryClientProvider>);
}

function category(label: string) {
  const categories = screen.getAllByRole('button', { name: label });
  return categories[categories.length - 1]!;
}

describe('RoleLibrarySettingsTab interactions', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    authState.permissions = { userId: 'admin-1', platform: ['platform:authz:roles:view', 'platform:authz:roles:manage'], projects: [], engines: [], generatedAt: 1 };
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url === '/api/authz/roles') return roles;
      if (url === '/api/authz/permissions') return permissions;
      if (url === '/api/authz/roles/role-system') return { ...roles[0], permissions: ['engine:instance:view'] };
      if (url === '/api/authz/roles/role-custom') return { ...roles[1], permissions: ['engine:instance:view'] };
      if (url === '/api/authz/roles/role-config') return { ...roles[2], permissions: ['engine:instance:view'] };
      throw new Error(`Unexpected request: ${url}`);
    });
  });

  afterEach(cleanup);

  it('searches roles, groups permissions by category, and enables save only for unsaved custom-role changes', async () => {
    renderTab();
    await screen.findByText('System Operator');

    fireEvent.change(screen.getByLabelText('Search roles'), { target: { value: 'Custom' } });
    expect(screen.getByText('Custom Operator')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /System Operator system engine/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search roles'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Custom Operator custom engine/ }));

    expect(await screen.findByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.click(category('Access (1)'));
    fireEvent.click(document.getElementById('role-library-engine:members:manage')!);
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    fireEvent.change(document.getElementById('role-library-edit-name')!, { target: { value: 'Production operator' } });
    fireEvent.change(document.getElementById('role-library-edit-description')!, { target: { value: 'Editable metadata' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith('/api/authz/roles/role-custom', {
      name: 'Production operator', description: 'Editable metadata', permissionIds: ['engine:instance:view', 'engine:members:manage'],
    }));
  });

  it('requires acknowledgement before creating a role with a sensitive permission and duplicates system roles', async () => {
    renderTab();
    await screen.findByText('System Operator');
    fireEvent.click(await screen.findByRole('button', { name: 'Duplicate' }));
    expect(await screen.findByDisplayValue('System Operator copy')).toBeInTheDocument();

    fireEvent.click(category('Access (1)'));
    fireEvent.click(document.getElementById('create-role-engine:members:manage')!);
    expect(await screen.findByText('Sensitive permissions selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText('I understand this role includes sensitive permissions.'));
    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled();
  });

  it('confirms before archiving an editable custom role', async () => {
    vi.mocked(apiClient.delete).mockResolvedValue(undefined);
    renderTab();
    await screen.findByText('Custom Operator');
    fireEvent.click(screen.getByRole('button', { name: /Custom Operator custom engine/ }));
    await waitFor(() => expect(document.getElementById('role-library-edit-name')).toHaveValue('Custom Operator'));
    fireEvent.click(screen.getByRole('button', { name: 'Archive custom role' }));
    expect(screen.getByText('Archive custom role')).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Archive custom role' })).getByRole('button', { name: /Archive$/ }));
    await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith('/api/authz/roles/role-custom'));
  });

  it('marks config-owned roles and disables their local permission controls', async () => {
    renderTab();
    await screen.findByText('Config Locked Operator');
    fireEvent.click(screen.getByRole('button', { name: /Config Locked Operator custom engine Managed by config/ }));

    expect(await screen.findByText('Managed by configuration')).toBeInTheDocument();
    expect(screen.getByText('Managed by config')).toBeInTheDocument();
    fireEvent.click(category('Runtime (1)'));
    await waitFor(() => expect(document.getElementById('role-library-engine:instance:view')).toBeDisabled());

    const rolePanels = screen.getByLabelText('Search roles').closest('div[style*="grid-template-columns"]');
    expect(rolePanels).toHaveStyle({ gridTemplateColumns: 'minmax(13rem, 18rem) minmax(0, 1fr)' });
  });
});

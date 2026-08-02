import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import RoleLibrarySettingsTab from '@src/features/platform-admin/components/RoleLibrarySettingsTab';
import type { CurrentUserPermissions } from '@src/shared/types/auth';
import { server } from '../../../../../test/mocks/server';

const authState = vi.hoisted(() => ({
  permissions: {
    userId: 'admin-1',
    platform: ['platform:authz:roles:view', 'platform:authz:roles:manage'],
    tenantId: null, projects: [], engines: [], authorizationVersion: 'test-authz-v1', generatedAt: 1,
  } as CurrentUserPermissions,
}));

vi.mock('@src/shared/hooks/useAuth', () => ({ useAuth: () => authState }));

function renderTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><RoleLibrarySettingsTab /></QueryClientProvider>);
}

describe('RoleLibrarySettingsTab configuration export', () => {
  beforeEach(() => {
    server.use(
      http.get('/api/authz/roles', () => HttpResponse.json([{
        id: 'system.engine.operator', key: 'system.engine.operator', name: 'Engine Operator', description: 'Operate engines',
        scope: 'engine', kind: 'system', isEditable: false, isArchived: false, permissionCount: 2,
      }])),
      http.get('/api/authz/roles/system.engine.operator', () => HttpResponse.json({
        id: 'system.engine.operator', key: 'system.engine.operator', name: 'Engine Operator', description: 'Operate engines',
        scope: 'engine', kind: 'system', isEditable: false, isArchived: false, permissionCount: 2,
        permissions: ['engine:deploy', 'engine:view'],
      })),
      http.get('/api/authz/permissions', () => HttpResponse.json([
        { key: 'engine:deploy', scope: 'engine', category: 'Deployment', label: 'Deploy', description: 'Deploy models' },
        { key: 'engine:view', scope: 'engine', category: 'Engine', label: 'View engine', description: 'View engine' },
      ])),
    );
  });

  it('opens a prefilled configuration-managed system-role duplicate', async () => {
    const createObjectUrl = vi.fn(() => 'blob:config-role');
    const revokeObjectUrl = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrl });
    const downloadClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    renderTab();

    fireEvent.click(await screen.findByRole(
      'button',
      { name: 'Export config role' },
      { timeout: 10_000 },
    ));

    expect(await screen.findByText('Export configuration role')).toBeInTheDocument();
    expect(screen.getByLabelText('Bundle key')).toHaveValue('example.authz');
    expect(screen.getByLabelText('Tenant key')).toHaveValue('default');
    expect(screen.getByLabelText('Custom role key')).toHaveValue('custom.engine.operator');
    expect(screen.getAllByLabelText('Deploy').find((checkbox) => !checkbox.hasAttribute('disabled'))).toBeChecked();
    expect(screen.getByRole('button', { name: 'Export JSON' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Export JSON' }));

    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
    expect(downloadClick).toHaveBeenCalled();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:config-role');
    downloadClick.mockRestore();
  });
});

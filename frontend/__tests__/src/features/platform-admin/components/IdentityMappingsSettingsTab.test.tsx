import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import IdentityMappingsSettingsTab from '@src/features/platform-admin/components/IdentityMappingsSettingsTab';
import type { CurrentUserPermissions } from '@src/shared/types/auth';
import { server } from '../../../../../test/mocks/server';
import { identityMappingFixture } from '../../../../../test/mocks/handlers';

const authState = vi.hoisted(() => ({
  permissions: {
    userId: 'admin-1',
    platform: ['platform:sso-assignments:view', 'platform:sso-assignments:manage'],
    projects: [], engines: [], generatedAt: 1,
  } as CurrentUserPermissions,
}));

vi.mock('@src/shared/hooks/useAuth', () => ({ useAuth: () => authState }));

function renderTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><IdentityMappingsSettingsTab /></QueryClientProvider>);
}

function menuItem(label: string): HTMLElement | null {
  const node = screen.queryAllByText(label).find((candidate) => candidate.closest('.cds--overflow-menu-options__option'));
  return node?.closest('button') || node?.closest('[role="menuitem"]') || node || null;
}

describe('IdentityMappingsSettingsTab', () => {
  beforeEach(() => {
    authState.permissions = {
      userId: 'admin-1',
      platform: ['platform:sso-assignments:view', 'platform:sso-assignments:manage'],
      projects: [], engines: [], generatedAt: 1,
    };
  });

  it('renders manual mappings from the provider-neutral API', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText('group.engine-operators')).toBeInTheDocument());
    expect(screen.getByText('Manual')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add mapping/i })).toBeEnabled();
  });

  it('shows config-managed mappings but disables UI mutation actions', async () => {
    server.use(http.get('/api/identity/mappings', () => HttpResponse.json([{ ...identityMappingFixture, sourceRef: 'config:identity-mappings/operations' }])));
    renderTab();
    await waitFor(() => expect(screen.getByText('Managed by config')).toBeInTheDocument());

    const overflow = screen.getAllByRole('button').find((button) => button.className.includes('cds--overflow-menu'));
    if (!overflow) throw new Error('Mapping actions menu not found');
    fireEvent.click(overflow);

    await waitFor(() => expect(menuItem('Edit')).toBeTruthy());
    expect(menuItem('Edit')).toBeDisabled();
    expect(menuItem('Edit')).toHaveAttribute('title', 'Managed by configuration');
    expect(menuItem('Delete')).toBeDisabled();
    expect(menuItem('Delete')).toHaveAttribute('title', 'Managed by configuration');
  });

  it('does not load mapping data without the read action', () => {
    authState.permissions = { userId: 'viewer-1', platform: [], projects: [], engines: [], generatedAt: 1 };
    renderTab();
    expect(screen.getByText('Identity mappings unavailable')).toBeInTheDocument();
  });
});

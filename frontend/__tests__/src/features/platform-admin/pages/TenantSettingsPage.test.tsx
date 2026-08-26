import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TenantSettingsPage from '@src/features/platform-admin/pages/TenantSettingsPage';
import { apiClient } from '@src/shared/api/client';

const decisions = vi.hoisted(() => ({ read: true, settingsManage: true, membersManage: true }));

vi.mock('@src/shared/hooks/useAuth', () => ({
  useAuth: () => ({ permissions: { tenantId: 'tenant-alpha', tenant: { resourceId: 'tenant-alpha' } } }),
}));

vi.mock('@src/shared/auth/guards', () => ({
  useActionDecision: (action: string) => ({
    allowed: action === 'tenant.settings.read'
      ? decisions.read
      : action === 'tenant.settings.manage'
        ? decisions.settingsManage
        : decisions.membersManage,
    reason: 'Permission denied by test',
  }),
  UnauthorizedEmptyState: ({ title, reason }: { title: string; reason: string }) => <div><h1>{title}</h1><p>{reason}</p></div>,
}));

vi.mock('@src/features/platform-admin/components/IdentityProvidersSettingsTab', () => ({
  default: ({ tenantAdminMode, tenantId, onLoginPolicyChange }: any) => <section aria-label="Tenant identity providers">
    <span>{tenantAdminMode ? 'Tenant-managed providers' : 'Platform providers'} for {tenantId}</span>
    <button type="button" onClick={() => onLoginPolicyChange({ localPasswordLoginMode: 'disabled', ssoProviderSelectionMode: 'chooser' })}>Save segregated sign-in policy</button>
  </section>,
}));

vi.mock('@src/shared/api/client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/t/alpha/admin/settings']}>
        <Routes><Route path="/t/:tenantSlug/admin/settings" element={<TenantSettingsPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TenantSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    decisions.read = true;
    decisions.settingsManage = true;
    decisions.membersManage = true;
    vi.mocked(apiClient.get).mockImplementation(async (path: string) => {
      if (path.endsWith('/login-policy')) return { localPasswordMode: 'auto', providerSelectionMode: 'chooser' };
      if (path.endsWith('/members')) return [{ userId: 'user-1', email: 'operator@alpha.example', role: 'admin' }];
      if (path.endsWith('/discovery-domains')) return [{ id: 'domain-1', tenantId: 'tenant-alpha', domain: 'alpha.example', status: 'verified', verifiedAt: 1 }];
      return [];
    });
    vi.mocked(apiClient.put).mockResolvedValue({ localPasswordMode: 'disabled', providerSelectionMode: 'chooser' });
  });

  it('loads members, discovery, login policy, and identity providers only through the tenant route', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('operator@alpha.example · Tenant administrator')).toBeInTheDocument();
    expect(screen.getByText('alpha.example')).toBeInTheDocument();
    expect(screen.getByText('Tenant-managed providers for tenant-alpha')).toBeInTheDocument();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/t/alpha/tenant/login-policy'));
    expect(apiClient.get).toHaveBeenCalledWith('/api/t/alpha/tenant/members');
    expect(apiClient.get).toHaveBeenCalledWith('/api/t/alpha/tenant/discovery-domains');
    expect(vi.mocked(apiClient.get).mock.calls.every(([path]) => String(path).startsWith('/api/t/alpha/'))).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Save segregated sign-in policy' }));
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith('/api/t/alpha/tenant/login-policy', {
      localPasswordMode: 'disabled', providerSelectionMode: 'chooser',
    }));
  });

  it('does not query tenant settings when read access is denied', () => {
    decisions.read = false;
    decisions.settingsManage = false;
    decisions.membersManage = false;
    renderPage();
    expect(screen.getByRole('heading', { name: 'Tenant settings unavailable' })).toBeInTheDocument();
    expect(apiClient.get).not.toHaveBeenCalled();
  });
});

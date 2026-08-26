import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TenantsPage from '@src/features/platform-admin/pages/TenantsPage';
import { apiClient } from '@src/shared/api/client';

const decisions = vi.hoisted(() => ({ read: true, manage: true }));

vi.mock('@src/shared/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'platform-admin', email: 'admin@example.test' } }),
}));

vi.mock('@src/shared/auth/guards', () => ({
  useActionDecision: (action: string) => ({
    allowed: action === 'platform.tenants.read' ? decisions.read : decisions.manage,
    reason: 'Permission denied by test',
  }),
  UnauthorizedEmptyState: ({ title, reason }: { title: string; reason: string }) => <div><h1>{title}</h1><p>{reason}</p></div>,
}));

vi.mock('@src/shared/api/client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><TenantsPage /></QueryClientProvider>);
}

describe('TenantsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    decisions.read = true;
    decisions.manage = true;
    vi.mocked(apiClient.get).mockResolvedValue([
      { id: 'tenant-alpha', name: 'Alpha Industries', slug: 'alpha', status: 'active', placementKey: 'pooled-a', placementEpoch: 1 },
    ]);
  });

  it('lists pooled tenants and creates a slug from the organization name', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.post).mockImplementation(() => new Promise(() => {}));
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Alpha Industries' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Tenant name'), 'Bravo Services EU');
    expect(screen.getByLabelText('Tenant slug')).toHaveValue('bravo-services-eu');
    await user.click(screen.getByRole('button', { name: 'Create tenant' }));
    expect(apiClient.post).toHaveBeenCalledWith('/api/platform/tenants', {
      name: 'Bravo Services EU', slug: 'bravo-services-eu', ownerUserId: 'platform-admin',
    });
  });

  it('keeps tenant creation read-only without lifecycle-manage permission', async () => {
    decisions.manage = false;
    renderPage();
    expect(await screen.findByRole('button', { name: 'Create tenant' })).toBeDisabled();
  });

  it('shows an explicit denied state without tenant-list permission', () => {
    decisions.read = false;
    renderPage();
    expect(screen.getByRole('heading', { name: 'Tenants unavailable' })).toBeInTheDocument();
    expect(apiClient.get).not.toHaveBeenCalled();
  });
});

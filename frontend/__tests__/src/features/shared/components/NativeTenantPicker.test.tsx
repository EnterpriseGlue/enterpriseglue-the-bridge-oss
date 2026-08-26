import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NativeTenantPicker from '@src/features/shared/components/NativeTenantPicker';
import { apiClient } from '@src/shared/api/client';

vi.mock('@src/shared/api/client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}));

function renderPicker(enabled = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/t/alpha/admin/settings?section=identity#providers']}>
        <NativeTenantPicker enabled={enabled} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('NativeTenantPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.get).mockResolvedValue([
      { tenantId: 'tenant-alpha', tenantSlug: 'alpha', tenantName: 'Alpha Industries', tenantStatus: 'active', role: 'admin' },
      { tenantId: 'tenant-bravo', tenantSlug: 'bravo', tenantName: 'Bravo Services', tenantStatus: 'suspended', role: 'member' },
      { tenantId: 'tenant-charlie', tenantSlug: 'charlie', tenantName: 'Charlie Operations', tenantStatus: 'active', role: 'member' },
    ]);
    vi.mocked(apiClient.post).mockResolvedValue({});
  });

  it('labels the active tenant and exposes only active memberships', async () => {
    renderPicker();

    const alphaLinks = await screen.findAllByRole('link', { name: 'Alpha Industries' });

    expect(alphaLinks[0]).toHaveAttribute('aria-haspopup', 'menu');
    expect(alphaLinks[alphaLinks.length - 1]).toHaveAttribute('href', '/t/alpha/admin/settings?section=identity#providers');
    expect(screen.getByRole('link', { name: 'Charlie Operations' })).toHaveAttribute('href', '/t/charlie/admin/settings?section=identity#providers');
    expect(screen.queryByRole('link', { name: 'Bravo Services' })).not.toBeInTheDocument();
    expect(apiClient.get).toHaveBeenCalledWith('/api/auth/my-tenants');
  });

  it('switches the server-side tenant context before browser navigation', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.post).mockImplementation(() => new Promise(() => {}));
    renderPicker();

    await user.click((await screen.findAllByRole('link', { name: 'Alpha Industries' }))[0]);
    await user.click(screen.getByRole('link', { name: 'Charlie Operations' }));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/auth/switch-tenant', { tenantSlug: 'charlie' }));
  });

  it('does not call the membership endpoint outside pooled mode', () => {
    renderPicker(false);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(apiClient.get).not.toHaveBeenCalled();
  });
});

import React from 'react';
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import EmailConfigurations from '@src/pages/admin/EmailConfigurations';
import { apiClient } from '@src/shared/api/client';

vi.mock('@src/shared/api/client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('@src/shared/notifications/ToastProvider', () => ({
  useToast: () => ({ notify: vi.fn() }),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <EmailConfigurations embedded />
    </QueryClientProvider>,
  );
}

describe('EmailConfigurations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (apiClient.get as any).mockResolvedValue([
      {
        id: 'locked', name: 'Release email', provider: 'smtp', fromName: 'EnterpriseGlue',
        fromEmail: 'release@example.com', enabled: true, isDefault: false, createdAt: 1, updatedAt: 2,
        configKey: 'release', sourceRef: 'config_bundle:headless.admin', ownershipMode: 'config_locked',
        driftStatus: 'in_sync',
      },
      {
        id: 'warn', name: 'Drift review', provider: 'resend', fromName: 'EnterpriseGlue',
        fromEmail: 'review@example.com', enabled: true, isDefault: false, createdAt: 1, updatedAt: 2,
        configKey: 'review', sourceRef: 'config_bundle:headless.admin', ownershipMode: 'config_warn',
        driftStatus: 'drifted',
      },
    ]);
  });

  it('shows locked and drifted configuration lineage and blocks locked mutations', async () => {
    renderPage();

    const lockedRow = (await screen.findByText('Release email')).closest('tr');
    expect(lockedRow).not.toBeNull();
    expect(within(lockedRow!).getByText('Managed by configuration')).toBeInTheDocument();

    const warnRow = screen.getByText('Drift review').closest('tr');
    expect(within(warnRow!).getByText('Configuration-linked')).toBeInTheDocument();
    expect(within(warnRow!).getByText('Drifted')).toBeInTheDocument();

    fireEvent.click(within(lockedRow!).getByRole('button'));
    await waitFor(() => expect(screen.getByText('Edit')).toBeInTheDocument());
    expect(screen.getByText('Edit').closest('button')).toBeDisabled();
    expect(apiClient.patch).not.toHaveBeenCalled();
    expect(apiClient.delete).not.toHaveBeenCalled();
  });
});

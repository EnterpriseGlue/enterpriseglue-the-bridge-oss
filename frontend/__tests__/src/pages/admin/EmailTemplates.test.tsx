import React from 'react';
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import EmailTemplates from '@src/pages/admin/EmailTemplates';
import { apiClient } from '@src/shared/api/client';

vi.mock('@src/shared/api/client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn() },
}));

vi.mock('@src/shared/notifications/ToastProvider', () => ({
  useToast: () => ({ notify: vi.fn() }),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <EmailTemplates embedded />
    </QueryClientProvider>,
  );
}

describe('EmailTemplates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path === '/api/admin/email-platform-name') {
        return Promise.resolve({
          emailPlatformName: 'EnterpriseGlue',
          ownership: { section: 'general', sourceRef: 'config_bundle:headless.admin', ownershipMode: 'config_locked', driftStatus: 'in_sync' },
        });
      }
      return Promise.resolve([
        {
          id: 'locked', type: 'invite', name: 'Invite', subject: 'Join us', htmlTemplate: '<p>Join</p>',
          textTemplate: 'Join', variables: [], isActive: true, createdAt: 1, updatedAt: 2,
          configKey: 'invite', sourceRef: 'config_bundle:headless.admin', ownershipMode: 'config_locked', driftStatus: 'in_sync',
        },
        {
          id: 'warn', type: 'welcome', name: 'Welcome', subject: 'Welcome', htmlTemplate: '<p>Welcome</p>',
          textTemplate: 'Welcome', variables: [], isActive: true, createdAt: 1, updatedAt: 2,
          configKey: 'welcome', sourceRef: 'config_bundle:headless.admin', ownershipMode: 'config_warn', driftStatus: 'drifted',
        },
      ]);
    });
  });

  it('locks configured platform naming and template mutations while surfacing drift', async () => {
    renderPage();

    expect(await screen.findByText('Email platform name is managed by configuration')).toBeInTheDocument();
    expect(screen.getByLabelText('Email Platform Name')).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Save' }).some((button) => button.hasAttribute('disabled'))).toBe(true);

    const lockedRow = screen.getByText('Invite').closest('tr');
    expect(within(lockedRow!).getByText('Managed by configuration')).toBeInTheDocument();
    expect(within(lockedRow!).getByRole('button', { name: 'Edit' })).toBeDisabled();
    expect(within(lockedRow!).getByRole('button', { name: 'Reset to Default' })).toBeDisabled();
    expect(within(lockedRow!).getByRole('button', { name: 'Preview' })).toBeEnabled();

    const warnRow = screen.getAllByText('Welcome')[0].closest('tr');
    expect(within(warnRow!).getByText('Configuration-linked')).toBeInTheDocument();
    expect(within(warnRow!).getByText('Drifted')).toBeInTheDocument();
    expect(apiClient.put).not.toHaveBeenCalled();
    expect(apiClient.patch).not.toHaveBeenCalled();
  });
});

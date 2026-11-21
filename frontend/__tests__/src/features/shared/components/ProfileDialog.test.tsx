import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileDialog } from '@src/features/shared/components/ProfileDialog';
import * as tenancy from '@src/services/tenancy';

const fixtures = vi.hoisted(() => ({
  user: { id: 'ada', email: 'ada@example.test', firstName: 'Ada', lastName: 'Lovelace', isEmailVerified: true },
  get: vi.fn(), patch: vi.fn(), redirect: vi.fn(),
}));
vi.mock('@src/shared/hooks/useAuth', () => ({ useAuth: () => ({ user: fixtures.user, permissions: { platform: [] }, refreshUser: vi.fn() }) }));
vi.mock('@src/shared/api/client', () => ({ apiClient: { get: fixtures.get, patch: fixtures.patch } }));
vi.mock('@src/utils/redirect', () => ({ redirectToApi: fixtures.redirect }));

function open() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={['/t/northwind/']}>
      <ProfileDialog open onClose={vi.fn()} isMultiTenant tenantSlug="northwind" />
    </MemoryRouter>
  </QueryClientProvider>);
}

describe('Profile sign-in method recovery', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('omits platform access details for a standard organization account', async () => {
    const capability = vi.spyOn(tenancy, 'getTenancyCapabilities')
      .mockReturnValue({ ...tenancy.getTenancyCapabilities(), mode: 'pooled' });
    fixtures.get.mockResolvedValue({ providers: [] });

    try {
      open();
      expect(await screen.findByRole('dialog', { name: 'My profile' })).toBeVisible();
      expect(screen.queryByText('Platform access')).not.toBeInTheDocument();
    } finally {
      capability.mockRestore();
    }
  });

  it('retries methods locally while preserving edited names', async () => {
    let attempts = 0;
    fixtures.get.mockImplementation(async (path: string) => {
      if (path.endsWith('/identity-providers')) {
        if (++attempts === 1) throw new Error('Temporary outage');
        return { providers: [{ id: 'google', displayName: 'Google', linked: true }] };
      }
      return { documentationOrigin: 'https://docs.enterpriseglue.ai' };
    });
    const user = userEvent.setup();
    open();
    await screen.findByText('Sign-in methods unavailable');
    await user.clear(screen.getByLabelText('First name'));
    await user.type(screen.getByLabelText('First name'), 'New name');
    await user.click(screen.getByRole('button', { name: 'Retry sign-in methods' }));
    expect(await screen.findByText('Google')).toBeInTheDocument();
    expect(screen.getByLabelText('First name')).toHaveValue('New name');
    expect(screen.getByRole('dialog', { name: 'My profile' })).toBeVisible();
    expect(fixtures.patch).not.toHaveBeenCalled();
    expect(attempts).toBe(2);
  });

  it('explains and prevents external provider navigation while name changes are unsaved', async () => {
    fixtures.get.mockImplementation(async (path: string) => path.endsWith('/identity-providers')
      ? { providers: [{ id: 'microsoft', displayName: 'Microsoft', linked: false }] }
      : { documentationOrigin: 'https://docs.enterpriseglue.ai' });
    const user = userEvent.setup();
    open();
    const connect = await screen.findByRole('button', { name: 'Connect' });
    await user.type(screen.getByLabelText('First name'), ' changed');
    expect(connect).toBeDisabled();
    expect(connect).toHaveAccessibleDescription('Save your name changes before connecting another sign-in method.');
    expect(fixtures.redirect).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText('First name'));
    await user.type(screen.getByLabelText('First name'), 'Ada');
    await user.click(connect);
    expect(fixtures.redirect).toHaveBeenCalledExactlyOnceWith('/api/auth/me/identity-providers/microsoft/link?returnTo=%2Ft%2Fnorthwind%2F');
  });
});

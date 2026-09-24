import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@src/shared/notifications/ToastProvider';
import Login from '@src/pages/Login';
import { apiClient } from '@src/shared/api/client';

const navigateMock = vi.fn();
const redirectMock = vi.fn();
const authState = vi.hoisted(() => ({ isAuthenticated: false, isLoading: false }));

vi.mock('@src/utils/redirect', () => ({ redirectTo: (...args: unknown[]) => redirectMock(...args) }));

vi.mock('@src/shared/hooks/useAuth', () => ({
  useAuth: () => ({
    login: vi.fn(),
    setAuthenticatedUser: vi.fn(),
    refreshPermissions: vi.fn(),
    get isAuthenticated() { return authState.isAuthenticated; },
    get isLoading() { return authState.isLoading; },
  }),
}));

vi.mock('@src/services/tenancy', () => ({
  getTenancyCapabilities: () => ({
    mode: 'pooled',
    rootTenantAliasesEnabled: false,
    tenantScopedLoginRequired: true,
    databaseIsolation: 'postgres_rls',
    customDomainsEnabled: true,
    organizationDiscoveryEnabled: true,
    signedPlacementAssertionsEnabled: true,
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('@src/shared/api/client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}));

function renderLogin(initialPath = '/login') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <Login />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('pooled organization discovery login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    authState.isAuthenticated = false;
    authState.isLoading = false;
    (apiClient.get as any).mockImplementation((path: string) => path === '/api/auth/cloud-signup/providers' ? Promise.resolve([]) : Promise.resolve({}));
  });

  it('shows the neutral finder without calling ambiguous root login-method discovery', async () => {
    renderLogin();

    expect(await screen.findByRole('heading', { level: 1, name: 'Find your organization' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toHaveFocus();
    expect(apiClient.get).not.toHaveBeenCalledWith('/api/auth/login-methods');
  });

  it('routes one verified domain match to its canonical tenant login without an email query parameter', async () => {
    const user = userEvent.setup();
    (apiClient.post as any).mockResolvedValue({ status: 'resolved', tenantSlug: 'acme', loginPath: '/t/acme/login' });
    renderLogin();

    await user.type(await screen.findByLabelText('Email address'), 'Person@Acme.Example');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/auth/tenant-discovery', { email: 'person@acme.example' }));
    expect(navigateMock).toHaveBeenCalledWith('/t/acme/login', { replace: true });
    expect(window.sessionStorage.getItem('eg.tenancy.discoveryEmail')).toBe('person@acme.example');
    expect(JSON.stringify(navigateMock.mock.calls)).not.toContain('person@acme.example');
  });

  it('uses the common email response and keeps organization-name fallback available', async () => {
    const user = userEvent.setup();
    (apiClient.post as any).mockResolvedValue({
      status: 'verification_sent',
      message: 'If an active account can be found, a single-use organization link will be sent. You can also continue with an organization name.',
    });
    renderLogin();

    await user.type(await screen.findByLabelText('Email address'), 'person@shared.example');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Check your email')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Use an organization name instead' }));
    await user.type(screen.getByLabelText('Organization name'), 'bravo');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(navigateMock).toHaveBeenCalledWith('/t/bravo/login', { replace: true });
  });

  it('exchanges an email token once and presents only the returned active memberships', async () => {
    const user = userEvent.setup();
    (apiClient.post as any).mockResolvedValue({
      tenants: [
        { tenantId: 'a', tenantSlug: 'alpha', tenantName: 'Alpha Industries', tenantStatus: 'active', role: 'member' },
        { tenantId: 'b', tenantSlug: 'bravo', tenantName: 'Bravo Services', tenantStatus: 'active', role: 'admin' },
      ],
    });
    renderLogin('/login#discovery_token=opaque-email-token-that-is-long-enough');

    expect(await screen.findByRole('heading', { name: 'Choose an organization' })).toBeInTheDocument();
    expect(apiClient.post).toHaveBeenCalledTimes(1);
    expect(apiClient.post).toHaveBeenCalledWith('/api/auth/tenant-discovery/exchange', { token: 'opaque-email-token-that-is-long-enough' });
    expect(navigateMock).toHaveBeenCalledWith('/login', { replace: true });

    await user.click(screen.getByRole('button', { name: 'Bravo Services' }));
    expect(navigateMock).toHaveBeenCalledWith('/t/bravo/login', { replace: true });
  });

  it('never exchanges discovery tokens from the URL query string', async () => {
    renderLogin('/login?discovery_token=must-not-reach-the-server');

    expect(await screen.findByRole('heading', { level: 1, name: 'Find your organization' })).toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('offers configured global providers before email discovery and starts a signed login-return flow', async () => {
    const user = userEvent.setup();
    (apiClient.get as any).mockImplementation((path: string) => path === '/api/auth/cloud-signup/providers'
      ? Promise.resolve([{ id: 'microsoft-global', displayName: 'Microsoft', protocol: 'oidc' }])
      : Promise.resolve({}));
    renderLogin();

    await user.click(await screen.findByRole('button', { name: 'Sign in with Microsoft' }));
    expect(redirectMock).toHaveBeenCalledWith('/api/auth/cloud-signup/providers/microsoft-global/start?returnTo=%2Flogin');
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
    expect(apiClient.get).not.toHaveBeenCalledWith('/api/auth/login-methods');
  });

  it('opens the sole active membership only after the server issues a tenant-bound session', async () => {
    authState.isAuthenticated = true;
    (apiClient.get as any).mockImplementation((path: string) => path === '/api/auth/my-tenants'
      ? Promise.resolve([
        { tenantId: 'a', tenantSlug: 'alpha', tenantName: 'Alpha', tenantStatus: 'active', role: 'member' },
        { tenantId: 'b', tenantSlug: 'disabled', tenantName: 'Disabled', tenantStatus: 'suspended', role: 'member' },
      ])
      : path === '/api/auth/cloud-signup/providers' ? Promise.resolve([]) : Promise.resolve({}));
    (apiClient.post as any).mockResolvedValue({ tenantSlug: 'alpha' });
    renderLogin();

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/auth/switch-tenant', { tenantSlug: 'alpha' }));
    expect(redirectMock).toHaveBeenCalledWith('/t/alpha/');
    expect(screen.queryByLabelText('Email address')).not.toBeInTheDocument();
  });

  it('makes an authenticated user choose between active memberships without automatically selecting one', async () => {
    const user = userEvent.setup();
    authState.isAuthenticated = true;
    (apiClient.get as any).mockImplementation((path: string) => path === '/api/auth/my-tenants'
      ? Promise.resolve([
        { tenantId: 'a', tenantSlug: 'alpha', tenantName: 'Alpha', tenantStatus: 'active', role: 'member' },
        { tenantId: 'b', tenantSlug: 'bravo', tenantName: 'Bravo', tenantStatus: 'active', role: 'admin' },
        { tenantId: 'c', tenantSlug: 'charlie', tenantName: 'Charlie', tenantStatus: 'suspended', role: 'member' },
      ])
      : path === '/api/auth/cloud-signup/providers' ? Promise.resolve([]) : Promise.resolve({}));
    (apiClient.post as any).mockResolvedValue({ tenantSlug: 'bravo' });
    renderLogin();

    expect(await screen.findByRole('heading', { name: 'Choose an organization' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Charlie' })).not.toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Bravo' }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/auth/switch-tenant', { tenantSlug: 'bravo' }));
    expect(redirectMock).toHaveBeenCalledWith('/t/bravo/');
  });

  it('does not navigate when authenticated membership lookup fails', async () => {
    const user = userEvent.setup();
    authState.isAuthenticated = true;
    (apiClient.get as any).mockImplementation((path: string) => path === '/api/auth/my-tenants'
      ? Promise.reject(new Error('unavailable'))
      : path === '/api/auth/cloud-signup/providers' ? Promise.resolve([]) : Promise.resolve({}));
    renderLogin();

    expect(await screen.findByText('Could not load your organizations. Try again.')).toBeInTheDocument();
    expect(redirectMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/auth/my-tenants'));
    expect((apiClient.get as any).mock.calls.filter(([path]: string[]) => path === '/api/auth/my-tenants')).toHaveLength(2);
  });

  it('does not guess an organization for a verified account with no active memberships', async () => {
    authState.isAuthenticated = true;
    (apiClient.get as any).mockImplementation((path: string) => path === '/api/auth/my-tenants'
      ? Promise.resolve([])
      : path === '/api/auth/cloud-signup/providers' ? Promise.resolve([]) : Promise.resolve({}));
    renderLogin();

    expect(await screen.findByRole('heading', { name: 'No organization yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create an organization' })).toHaveAttribute('href', '/cloud/onboarding');
    expect(apiClient.post).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('keeps the organization picker open when the server denies a tenant switch', async () => {
    const user = userEvent.setup();
    authState.isAuthenticated = true;
    (apiClient.get as any).mockImplementation((path: string) => path === '/api/auth/my-tenants'
      ? Promise.resolve([
        { tenantId: 'a', tenantSlug: 'alpha', tenantName: 'Alpha', tenantStatus: 'active', role: 'member' },
        { tenantId: 'b', tenantSlug: 'bravo', tenantName: 'Bravo', tenantStatus: 'active', role: 'member' },
      ])
      : path === '/api/auth/cloud-signup/providers' ? Promise.resolve([]) : Promise.resolve({}));
    (apiClient.post as any).mockRejectedValue(new Error('forbidden'));
    renderLogin();

    await user.click(await screen.findByRole('button', { name: 'Bravo' }));
    expect(await screen.findByText('Could not open this organization. Your access may have changed. Try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Alpha' })).toBeInTheDocument();
    expect(redirectMock).not.toHaveBeenCalled();
  });
});

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@src/shared/notifications/ToastProvider';
import Login from '@src/pages/Login';
import { apiClient } from '@src/shared/api/client';
import { redirectTo } from '@src/utils/redirect';

const loginMock = vi.fn().mockResolvedValue(undefined);
const setAuthenticatedUser = vi.fn();
const refreshPermissions = vi.fn().mockResolvedValue(null);

vi.mock('@src/shared/hooks/useAuth', () => ({
  useAuth: () => ({
    login: loginMock,
    setAuthenticatedUser,
    refreshPermissions,
    isAuthenticated: false,
    isLoading: false,
  }),
}));

vi.mock('@src/shared/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('@src/utils/redirect', () => ({
  redirectTo: vi.fn(),
}));

describe('Login SSO auto-redirect behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  function provider(id: string, overrides: Record<string, unknown> = {}) {
    return {
      id,
      key: `provider-${id}`,
      displayName: `Provider ${id}`,
      organization: null,
      protocol: 'oidc',
      loginMethod: 'redirect',
      preferred: false,
      loginDomains: [],
      ...overrides,
    };
  }

  function setupApiResponses(options: {
    providers?: ReturnType<typeof provider>[];
    localPassword?: boolean;
    providerSelection?: 'auto_redirect_single' | 'chooser' | 'progressive';
    autoRedirectProviderId?: string | null;
  }) {
    (apiClient.get as any).mockImplementation((url: string) => {
      if (url.endsWith('/auth/login-methods')) {
        const providers = options.providers || [];
        return Promise.resolve({
          localPassword: { enabled: options.localPassword ?? false },
          providerSelection: options.providerSelection || 'chooser',
          autoRedirectProviderId: options.autoRedirectProviderId ?? null,
          providers,
          configurationStatus: providers.length > 0 || options.localPassword ? 'ready' : 'no_login_method',
        });
      }
      if (url === '/api/auth/branding') {
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });
  }

  function renderLogin(initialPath = '/login') {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    return render(
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <MemoryRouter initialEntries={[initialPath]}>
            <Login />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    );
  }

  it('auto-redirects provider-neutral OIDC through its exact provider id', async () => {
    setupApiResponses({
      providers: [provider('oidc-1', { displayName: 'Corporate identity' })],
      providerSelection: 'auto_redirect_single',
      autoRedirectProviderId: 'oidc-1',
    });

    renderLogin('/t/default/login');

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith('/api/t/default/auth/login-methods');
      expect(redirectTo).toHaveBeenCalledWith('/api/t/default/auth/providers/oidc-1/start');
    });
  });

  it('does not auto-redirect when the explicit redirect bypass is present', async () => {
    setupApiResponses({
      providers: [provider('oidc-1')],
      providerSelection: 'auto_redirect_single',
      autoRedirectProviderId: 'oidc-1',
    });

    renderLogin('/login?no_sso_redirect=1');

    await waitFor(() => {
      expect((apiClient.get as any).mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    expect(redirectTo).not.toHaveBeenCalled();
  });

  it('does not auto-redirect when more than one SSO provider is enabled', async () => {
    setupApiResponses({
      providers: [
        provider('p1', { displayName: 'Microsoft Entra ID' }),
        provider('p2', { displayName: 'Partner SAML', protocol: 'saml' }),
      ],
      providerSelection: 'chooser',
    });

    renderLogin('/login');

    await waitFor(() => {
      expect((apiClient.get as any).mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    expect(redirectTo).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Microsoft Entra ID/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Partner SAML/i })).toBeInTheDocument();
  });

  it('shows local password fields only when the resolved policy enables them', async () => {
    setupApiResponses({
      providers: [provider('p1')],
      localPassword: true,
      providerSelection: 'chooser',
    });

    renderLogin('/login');

    await waitFor(() => {
      expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^sign in$/i })).toBeDisabled();
    });
  });

  it('uses friendly provider metadata and hides ordinary local credentials for SSO-only login', async () => {
    setupApiResponses({
      providers: [provider('p1', { displayName: 'Microsoft Entra ID', organization: 'Example Corporation' })],
      localPassword: false,
      providerSelection: 'chooser',
    });

    renderLogin();

    const providerTile = await screen.findByRole('button', { name: /Continue with Microsoft Entra ID Example Corporation/i });
    expect(providerTile).toHaveClass('eg-login-provider-tile', 'eg-login-provider-tile--primary');
    expect(screen.getByText('Continue with Microsoft Entra ID')).toHaveClass('eg-login-provider-tile__action');
    expect(screen.getByText('Example Corporation')).toHaveClass('eg-login-provider-tile__supporting');
    expect(providerTile.querySelector('.cds--tile--icon')).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Password$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/provider-p1/i)).not.toBeInTheDocument();
  });

  it('shortens the visual provider name while preserving its complete accessible name', async () => {
    const longName = 'Sign-in service for international employees, contractors, partners, and delegated administrators';
    setupApiResponses({
      providers: [provider('legacy-long-name', { displayName: longName })],
      localPassword: false,
      providerSelection: 'chooser',
    });

    renderLogin();

    expect(await screen.findByRole('button', { name: `Continue with ${longName}` })).toBeInTheDocument();
    expect(screen.getByText('Continue with Sign-in service for international emplo…')).toBeInTheDocument();
    expect(screen.getByTitle(longName)).toBeInTheDocument();
    expect(screen.queryByText(longName, { exact: true })).not.toBeInTheDocument();
  });

  it('gives administrators a plain-language next action when no sign-in method is configured', async () => {
    setupApiResponses({
      providers: [],
      localPassword: false,
      providerSelection: 'chooser',
    });

    renderLogin();

    expect(await screen.findByText('No sign-in method is available')).toBeInTheDocument();
    expect(screen.getByText('Ask a platform administrator to enable work-account sign-in or local password sign-in.')).toBeInTheDocument();
  });

  it('routes progressive discovery to the matching provider without exposing account existence', async () => {
    const user = userEvent.setup();
    setupApiResponses({
      providers: [
        provider('entra', { displayName: 'Microsoft Entra ID', loginDomains: ['example.com'] }),
        provider('partner', { displayName: 'Partner SAML', protocol: 'saml', loginDomains: ['partner.example'] }),
      ],
      providerSelection: 'progressive',
    });

    renderLogin('/t/default/login');
    await user.type(await screen.findByLabelText('Work email'), 'person@example.com');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('heading', { name: 'Opening Microsoft Entra ID' })).toBeInTheDocument();
    await waitFor(() => {
      expect(redirectTo).toHaveBeenCalledWith('/api/t/default/auth/providers/entra/start');
    });
  });

  it('lets users cancel an automatic redirect and return to the provider chooser', async () => {
    const user = userEvent.setup();
    setupApiResponses({
      providers: [provider('oidc-1', { displayName: 'Corporate identity' })],
      providerSelection: 'auto_redirect_single',
      autoRedirectProviderId: 'oidc-1',
    });

    renderLogin();

    expect(await screen.findByRole('heading', { name: 'Opening Corporate identity' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Choose another sign-in method' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Choose how to sign in' })).toHaveFocus());
    expect(screen.getByRole('button', { name: /Continue with Corporate identity/ })).toBeInTheDocument();
    await new Promise((resolve) => window.setTimeout(resolve, 650));
    expect(redirectTo).not.toHaveBeenCalled();
  });

  it('keeps break-glass credentials on the separate administrator recovery route', async () => {
    setupApiResponses({});
    renderLogin('/admin-recovery');

    expect(await screen.findByText('Administrator recovery')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in for recovery' })).toBeDisabled();
    expect(apiClient.get).not.toHaveBeenCalledWith('/api/auth/login-methods');
  });
});

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@src/shared/notifications/ToastProvider';
import Login from '@src/pages/Login';
import { apiClient } from '@src/shared/api/client';
import { redirectTo } from '@src/utils/redirect';

const loginMock = vi.fn().mockResolvedValue(undefined);

vi.mock('@src/shared/hooks/useAuth', () => ({
  useAuth: () => ({ login: loginMock }),
}));

vi.mock('@src/shared/api/client', () => ({
  apiClient: {
    get: vi.fn(),
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

  function setupApiResponses(options: {
    identityProviders?: Array<{ id: string; key: string; protocol: 'oidc' | 'saml' | 'ldap'; loginMethod: 'redirect' | 'password' }>;
    autoRedirect: boolean;
  }) {
    (apiClient.get as any).mockImplementation((url: string) => {
      if (url === '/api/auth/providers/enabled') {
        return Promise.resolve(options.identityProviders || []);
      }
      if (url === '/api/auth/branding') {
        return Promise.resolve({ ssoAutoRedirectSingleProvider: options.autoRedirect });
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
      identityProviders: [{ id: 'oidc-1', key: 'corp-oidc', protocol: 'oidc', loginMethod: 'redirect' }],
      autoRedirect: true,
    });

    renderLogin('/t/default/login');

    await waitFor(() => {
      expect(redirectTo).toHaveBeenCalledWith('/api/auth/providers/oidc-1/start?tenantSlug=default');
    });
  });

  it('does not auto-redirect when local bypass query param is present', async () => {
    setupApiResponses({
      identityProviders: [{ id: 'oidc-1', key: 'corp-oidc', protocol: 'oidc', loginMethod: 'redirect' }],
      autoRedirect: true,
    });

    renderLogin('/login?local=1');

    await waitFor(() => {
      expect((apiClient.get as any).mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    expect(redirectTo).not.toHaveBeenCalled();
  });

  it('does not auto-redirect when more than one SSO provider is enabled', async () => {
    setupApiResponses({
      identityProviders: [
        { id: 'p1', key: 'corp-oidc', protocol: 'oidc', loginMethod: 'redirect' },
        { id: 'p2', key: 'corp-saml', protocol: 'saml', loginMethod: 'redirect' },
      ],
      autoRedirect: true,
    });

    renderLogin('/login');

    await waitFor(() => {
      expect((apiClient.get as any).mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    expect(redirectTo).not.toHaveBeenCalled();
  });

  it('keeps local login available for the backend-enforced break-glass policy', async () => {
    setupApiResponses({
      identityProviders: [{ id: 'p1', key: 'corp-oidc', protocol: 'oidc', loginMethod: 'redirect' }],
      autoRedirect: false,
    });

    renderLogin('/login');

    await waitFor(() => {
      expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^sign in$/i })).toBeDisabled();
    });
  });
});

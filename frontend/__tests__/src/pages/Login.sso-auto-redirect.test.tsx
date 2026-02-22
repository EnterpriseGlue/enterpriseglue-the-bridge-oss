import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../../src/shared/notifications/ToastProvider';
import Login from '../../../src/pages/Login';
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
    providers: Array<{ id: string; name: string; type: 'microsoft' | 'google' | 'saml' | 'oidc' }>;
    autoRedirect: boolean;
  }) {
    (apiClient.get as any).mockImplementation((url: string) => {
      if (url === '/api/sso/providers/enabled') {
        return Promise.resolve(options.providers);
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

  it('auto-redirects when exactly one SSO provider is enabled and setting is on', async () => {
    setupApiResponses({
      providers: [{ id: 'p1', name: 'Entra SAML', type: 'saml' }],
      autoRedirect: true,
    });

    renderLogin('/login');

    await waitFor(() => {
      expect(redirectTo).toHaveBeenCalledWith('/api/auth/saml');
    });
  });

  it('does not auto-redirect when local bypass query param is present', async () => {
    setupApiResponses({
      providers: [{ id: 'p1', name: 'Entra SAML', type: 'saml' }],
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
      providers: [
        { id: 'p1', name: 'Entra SAML', type: 'saml' },
        { id: 'p2', name: 'Google', type: 'google' },
      ],
      autoRedirect: true,
    });

    renderLogin('/login');

    await waitFor(() => {
      expect((apiClient.get as any).mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    expect(redirectTo).not.toHaveBeenCalled();
  });

  it('hides local login form when SSO providers are enabled', async () => {
    setupApiResponses({
      providers: [{ id: 'p1', name: 'Entra SAML', type: 'saml' }],
      autoRedirect: false,
    });

    renderLogin('/login');

    await waitFor(() => {
      expect((apiClient.get as any).mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Local sign-in disabled/i)).toBeInTheDocument();
  });
});

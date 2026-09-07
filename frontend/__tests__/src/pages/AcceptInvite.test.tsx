import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AcceptInvite from '@src/pages/AcceptInvite';
import { apiClient } from '@src/shared/api/client';
import { redirectTo, replaceAndReloadToInternalPath } from '@src/utils/redirect';
vi.mock('@src/utils/redirect', () => ({ redirectTo: vi.fn(), replaceAndReloadToInternalPath: vi.fn() }));

const navigateMock = vi.fn();
const notifyMock = vi.fn();
const setAuthenticatedUserMock = vi.fn();

vi.mock('@src/shared/api/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('@src/shared/api/client')>(),
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('@src/shared/notifications/ToastProvider', () => ({
  useToast: () => ({ notify: notifyMock }),
}));

vi.mock('@src/shared/hooks/useAuth', () => ({
  useAuth: () => ({ setAuthenticatedUser: setAuthenticatedUserMock }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/t/default/invite/token-1']}>
      <Routes>
        <Route path="/t/:tenantSlug/invite/:token" element={<AcceptInvite />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('AcceptInvite', () => {
  it('leaves unavailable invitations with a full-document login navigation', async () => {
    renderPage();
    const link = await screen.findByRole('link', { name: 'Go to login' });
    expect(link).toHaveAttribute('href', '/login');
    let interceptedByRouter: boolean | undefined;
    const observeClick = (event: MouseEvent) => {
      interceptedByRouter = event.defaultPrevented;
      event.preventDefault(); // JSDOM cannot perform document navigation.
    };
    document.addEventListener('click', observeClick);
    try {
      fireEvent.click(link);
      expect(interceptedByRouter).toBe(false);
      expect(navigateMock).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('click', observeClick);
    }
  });
  function ssoFixture(protocol: 'oidc' | 'saml' | 'ldap') {
    const provider = { id: `provider-${protocol}`, key: protocol, displayName: `Organization ${protocol}`, protocol, loginMethod: protocol === 'ldap' ? 'password' : 'redirect' };
    vi.mocked(apiClient.get).mockImplementation(async (url) => {
      if (url === '/api/auth/branding') return {} as any;
      if (url === '/api/t/default/invitations/token-1') return { email: 'invitee@example.com', tenantSlug: 'alpha', resourceType: 'tenant', deliveryMethod: 'email', expiresAt: Date.now() + 60000, status: 'onboarding' } as any;
      if (url === '/api/t/default/auth/onboarding/login-methods') return { localPassword: { enabled: false }, providers: [provider], providerSelection: 'chooser', autoRedirectProviderId: null, configurationStatus: 'ready' } as any;
      throw new Error(`Unhandled GET ${url}`);
    });
    return provider;
  }

  it.each(['oidc', 'saml'] as const)('starts dedicated %s enrollment without offering a local password', async (protocol) => {
    const provider = ssoFixture(protocol);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: `Continue with ${provider.displayName}` }));
    expect(redirectTo).toHaveBeenCalledWith(`/api/t/default/auth/onboarding/providers/${provider.id}/start`);
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('completes LDAP enrollment using only the dedicated invitation endpoint', async () => {
    const provider = ssoFixture('ldap');
    vi.mocked(apiClient.post).mockResolvedValue({ user: { id: 'invitee-a', email: 'invitee@example.com' } });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: `Continue with ${provider.displayName}` }));
    await user.type(screen.getByLabelText('Directory password'), 'DirectorySecret!7');
    await user.click(screen.getByRole('button', { name: 'Complete SSO enrollment' }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/t/default/auth/onboarding/providers/provider-ldap/login', { username: 'invitee@example.com', password: 'DirectorySecret!7' }));
    // The reloaded authenticated shell restores the server-issued session.
    // Do not launch permission requests that navigation would cancel.
    expect(setAuthenticatedUserMock).not.toHaveBeenCalled();
    expect(replaceAndReloadToInternalPath).toHaveBeenCalledWith('/t/alpha/');
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  });

  it('fails closed when verified onboarding methods cannot be loaded', async () => {
    ssoFixture('oidc');
    const original = vi.mocked(apiClient.get).getMockImplementation()!;
    vi.mocked(apiClient.get).mockImplementation(async (url, ...args) => {
      if (url === '/api/t/default/auth/onboarding/login-methods') throw new Error('Expired onboarding session');
      return original(url, ...args);
    });
    renderPage();
    expect(await screen.findByText('Sign-in methods unavailable')).toBeInTheDocument();
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Finish account setup' })).not.toBeInTheDocument();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.stubGlobal('atob', (value: string) => Buffer.from(value, 'base64').toString('binary'));
    URL.createObjectURL = vi.fn(() => 'blob:test');
    URL.revokeObjectURL = vi.fn();
    (apiClient.get as any).mockImplementation(async (url: string) => {
if (url === '/api/auth/branding') return {};
      if (url === '/api/t/default/auth/onboarding/login-methods') return { localPassword: { enabled: true }, providers: [], providerSelection: 'chooser', autoRedirectProviderId: null, configurationStatus: 'ready' };
      throw new Error(`Unhandled GET ${url}`);
    });
    (apiClient.post as any).mockImplementation(async (url: string) => {
      throw new Error(`Unhandled POST ${url}`);
    });
  });

  it('redeems email-delivered invites before showing account setup', async () => {
    (apiClient.get as any).mockImplementation(async (url: string) => {
if (url === '/api/auth/branding') return {};
      if (url === '/api/t/default/auth/onboarding/login-methods') return { localPassword: { enabled: true }, providers: [], providerSelection: 'chooser', autoRedirectProviderId: null, configurationStatus: 'ready' };
      if (url === '/api/t/default/invitations/token-1') {
        return {
          email: 'invitee@example.com',
          tenantSlug: 'default',
          resourceType: 'tenant',
          resourceName: 'default',
          resourceRole: null,
          resourceRoles: [],
          deliveryMethod: 'email',
          expiresAt: Date.now() + 60_000,
          status: 'pending',
        };
      }
      throw new Error(`Unhandled GET ${url}`);
    });
    (apiClient.post as any).mockResolvedValue({ requiresPasswordSet: true, tenantSlug: 'default', deliveryMethod: 'email' });

    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByRole('button', { name: /continue to account setup/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /continue to account setup/i }));

    expect(apiClient.post).toHaveBeenCalledWith('/api/t/default/invitations/token-1/redeem', {});
    await waitFor(() => expect(screen.getByLabelText(/first name/i)).toBeInTheDocument());
  });

  it('verifies manual invites with an OTP before showing account setup', async () => {
    (apiClient.get as any).mockImplementation(async (url: string) => {
if (url === '/api/auth/branding') return {};
      if (url === '/api/t/default/auth/onboarding/login-methods') return { localPassword: { enabled: true }, providers: [], providerSelection: 'chooser', autoRedirectProviderId: null, configurationStatus: 'ready' };
      if (url === '/api/t/default/invitations/token-1') {
        return {
          email: 'invitee@example.com',
          tenantSlug: 'default',
          resourceType: 'project',
          resourceName: 'Project One',
          resourceRole: 'viewer',
          resourceRoles: ['viewer'],
          deliveryMethod: 'manual',
          expiresAt: Date.now() + 60_000,
          status: 'pending',
        };
      }
      throw new Error(`Unhandled GET ${url}`);
    });
    (apiClient.post as any).mockResolvedValue({ requiresPasswordSet: true, tenantSlug: 'default', deliveryMethod: 'manual' });

    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByLabelText(/one-time password/i)).toBeInTheDocument());
    await user.type(screen.getByLabelText(/one-time password/i), 'Manual123!');
    await user.click(screen.getByRole('button', { name: /verify one-time password/i }));

    expect(apiClient.post).toHaveBeenCalledWith('/api/t/default/invitations/token-1/verify-otp', { oneTimePassword: 'Manual123!' });
    await waitFor(() => expect(screen.getByLabelText(/first name/i)).toBeInTheDocument());
  });

  it('resumes directly at account setup when the invite is already in onboarding state', async () => {
    (apiClient.get as any).mockImplementation(async (url: string) => {
if (url === '/api/auth/branding') return {};
      if (url === '/api/t/default/auth/onboarding/login-methods') return { localPassword: { enabled: true }, providers: [], providerSelection: 'chooser', autoRedirectProviderId: null, configurationStatus: 'ready' };
      if (url === '/api/t/default/invitations/token-1') {
        return {
          email: 'invitee@example.com',
          tenantSlug: 'default',
          resourceType: 'tenant',
          resourceName: 'default',
          resourceRole: null,
          resourceRoles: [],
          deliveryMethod: 'email',
          expiresAt: Date.now() + 60_000,
          status: 'onboarding',
        };
      }
      throw new Error(`Unhandled GET ${url}`);
    });

    renderPage();

    await waitFor(() => expect(screen.getByLabelText(/first name/i)).toBeInTheDocument());
    expect(screen.queryByLabelText(/one-time password/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /continue to account setup/i })).not.toBeInTheDocument();
  });
});

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@src/shared/notifications/ToastProvider';
import Login from '@src/pages/Login';
import { apiClient } from '@src/shared/api/client';
import { redirectTo } from '@src/utils/redirect';

const loginMock = vi.fn().mockResolvedValue(undefined);
const navigateMock = vi.fn();
const authState = {
  isAuthenticated: false,
  isLoading: false,
};

vi.mock('@src/shared/hooks/useAuth', () => ({
  useAuth: () => ({ login: loginMock, setAuthenticatedUser: vi.fn(), refreshPermissions: vi.fn(), ...authState }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('@src/shared/api/client', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    data: unknown;

    constructor(message: string, status = 500, data?: unknown) {
      super(message);
      this.status = status;
      this.data = data;
    }
  },
  apiClient: {
    get: vi.fn(),
    post: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@src/utils/redirect', () => ({ redirectTo: vi.fn() }));

describe('Login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.title = 'EnterpriseGlue';
    authState.isAuthenticated = false;
    authState.isLoading = false;
    (apiClient.get as any).mockImplementation((url: string) => {
      if (url === '/api/auth/login-methods') return Promise.resolve({ localPassword: { enabled: true }, providerSelection: 'chooser', autoRedirectProviderId: null, providers: [], configurationStatus: 'ready' });
      if (url === '/api/auth/branding') return Promise.resolve({});
      return Promise.resolve({});
    });
  });

  it('submits credentials when form is filled', async () => {
    const user = userEvent.setup();

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <MemoryRouter initialEntries={['/login']}>
            <Login />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    );

    const submit = await screen.findByRole('button', { name: /sign in/i });
    expect(submit.hasAttribute('disabled')).toBe(true);

    const emailInput = await screen.findByLabelText(/email/i);
    const passwordInput = screen.getByLabelText(/^password$/i);
    expect(emailInput).toHaveAttribute('autocomplete', 'username');
    expect(passwordInput).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByRole('button', { name: 'Show password' })).toBeInTheDocument();
    await user.type(emailInput, 'user@example.com');
    await user.type(passwordInput, 'Password123!');

    expect(submit.hasAttribute('disabled')).toBe(false);

    await user.click(submit);

    expect(loginMock).toHaveBeenCalledWith({
      email: 'user@example.com',
      password: 'Password123!',
    });
  });

  it('uses the branded header title text for the browser page title', async () => {
    (apiClient.get as any).mockImplementation((url: string) => {
      if (url === '/api/auth/login-methods') return Promise.resolve({ localPassword: { enabled: true }, providerSelection: 'chooser', autoRedirectProviderId: null, providers: [], configurationStatus: 'ready' });
      if (url === '/api/auth/branding') return Promise.resolve({ logoTitle: 'OneJOP' });
      return Promise.resolve({});
    });

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <MemoryRouter initialEntries={['/login']}>
            <Login />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    );

    expect(await screen.findByText('OneJOP')).toBeDefined();
    expect(document.title).toBe('OneJOP');
  });

  it('redirects authenticated users away from the login page', async () => {
    authState.isAuthenticated = true;

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <MemoryRouter initialEntries={['/login']}>
            <Login />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/t/default/', { replace: true });
    });
  });

  it('uses the provider-id LDAP login endpoint after selecting a directory provider', async () => {
    const user = userEvent.setup();
    (apiClient.get as any).mockImplementation((url: string) => {
      if (url.endsWith('/auth/login-methods')) return Promise.resolve({
        localPassword: { enabled: false },
        providerSelection: 'chooser',
        autoRedirectProviderId: null,
        providers: [{ id: 'ldap-1', key: 'corp-directory', displayName: 'Corporate directory', organization: null, protocol: 'ldap', loginMethod: 'password', preferred: true, loginDomains: [] }],
        configurationStatus: 'ready',
      });
      if (url === '/api/auth/branding') return Promise.resolve({});
      return Promise.resolve({});
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><ToastProvider><MemoryRouter initialEntries={['/t/default/login']}><Login /></MemoryRouter></ToastProvider></QueryClientProvider>);

    await user.click(await screen.findByRole('button', { name: /Continue with Corporate directory/i }));
    const usernameInput = screen.getByLabelText('Username');
    const passwordInput = screen.getByLabelText('Password');
    await waitFor(() => expect(usernameInput).toHaveFocus());
    expect(usernameInput).toHaveAttribute('autocomplete', 'username');
    expect(passwordInput).toHaveAttribute('autocomplete', 'current-password');
    await user.type(usernameInput, 'person@example.test');
    await user.type(passwordInput, 'directory-password');
    await user.click(screen.getByRole('button', { name: /^Sign in$/i }));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/t/default/auth/providers/ldap-1/login', { username: 'person@example.test', password: 'directory-password' }));
    expect(redirectTo).toHaveBeenCalledWith('/t/default/');
  });
});

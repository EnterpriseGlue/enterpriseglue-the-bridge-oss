import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@src/shared/notifications/ToastProvider';
import Login from '@src/pages/Login';
import { apiClient } from '@src/shared/api/client';

const loginMock = vi.fn().mockRejectedValue(new Error('Invalid credentials'));

vi.mock('@src/shared/hooks/useAuth', () => ({
  useAuth: () => ({ login: loginMock, setAuthenticatedUser: vi.fn(), refreshPermissions: vi.fn(), isAuthenticated: false, isLoading: false }),
}));

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

describe('Login error state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (apiClient.get as any).mockImplementation((url: string) => {
      if (url === '/api/auth/login-methods') return Promise.resolve({ localPassword: { enabled: true }, providerSelection: 'chooser', autoRedirectProviderId: null, providers: [], configurationStatus: 'ready' });
      if (url === '/api/auth/branding') return Promise.resolve({});
      return Promise.resolve({});
    });
  });

  it('shows error when login fails', async () => {
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

    await user.type(await screen.findByLabelText(/email/i), 'user@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'Password123!');
    await user.click(screen.getByRole('button', { name: /^log in$/i }));

    await waitFor(() => {
      expect(screen.getByText('Log in failed')).toBeInTheDocument();
    });
    await waitFor(() => expect(screen.getByLabelText(/email/i)).toHaveFocus());
    expect(screen.getByText(/Invalid credentials/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toHaveValue('');
  });

  it('fails closed with an actionable message when the login-method policy cannot be loaded', async () => {
    let loginMethodAttempts = 0;
    (apiClient.get as any).mockImplementation((url: string) => {
      if (url === '/api/auth/login-methods') {
        loginMethodAttempts += 1;
        return loginMethodAttempts === 1
          ? Promise.reject(new Error('policy unavailable'))
          : Promise.resolve({ localPassword: { enabled: true }, providerSelection: 'chooser', autoRedirectProviderId: null, providers: [], configurationStatus: 'ready' });
      }
      if (url === '/api/auth/branding') return Promise.resolve({});
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

    const user = userEvent.setup();
    expect(await screen.findByText('Login methods could not be loaded')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^log in$/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: /^log in$/i })).toBeInTheDocument();
    expect(loginMethodAttempts).toBe(2);
  });
});

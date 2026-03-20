import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@src/shared/notifications/ToastProvider';
import Login from '@src/pages/Login';
import { apiClient } from '@src/shared/api/client';

const loginMock = vi.fn().mockResolvedValue(undefined);
const navigateMock = vi.fn();
const authState = {
  isAuthenticated: false,
  isLoading: false,
};

vi.mock('@src/shared/hooks/useAuth', () => ({
  useAuth: () => ({ login: loginMock, ...authState }),
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

describe('Login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.title = 'EnterpriseGlue';
    authState.isAuthenticated = false;
    authState.isLoading = false;
    (apiClient.get as any).mockImplementation((url: string) => {
      if (url === '/api/sso/providers/enabled') return Promise.resolve([]);
      if (url === '/api/auth/branding') return Promise.resolve({ ssoAutoRedirectSingleProvider: false });
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

    const submit = screen.getByRole('button', { name: /sign in/i });
    expect(submit.hasAttribute('disabled')).toBe(true);

    await user.type(screen.getByLabelText(/email/i), 'user@example.com');
    await user.type(screen.getByLabelText(/password/i), 'Password123!');

    expect(submit.hasAttribute('disabled')).toBe(false);

    await user.click(submit);

    expect(loginMock).toHaveBeenCalledWith({
      email: 'user@example.com',
      password: 'Password123!',
    });
  });

  it('uses the branded header title text for the browser page title', async () => {
    (apiClient.get as any).mockImplementation((url: string) => {
      if (url === '/api/sso/providers/enabled') return Promise.resolve([]);
      if (url === '/api/auth/branding') return Promise.resolve({ logoTitle: 'OneJOP', ssoAutoRedirectSingleProvider: false });
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
      expect(navigateMock).toHaveBeenCalledWith('/', { replace: true });
    });
  });
});

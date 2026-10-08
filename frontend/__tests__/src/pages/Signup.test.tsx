import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import Signup from '@src/pages/Signup';
import { apiClient, ApiError } from '@src/shared/api/client';

vi.mock('@src/shared/api/client', () => ({
  ApiError: class ApiError extends Error {
    constructor(public status: number, public statusText: string, message: string) { super(message); }
  },
  apiClient: { get: vi.fn() },
}));

describe('Signup', () => {
  beforeEach(() => vi.clearAllMocks());

  it('offers each sanitized managed Cloud identity method when enabled', async () => {
    vi.mocked(apiClient.get).mockResolvedValue([
      { id: 'cloud-signup-google', displayName: 'Google', protocol: 'oidc' },
      { id: 'cloud-signup-microsoft', displayName: 'Microsoft', protocol: 'oidc' },
      { id: 'cloud-signup-apple', displayName: 'Apple', protocol: 'oidc' },
    ]);
    render(<MemoryRouter><Signup /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Create your Cloud account' })).toBeInTheDocument();
    expect(document.querySelector('.eg-login-shell--process')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in with Microsoft' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with Apple' })).toBeInTheDocument();
    expect(document.querySelector('.eg-login-provider-button--google')).toBeInTheDocument();
    expect(document.querySelector('.eg-login-provider-button--microsoft')).toBeInTheDocument();
    expect(document.querySelector('.eg-login-provider-button--apple')).toBeInTheDocument();
    const email = screen.getByRole('link', { name: 'Continue with email' });
    expect(email).toHaveAttribute('href', '/signup/email');
    expect(email).toHaveClass('eg-login-provider-button', 'eg-login-provider-button--email');
    expect(email).toHaveAccessibleDescription('Verify your email, then create a passkey for secure sign-in.');
    expect(screen.getByRole('link', { name: /Already have an account/i })).toHaveAttribute('href', '/login');
  });

  it('preserves the self-hosted administrator-created account message when Cloud signup is disabled', async () => {
    vi.mocked(apiClient.get).mockRejectedValue(new ApiError(404, 'Not Found', 'disabled'));
    render(<MemoryRouter><Signup /></MemoryRouter>);

    expect(await screen.findByText('Self-service signup is not available on this EnterpriseGlue instance.')).toBeInTheDocument();
    expect(document.querySelector('.eg-login-shell--process')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to login' })).toHaveAttribute('href', '/login');
  });

  it('keeps the shared process shell while loading and when signup fails', async () => {
    vi.mocked(apiClient.get).mockImplementation((path) => path === '/api/auth/branding'
      ? Promise.resolve({}) : new Promise(() => {}));
    const view = render(<MemoryRouter><Signup /></MemoryRouter>);
    expect(screen.getByText('Loading account options…')).toBeInTheDocument();
    expect(document.querySelector('.eg-login-shell--process')).toBeInTheDocument();
    view.unmount();

    vi.mocked(apiClient.get).mockRejectedValue(new Error('unavailable'));
    render(<MemoryRouter><Signup /></MemoryRouter>);
    expect(await screen.findByText('Cloud account signup is temporarily unavailable.')).toBeInTheDocument();
    expect(document.querySelector('.eg-login-shell--process')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

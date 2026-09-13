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
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in with Microsoft' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with Apple' })).toBeInTheDocument();
    expect(document.querySelector('.eg-login-provider-button--google')).toBeInTheDocument();
    expect(document.querySelector('.eg-login-provider-button--microsoft')).toBeInTheDocument();
    expect(document.querySelector('.eg-login-provider-button--apple')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Already have an account/i })).toHaveAttribute('href', '/login');
  });

  it('preserves the self-hosted administrator-created account message when Cloud signup is disabled', async () => {
    vi.mocked(apiClient.get).mockRejectedValue(new ApiError(404, 'Not Found', 'disabled'));
    render(<MemoryRouter><Signup /></MemoryRouter>);

    expect(await screen.findByText('Self-service signup is not available on this EnterpriseGlue instance.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to login' })).toHaveAttribute('href', '/login');
  });
});

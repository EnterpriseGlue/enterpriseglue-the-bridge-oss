import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CloudEmailAuth from '@src/pages/CloudEmailAuth';
import { apiClient } from '@src/shared/api/client';

vi.mock('@src/shared/api/client', () => ({ apiClient: { get: vi.fn().mockResolvedValue({}), post: vi.fn() } }));

describe('Cloud email-and-passkey account page', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends only the email request, then shows a generic check-inbox message', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ message: 'If this address can be used, we will send the next step by email.' });
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/signup/email']}><CloudEmailAuth /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Sign up with email' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Other sign-up methods' })).toHaveAttribute('href', '/signup');
    await user.type(screen.getByRole('textbox', { name: 'Email address' }), 'New@Example.com');
    await user.click(screen.getByRole('button', { name: 'Email me a verification link' }));
    expect(apiClient.post).toHaveBeenCalledWith('/api/auth/cloud-signup/email/request', { email: 'new@example.com' });
    expect(await screen.findByText(/If this address can be used, we sent the next step/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create passkey and account' })).not.toBeInTheDocument();
  });

  it('retains a route to alternate sign-in methods', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(new Error('unavailable'));
    render(<MemoryRouter initialEntries={['/signup/email/signin']}><CloudEmailAuth /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Sign in with a passkey' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Other sign-in methods' })).toHaveAttribute('href', '/login');
  });
});

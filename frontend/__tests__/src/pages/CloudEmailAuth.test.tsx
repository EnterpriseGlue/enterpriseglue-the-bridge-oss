import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CloudEmailAuth from '@src/pages/CloudEmailAuth';
import { apiClient } from '@src/shared/api/client';

vi.mock('@src/shared/api/client', () => ({ apiClient: { get: vi.fn().mockResolvedValue({}), post: vi.fn() } }));
const webauthn = vi.hoisted(() => ({ supported: true, register: vi.fn(), authenticate: vi.fn() }));
vi.mock('@src/shared/auth/cloudWebAuthn', () => ({
  browserSupportsWebAuthn: () => webauthn.supported,
  startRegistration: webauthn.register,
  startAuthentication: webauthn.authenticate,
}));

describe('Cloud email-and-passkey account page', () => {
  beforeEach(() => { vi.clearAllMocks(); webauthn.supported = true; });

  it('sends only the email request, then shows a generic check-inbox message', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ message: 'If this address can be used, we will send the next step by email.' });
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/signup/email']}><CloudEmailAuth /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Sign up with email' })).toBeInTheDocument();
    expect(document.querySelector('.eg-login-shell--process')).toBeInTheDocument();
    expect(screen.getByText(/Then you’ll create a passkey/)).toBeInTheDocument();
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
    expect(document.querySelector('.eg-login-shell--process')).toBeInTheDocument();
    expect(await screen.findByText('Passkey sign-in is temporarily unavailable.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Other sign-in methods' })).toHaveAttribute('href', '/login');
  });

  it('offers alternate methods when this browser cannot use passkeys', async () => {
    webauthn.supported = false;
    vi.mocked(apiClient.post).mockResolvedValue({ challenge: 'synthetic-challenge' });
    render(<MemoryRouter initialEntries={['/signup/email/passkey']}><CloudEmailAuth /></MemoryRouter>);
    expect(await screen.findByText('Passkeys unavailable')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Other sign-up methods' })).toHaveAttribute('href', '/signup');
    expect(screen.queryByRole('button', { name: 'Create passkey and account' })).not.toBeInTheDocument();
    expect(webauthn.register).not.toHaveBeenCalled();
  });

  it('does not create an account after a cancelled registration prompt and permits a fresh challenge', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.post).mockResolvedValue({ challenge: 'synthetic-challenge' });
    webauthn.register.mockRejectedValue(new DOMException('Cancelled', 'NotAllowedError'));
    render(<MemoryRouter initialEntries={['/signup/email/passkey']}><CloudEmailAuth /></MemoryRouter>);
    const create = screen.getByRole('button', { name: 'Create passkey and account' });
    await waitFor(() => expect(create).toBeEnabled());
    await user.click(create);
    expect(await screen.findByText('The passkey could not be verified. Try again or choose another sign-in method.')).toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalledWith('/api/auth/cloud-signup/email/passkey/complete', expect.anything());
    expect(create).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(create).toBeEnabled());
    expect(apiClient.post).toHaveBeenCalledTimes(2);
  });

  it('fails closed for an expired verification link without requesting a credential', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(new Error('expired'));
    render(<MemoryRouter initialEntries={['/signup/email/passkey']}><CloudEmailAuth /></MemoryRouter>);
    expect(await screen.findByText('Your email link is invalid or has expired. Request a new link.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create passkey and account' })).toBeDisabled();
    expect(webauthn.register).not.toHaveBeenCalled();
  });
});

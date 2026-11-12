import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CloudEmailAuth from '@src/pages/CloudEmailAuth';
import { apiClient } from '@src/shared/api/client';

vi.mock('@src/shared/api/client', () => ({ apiClient: { get: vi.fn().mockResolvedValue({ siteKey: null }), post: vi.fn() } }));
const webauthn = vi.hoisted(() => ({ supported: true, register: vi.fn(), authenticate: vi.fn() }));
vi.mock('@src/shared/auth/cloudWebAuthn', () => ({
  browserSupportsWebAuthn: () => webauthn.supported,
  startRegistration: webauthn.register,
  startAuthentication: webauthn.authenticate,
}));

describe('Cloud email-and-passkey account page', () => {
  beforeEach(() => { vi.clearAllMocks(); webauthn.supported = true; vi.mocked(apiClient.get).mockResolvedValue({ siteKey: null }); });
  afterEach(() => vi.unstubAllGlobals());

  it('waits for a configured verification widget before submitting the email form', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ siteKey: 'synthetic-site-key' });
    vi.mocked(apiClient.post).mockResolvedValue({ message: 'accepted' });
    const widget = { render: vi.fn((_node, _options) => 'synthetic-widget'), remove: vi.fn() };
    vi.stubGlobal('turnstile', widget);
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/signup/email']}><CloudEmailAuth /></MemoryRouter>);
    const submit = screen.getByRole('button', { name: 'Email me a verification link' });
    await user.type(screen.getByRole('textbox', { name: 'Email address' }), 'new@example.com');
    await waitFor(() => expect(widget.render).toHaveBeenCalled());
    expect(submit).toBeDisabled();
    expect(apiClient.post).not.toHaveBeenCalled();
    const options = widget.render.mock.calls[0]![1] as { callback(token: string): void };
    act(() => options.callback('synthetic-token'));
    await user.click(submit);
    expect(apiClient.post).toHaveBeenCalledWith('/api/auth/cloud-signup/email/request',
      { email: 'new@example.com', turnstileToken: 'synthetic-token' });
    expect(await screen.findByText('Check your email')).toBeInTheDocument();
  });

  it('sends only the email request, then shows a generic check-inbox message', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ message: 'If this address can be used, we will send the next step by email.' });
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/signup/email']}><CloudEmailAuth /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Continue with email' })).toBeInTheDocument();
    expect(document.querySelector('.eg-login-shell--process')).toBeInTheDocument();
    expect(screen.getByText(/one-time sign-in link/)).toBeInTheDocument();
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

  it('redeems the verified email link on a browser without passkey support', async () => {
    webauthn.supported = false;
    vi.mocked(apiClient.post).mockResolvedValue({ success: true });
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/signup/email/continue']}><CloudEmailAuth /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: 'Sign in with email' }));
    expect(apiClient.post).toHaveBeenCalledExactlyOnceWith('/api/auth/cloud-signup/email/complete', {});
    expect(webauthn.register).not.toHaveBeenCalled();
  });

  it('offers a passkey after email sign-in and allows continuing without enrollment', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ success: true });
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/signup/email/continue']}><CloudEmailAuth /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: 'Sign in with email' }));
    expect(await screen.findByRole('button', { name: 'Add a passkey' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Continue to your account' })).toBeEnabled();
    expect(apiClient.post).toHaveBeenCalledExactlyOnceWith('/api/auth/cloud-signup/email/complete', {});
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

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CloudMicrosoftEmail from '@src/pages/CloudMicrosoftEmail';
import { apiClient } from '@src/shared/api/client';

vi.mock('@src/shared/api/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('@src/shared/api/client')>(),
  apiClient: { get: vi.fn(), post: vi.fn() },
}));

describe('Microsoft mailbox verification', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(apiClient.get).mockResolvedValue({});
  });

  it('requests a normalized address and tells the user where to open the link', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ success: true });
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/signup/microsoft/email']}><CloudMicrosoftEmail /></MemoryRouter>);
    await user.type(screen.getByRole('textbox', { name: 'Email address' }), 'Reader@Example.com');
    await user.click(screen.getByRole('button', { name: 'Email me a verification link' }));
    expect(apiClient.post).toHaveBeenCalledExactlyOnceWith('/api/auth/cloud-signup/microsoft/email/request', { email: 'reader@example.com' });
    expect(await screen.findByText('Open the link in the same browser you used to sign in with Microsoft.')).toBeVisible();
  });

  it('requires an explicit continuation before attempting to issue a session', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(new Error('The link has expired.'));
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/signup/microsoft/email?verified=1']}><CloudMicrosoftEmail /></MemoryRouter>);
    expect(apiClient.post).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(apiClient.post).toHaveBeenCalledExactlyOnceWith('/api/auth/cloud-signup/microsoft/email/complete', {});
    expect(await screen.findByText('Could not continue')).toBeVisible();
  });
});

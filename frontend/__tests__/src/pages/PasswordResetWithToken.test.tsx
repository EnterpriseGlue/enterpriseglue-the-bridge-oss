import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import PasswordResetWithToken from '../../../src/pages/PasswordResetWithToken';
import { authService } from '../../../src/services/auth';

const notifyMock = vi.fn();

vi.mock('@src/services/auth', () => ({
  authService: {
    verifyResetToken: vi.fn(),
    resetPasswordWithToken: vi.fn(),
  },
}));

vi.mock('@src/shared/notifications/ToastProvider', () => ({
  useToast: () => ({ notify: notifyMock }),
}));

describe('PasswordResetWithToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows invalid state when token is not valid', async () => {
    (authService.verifyResetToken as unknown as Mock).mockResolvedValue({ valid: false, error: 'Invalid token' });

    render(
      <MemoryRouter initialEntries={['/password-reset?token=bad']}> 
        <PasswordResetWithToken />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/invalid token/i)).toBeInTheDocument();
    });
  });

  it('submits reset when token is valid', async () => {
    (authService.verifyResetToken as unknown as Mock).mockResolvedValue({ valid: true });
    (authService.resetPasswordWithToken as unknown as Mock).mockResolvedValue(undefined);

    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/password-reset?token=valid']}> 
        <PasswordResetWithToken />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByLabelText(/new password/i)).toBeInTheDocument());

    await user.type(screen.getByLabelText(/new password/i), 'Password123!');
    await user.type(screen.getByLabelText(/confirm password/i), 'Password123!');
    await user.click(screen.getByRole('button', { name: /update password/i }));

    expect(authService.resetPasswordWithToken).toHaveBeenCalledWith({
      token: 'valid',
      newPassword: 'Password123!',
    });
  });
});

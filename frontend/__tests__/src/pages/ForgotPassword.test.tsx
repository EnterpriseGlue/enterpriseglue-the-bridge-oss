import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import ForgotPassword from '../../../src/pages/ForgotPassword';
import { authService } from '../../../src/services/auth';

const notifyMock = vi.fn();

vi.mock('@src/services/auth', () => ({
  authService: {
    forgotPassword: vi.fn(),
  },
}));

vi.mock('@src/shared/notifications/ToastProvider', () => ({
  useToast: () => ({ notify: notifyMock }),
}));

describe('ForgotPassword', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('submits forgot password request', async () => {
    (authService.forgotPassword as unknown as Mock).mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/forgot-password']}>
        <ForgotPassword />
      </MemoryRouter>
    );

    await user.type(screen.getByLabelText(/email/i), 'user@example.com');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(authService.forgotPassword).toHaveBeenCalledWith({ email: 'user@example.com' });
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'success', title: 'Reset email sent' })
    );
  });
});

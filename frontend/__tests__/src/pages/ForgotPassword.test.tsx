import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import ForgotPassword from '@src/pages/ForgotPassword';
import { authService } from '@src/services/auth';

vi.mock('@src/services/auth', () => ({
  authService: {
    forgotPassword: vi.fn(),
  },
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
    expect(await screen.findByText('Reset email sent')).toBeInTheDocument();
    expect(screen.getByText('If an account exists, a reset link has been sent.')).toBeInTheDocument();
  });
});

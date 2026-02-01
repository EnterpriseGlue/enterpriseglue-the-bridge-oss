import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RequireEmailVerification } from '@src/shared/components/RequireEmailVerification';

vi.mock('@src/shared/hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    Navigate: ({ to }: { to: string }) => <div>Navigate:{to}</div>,
  };
});

const mockUseAuth = async (state: { user: any }) => {
  const { useAuth } = await import('@src/shared/hooks/useAuth');
  (useAuth as any).mockReturnValue(state);
};

describe('RequireEmailVerification', () => {
  it('redirects unverified users to resend verification', async () => {
    await mockUseAuth({ user: { isEmailVerified: false, mustResetPassword: false } });

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <RequireEmailVerification>
          <div>Secret</div>
        </RequireEmailVerification>
      </MemoryRouter>
    );

    expect(screen.getByText('Navigate:/resend-verification')).toBeInTheDocument();
  });

  it('allows users who must reset password', async () => {
    await mockUseAuth({ user: { isEmailVerified: false, mustResetPassword: true } });

    render(
      <MemoryRouter initialEntries={['/reset-password']}>
        <RequireEmailVerification>
          <div>Reset</div>
        </RequireEmailVerification>
      </MemoryRouter>
    );

    expect(screen.getByText('Reset')).toBeInTheDocument();
  });

  it('renders children when verified', async () => {
    await mockUseAuth({ user: { isEmailVerified: true, mustResetPassword: false } });

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <RequireEmailVerification>
          <div>Secret</div>
        </RequireEmailVerification>
      </MemoryRouter>
    );

    expect(screen.getByText('Secret')).toBeInTheDocument();
  });
});

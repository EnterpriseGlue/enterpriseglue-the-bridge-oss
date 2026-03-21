import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AcceptInvite from '@src/pages/AcceptInvite';
import { apiClient } from '@src/shared/api/client';

const navigateMock = vi.fn();
const notifyMock = vi.fn();
const setAuthenticatedUserMock = vi.fn();

vi.mock('@src/shared/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('@src/shared/notifications/ToastProvider', () => ({
  useToast: () => ({ notify: notifyMock }),
}));

vi.mock('@src/shared/hooks/useAuth', () => ({
  useAuth: () => ({ setAuthenticatedUser: setAuthenticatedUserMock }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/t/default/invite/token-1']}>
      <Routes>
        <Route path="/t/:tenantSlug/invite/:token" element={<AcceptInvite />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('AcceptInvite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.stubGlobal('atob', (value: string) => Buffer.from(value, 'base64').toString('binary'));
    URL.createObjectURL = vi.fn(() => 'blob:test');
    URL.revokeObjectURL = vi.fn();
    (apiClient.get as any).mockImplementation(async (url: string) => {
      if (url === '/api/auth/branding') return {};
      throw new Error(`Unhandled GET ${url}`);
    });
    (apiClient.post as any).mockImplementation(async (url: string) => {
      throw new Error(`Unhandled POST ${url}`);
    });
  });

  it('redeems email-delivered invites before showing account setup', async () => {
    (apiClient.get as any).mockImplementation(async (url: string) => {
      if (url === '/api/auth/branding') return {};
      if (url === '/api/invitations/token-1') {
        return {
          email: 'invitee@example.com',
          tenantSlug: 'default',
          resourceType: 'tenant',
          resourceName: 'default',
          resourceRole: null,
          resourceRoles: [],
          deliveryMethod: 'email',
          expiresAt: Date.now() + 60_000,
          status: 'pending',
        };
      }
      throw new Error(`Unhandled GET ${url}`);
    });
    (apiClient.post as any).mockResolvedValue({ requiresPasswordSet: true, tenantSlug: 'default', deliveryMethod: 'email' });

    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByRole('button', { name: /continue to account setup/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /continue to account setup/i }));

    expect(apiClient.post).toHaveBeenCalledWith('/api/invitations/token-1/redeem', {});
    await waitFor(() => expect(screen.getByLabelText(/first name/i)).toBeInTheDocument());
  });

  it('verifies manual invites with an OTP before showing account setup', async () => {
    (apiClient.get as any).mockImplementation(async (url: string) => {
      if (url === '/api/auth/branding') return {};
      if (url === '/api/invitations/token-1') {
        return {
          email: 'invitee@example.com',
          tenantSlug: 'default',
          resourceType: 'project',
          resourceName: 'Project One',
          resourceRole: 'viewer',
          resourceRoles: ['viewer'],
          deliveryMethod: 'manual',
          expiresAt: Date.now() + 60_000,
          status: 'pending',
        };
      }
      throw new Error(`Unhandled GET ${url}`);
    });
    (apiClient.post as any).mockResolvedValue({ requiresPasswordSet: true, tenantSlug: 'default', deliveryMethod: 'manual' });

    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByLabelText(/one-time password/i)).toBeInTheDocument());
    await user.type(screen.getByLabelText(/one-time password/i), 'Manual123!');
    await user.click(screen.getByRole('button', { name: /verify one-time password/i }));

    expect(apiClient.post).toHaveBeenCalledWith('/api/invitations/token-1/verify-otp', { oneTimePassword: 'Manual123!' });
    await waitFor(() => expect(screen.getByLabelText(/first name/i)).toBeInTheDocument());
  });

  it('resumes directly at account setup when the invite is already in onboarding state', async () => {
    (apiClient.get as any).mockImplementation(async (url: string) => {
      if (url === '/api/auth/branding') return {};
      if (url === '/api/invitations/token-1') {
        return {
          email: 'invitee@example.com',
          tenantSlug: 'default',
          resourceType: 'tenant',
          resourceName: 'default',
          resourceRole: null,
          resourceRoles: [],
          deliveryMethod: 'email',
          expiresAt: Date.now() + 60_000,
          status: 'onboarding',
        };
      }
      throw new Error(`Unhandled GET ${url}`);
    });

    renderPage();

    await waitFor(() => expect(screen.getByLabelText(/first name/i)).toBeInTheDocument());
    expect(screen.queryByLabelText(/one-time password/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /continue to account setup/i })).not.toBeInTheDocument();
  });
});

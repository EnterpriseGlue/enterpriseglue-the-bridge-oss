import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProtectedRoute } from '@src/shared/components/ProtectedRoute';

vi.mock('@src/shared/hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@src/shared/api/client', () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

vi.mock('@carbon/react', () => ({
  InlineLoading: ({ description }: { description: string }) => <div>{description}</div>,
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    Navigate: ({ to }: { to: string }) => <div>Navigate:{to}</div>,
  };
});

const mockUseAuth = async (state: { user: any; isAuthenticated: boolean }) => {
  const { useAuth } = await import('@src/shared/hooks/useAuth');
  (useAuth as any).mockReturnValue(state);
};

describe('ProtectedRoute', () => {
  it('redirects unauthenticated users to login', async () => {
    await mockUseAuth({ user: null, isAuthenticated: false });

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <ProtectedRoute>
          <div>Secret</div>
        </ProtectedRoute>
      </MemoryRouter>
    );

    expect(screen.getByText('Navigate:/login')).toBeInTheDocument();
  });

  it('redirects non-admin users when requireAdmin', async () => {
    await mockUseAuth({
      user: { capabilities: { canAccessAdminRoutes: false, canManagePlatformSettings: false } },
      isAuthenticated: true,
    });

    render(
      <MemoryRouter initialEntries={['/admin']}>
        <ProtectedRoute requireAdmin>
          <div>Admin</div>
        </ProtectedRoute>
      </MemoryRouter>
    );

    expect(screen.getByText('Navigate:/')).toBeInTheDocument();
  });

  it('renders children when authenticated', async () => {
    await mockUseAuth({
      user: { capabilities: { canAccessAdminRoutes: false, canManagePlatformSettings: false } },
      isAuthenticated: true,
    });

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <ProtectedRoute>
          <div>Secret</div>
        </ProtectedRoute>
      </MemoryRouter>
    );

    expect(screen.getByText('Secret')).toBeInTheDocument();
  });

  it('redirects admin to setup when not configured', async () => {
    await mockUseAuth({
      user: { capabilities: { canAccessAdminRoutes: true, canManagePlatformSettings: true } },
      isAuthenticated: true,
    });
    const { apiClient } = await import('@src/shared/api/client');
    (apiClient.get as any).mockResolvedValue({ isConfigured: false });

    render(
      <MemoryRouter initialEntries={['/admin/other']}>
        <ProtectedRoute requireAdmin>
          <div>Admin</div>
        </ProtectedRoute>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Navigate:/admin/tenants')).toBeInTheDocument();
    });
  });

  it('skips setup check when skipSetupCheck is true', async () => {
    await mockUseAuth({
      user: { capabilities: { canAccessAdminRoutes: true, canManagePlatformSettings: true } },
      isAuthenticated: true,
    });

    render(
      <MemoryRouter initialEntries={['/admin']}>
        <ProtectedRoute requireAdmin skipSetupCheck>
          <div>Admin</div>
        </ProtectedRoute>
      </MemoryRouter>
    );

    expect(screen.getByText('Admin')).toBeInTheDocument();
  });
});

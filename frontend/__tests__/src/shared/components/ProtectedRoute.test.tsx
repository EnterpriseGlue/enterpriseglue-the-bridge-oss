import React from 'react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProtectedRoute } from '@src/shared/components/ProtectedRoute';

const tenancy = vi.hoisted(() => ({ pooled: false }));
vi.mock('@src/enterprise/extensionRegistry', () => ({ isMultiTenantEnabled: () => tenancy.pooled }));

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

const mockUseAuth = async (state: {
  user: any;
  isAuthenticated: boolean;
  isLoading?: boolean;
  permissions?: any;
  hasAnyPlatformPermission?: (permissions: string[]) => boolean;
}) => {
  const { useAuth } = await import('@src/shared/hooks/useAuth');
  (useAuth as any).mockReturnValue({
    isLoading: false,
    permissions: null,
    hasAnyPlatformPermission: () => false,
    ...state,
  });
};

describe('ProtectedRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tenancy.pooled = false;
  });

  it('shows loading state while auth bootstrap is still running', async () => {
    await mockUseAuth({ user: null, isAuthenticated: false, isLoading: true });

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <ProtectedRoute>
          <div>Secret</div>
        </ProtectedRoute>
      </MemoryRouter>
    );

    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(screen.queryByText('Navigate:/login')).not.toBeInTheDocument();
  });

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

  it('allows admin routes when the current user has a required platform permission', async () => {
    await mockUseAuth({
      user: { capabilities: { canAccessAdminRoutes: false, canManagePlatformSettings: false } },
      isAuthenticated: true,
      permissions: {
        userId: 'user-1',
        platform: ['platform:authz:roles:view'],
        projects: [],
        engines: [],
        generatedAt: 1,
      },
    });

    render(
      <MemoryRouter initialEntries={['/admin/access-control']}>
        <ProtectedRoute requireAdmin requiredPlatformPermissions={['platform:authz:roles:view']}>
          <div>Access Control</div>
        </ProtectedRoute>
      </MemoryRouter>
    );

    expect(screen.getByText('Access Control')).toBeInTheDocument();
  });

  it('allows generic admin routes when the current user has any admin navigation platform permission', async () => {
    await mockUseAuth({
      user: { capabilities: { canAccessAdminRoutes: false, canManagePlatformSettings: false } },
      isAuthenticated: true,
      permissions: {
        userId: 'user-1',
        platform: ['platform:audit:view'],
        projects: [],
        engines: [],
        generatedAt: 1,
      },
    });

    render(
      <MemoryRouter initialEntries={['/admin']}>
        <ProtectedRoute requireAdmin>
          <div>Admin</div>
        </ProtectedRoute>
      </MemoryRouter>
    );

    expect(screen.getByText('Admin')).toBeInTheDocument();
  });

  it('runs setup checks for users with platform settings permission', async () => {
    await mockUseAuth({
      user: { capabilities: { canAccessAdminRoutes: false, canManagePlatformSettings: false } },
      isAuthenticated: true,
      permissions: {
        userId: 'user-1',
        platform: ['platform:settings:manage'],
        projects: [],
        engines: [],
        generatedAt: 1,
      },
    });
    const { apiClient } = await import('@src/shared/api/client');
    (apiClient.get as any).mockResolvedValue({ isConfigured: false });

    render(
      <MemoryRouter initialEntries={['/admin/other']}>
        <ProtectedRoute requireAdmin requiredPlatformPermissions={['platform:settings:manage']}>
          <div>Admin</div>
        </ProtectedRoute>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Navigate:/admin/settings')).toBeInTheDocument();
    });
  });

  it('redirects admin to setup when not configured', async () => {
    await mockUseAuth({
      user: { capabilities: { canAccessAdminRoutes: true, canManagePlatformSettings: true } },
      isAuthenticated: true,
      permissions: {
        userId: 'user-1',
        platform: ['platform:settings:manage'],
        projects: [],
        engines: [],
        generatedAt: 1,
      },
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
      expect(screen.getByText('Navigate:/admin/settings')).toBeInTheDocument();
    });
  });

  it('skips setup check when skipSetupCheck is true', async () => {
    await mockUseAuth({
      user: { capabilities: { canAccessAdminRoutes: true, canManagePlatformSettings: true } },
      isAuthenticated: true,
      permissions: {
        userId: 'user-1',
        platform: ['platform:settings:manage'],
        projects: [],
        engines: [],
        generatedAt: 1,
      },
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

  it.each([
    [false, '/t/default/projects', '/t/default/admin/settings'],
    [true, '/t/alpha/projects', '/admin/tenants'],
  ])('uses the setup destination for pooled=%s without losing tenant context', async (pooled, path, target) => {
    tenancy.pooled = pooled;
    await mockUseAuth({ user: { id: 'admin' }, isAuthenticated: true, permissions: { platform: ['platform:settings:manage'] } });
    const { apiClient } = await import('@src/shared/api/client');
    vi.mocked(apiClient.get).mockResolvedValue({ isConfigured: false });
    render(<MemoryRouter initialEntries={[path]}><ProtectedRoute><div>Content</div></ProtectedRoute></MemoryRouter>);
    expect(await screen.findByText(`Navigate:${target}`)).toBeInTheDocument();
  });

  it('allows single-tenant settings to finish setup without a redirect loop', async () => {
    await mockUseAuth({ user: { id: 'admin' }, isAuthenticated: true, permissions: { platform: ['platform:settings:manage'] } });
    render(<MemoryRouter initialEntries={['/t/default/admin/settings']}><ProtectedRoute requireAdmin><div>Settings</div></ProtectedRoute></MemoryRouter>);
    expect(screen.getByText('Settings')).toBeInTheDocument();
    const { apiClient } = await import('@src/shared/api/client');
    expect(apiClient.get).not.toHaveBeenCalled();
  });
});

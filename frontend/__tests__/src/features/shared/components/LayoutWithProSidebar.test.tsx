import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LayoutWithProSidebar from '@src/features/shared/components/LayoutWithProSidebar';
import { apiClient } from '@src/shared/api/client';
import { EnginePermission, PlatformPermission } from '@src/shared/auth/permissions';

const authState = vi.hoisted(() => ({
  permissions: {
    userId: 'user-1',
    platform: ['platform:engine:create'],
    projects: [],
    engines: [],
    generatedAt: 1,
  } as any,
  user: {
    id: 'user-1',
    email: 'viewer@example.com',
    capabilities: {},
    firstName: 'Viewer',
    lastName: 'User',
  },
}));

const enterprisePluginState = vi.hoisted(() => ({
  navItems: [] as any[],
}));

vi.mock('@src/shared/hooks/useAuth', () => ({
  useAuth: () => ({
    logout: vi.fn(),
    refreshUser: vi.fn(),
    user: authState.user,
    permissions: authState.permissions,
  }),
}));

vi.mock('@src/shared/hooks/useFeatureFlag', () => ({
  useFeatureFlag: () => true,
}));

vi.mock('@src/features/shared/stores/layoutStore', () => ({
  useLayoutStore: () => ({
    sidebarOpen: true,
    setSidebarOpen: vi.fn(),
    sidebarCollapsed: false,
    setSidebarCollapsed: vi.fn(),
    toggleSidebarCollapsed: vi.fn(),
  }),
}));

vi.mock('@src/features/platform-admin/hooks/usePlatformSyncSettings', () => ({
  usePlatformSyncSettings: () => ({
    data: {
      syncPushEnabled: true,
      syncPullEnabled: false,
      gitProjectTokenSharingEnabled: false,
      defaultDeployRoles: ['owner', 'delegate', 'operator', 'deployer'],
    },
  }),
}));

vi.mock('@src/features/shared/components/ProSidebar', () => ({
  default: () => <div data-testid="pro-sidebar" />,
}));

vi.mock('@src/enterprise/ExtensionSlot', () => ({
  ExtensionSlot: () => null,
  useFilteredExtensionNavItems: ({ items = [] }: { items?: any[] }) => {
    const platformPermissions = authState.permissions?.platform || [];

    return items.filter((item) => {
      if (item.tenantOnly) return false;
      const requiredPermissions = [
        ...(item.requiredPermission ? [item.requiredPermission] : []),
        ...(Array.isArray(item.requiredPermissions) ? item.requiredPermissions : []),
      ];
      if (requiredPermissions.length > 0) {
        return requiredPermissions.some((permission) => platformPermissions.includes(permission));
      }
      if (item.requiredRole === 'admin') {
        return platformPermissions.length > 0;
      }
      return !item.requiredRole;
    });
  },
}));

vi.mock('@src/enterprise/loadEnterpriseFrontendPlugin', () => ({
  getEnterpriseFrontendPlugin: () => Promise.resolve({ navItems: enterprisePluginState.navItems }),
}));

vi.mock('@src/enterprise/extensionRegistry', () => ({
  extensions: {},
  getNavItemsBySection: () => [],
  isMultiTenantEnabled: () => false,
}));

vi.mock('@src/shared/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

function renderLayout() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<LayoutWithProSidebar />}>
            <Route index element={<div>Home</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('LayoutWithProSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enterprisePluginState.navItems = [];
    authState.user = {
      id: 'user-1',
      email: 'viewer@example.com',
      capabilities: {},
      firstName: 'Viewer',
      lastName: 'User',
    };
    authState.permissions = {
      userId: 'user-1',
      platform: [PlatformPermission.ENGINE_CREATE],
      projects: [],
      engines: [],
      generatedAt: 1,
    };
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url === '/api/notifications') return { notifications: [], unreadCount: 0 };
      if (url === '/api/auth/branding') {
        return {
          logoUrl: null,
          loginLogoUrl: null,
          logoTitle: null,
          loginTitleVerticalOffset: 0,
          loginTitleColor: null,
          logoScale: 1,
          titleFontUrl: null,
          titleFontWeight: '600',
          titleFontSize: 16,
          titleVerticalOffset: 0,
          menuAccentColor: null,
          faviconUrl: null,
        };
      }
      return [];
    });
  });

  it('exports LayoutWithProSidebar component', () => {
    expect(LayoutWithProSidebar).toBeDefined();
    expect(typeof LayoutWithProSidebar).toBe('function');
  });

  it('shows the Engines nav item when the user can create engines', async () => {
    renderLayout();

    expect(await screen.findByText('Engines')).toBeInTheDocument();
  });

  it('shows the Starbase nav item when the user can create projects', async () => {
    authState.permissions = {
      userId: 'user-1',
      platform: [PlatformPermission.PROJECT_CREATE],
      projects: [],
      engines: [],
      generatedAt: 1,
    };

    renderLayout();

    expect(await screen.findByText('Starbase')).toBeInTheDocument();
  });

  it('shows the Starbase nav item when the user has project-scoped access', async () => {
    authState.permissions = {
      userId: 'user-1',
      platform: [],
      projects: [{ resourceId: 'project-1', permissions: ['project:files:view'] }],
      engines: [],
      generatedAt: 1,
    };

    renderLayout();

    expect(await screen.findByText('Starbase')).toBeInTheDocument();
  });

  it('shows the Mission Control nav item when the user has runtime engine read access', async () => {
    authState.permissions = {
      userId: 'user-1',
      platform: [],
      projects: [],
      engines: [{ resourceId: 'engine-1', permissions: [EnginePermission.INSTANCE_VIEW] }],
      generatedAt: 1,
    };

    renderLayout();

    expect(await screen.findByText('Mission Control')).toBeInTheDocument();
  });

  it('links the Mission Control top nav item directly to Processes', async () => {
    authState.permissions = {
      userId: 'user-1',
      platform: [],
      projects: [],
      engines: [{ resourceId: 'engine-1', permissions: [EnginePermission.INSTANCE_VIEW] }],
      generatedAt: 1,
    };

    renderLayout();

    const missionControlLink = await screen.findByText('Mission Control');
    expect(missionControlLink.closest('a')).toHaveAttribute('href', '/mission-control/processes');
  });

  it('hides the Engines nav item when the user has no engine UI access', async () => {
    authState.permissions = {
      userId: 'user-1',
      platform: [],
      projects: [],
      engines: [],
      generatedAt: 1,
    };

    renderLayout();

    await waitFor(() => {
      expect(screen.queryByText('Engines')).toBeNull();
      expect(screen.queryByText('Starbase')).toBeNull();
      expect(screen.queryByText('Voyager')).toBeNull();
    });
  });

  it('shows only the user management admin item for user-management permissions', async () => {
    authState.permissions = {
      userId: 'user-1',
      platform: [PlatformPermission.USERS_VIEW],
      projects: [],
      engines: [],
      generatedAt: 1,
    };

    renderLayout();

    expect(await screen.findByText('Admin')).toBeInTheDocument();
    expect(screen.getByText('User Management')).toBeInTheDocument();
    expect(screen.queryByText('Platform Settings')).toBeNull();
    expect(screen.queryByText('Access Control')).toBeNull();
    expect(screen.queryByText('Authorization Audit')).toBeNull();
  });

  it('keeps the user management admin item visible for legacy user-view permission', async () => {
    authState.permissions = {
      userId: 'user-1',
      platform: [PlatformPermission.USER_VIEW],
      projects: [],
      engines: [],
      generatedAt: 1,
    };

    renderLayout();

    expect(await screen.findByText('Admin')).toBeInTheDocument();
    expect(screen.getByText('User Management')).toBeInTheDocument();
    expect(screen.queryByText('Platform Settings')).toBeNull();
    expect(screen.queryByText('Access Control')).toBeNull();
  });

  it('routes authorization readers through the Platform Settings admin hub', async () => {
    authState.permissions = {
      userId: 'user-1',
      platform: [PlatformPermission.AUTHZ_ROLES_VIEW],
      projects: [],
      engines: [],
      generatedAt: 1,
    };

    renderLayout();

    expect(await screen.findByText('Admin')).toBeInTheDocument();
    expect(screen.getByText('Platform Settings')).toBeInTheDocument();
    expect(screen.queryByText('Access Control')).toBeNull();
    expect(screen.queryByText('User Management')).toBeNull();
    expect(screen.queryByText('Authorization Policies')).toBeNull();
  });

  it('collapses scoped settings permissions into the Platform Settings admin hub', async () => {
    authState.permissions = {
      userId: 'user-1',
      platform: [
        PlatformPermission.GIT_PROVIDER_MANAGE,
        PlatformPermission.ENGINE_REGISTRATION_MANAGE,
        PlatformPermission.SSO_ASSIGNMENTS_MANAGE,
      ],
      projects: [],
      engines: [],
      generatedAt: 1,
    };

    renderLayout();

    expect(await screen.findByText('Admin')).toBeInTheDocument();
    expect(screen.getByText('Platform Settings')).toBeInTheDocument();
    expect(screen.queryByText('Git Settings')).toBeNull();
    expect(screen.queryByText('Engine Settings')).toBeNull();
    expect(screen.queryByText('SSO Settings')).toBeNull();
    expect(screen.queryByText('SSO Role Mappings')).toBeNull();
    expect(screen.queryByText('Access Control')).toBeNull();
  });

  it('routes audit readers through the Platform Settings admin hub', async () => {
    authState.permissions = {
      userId: 'user-1',
      platform: [PlatformPermission.AUDIT_VIEW],
      projects: [],
      engines: [],
      generatedAt: 1,
    };

    renderLayout();

    expect(await screen.findByText('Admin')).toBeInTheDocument();
    expect(screen.getByText('Platform Settings')).toBeInTheDocument();
    expect(screen.queryByText('Authorization Audit')).toBeNull();
    expect(screen.queryByText('System Audit Logs')).toBeNull();
    expect(screen.queryByText('User Management')).toBeNull();
  });

  it('filters Enterprise plugin nav items by extension permission metadata', async () => {
    enterprisePluginState.navItems = [
      {
        id: 'audit-extension',
        label: 'Audit Extension',
        path: '/enterprise/audit',
        requiredPermission: 'platform:audit:view',
      },
      {
        id: 'users-extension',
        label: 'Users Extension',
        path: '/enterprise/users',
        requiredPermission: 'platform:users:view',
      },
      {
        id: 'public-extension',
        label: 'Public Extension',
        path: '/enterprise/public',
      },
      {
        id: 'tenant-extension',
        label: 'Tenant Extension',
        path: '/enterprise/tenant',
        tenantOnly: true,
      },
    ];
    authState.permissions = {
      userId: 'user-1',
      platform: [PlatformPermission.AUDIT_VIEW],
      projects: [],
      engines: [],
      generatedAt: 1,
    };

    renderLayout();

    expect(await screen.findByText('Enterprise')).toBeInTheDocument();
    expect(screen.getByText('Audit Extension')).toBeInTheDocument();
    expect(screen.getByText('Public Extension')).toBeInTheDocument();
    expect(screen.queryByText('Users Extension')).toBeNull();
    expect(screen.queryByText('Tenant Extension')).toBeNull();
  });
});

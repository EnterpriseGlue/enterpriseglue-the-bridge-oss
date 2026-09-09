import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LayoutWithProSidebar from '@src/features/shared/components/LayoutWithProSidebar';
import { AuthContext, type AuthContextValue } from '@src/contexts/AuthContext';
import { loadTrustedSystemFrontendModules } from '@src/enterprise/trustedSystemFrontendModules';
import { registerFrontendPlugin } from '@src/enterprise/loadEnterpriseFrontendPlugin';
import { LEGACY_ENTERPRISE_PLUGIN_OWNER, unregisterPluginExtensions } from '@src/enterprise/extensionRegistry';
import { apiClient } from '@src/shared/api/client';

const state = vi.hoisted(() => ({ legacyItems: [] as any[] }));
vi.mock('@src/enterprise/loadEnterpriseFrontendPlugin', async (importOriginal) => ({
  ...await importOriginal<typeof import('@src/enterprise/loadEnterpriseFrontendPlugin')>(),
  getEnterpriseFrontendPlugin: () => Promise.resolve({ navItems: state.legacyItems }),
}));
vi.mock('@src/enterprise/extensionRegistry', async (importOriginal) => ({
  ...await importOriginal<typeof import('@src/enterprise/extensionRegistry')>(),
  isMultiTenantEnabled: () => true,
}));
vi.mock('@src/shared/hooks/useFeatureFlag', () => ({ useFeatureFlag: () => true }));
vi.mock('@src/features/shared/stores/layoutStore', () => ({
  useLayoutStore: () => ({ sidebarOpen: true, setSidebarOpen: vi.fn(), sidebarCollapsed: false,
    setSidebarCollapsed: vi.fn(), toggleSidebarCollapsed: vi.fn() }),
}));
vi.mock('@src/features/platform-admin/hooks/usePlatformSyncSettings', () => ({
  usePlatformSyncSettings: () => ({ data: {} }),
}));
vi.mock('@src/features/shared/components/ProSidebar', () => ({ default: () => null }));
vi.mock('@src/shared/api/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('@src/shared/api/client')>(),
  apiClient: { get: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const descriptor = {
  ownerId: 'io.enterpriseglue.navigation-test',
  entryPath: '/system/navigation-test.js',
  integrity: `sha256-${'A'.repeat(43)}=` as const,
  required: true,
};
const rootItem = {
  id: 'operator-console', label: 'Operator console', path: '/cloud/organizations',
  scope: 'root' as const, section: 'main' as const, actionId: 'platform.tenants.read', order: 60,
};

function Location() { return <output data-testid="location">{useLocation().pathname}</output>; }

function mount(path: string, platform: string[] = ['platform:tenants:view']) {
  const permissions = { userId: 'user-1', tenantId: null, platform, projects: [], engines: [], generatedAt: 1 };
  const auth = {
    user: { id: 'user-1', email: 'operator@example.test', capabilities: {} },
    permissions, isAuthenticated: true, isLoading: false,
    logout: vi.fn(), refreshUser: vi.fn(),
    hasPlatformPermission: (permission: string) => platform.includes(permission),
    hasAnyPlatformPermission: (requested: string[]) => requested.some((permission) => platform.includes(permission)),
    hasAnyEnginePermission: () => false,
  } as unknown as AuthContextValue;
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route element={<LayoutWithProSidebar />}><Route path="*" element={<Location />} /></Route></Routes>
      </MemoryRouter>
    </AuthContext.Provider>
  </QueryClientProvider>);
}

async function activate() {
  await loadTrustedSystemFrontendModules([descriptor], async () => ({
    ownerId: descriptor.ownerId,
    activate: async () => ({ navItems: [rootItem, {
      id: 'tenant-work', label: 'Tenant work', path: '/work', scope: 'tenant', section: 'main',
    }] }),
  }));
}

beforeEach(() => {
  state.legacyItems = [];
  vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
    if (url === '/api/notifications') return { notifications: [], unreadCount: 0 };
    if (url === '/api/auth/my-tenants') return [];
    if (url === '/api/auth/branding') return {};
    return {};
  });
});
afterEach(() => {
  unregisterPluginExtensions(descriptor.ownerId);
  unregisterPluginExtensions(LEGACY_ENTERPRISE_PLUGIN_OWNER);
});

describe('trusted system module main navigation', () => {
  it.each([0, 1])('keeps the root destination on menu %i while tenant navigation stays tenant-prefixed', async (menu) => {
    await activate();
    mount('/t/acme/work');
    const links = await screen.findAllByText('Operator console');
    expect(links).toHaveLength(2);
    for (const label of links) expect(label.closest('a')).toHaveAttribute('href', '/cloud/organizations');
    for (const label of screen.getAllByText('Tenant work')) expect(label.closest('a')).toHaveAttribute('href', '/t/acme/work');
    fireEvent.click(links[menu]);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/cloud/organizations'));
  });

  it('uses the real action filter to deny unauthorized root items on both menus', async () => {
    await activate();
    mount('/t/acme/work', []);
    await screen.findAllByText('Tenant work');
    expect(screen.queryByText('Operator console')).toBeNull();
  });

  it('marks root subroutes current without a tenant prefix', async () => {
    await activate();
    mount('/cloud/organizations/org-1');
    const links = await screen.findAllByText('Operator console');
    expect(links[0].closest('a')).toHaveAttribute('aria-current', 'true');
    expect(links[1].closest('a')).toHaveClass('cds--side-nav__link--current');
  });

  it('does not duplicate a main item returned by the legacy loader and registered in the owner registry', async () => {
    state.legacyItems = [rootItem];
    registerFrontendPlugin(LEGACY_ENTERPRISE_PLUGIN_OWNER, { navItems: state.legacyItems }, false);
    mount('/cloud/organizations');
    expect(await screen.findAllByText('Operator console')).toHaveLength(2);
  });

  it('does not expose an unregistered owner contribution on a subsequent mount', async () => {
    await activate();
    unregisterPluginExtensions(descriptor.ownerId);
    mount('/');
    await waitFor(() => expect(screen.getByTestId('location')).toBeInTheDocument());
    expect(screen.queryByText('Operator console')).toBeNull();
  });
});

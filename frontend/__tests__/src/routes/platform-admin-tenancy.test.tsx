import { render, screen } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ pooled: false, authenticated: true, platform: ['platform:settings:manage'], tenantId: null as string | null }));
vi.mock('@src/shared/hooks/useAuth', () => ({ useAuth: () => ({
  user: { id: 'admin', platformRole: 'admin', tenantId: state.tenantId },
  permissions: { platform: state.platform }, isAuthenticated: state.authenticated, isLoading: false,
}) }));
vi.mock('@src/enterprise/extensionRegistry', async (original) => ({
  ...await original<typeof import('@src/enterprise/extensionRegistry')>(),
  isMultiTenantEnabled: () => state.pooled,
}));
vi.mock('@src/features/platform-admin/pages/TenantsPage', () => ({ default: () => <div>Tenant administration</div> }));

import { createProtectedChildRoutes } from '@src/routes/index';

function mount(path: string, root: boolean) {
  const tenantRoute = createProtectedChildRoutes(root).find(route => route.path === (root ? '/admin/tenants' : 'admin/tenants'));
  expect(tenantRoute).toBeDefined();
  const router = createMemoryRouter([{
    path: root ? '/' : '/t/:tenantSlug', element: <Outlet />,
    children: [
      tenantRoute!,
      { path: 'admin/settings', element: <div>Platform settings</div> },
      { index: true, element: <div>Home</div> },
      { path: 'login', element: <div>Sign in</div> },
    ],
  }], { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

describe('platform administration routing across tenancy modes', () => {
  beforeEach(() => { state.pooled = false; state.authenticated = true; state.platform = ['platform:settings:manage']; state.tenantId = null; });

  it.each([null, 'tenant-default'])('resolves legacy single-tenant links for an authorized user with tenantId=%s', async (tenantId) => {
    state.tenantId = tenantId;
    const router = mount('/admin/tenants', true);
    expect(await screen.findByText('Platform settings')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/admin/settings');
  });

  it('preserves the default tenant prefix on legacy setup links', async () => {
    const router = mount('/t/default/admin/tenants', false);
    expect(await screen.findByText('Platform settings')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/t/default/admin/settings');
  });

  it('keeps the pooled platform tenant page available', async () => {
    state.pooled = true;
    mount('/admin/tenants', true);
    expect(await screen.findByText('Tenant administration')).toBeInTheDocument();
  });

  it('does not authorize a legacy admin label without effective permissions', async () => {
    state.platform = [];
    mount('/admin/tenants', true);
    expect(await screen.findByText('Home')).toBeInTheDocument();
  });

  it('requires authentication for the legacy setup link', async () => {
    state.authenticated = false;
    mount('/admin/tenants', true);
    expect(await screen.findByText('Sign in')).toBeInTheDocument();
  });
});

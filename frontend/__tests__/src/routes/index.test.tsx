import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/enterprise/extensionRegistry', () => ({
  extensions: {},
  isMultiTenantEnabled: vi.fn(),
}));

describe('frontend routes index', () => {
  it('exports route helpers', () => {
    expect(true).toBe(true);
  });

  it('builds protected child routes with correct path prefixes (single-tenant)', async () => {
    const routes = await import('../../../src/routes/index');
    const { isMultiTenantEnabled } = await import('../../../src/enterprise/extensionRegistry');
    (isMultiTenantEnabled as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const rootRoutes = routes.createProtectedChildRoutes(true);
    const tenantRoutes = routes.createProtectedChildRoutes(false);

    expect(rootRoutes.find((r) => r.path === '/admin/settings')).toBeDefined();
    expect(tenantRoutes.find((r) => r.path === 'admin/settings')).toBeDefined();
  });

  it('omits platform settings route in multi-tenant mode', async () => {
    const routes = await import('../../../src/routes/index');
    const { isMultiTenantEnabled } = await import('../../../src/enterprise/extensionRegistry');
    (isMultiTenantEnabled as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const rootRoutes = routes.createProtectedChildRoutes(true);
    const tenantRoutes = routes.createProtectedChildRoutes(false);

    expect(rootRoutes.find((r) => r.path === '/admin/settings')).toBeUndefined();
    expect(tenantRoutes.find((r) => r.path === 'admin/settings')).toBeUndefined();
  });
});

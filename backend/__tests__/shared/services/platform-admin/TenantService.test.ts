import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { config } from '@enterpriseglue/shared/config/index.js';
import { TenantService } from '@enterpriseglue/shared/services/platform-admin/TenantService.js';
import { NATIVE_TENANT_ROLE_IDS } from '@enterpriseglue/shared/authz/native-tenant-roles.js';

const getDataSource = vi.hoisted(() => vi.fn());
const assignRole = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'assignment-1', warnings: [] }));
const removeRoleAssignment = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource }));
vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js', () => ({
  permissionService: { assignRole, removeRoleAssignment },
}));

beforeEach(() => {
  vi.clearAllMocks();
  assignRole.mockResolvedValue({ id: 'assignment-1', warnings: [] });
  removeRoleAssignment.mockResolvedValue(undefined);
});

describe('TenantService placement assertions', () => {
  const originalKey = config.tenantPlacementKey;
  const originalMaxAge = config.tenantPlacementMaxAgeSeconds;
  const service = new TenantService();

  afterEach(() => {
    (config as any).tenantPlacementKey = originalKey;
    (config as any).tenantPlacementMaxAgeSeconds = originalMaxAge;
  });

  function assertion(overrides: Record<string, unknown> = {}) {
    (config as any).tenantPlacementKey = 'test-placement-key-that-is-at-least-32-characters';
    (config as any).tenantPlacementMaxAgeSeconds = 120;
    const payload = Buffer.from(JSON.stringify({
      tenantId: 'tenant-1', tenantSlug: 'customer-one', placementKey: 'shard-a', epoch: 4,
      expiresAt: Date.now() + 30_000, ...overrides,
    })).toString('base64url');
    const signature = createHmac('sha256', config.tenantPlacementKey!).update(payload).digest('base64url');
    return { payload, signature };
  }

  it('accepts a fresh, signed tenant placement claim', () => {
    const value = assertion();
    expect(service.verifyPlacementClaim(value.payload, value.signature)).toMatchObject({
      tenantId: 'tenant-1', tenantSlug: 'customer-one', placementKey: 'shard-a', epoch: 4,
    });
  });

  it('rejects tampering and expired placement claims', () => {
    const value = assertion();
    expect(() => service.verifyPlacementClaim(`${value.payload}x`, value.signature)).toThrow('Invalid tenant placement signature');
    const expired = assertion({ expiresAt: Date.now() - 1 });
    expect(() => service.verifyPlacementClaim(expired.payload, expired.signature)).toThrow('Expired tenant placement assertion');
  });
});

describe('TenantService SSO membership', () => {
  const originalMode = config.tenancyMode;

  afterEach(() => {
    (config as any).tenancyMode = originalMode;
  });

  it('records provider-owned tenant membership in native FGA', async () => {
    (config as any).tenancyMode = 'pooled';
    getDataSource.mockResolvedValue({
      getRepository: () => ({ findOneBy: vi.fn().mockResolvedValue({ id: 'tenant-1', status: 'active' }) }),
    });
    const service = new TenantService();

    await service.ensureSsoMember('tenant-1', 'user-1', 'provider-1');

    expect(assignRole).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      principalType: 'user',
      principalId: 'user-1',
      scopeType: 'tenant',
      scopeId: 'tenant-1',
      source: 'sso',
      sourceRef: 'provider-1',
    }));
  });

  it('does not broaden single-mode SSO access with a tenant-wide viewer role', async () => {
    (config as any).tenancyMode = 'single';
    getDataSource.mockResolvedValue({
      getRepository: () => ({ findOneBy: vi.fn().mockResolvedValue({ id: 'tenant-default', status: 'active' }) }),
    });
    const service = new TenantService();

    await service.ensureSsoMember('tenant-default', 'user-1', 'provider-1');

    expect(assignRole).not.toHaveBeenCalled();
  });

  it('replaces a manual administrator role when the member is demoted', async () => {
    const tenantRepo = { findOneBy: vi.fn().mockResolvedValue({ id: 'tenant-1', status: 'active' }) };
    const userRepo = { findOneBy: vi.fn().mockResolvedValue({ id: 'user-1', isActive: true }) };
    const assignmentRepo = {
      find: vi.fn().mockResolvedValue([{
        id: 'assignment-admin',
        roleId: NATIVE_TENANT_ROLE_IDS.ADMIN,
        source: 'manual',
      }]),
      count: vi.fn().mockResolvedValue(2),
    };
    getDataSource.mockResolvedValue({
      getRepository: (entity: { name: string }) => entity.name === 'Tenant'
        ? tenantRepo
        : entity.name === 'User'
          ? userRepo
          : assignmentRepo,
    });
    const service = new TenantService();

    await service.addMember('tenant-1', 'user-1', 'member', 'actor-1');

    expect(assignRole).toHaveBeenCalledWith(expect.objectContaining({
      roleId: NATIVE_TENANT_ROLE_IDS.VIEWER,
      source: 'manual',
    }));
    expect(removeRoleAssignment).toHaveBeenCalledWith('assignment-admin', 'actor-1');
  });

  it('does not create membership for an unknown account', async () => {
    const tenantRepo = { findOneBy: vi.fn().mockResolvedValue({ id: 'tenant-1', status: 'active' }) };
    const userRepo = { findOneBy: vi.fn().mockResolvedValue(null) };
    getDataSource.mockResolvedValue({
      getRepository: (entity: { name: string }) => entity.name === 'Tenant' ? tenantRepo : userRepo,
    });
    const service = new TenantService();

    await expect(service.addMember('tenant-1', 'missing-user', 'member', 'actor-1'))
      .rejects.toThrow('Tenant member account');
    expect(assignRole).not.toHaveBeenCalled();
  });

  it('allows a tenant administrator to revoke SSO-provisioned membership', async () => {
    const assignmentRepo = {
      find: vi.fn().mockResolvedValue([{
        id: 'assignment-sso',
        roleId: NATIVE_TENANT_ROLE_IDS.VIEWER,
        source: 'sso',
      }]),
    };
    getDataSource.mockResolvedValue({ getRepository: () => assignmentRepo });
    const service = new TenantService();

    await service.removeMember('tenant-1', 'user-1', 'actor-1');

    expect(removeRoleAssignment).toHaveBeenCalledWith('assignment-sso', 'actor-1', { allowSso: true });
  });
});

describe('TenantService organization discovery domains', () => {
  const originalMode = config.tenancyMode;

  afterEach(() => {
    (config as any).tenancyMode = originalMode;
  });

  it('rejects consumer domains before creating a discoverable organization mapping', async () => {
    (config as any).tenancyMode = 'pooled';
    const tenantRepo = { findOneBy: vi.fn().mockResolvedValue({ id: 'tenant-1', status: 'active' }) };
    getDataSource.mockResolvedValue({ getRepository: () => tenantRepo });
    const service = new TenantService();

    await expect(service.createDiscoveryDomain('tenant-1', 'gmail.com')).rejects.toThrow('Public consumer-email domains');
  });

  it('verifies a tenant discovery domain only with the matching DNS proof', async () => {
    (config as any).tenancyMode = 'pooled';
    const token = 'a'.repeat(43);
    const tokenHash = (await import('node:crypto')).createHash('sha256').update(token).digest('hex');
    const domainRepo = {
      findOneBy: vi.fn()
        .mockResolvedValueOnce({ id: 'domain-1', tenantId: 'tenant-1', domain: 'acme.example', status: 'pending', verificationTokenHash: tokenHash }),
      findOneByOrFail: vi.fn().mockResolvedValue({ id: 'domain-1', tenantId: 'tenant-1', domain: 'acme.example', status: 'verified', verificationTokenHash: null }),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
    };
    getDataSource.mockResolvedValue({ getRepository: () => domainRepo });
    const resolveTxtRecords = vi.fn().mockResolvedValue([[`enterpriseglue-discovery-verification=${token}`]]);
    const service = new TenantService(resolveTxtRecords);

    await expect(service.verifyDiscoveryDomain('tenant-1', 'domain-1', token)).resolves.toMatchObject({ status: 'verified' });
    expect(resolveTxtRecords).toHaveBeenCalledWith('_enterpriseglue-discovery.acme.example');
    expect(domainRepo.update).toHaveBeenCalledWith(
      { id: 'domain-1', tenantId: 'tenant-1' },
      expect.objectContaining({ status: 'verified', verificationTokenHash: null }),
    );
  });

  it('returns only active tenants mapped by an exact verified discovery domain', async () => {
    const domainRepo = { find: vi.fn().mockResolvedValue([{ tenantId: 'tenant-a' }, { tenantId: 'tenant-b' }]) };
    const tenantRepo = { findBy: vi.fn().mockResolvedValue([
      { id: 'tenant-a', name: 'Alpha', slug: 'alpha', status: 'active' },
      { id: 'tenant-b', name: 'Bravo', slug: 'bravo', status: 'suspended' },
    ]) };
    getDataSource.mockResolvedValue({
      getRepository: (entity: { name: string }) => entity.name === 'TenantDiscoveryDomain' ? domainRepo : tenantRepo,
    });
    const service = new TenantService();

    await expect(service.findByDiscoveryDomain('company.example')).resolves.toEqual([
      expect.objectContaining({ id: 'tenant-a', slug: 'alpha' }),
    ]);
    expect(domainRepo.find).toHaveBeenCalledWith({ where: { domain: 'company.example', status: 'verified' } });
  });
});

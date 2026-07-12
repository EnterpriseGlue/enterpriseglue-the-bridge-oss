import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { ExternalIdentity, SsoNormalizedIdentity } from '@enterpriseglue/shared/db/entities/index.js';
import { ssoNormalizedIdentityService } from '@enterpriseglue/shared/services/platform-admin/SsoNormalizedIdentityService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));
const syncMembershipsInStore = vi.hoisted(() => vi.fn().mockResolvedValue({ created: 0, removed: 0 }));
vi.mock('@enterpriseglue/shared/services/platform-admin/IdentityEntitlementMappingService.js', () => ({
  identityEntitlementMappingService: { syncMembershipsInStore },
}));

describe('ssoNormalizedIdentityService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts a normalized SSO identity snapshot when no provider subject exists', async () => {
    const getOne = vi.fn().mockResolvedValue(null);
    const qb = {
      where: vi.fn(() => qb),
      andWhere: vi.fn(() => qb),
      getOne,
    };
    const insert = vi.fn().mockResolvedValue(undefined);
    const update = vi.fn().mockResolvedValue(undefined);
    const repo = {
      createQueryBuilder: vi.fn().mockReturnValue(qb),
      insert,
      update,
    };
    const externalRepo = { findOne: vi.fn().mockResolvedValue(null), insert: vi.fn().mockResolvedValue(undefined), update: vi.fn().mockResolvedValue(undefined) };
    const dataSource = {
      getRepository: vi.fn((entity: unknown) => {
        if (entity === SsoNormalizedIdentity) return repo;
        if (entity === ExternalIdentity) return externalRepo;
        throw new Error('Unexpected repository');
      }),
    };
    (getDataSource as unknown as Mock).mockResolvedValue(dataSource);

    const result = await ssoNormalizedIdentityService.upsertIdentity({
      tenantId: 'tenant-a',
      providerId: 'provider-1',
      providerType: 'saml',
      providerSubject: 'subject-1',
      subjectClaim: 'name_id',
      providerTenantId: 'idp-tenant',
      userId: 'user-1',
      email: 'USER@example.com',
      displayName: 'User One',
      firstName: 'User',
      lastName: 'One',
      claims: {
        email: 'user@example.com',
        groups: ['ops', 'ops', 'deployers'],
        roles: ['operator'],
        department: 'engineering',
      },
      now: 1234,
    });

    expect(result).toEqual({ id: expect.any(String), created: true });
    expect(qb.where).toHaveBeenCalledWith('identity.providerId = :providerId', { providerId: 'provider-1' });
    expect(qb.andWhere).toHaveBeenCalledWith('identity.providerSubject = :providerSubject', { providerSubject: 'subject-1' });
    expect(qb.andWhere).toHaveBeenCalledWith('identity.tenantId = :tenantId', { tenantId: 'tenant-a' });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      providerId: 'provider-1',
      providerType: 'saml',
      providerSubject: 'subject-1',
      subjectClaim: 'name_id',
      providerTenantId: 'idp-tenant',
      userId: 'user-1',
      email: 'user@example.com',
      groupsJson: JSON.stringify(['ops', 'deployers']),
      rolesJson: JSON.stringify(['operator']),
      claimsJson: expect.stringContaining('department'),
      providerStatus: 'active',
      lastSeenAt: 1234,
      lastProviderCheckAt: null,
      createdAt: 1234,
      updatedAt: 1234,
    }));
    expect(update).not.toHaveBeenCalled();
    expect(externalRepo.insert).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'provider-1', subjectId: 'subject-1', userId: 'user-1', emailHint: 'user@example.com', identityKey: expect.any(String),
    }));
    expect(syncMembershipsInStore).toHaveBeenCalledWith(dataSource, 'user-1', 'tenant-a', expect.objectContaining({ providerKey: 'provider-1', providerType: 'saml' }));
  });

  it('updates an existing normalized identity snapshot by provider subject', async () => {
    const getOne = vi.fn().mockResolvedValue({ id: 'identity-1' });
    const qb = {
      where: vi.fn(() => qb),
      andWhere: vi.fn(() => qb),
      getOne,
    };
    const insert = vi.fn().mockResolvedValue(undefined);
    const update = vi.fn().mockResolvedValue(undefined);
    const repo = {
      createQueryBuilder: vi.fn().mockReturnValue(qb),
      insert,
      update,
    };
    const externalRepo = { findOne: vi.fn().mockResolvedValue({ id: 'external-identity-1' }), insert: vi.fn(), update: vi.fn().mockResolvedValue(undefined) };
    const dataSource = {
      getRepository: vi.fn((entity: unknown) => {
        if (entity === SsoNormalizedIdentity) return repo;
        if (entity === ExternalIdentity) return externalRepo;
        throw new Error('Unexpected repository');
      }),
    };
    (getDataSource as unknown as Mock).mockResolvedValue(dataSource);

    const result = await ssoNormalizedIdentityService.upsertIdentity({
      providerId: 'microsoft',
      providerType: 'microsoft',
      providerSubject: 'oid-1',
      subjectClaim: 'oid',
      userId: 'user-1',
      email: 'user@example.com',
      claims: {
        email: 'user@example.com',
        groups: ['engines'],
        roles: ['deployer'],
      },
      now: 5678,
    });

    expect(result).toEqual({ id: 'identity-1', created: false });
    expect(qb.andWhere).toHaveBeenCalledWith('identity.tenantId IS NULL');
    expect(update).toHaveBeenCalledWith({ id: 'identity-1' }, expect.objectContaining({
      providerId: 'microsoft',
      providerType: 'microsoft',
      providerSubject: 'oid-1',
      userId: 'user-1',
      groupsJson: JSON.stringify(['engines']),
      rolesJson: JSON.stringify(['deployer']),
      lastSeenAt: 5678,
      updatedAt: 5678,
    }));
    expect(insert).not.toHaveBeenCalled();
    expect(externalRepo.update).toHaveBeenCalledWith({ id: 'external-identity-1' }, expect.objectContaining({
      providerId: 'microsoft', subjectId: 'oid-1', userId: 'user-1', lastSeenAt: 5678,
    }));
    expect(syncMembershipsInStore).toHaveBeenCalledWith(dataSource, 'user-1', null, expect.objectContaining({ providerKey: 'microsoft', providerType: 'oidc' }));
  });
});

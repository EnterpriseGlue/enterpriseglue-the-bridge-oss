import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuditLog, AuthzGroup, AuthzGroupMembership, IdentityEntitlementMapping, IdentityProvider, PlatformSettings, SsoGroupMapping } from '@enterpriseglue/shared/db/entities/index.js';
import { ssoGroupMappingService } from '@enterpriseglue/shared/services/platform-admin/SsoGroupMappingService.js';

const { identityEntitlementMappingService, recordLegacyMappingConversion } = vi.hoisted(() => ({
  identityEntitlementMappingService: { create: vi.fn() },
  recordLegacyMappingConversion: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/IdentityEntitlementMappingService.js', () => ({ identityEntitlementMappingService }));
vi.mock('@enterpriseglue/shared/services/platform-admin/LegacyMappingConversionAudit.js', () => ({ recordLegacyMappingConversion }));

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

function queryBuilder(result: unknown) {
  return {
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    getMany: vi.fn().mockResolvedValue(result),
    getOne: vi.fn().mockResolvedValue(result),
  };
}

describe('ssoGroupMappingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates SSO group membership when claims match', async () => {
    const mapping = {
      id: 'mapping-1',
      tenantId: 'tenant-a',
      providerId: 'provider-1',
      claimType: 'group',
      claimKey: 'groups',
      claimValue: 'Ops',
      targetGroupId: 'group-1',
      syncMode: 'authoritative',
      priority: 0,
      isActive: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const insert = vi.fn().mockResolvedValue(undefined);
    const auditInsert = vi.fn().mockResolvedValue(undefined);
    const mappingQb = queryBuilder([mapping]);
    const membershipQb = queryBuilder(null);
    membershipQb.getOne = vi.fn().mockResolvedValue(null);

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === SsoGroupMapping) return { createQueryBuilder: vi.fn().mockReturnValue(mappingQb) };
        if (entity === AuthzGroup) return {
          findOneBy: vi.fn().mockResolvedValue({ id: 'group-1', tenantId: 'tenant-a', key: 'ops', name: 'Ops', isArchived: false }),
        };
        if (entity === AuthzGroupMembership) return {
          createQueryBuilder: vi.fn().mockReturnValue(membershipQb),
          insert,
          find: vi.fn().mockResolvedValue([]),
          update: vi.fn(),
          delete: vi.fn(),
        };
        if (entity === AuditLog) return { insert: auditInsert };
        throw new Error('Unexpected repository');
      },
    });

    const result = await ssoGroupMappingService.syncMembershipsForUser('user-1', { groups: ['Ops'] }, 'provider-1', 'tenant-a');

    expect(result).toMatchObject({ created: 1, updated: 0, removed: 0 });
    expect(mappingQb.andWhere).toHaveBeenCalledWith(
      '(m.tenantId = :tenantId OR m.tenantId IS NULL)',
      { tenantId: 'tenant-a' },
    );
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      groupId: 'group-1',
      userId: 'user-1',
      source: 'sso',
      sourceRef: 'legacy_sso:provider-1:mapping:mapping-1',
    }));
    expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      action: 'authz.sso_group_membership.create',
      resourceType: 'authz_group_membership',
      details: expect.stringContaining('mapping-1'),
    }));
  });

  it('removes stale authoritative SSO membership without touching manual memberships', async () => {
    const mapping = {
      id: 'mapping-1',
      tenantId: null,
      providerId: null,
      claimType: 'group',
      claimKey: 'groups',
      claimValue: 'Ops',
      targetGroupId: 'group-1',
      syncMode: 'authoritative',
      priority: 0,
      isActive: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const deleteMembership = vi.fn().mockResolvedValue(undefined);
    const auditInsert = vi.fn().mockResolvedValue(undefined);
    const find = vi.fn().mockResolvedValue([
      {
        id: 'stale-sso-membership',
        tenantId: null,
        userId: 'user-1',
        groupId: 'group-1',
        source: 'sso',
        sourceRef: 'mapping-1',
      },
    ]);
    const mappingQb = queryBuilder([mapping]);

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === SsoGroupMapping) return { createQueryBuilder: vi.fn().mockReturnValue(mappingQb) };
        if (entity === AuthzGroupMembership) return {
          createQueryBuilder: vi.fn(),
          insert: vi.fn(),
          find,
          update: vi.fn(),
          delete: deleteMembership,
        };
        if (entity === AuditLog) return { insert: auditInsert };
        throw new Error('Unexpected repository');
      },
    });

    const result = await ssoGroupMappingService.syncMembershipsForUser('user-1', { groups: ['Other'] });

    expect(result).toMatchObject({ created: 0, updated: 0, removed: 1 });
    expect(find).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        source: 'sso',
        sourceRef: 'mapping-1',
      },
    });
    expect(deleteMembership).toHaveBeenCalledWith({ id: 'stale-sso-membership' });
    expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      action: 'authz.sso_group_membership.delete',
      resourceType: 'authz_group_membership',
      resourceId: 'stale-sso-membership',
    }));
  });

  it('deletes provider-bound mapping memberships with both legacy source references', async () => {
    const mapping = { id: 'mapping-1', providerId: 'provider-1' };
    const find = vi.fn().mockResolvedValue([
      { id: 'membership-1', tenantId: null, userId: 'user-1', groupId: 'group-1' },
    ]);
    const deleteMembership = vi.fn().mockResolvedValue(undefined);
    const deleteMapping = vi.fn().mockResolvedValue(undefined);
    const auditInsert = vi.fn().mockResolvedValue(undefined);

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === SsoGroupMapping) return { findOneBy: vi.fn().mockResolvedValue(mapping), delete: deleteMapping };
        if (entity === AuthzGroupMembership) return { find, delete: deleteMembership };
        if (entity === AuditLog) return { insert: auditInsert };
        throw new Error('Unexpected repository');
      },
    });

    await ssoGroupMappingService.deleteMapping('mapping-1');

    const sourceRefs = (find.mock.calls[0][0].where.sourceRef as any)._value;
    expect(sourceRefs).toEqual(expect.arrayContaining([
      'mapping-1',
      'legacy_sso:provider-1:mapping:mapping-1',
    ]));
    expect(deleteMapping).toHaveBeenCalledWith({ id: 'mapping-1' });
    expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
      action: 'authz.sso_group_membership.delete',
      resourceId: 'membership-1',
    }));
  });

  it('does not remove stale group memberships in additive sync mode', async () => {
    const mapping = {
      id: 'mapping-additive',
      tenantId: null,
      providerId: null,
      claimType: 'group',
      claimKey: 'groups',
      claimValue: 'Ops',
      targetGroupId: 'group-1',
      syncMode: 'additive',
      priority: 0,
      isActive: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const find = vi.fn();
    const deleteMembership = vi.fn();
    const mappingQb = queryBuilder([mapping]);

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === SsoGroupMapping) return { createQueryBuilder: vi.fn().mockReturnValue(mappingQb) };
        if (entity === AuthzGroupMembership) return {
          createQueryBuilder: vi.fn(),
          insert: vi.fn(),
          find,
          update: vi.fn(),
          delete: deleteMembership,
        };
        throw new Error('Unexpected repository');
      },
    });

    const result = await ssoGroupMappingService.syncMembershipsForUser('user-1', { groups: ['Other'] });

    expect(result).toMatchObject({ created: 0, updated: 0, removed: 0 });
    expect(find).not.toHaveBeenCalled();
    expect(deleteMembership).not.toHaveBeenCalled();
  });

  it('requires acknowledgement before creating active regex group mappings', async () => {
    const insert = vi.fn();

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === AuthzGroup) return {
          findOneBy: vi.fn().mockResolvedValue({ id: 'group-1', tenantId: null, key: 'ops', name: 'Ops', isArchived: false }),
        };
        if (entity === SsoGroupMapping) return { insert };
        throw new Error('Unexpected repository');
      },
    });

    await expect(ssoGroupMappingService.createMapping({
      claimType: 'group',
      claimKey: 'groups',
      claimValue: '^Ops$',
      claimOperator: 'matches_regex',
      targetGroupId: 'group-1',
    })).rejects.toThrow('High-risk SSO regex claim mapping requires acknowledgement');
    expect(insert).not.toHaveBeenCalled();
  });

  it('removes stale regex group memberships when regex mappings are disabled by platform settings', async () => {
    const mapping = {
      id: 'mapping-regex',
      tenantId: null,
      providerId: null,
      claimType: 'group',
      claimKey: 'groups',
      claimValue: '^Ops$',
      claimOperator: 'matches_regex',
      targetGroupId: 'group-1',
      syncMode: 'additive',
      priority: 0,
      isActive: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const deleteMembership = vi.fn().mockResolvedValue(undefined);
    const auditInsert = vi.fn().mockResolvedValue(undefined);
    const find = vi.fn().mockResolvedValue([
      {
        id: 'stale-regex-membership',
        tenantId: null,
        userId: 'user-1',
        groupId: 'group-1',
        source: 'sso',
        sourceRef: 'mapping-regex',
      },
    ]);
    const mappingQb = queryBuilder([mapping]);

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === SsoGroupMapping) return { createQueryBuilder: vi.fn().mockReturnValue(mappingQb) };
        if (entity === PlatformSettings) return { findOneBy: vi.fn().mockResolvedValue({ ssoRegexClaimMappingsEnabled: false }) };
        if (entity === AuthzGroupMembership) return {
          createQueryBuilder: vi.fn(),
          insert: vi.fn(),
          find,
          update: vi.fn(),
          delete: deleteMembership,
        };
        if (entity === AuditLog) return { insert: auditInsert };
        throw new Error('Unexpected repository');
      },
    });

    const result = await ssoGroupMappingService.syncMembershipsForUser('user-1', { groups: ['Ops'] });

    expect(result).toMatchObject({ created: 0, updated: 0, removed: 1 });
    expect(deleteMembership).toHaveBeenCalledWith({ id: 'stale-regex-membership' });
  });

  it('rejects mappings that target a missing group', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === AuthzGroup) return { findOneBy: vi.fn().mockResolvedValue(null) };
        throw new Error('Unexpected repository');
      },
    });

    await expect(ssoGroupMappingService.createMapping({
      claimType: 'group',
      claimKey: 'groups',
      claimValue: 'Ops',
      targetGroupId: 'missing-group',
    })).rejects.toThrow('Target group');
  });

  it('creates a provider-neutral replacement for an equivalent legacy group mapping without deleting the legacy mapping', async () => {
    const legacyMapping = {
      id: 'legacy-group-1', tenantId: 'tenant-a', providerId: 'legacy-entra', claimType: 'group', claimKey: 'groups', claimValue: 'ops', claimOperator: 'equals',
      targetGroupId: 'group-1', syncMode: 'authoritative', priority: 0, isActive: true, createdAt: 1, updatedAt: 1,
    };
    const provider = { id: 'provider-1', tenantId: 'tenant-a', key: 'entra-main' };
    const group = { id: 'group-1', tenantId: 'tenant-a', key: 'ops', isArchived: false };
    identityEntitlementMappingService.create.mockResolvedValue({ id: 'identity-mapping-1', providerId: 'provider-1', providerKey: 'entra-main', targetGroupId: 'group-1', targetGroupKey: 'ops', entitlementType: 'group', externalId: 'ops', matchOperator: 'exact', syncMode: 'authoritative', isActive: true, configKey: null, sourceRef: null });
    const getRepository = (entity: unknown) => {
      if (entity === SsoGroupMapping) return { findOneBy: vi.fn().mockResolvedValue(legacyMapping) };
      if (entity === IdentityProvider) return { findOne: vi.fn().mockResolvedValue(provider) };
      if (entity === AuthzGroup) return { findOneBy: vi.fn().mockResolvedValue(group) };
      if (entity === IdentityEntitlementMapping) return { findOne: vi.fn().mockResolvedValue(null) };
      throw new Error('Unexpected repository');
    };
    (getDataSource as unknown as Mock).mockResolvedValue({ transaction: (callback: any) => callback({ getRepository }) });

    const result = await ssoGroupMappingService.migrateToProviderNeutral('legacy-group-1', 'entra-main', 'tenant-a');

    expect(result).toEqual(expect.objectContaining({ legacyMappingId: 'legacy-group-1', providerKey: 'entra-main', created: true }));
    expect(identityEntitlementMappingService.create).toHaveBeenCalledWith({ providerKey: 'entra-main', targetGroupKey: 'ops', entitlementType: 'group', externalId: 'ops', matchOperator: 'exact', syncMode: 'authoritative' }, 'tenant-a', expect.anything());
  });

  it('converts an exact email-domain group mapping into the sanitized attribute entitlement', async () => {
    const legacyMapping = {
      id: 'legacy-domain-1', tenantId: 'tenant-a', providerId: 'legacy-entra', claimType: 'email_domain', claimKey: 'email', claimValue: '*@enterpriseglue.ai', claimOperator: 'equals',
      targetGroupId: 'group-1', syncMode: 'authoritative', priority: 0, isActive: true, createdAt: 1, updatedAt: 1,
    };
    const provider = { id: 'provider-1', tenantId: 'tenant-a', key: 'entra-main', configurationJson: '{}' };
    const group = { id: 'group-1', tenantId: 'tenant-a', key: 'enterpriseglue-users', isArchived: false };
    identityEntitlementMappingService.create.mockResolvedValue({ id: 'identity-domain-1' });
    const getRepository = (entity: unknown) => {
      if (entity === SsoGroupMapping) return { findOneBy: vi.fn().mockResolvedValue(legacyMapping) };
      if (entity === IdentityProvider) return { findOne: vi.fn().mockResolvedValue(provider) };
      if (entity === AuthzGroup) return { findOneBy: vi.fn().mockResolvedValue(group) };
      if (entity === IdentityEntitlementMapping) return { findOne: vi.fn().mockResolvedValue(null) };
      throw new Error('Unexpected repository');
    };
    (getDataSource as unknown as Mock).mockResolvedValue({ transaction: (callback: any) => callback({ getRepository }) });

    await ssoGroupMappingService.migrateToProviderNeutral(legacyMapping.id, provider.key, 'tenant-a');

    expect(identityEntitlementMappingService.create).toHaveBeenCalledWith({
      providerKey: provider.key, targetGroupKey: group.key, entitlementType: 'attribute', externalId: 'email_domain:enterpriseglue.ai', matchOperator: 'exact', syncMode: 'authoritative',
    }, 'tenant-a', expect.anything());
  });

  it('refuses automatic conversion of legacy regex mappings', async () => {
    const legacyMapping = {
      id: 'legacy-regex-1', tenantId: null, providerId: null, claimType: 'group', claimKey: 'groups', claimValue: '^ops$', claimOperator: 'matches_regex',
      targetGroupId: 'group-1', syncMode: 'authoritative', priority: 0, isActive: true, createdAt: 1, updatedAt: 1,
    };
    (getDataSource as unknown as Mock).mockResolvedValue({ transaction: (callback: any) => callback({ getRepository: () => ({ findOneBy: vi.fn().mockResolvedValue(legacyMapping) }) }) });

    await expect(ssoGroupMappingService.migrateToProviderNeutral('legacy-regex-1', 'entra-main')).rejects.toThrow('Only equals, contains, and exists');
    expect(identityEntitlementMappingService.create).not.toHaveBeenCalled();
  });
});

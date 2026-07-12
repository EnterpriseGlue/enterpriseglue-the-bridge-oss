import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuditLog, AuthzGroup, AuthzGroupMembership, PlatformSettings, SsoGroupMapping } from '@enterpriseglue/shared/db/entities/index.js';
import { ssoGroupMappingService } from '@enterpriseglue/shared/services/platform-admin/SsoGroupMappingService.js';

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

    const result = await ssoGroupMappingService.syncMembershipsForUser('user-1', { groups: ['Ops'] }, undefined, 'tenant-a');

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
      sourceRef: 'mapping-1',
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
});

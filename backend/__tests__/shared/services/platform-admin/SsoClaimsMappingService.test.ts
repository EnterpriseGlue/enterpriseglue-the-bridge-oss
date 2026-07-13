import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuthzGroup } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroup.js';
import { IdentityEntitlementMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityEntitlementMapping.js';
import { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { SsoClaimsMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/SsoClaimsMapping.js';
import {
  ssoClaimMatches,
  ssoClaimsMappingService,
} from '@enterpriseglue/shared/services/platform-admin/SsoClaimsMappingService.js';

const { createGroup, createIdentityMapping, assignRole } = vi.hoisted(() => ({
  createGroup: vi.fn(),
  createIdentityMapping: vi.fn(),
  assignRole: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/AuthzGroupService.js', () => ({
  authzGroupService: { createGroup },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/IdentityEntitlementMappingService.js', () => ({
  identityEntitlementMappingService: { create: createIdentityMapping },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js', () => ({
  SYSTEM_ROLE_IDS: { PLATFORM_ADMIN: 'system.platform.admin', PLATFORM_USER: 'system.platform.user' },
  permissionService: { assignRole },
}));

describe('SsoClaimsMappingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockMappings(mappings: any[]) {
    const qb = {
      where: vi.fn(),
      andWhere: vi.fn(),
      orderBy: vi.fn(),
      getMany: vi.fn().mockResolvedValue(mappings),
    };
    qb.where.mockReturnValue(qb);
    qb.andWhere.mockReturnValue(qb);
    qb.orderBy.mockReturnValue(qb);

    const repo = {
      createQueryBuilder: vi.fn().mockReturnValue(qb),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: () => repo,
    });

    return { qb };
  }

  it('returns fallbackRole when no mappings match', async () => {
    mockMappings([
      {
        id: 'm1',
        claimType: 'group',
        claimKey: 'groups',
        claimValue: 'Platform-Admins',
        targetRole: 'admin',
        priority: 100,
      },
    ]);

    const resolvedRole = await ssoClaimsMappingService.resolveRoleFromClaims(
      { email: 'user@enterpriseglue.ai', groups: ['users'], roles: [] },
      'provider-1',
      'user'
    );

    expect(resolvedRole).toBe('user');
  });

  it('matches custom claim values for provider-specific mappings', async () => {
    const { qb } = mockMappings([
      {
        id: 'm2',
        claimType: 'custom',
        claimKey: 'department',
        claimValue: 'fin*',
        targetRole: 'admin',
        priority: 50,
      },
    ]);

    const resolvedRole = await ssoClaimsMappingService.resolveRoleFromClaims(
      { email: 'user@enterpriseglue.ai', groups: [], roles: [], department: 'Finance' },
      'provider-1',
      'user'
    );

    expect(resolvedRole).toBe('admin');
    expect(qb.andWhere).toHaveBeenCalledWith(
      '(m.providerId IS NULL OR m.providerId = :providerId)',
      { providerId: 'provider-1' }
    );
  });

  it('preserves wildcard compatibility when claimOperator is not set', () => {
    expect(ssoClaimMatches(
      { groups: ['Platform Admins'], roles: [], email: 'user@example.com' },
      { claimType: 'group', claimKey: 'groups', claimValue: 'Platform*' },
    )).toBe(true);
    expect(ssoClaimMatches(
      { groups: ['Everyone'], roles: [], email: 'user@example.com' },
      { claimType: 'group', claimKey: 'groups', claimValue: '*' },
    )).toBe(true);
  });

  it('requires acknowledgement before creating active regex platform-role mappings', async () => {
    const insert = vi.fn();
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: () => ({ insert }),
    });

    await expect(ssoClaimsMappingService.createMapping({
      claimType: 'group',
      claimKey: 'groups',
      claimValue: '^Admins$',
      claimOperator: 'matches_regex',
      targetRole: 'admin',
    })).rejects.toThrow('High-risk SSO regex claim mapping requires acknowledgement');
    expect(insert).not.toHaveBeenCalled();
  });

  it('rejects active regex platform-role mappings when the platform setting is off', async () => {
    const insert = vi.fn();
    const getRepository = vi.fn()
      .mockReturnValueOnce({ insert })
      .mockReturnValueOnce({ findOneBy: vi.fn().mockResolvedValue({ ssoRegexClaimMappingsEnabled: false }) });
    (getDataSource as unknown as Mock).mockResolvedValue({ getRepository });

    await expect(ssoClaimsMappingService.createMapping({
      claimType: 'group',
      claimKey: 'groups',
      claimValue: '^Admins$',
      claimOperator: 'matches_regex',
      targetRole: 'admin',
      riskAcknowledged: true,
    })).rejects.toThrow('High-risk SSO regex claim mappings are disabled by platform settings');
    expect(insert).not.toHaveBeenCalled();
  });

  it('skips active regex platform-role mappings at runtime when the platform setting is off', async () => {
    const qb = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([
        {
          id: 'regex-admin',
          claimType: 'group',
          claimKey: 'groups',
          claimValue: '^Admins$',
          claimOperator: 'matches_regex',
          targetRole: 'admin',
          priority: 100,
        },
      ]),
    };
    const getRepository = vi.fn()
      .mockReturnValueOnce({ createQueryBuilder: vi.fn().mockReturnValue(qb) })
      .mockReturnValueOnce({ findOneBy: vi.fn().mockResolvedValue({ ssoRegexClaimMappingsEnabled: false }) });
    (getDataSource as unknown as Mock).mockResolvedValue({ getRepository });

    const resolvedRole = await ssoClaimsMappingService.resolveRoleFromClaims(
      { groups: ['Admins'] },
      undefined,
      'user',
    );

    expect(resolvedRole).toBe('user');
  });

  it('matches explicit SSO claim operators', () => {
    const claims = {
      email: 'release.lead@example.com',
      groups: ['Finance', 'Release Operators', 'Engine Deployers'],
      roles: ['deployer', 'operator'],
      department: 'Finance Operations',
      clearance: 'critical',
    };

    expect(ssoClaimMatches(claims, {
      claimType: 'group',
      claimKey: 'groups',
      claimValue: 'finance',
      claimOperator: 'equals',
    })).toBe(true);
    expect(ssoClaimMatches(claims, {
      claimType: 'custom',
      claimKey: 'department',
      claimValue: 'operations',
      claimOperator: 'contains',
    })).toBe(true);
    expect(ssoClaimMatches(claims, {
      claimType: 'role',
      claimKey: 'roles',
      claimValue: 'deployer,owner',
      claimOperator: 'contains_any',
    })).toBe(true);
    expect(ssoClaimMatches(claims, {
      claimType: 'role',
      claimKey: 'roles',
      claimValue: 'deployer,operator',
      claimOperator: 'contains_all',
    })).toBe(true);
    expect(ssoClaimMatches(claims, {
      claimType: 'email_domain',
      claimKey: 'email',
      claimValue: 'example.com',
      claimOperator: 'equals',
    })).toBe(true);
    expect(ssoClaimMatches(claims, {
      claimType: 'custom',
      claimKey: 'clearance',
      claimValue: '^crit',
      claimOperator: 'matches_regex',
    })).toBe(true);
    expect(ssoClaimMatches(claims, {
      claimType: 'custom',
      claimKey: 'missing',
      claimValue: '',
      claimOperator: 'not_exists',
    })).toBe(true);
    expect(ssoClaimMatches(claims, {
      claimType: 'group',
      claimKey: 'groups',
      claimValue: 'Platform Admins',
      claimOperator: 'not_equals',
    })).toBe(true);
  });

  it('fails closed for invalid explicit SSO claim operators and invalid regex patterns', () => {
    expect(ssoClaimMatches(
      { groups: ['Ops'] },
      { claimType: 'group', claimKey: 'groups', claimValue: 'Ops', claimOperator: 'unknown' },
    )).toBe(false);
    expect(ssoClaimMatches(
      { groups: ['Ops'] },
      { claimType: 'group', claimKey: 'groups', claimValue: '[', claimOperator: 'matches_regex' },
    )).toBe(false);
    expect(ssoClaimMatches(
      { groups: ['Ops'] },
      { claimType: 'group', claimKey: 'groups', claimValue: '[', claimOperator: 'not_matches_regex' },
    )).toBe(true);
  });

  it('migrates an active global platform role mapping into a group mapping without removing the source', async () => {
    const legacy = { id: 'legacy-admin', isActive: true, claimType: 'group', claimOperator: 'equals', claimValue: 'entra-platform-admins', targetRole: 'admin' };
    const provider = { id: 'provider-1', key: 'entra' };
    const group = { id: 'group-1', key: 'entra-platform-admins', isArchived: false };
    const mappingRepo = { findOne: vi.fn().mockResolvedValue(null) };
    const getRepository = vi.fn((entity) => {
      if (entity === SsoClaimsMapping) return { findOneBy: vi.fn().mockResolvedValue(legacy) };
      if (entity === IdentityProvider) return { findOne: vi.fn().mockResolvedValue(provider) };
      if (entity === AuthzGroup) return { findOne: vi.fn().mockResolvedValue(group) };
      if (entity === IdentityEntitlementMapping) return mappingRepo;
      throw new Error(`Unexpected repository: ${entity.name}`);
    });
    (getDataSource as unknown as Mock).mockResolvedValue({ transaction: async (callback: any) => callback({ getRepository }) });
    createIdentityMapping.mockResolvedValue({ id: 'identity-mapping-1', providerId: provider.id, providerKey: provider.key, targetGroupId: group.id, targetGroupKey: group.key, entitlementType: 'group', externalId: legacy.claimValue, matchOperator: 'exact', syncMode: 'authoritative', isActive: true, configKey: null, sourceRef: null });
    assignRole.mockResolvedValue({ id: 'assignment-1' });

    const result = await ssoClaimsMappingService.migrateToProviderNeutral('legacy-admin', {
      providerKey: 'entra', targetGroupKey: group.key, createdById: 'admin-1',
    });

    expect(result).toMatchObject({ legacyMappingId: legacy.id, created: true, mapping: { id: 'identity-mapping-1' }, assignment: { id: 'assignment-1' }, createdGroup: null });
    expect(createIdentityMapping).toHaveBeenCalledWith({ providerKey: 'entra', targetGroupKey: group.key, entitlementType: 'group', externalId: legacy.claimValue, matchOperator: 'exact', syncMode: 'authoritative' }, null, expect.anything());
    expect(assignRole).toHaveBeenCalledWith(expect.objectContaining({ tenantId: null, principalType: 'group', principalId: group.id, roleId: 'system.platform.admin', resourceType: 'platform', resourceId: null }), expect.anything());
  });

  it('reuses an equivalent provider-neutral mapping on retry', async () => {
    const legacy = { id: 'legacy-user', isActive: true, claimType: 'role', claimOperator: 'contains', claimValue: 'standard', targetRole: 'user' };
    const provider = { id: 'provider-1', key: 'entra' };
    const group = { id: 'group-1', key: 'entra-users', isArchived: false };
    const existing = { id: 'identity-mapping-existing', configKey: null, sourceRef: null };
    const getRepository = vi.fn((entity) => {
      if (entity === SsoClaimsMapping) return { findOneBy: vi.fn().mockResolvedValue(legacy) };
      if (entity === IdentityProvider) return { findOne: vi.fn().mockResolvedValue(provider) };
      if (entity === AuthzGroup) return { findOne: vi.fn().mockResolvedValue(group) };
      if (entity === IdentityEntitlementMapping) return { findOne: vi.fn().mockResolvedValue(existing) };
      throw new Error(`Unexpected repository: ${entity.name}`);
    });
    (getDataSource as unknown as Mock).mockResolvedValue({ transaction: async (callback: any) => callback({ getRepository }) });
    assignRole.mockResolvedValue({ id: 'assignment-1' });

    const result = await ssoClaimsMappingService.migrateToProviderNeutral('legacy-user', {
      providerKey: 'entra', targetGroupKey: group.key, createdById: 'admin-1',
    });

    expect(result).toMatchObject({ created: false, mapping: { id: existing.id, targetGroupKey: group.key } });
    expect(createIdentityMapping).not.toHaveBeenCalled();
    expect(assignRole).toHaveBeenCalledWith(expect.objectContaining({ roleId: 'system.platform.user' }), expect.anything());
  });
});

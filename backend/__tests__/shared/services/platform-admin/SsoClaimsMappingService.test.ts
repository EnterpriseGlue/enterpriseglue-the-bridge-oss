import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import {
  ssoClaimMatches,
  ssoClaimsMappingService,
} from '@enterpriseglue/shared/services/platform-admin/SsoClaimsMappingService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
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
});

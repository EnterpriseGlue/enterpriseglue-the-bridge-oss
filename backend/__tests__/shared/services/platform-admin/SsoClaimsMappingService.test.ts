import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { ssoClaimsMappingService } from '@enterpriseglue/shared/services/platform-admin/SsoClaimsMappingService.js';

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
});

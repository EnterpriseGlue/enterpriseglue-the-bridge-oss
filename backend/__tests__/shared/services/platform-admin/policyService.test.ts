import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { policyService } from '@enterpriseglue/shared/services/platform-admin/PolicyService.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuthzPolicy } from '@enterpriseglue/shared/db/entities/AuthzPolicy.js';
import { AuthzAuditLog } from '@enterpriseglue/shared/db/entities/AuthzAuditLog.js';
import { permissionService, PlatformPermissions } from '@enterpriseglue/shared/services/platform-admin/permissions.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

describe('policyService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns deny when deny policy matches', async () => {
    const policyRepo = {
      createQueryBuilder: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue([
          {
            id: 'p1',
            name: 'deny-policy',
            description: null,
            effect: 'deny',
            priority: 10,
            resourceType: null,
            action: null,
            conditions: '{}',
            isActive: true,
          },
        ]),
      }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === AuthzPolicy) return policyRepo;
        throw new Error('Unexpected repository');
      },
    });

    vi.spyOn(permissionService, 'hasPermission').mockResolvedValue(false);

    const result = await policyService.evaluate(PlatformPermissions.USER_VIEW, {
      userId: 'user-1',
      platformRole: 'user',
    });

    expect(result.decision).toBe('deny');
    expect(result.reason).toContain('policy:deny-policy');
  });

  it('allows when allow policy grants access', async () => {
    const policyRepo = {
      createQueryBuilder: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue([
          {
            id: 'p2',
            name: 'allow-policy',
            description: null,
            effect: 'allow',
            priority: 5,
            resourceType: null,
            action: null,
            conditions: '{}',
            isActive: true,
          },
        ]),
      }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === AuthzPolicy) return policyRepo;
        throw new Error('Unexpected repository');
      },
    });

    vi.spyOn(permissionService, 'hasPermission').mockResolvedValue(false);

    const result = await policyService.evaluate(PlatformPermissions.USER_VIEW, {
      userId: 'user-1',
      platformRole: 'user',
    });

    expect(result.decision).toBe('allow');
  });

  it('logs decisions with audit records', async () => {
    const policyRepo = {
      createQueryBuilder: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue([]),
      }),
    };
    const auditRepo = { insert: vi.fn() };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === AuthzPolicy) return policyRepo;
        if (entity === AuthzAuditLog) return auditRepo;
        throw new Error('Unexpected repository');
      },
    });

    vi.spyOn(permissionService, 'hasPermission').mockResolvedValue(true);

    await policyService.evaluateAndLog(PlatformPermissions.USER_VIEW, {
      userId: 'user-1',
      platformRole: 'admin',
    });

    expect(auditRepo.insert).toHaveBeenCalled();
  });
});

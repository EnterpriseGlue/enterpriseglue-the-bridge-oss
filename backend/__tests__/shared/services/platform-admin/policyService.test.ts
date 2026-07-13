import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { policyService } from '@enterpriseglue/shared/services/platform-admin/PolicyService.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuditLog } from '@enterpriseglue/shared/db/entities/AuditLog.js';
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
    });

    expect(result.decision).toBe('allow');
  });

  it('evaluateGate denies when a deny policy matches', async () => {
    const policyRepo = {
      createQueryBuilder: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue([
          {
            id: 'p-deny',
            name: 'release-freeze',
            description: null,
            effect: 'deny',
            priority: 10,
            resourceType: 'project',
            action: 'project:deploy',
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

    const permissionSpy = vi.spyOn(permissionService, 'hasPermission').mockResolvedValue(false);

    const result = await policyService.evaluateGate('project:deploy', {
      userId: 'user-1',
      resourceType: 'project',
      resourceId: 'project-1',
    });

    expect(result).toMatchObject({
      decision: 'deny',
      reason: 'policy:release-freeze',
      policyId: 'p-deny',
      policyName: 'release-freeze',
    });
    expect(permissionSpy).not.toHaveBeenCalled();
  });

  it('evaluateGate treats allow policies as a pass, not a permission grant', async () => {
    const policyRepo = {
      createQueryBuilder: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue([
          {
            id: 'p-allow',
            name: 'business-hours',
            description: null,
            effect: 'allow',
            priority: 5,
            resourceType: 'project',
            action: 'project:deploy',
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

    const permissionSpy = vi.spyOn(permissionService, 'hasPermission').mockResolvedValue(false);

    const result = await policyService.evaluateGate('project:deploy', {
      userId: 'user-1',
      resourceType: 'project',
      resourceId: 'project-1',
    });

    expect(result).toMatchObject({
      decision: 'allow',
      reason: 'policy:business-hours',
      policyId: 'p-allow',
      policyName: 'business-hours',
    });
    expect(permissionSpy).not.toHaveBeenCalled();
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
    vi.spyOn(permissionService, 'evaluatePermission').mockResolvedValue({
      allowed: true,
      reason: 'canonical-assignment',
    } as any);

    await policyService.evaluateAndLog(PlatformPermissions.USER_VIEW, {
      userId: 'user-1',
    });

    expect(auditRepo.insert).toHaveBeenCalled();
    const auditContext = JSON.parse(auditRepo.insert.mock.calls[0][0].context);
    expect(auditContext).not.toHaveProperty('platformRole');
  });

  it('records policy mutation audit events', async () => {
    const policyRepo = {
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findOne: vi.fn().mockResolvedValue({
        id: 'policy-1',
        tenantId: 'tenant-a',
        name: 'Release freeze',
        effect: 'deny',
        resourceType: 'project',
        action: 'project:deploy',
      }),
    };
    const auditRepo = { insert: vi.fn() };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === AuthzPolicy) return policyRepo;
        if (entity === AuditLog) return auditRepo;
        throw new Error('Unexpected repository');
      },
    });

    const created = await policyService.createPolicy({
      tenantId: 'tenant-a',
      name: 'Release freeze',
      effect: 'deny',
      priority: 10,
      resourceType: 'project',
      action: 'project:deploy',
      createdById: 'admin-1',
    });
    await policyService.updatePolicy(created.id, {
      tenantId: 'tenant-a',
      name: 'Release freeze window',
      updatedById: 'admin-2',
    });
    await policyService.deletePolicy(created.id, 'admin-3');

    const actions = auditRepo.insert.mock.calls.map(([entry]) => entry.action);
    expect(actions).toEqual([
      'authz.policy.create',
      'authz.policy.update',
      'authz.policy.delete',
    ]);
    expect(auditRepo.insert).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'admin-1',
      action: 'authz.policy.create',
      resourceType: 'authz_policy',
      details: expect.stringContaining('project:deploy'),
    }));
    expect(auditRepo.insert).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'admin-2',
      action: 'authz.policy.update',
      resourceType: 'authz_policy',
    }));
    expect(auditRepo.insert).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'admin-3',
      action: 'authz.policy.delete',
      resourceType: 'authz_policy',
    }));
  });
});

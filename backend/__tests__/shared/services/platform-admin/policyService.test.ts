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
    expect(auditContext).not.toHaveProperty('projectRole');
    expect(auditContext).not.toHaveProperty('engineRole');
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

  it('uses the base evaluator result when no policy overrides it', async () => {
    const policyRepo = queryRepo([policyRow({
      id: 'unmatched-policy',
      name: 'unmatched policy',
      conditions: JSON.stringify({ userAttribute: { key: 'missing', operator: 'eq', value: 'x' } }),
    })]);
    (getDataSource as unknown as Mock).mockResolvedValue({ getRepository: () => policyRepo });
    vi.spyOn(permissionService, 'hasPermission').mockResolvedValue(true);
    vi.spyOn(permissionService, 'evaluatePermission').mockResolvedValue({ allowed: true, reason: 'role-assignment:operator', sources: [] } as any);

    await expect(policyService.evaluate('project:deploy', { userId: 'user-1', resourceType: 'project', resourceId: 'project-1' }))
      .resolves.toEqual({ decision: 'allow', reason: 'role-assignment:operator' });

    policyRepo.qb.getMany.mockResolvedValue([policyRow({ id: 'base-allow', name: 'base permission', effect: 'allow' })]);
    await expect(policyService.evaluate('project:deploy', { userId: 'user-1' }))
      .resolves.toEqual({ decision: 'allow', reason: 'role-assignment:operator' });

    vi.spyOn(permissionService, 'hasPermission').mockResolvedValue(false);
    policyRepo.qb.getMany.mockResolvedValue([]);
    await expect(policyService.evaluate('project:deploy', { userId: 'user-1' }))
      .resolves.toEqual({ decision: 'deny', reason: 'no-permission' });
  });

  it('keeps the first matching allow gate but lets a later deny win', async () => {
    const policyRepo = queryRepo([
      policyRow({ id: 'allow-1', name: 'first', effect: 'allow' }),
      policyRow({ id: 'allow-2', name: 'second', effect: 'allow' }),
      policyRow({ id: 'deny-1', name: 'freeze', effect: 'deny' }),
    ]);
    (getDataSource as unknown as Mock).mockResolvedValue({ getRepository: () => policyRepo });

    await expect(policyService.evaluateGate('project:deploy', { userId: 'user-1', resourceType: 'project' }))
      .resolves.toMatchObject({ decision: 'deny', policyId: 'deny-1' });

    policyRepo.qb.getMany.mockResolvedValue([
      policyRow({ id: 'unmatched', name: 'out-of-hours', effect: 'deny', conditions: JSON.stringify({ userAttribute: { key: 'missing', operator: 'eq', value: 'x' } }) }),
      policyRow({ id: 'allow-1', name: 'first', effect: 'allow' }),
      policyRow({ id: 'allow-2', name: 'second', effect: 'allow' }),
    ]);
    await expect(policyService.evaluateGate('project:deploy', { userId: 'user-1', resourceType: 'project' }))
      .resolves.toMatchObject({ decision: 'allow', policyId: 'allow-1' });

    policyRepo.qb.getMany.mockResolvedValue([]);
    await expect(policyService.evaluateGate('project:deploy', { userId: 'user-1' }))
      .resolves.toEqual({ decision: 'allow', reason: 'no-policy-deny' });
  });

  it('restores a base grant when a deny policy is disabled or its time window has expired', async () => {
    const policyRepo = queryRepo([]);
    const policies = [policyRow({
      id: 'temporary-freeze', name: 'temporary freeze', effect: 'deny', priority: 100,
      resourceType: 'project', action: 'project:deploy', isActive: true,
    })];
    policyRepo.qb.getMany.mockImplementation(async () => policies.filter((policy: any) => policy.isActive));
    (getDataSource as unknown as Mock).mockResolvedValue({ getRepository: () => policyRepo });
    vi.spyOn(permissionService, 'hasPermission').mockResolvedValue(true);
    vi.spyOn(permissionService, 'evaluatePermission').mockResolvedValue({
      allowed: true, reason: 'role-assignment:custom-project-deployer', sources: [],
    } as any);
    const context = { userId: 'user-1', resourceType: 'project' as const, resourceId: 'project-1' };

    await expect(policyService.evaluate('project:deploy', context)).resolves.toMatchObject({
      decision: 'deny', policyId: 'temporary-freeze',
    });

    policies[0] = { ...policies[0], isActive: false };
    await expect(policyService.evaluate('project:deploy', context)).resolves.toEqual({
      decision: 'allow', reason: 'role-assignment:custom-project-deployer',
    });

    policies[0] = policyRow({
      id: 'expired-freeze', name: 'expired freeze', effect: 'deny', priority: 100,
      resourceType: 'project', action: 'project:deploy', isActive: true,
      conditions: JSON.stringify({ timeWindow: { daysOfWeek: [0] } }),
    });
    await expect(policyService.evaluate('project:deploy', {
      ...context,
      timestamp: Date.UTC(2024, 0, 1, 12, 0, 0), // Monday: outside the Sunday-only freeze.
    })).resolves.toEqual({ decision: 'allow', reason: 'role-assignment:custom-project-deployer' });
  });

  it('evaluates every policy condition branch fail-closed', () => {
    const service = policyService as any;
    const context = {
      userId: 'user-1',
      userAttributes: { department: 'engineering', tags: 'release-manager' },
      resourceAttributes: { production: true, owner: 'user-1' },
      ipAddress: '10.10.2.3',
    };
    const timestamp = Date.UTC(2024, 0, 3, 12, 0, 0); // Wednesday noon UTC

    expect(service.evaluateConditions({}, context, timestamp)).toBe(true);
    expect(service.evaluateConditions({ userAttribute: { key: 'missing', operator: 'eq', value: 'x' } }, context, timestamp)).toBe(false);
    expect(service.evaluateConditions({ userAttribute: { key: 'department', operator: 'eq', value: 'engineering' } }, context, timestamp)).toBe(true);
    expect(service.evaluateConditions({ userAttribute: { key: 'department', operator: 'neq', value: 'sales' } }, context, timestamp)).toBe(true);
    expect(service.evaluateConditions({ userAttribute: { key: 'department', operator: 'in', value: ['sales', 'engineering'] } }, context, timestamp)).toBe(true);
    expect(service.evaluateConditions({ userAttribute: { key: 'department', operator: 'notIn', value: ['sales'] } }, context, timestamp)).toBe(true);
    expect(service.evaluateConditions({ userAttribute: { key: 'tags', operator: 'contains', value: 'manager' } }, context, timestamp)).toBe(true);
    expect(service.evaluateConditions({ userAttribute: { key: 'department', operator: 'unknown', value: 'engineering' } as any }, context, timestamp)).toBe(false);
    expect(service.evaluateConditions({ resourceAttribute: { key: 'missing', operator: 'eq', value: true } }, context, timestamp)).toBe(false);
    expect(service.evaluateConditions({ resourceAttribute: { key: 'production', operator: 'eq', value: true } }, context, timestamp)).toBe(true);
    expect(service.evaluateConditions({ environment: { ipRange: ['10.10.*'] } }, context, timestamp)).toBe(true);
    expect(service.evaluateConditions({ environment: { ipRange: ['10.10.2.3'] } }, context, timestamp)).toBe(true);
    expect(service.evaluateConditions({ environment: { ipRange: ['192.168.*'] } }, context, timestamp)).toBe(false);
    expect(service.evaluateConditions({ environment: { ipRange: ['10.10.2.3'] } }, { userId: 'user-1' }, timestamp)).toBe(true);
    expect(service.evaluateConditions({ timeWindow: { daysOfWeek: [3], start: '09:00', end: '17:00' } }, context, timestamp)).toBe(true);
    expect(service.evaluateConditions({ timeWindow: { daysOfWeek: [2] } }, context, timestamp)).toBe(false);
    expect(service.evaluateConditions({ timeWindow: { start: '13:00', end: '17:00' } }, context, timestamp)).toBe(false);
    expect(service.evaluateConditions({ timeWindow: { start: '22:00', end: '06:00' } }, context, timestamp)).toBe(false);
    expect(service.evaluateConditions({ timeWindow: { start: '09:00' } }, context, timestamp)).toBe(true);
    expect(service.evaluateConditions({ timeWindow: { start: '22:00', end: '06:00' } }, context, Date.UTC(2024, 0, 3, 23, 0, 0))).toBe(true);
  });

  it('covers policy CRUD, tenant filtering, invalid persisted conditions, and audit query filters', async () => {
    const policyRepo = {
      ...queryRepo([policyRow({ id: 'policy-1', tenantId: 'tenant-a', description: '', resourceType: '', action: '', conditions: '{invalid' })]),
      insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
      findOne: vi.fn().mockResolvedValue(null),
      findOneBy: vi.fn()
        .mockResolvedValueOnce(policyRow({ id: 'policy-1', tenantId: 'tenant-a', description: '', resourceType: '', action: '', conditions: '{invalid' }))
        .mockResolvedValueOnce(null),
      find: vi.fn().mockResolvedValue([policyRow({ id: 'policy-1', tenantId: 'tenant-a', description: '', resourceType: '', action: '', conditions: '{invalid' })]),
    };
    const auditRepo = { insert: vi.fn(), createQueryBuilder: vi.fn().mockReturnValue(queryBuilder([])) };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => entity === AuthzPolicy ? policyRepo : entity === AuditLog || entity === AuthzAuditLog ? auditRepo : undefined,
    });

    const created = await policyService.createPolicy({ name: 'Default policy', effect: 'allow', createdById: 'admin-1', tenantId: '  ' });
    expect(policyRepo.insert).toHaveBeenCalledWith(expect.objectContaining({ tenantId: null, description: null, priority: 0, resourceType: null, action: null, conditions: '{}' }));
    await policyService.updatePolicy(created.id, {
      tenantId: ' tenant-b ', name: 'Updated', description: '', effect: 'deny', priority: 9,
      resourceType: '', action: '', conditions: { environment: {} }, isActive: false, updatedById: 'admin-2',
    });
    expect(policyRepo.update).toHaveBeenCalledWith({ id: created.id }, expect.objectContaining({
      tenantId: 'tenant-b', name: 'Updated', description: null, effect: 'deny', priority: 9,
      resourceType: null, action: null, conditions: JSON.stringify({ environment: {} }), isActive: false,
    }));
    await policyService.updatePolicy(created.id, {});
    await policyService.deletePolicy(created.id);
    expect(auditRepo.insert).toHaveBeenCalledWith(expect.objectContaining({ userId: null, action: 'authz.policy.delete' }));

    await expect(policyService.getAllPolicies(' tenant-a ')).resolves.toEqual([expect.objectContaining({ conditions: {}, description: undefined, resourceType: undefined, action: undefined })]);
    await expect(policyService.getAllPolicies()).resolves.toHaveLength(1);
    await expect(policyService.getPolicy('policy-1')).resolves.toMatchObject({ id: 'policy-1', conditions: {} });
    await expect(policyService.getPolicy('missing')).resolves.toBeNull();
    await expect(policyService.getAuditLog({ tenantId: ' tenant-a ', userId: 'user-1', resourceType: 'project', resourceId: 'project-1', decision: 'deny', limit: 25, offset: 10 })).resolves.toEqual([]);
    await expect(policyService.getAuditLog({})).resolves.toEqual([]);
    const auditQb = auditRepo.createQueryBuilder.mock.results[0].value;
    expect(auditQb.andWhere).toHaveBeenCalledWith('(a.tenantId = :tenantId OR a.tenantId IS NULL)', { tenantId: 'tenant-a' });
    expect(auditQb.take).toHaveBeenCalledWith(25);
    expect(auditQb.skip).toHaveBeenCalledWith(10);

    auditRepo.insert.mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(policyService.createPolicy({ name: 'Audit best effort', effect: 'allow', createdById: 'admin-1' })).resolves.toHaveProperty('id');
    await expect((policyService as any).logPolicyMutation({ getRepository: () => auditRepo }, {
      tenantId: null, action: 'authz.policy.no-details', resourceId: 'policy-1',
    })).resolves.toBeUndefined();
  });
});

function policyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'policy', tenantId: null, name: 'policy', description: null, effect: 'allow', priority: 1,
    resourceType: null, action: null, conditions: '{}', isActive: true, ...overrides,
  };
}

function queryBuilder(rows: unknown[]) {
  const qb: any = {
    where: vi.fn(), andWhere: vi.fn(), orderBy: vi.fn(), take: vi.fn(), skip: vi.fn(),
    getMany: vi.fn().mockResolvedValue(rows),
  };
  for (const method of ['where', 'andWhere', 'orderBy', 'take', 'skip']) qb[method].mockReturnValue(qb);
  return qb;
}

function queryRepo(rows: unknown[]) {
  const qb = queryBuilder(rows);
  return { qb, createQueryBuilder: vi.fn().mockReturnValue(qb) };
}

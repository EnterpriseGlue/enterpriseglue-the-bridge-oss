import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  EnginePermissions,
  EngineRolePermissions,
  permissionService,
} from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import {
  AuthzGroupMembership,
  PermissionGrant,
  RbacRole,
  RbacRoleAssignment,
  RbacRolePermission,
} from '@enterpriseglue/shared/db/entities/index.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

interface TestAssignment {
  id: string;
  roleId: string;
  principalType: 'user';
  principalId: string;
  scopeType: 'engine';
  scopeId: string;
  source: 'manual';
  sourceMappingId: null;
  sourceRef: null;
  permissions: string[];
}

function queryBuilder(assignments: TestAssignment[]) {
  const parameters: Record<string, unknown> = {};
  const capture = (...args: unknown[]) => {
    const candidate = args[args.length - 1];
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      Object.assign(parameters, candidate);
    }
  };
  const builder = {
    select: vi.fn().mockReturnThis(),
    innerJoin: vi.fn((...args: unknown[]) => { capture(...args); return builder; }),
    where: vi.fn((...args: unknown[]) => { capture(...args); return builder; }),
    andWhere: vi.fn((...args: unknown[]) => { capture(...args); return builder; }),
    getMany: vi.fn(async () => {
      if (parameters.engineSetScopeType) return [];
      return assignments.filter((assignment) =>
        assignment.principalId === parameters.userId &&
        assignment.scopeType === parameters.resourceType &&
        assignment.scopeId === parameters.resourceId &&
        assignment.permissions.includes(String(parameters.permission))
      );
    }),
  };
  return builder;
}

describe('per-engine canonical access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps viewer access on Engine A isolated from administrator access on Engine B', async () => {
    const assignments: TestAssignment[] = [
      {
        id: 'assignment-engine-a-viewer',
        roleId: 'custom.engine.viewer',
        principalType: 'user',
        principalId: 'user-1',
        scopeType: 'engine',
        scopeId: 'engine-a',
        source: 'manual',
        sourceMappingId: null,
        sourceRef: null,
        permissions: [EnginePermissions.INSTANCE_VIEW],
      },
      {
        id: 'assignment-engine-b-admin',
        roleId: 'custom.engine.admin',
        principalType: 'user',
        principalId: 'user-1',
        scopeType: 'engine',
        scopeId: 'engine-b',
        source: 'manual',
        sourceMappingId: null,
        sourceRef: null,
        // A tenant-defined Engine Administrator role with owner-equivalent capabilities.
        permissions: EngineRolePermissions.owner,
      },
    ];
    const membershipBuilder = {
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([]),
    };
    const grantBuilder = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue(null),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === AuthzGroupMembership) return { createQueryBuilder: vi.fn().mockReturnValue(membershipBuilder) };
        if (entity === RbacRoleAssignment) return { createQueryBuilder: vi.fn(() => queryBuilder(assignments)) };
        if (entity === PermissionGrant) return { createQueryBuilder: vi.fn().mockReturnValue(grantBuilder) };
        if (entity === RbacRolePermission || entity === RbacRole) return {};
        throw new Error('Unexpected repository');
      },
    });

    const engineAView = await permissionService.evaluatePermission(EnginePermissions.INSTANCE_VIEW, {
      userId: 'user-1', resourceType: 'engine', resourceId: 'engine-a',
    });
    const engineAAdmin = await permissionService.evaluatePermission(EnginePermissions.ENGINE_EDIT, {
      userId: 'user-1', resourceType: 'engine', resourceId: 'engine-a',
    });
    const engineBView = await permissionService.evaluatePermission(EnginePermissions.INSTANCE_VIEW, {
      userId: 'user-1', resourceType: 'engine', resourceId: 'engine-b',
    });
    const engineBAdmin = await permissionService.evaluatePermission(EnginePermissions.ENGINE_EDIT, {
      userId: 'user-1', resourceType: 'engine', resourceId: 'engine-b',
    });
    const engineBSecrets = await permissionService.evaluatePermission(EnginePermissions.SECRETS_MANAGE, {
      userId: 'user-1', resourceType: 'engine', resourceId: 'engine-b',
    });
    const unknownEngine = await permissionService.evaluatePermission(EnginePermissions.INSTANCE_VIEW, {
      userId: 'user-1', resourceType: 'engine', resourceId: 'engine-c',
    });

    expect(engineAView).toMatchObject({
      allowed: true,
      reason: 'role-assignment:custom.engine.viewer',
      sources: [{ assignmentId: 'assignment-engine-a-viewer', scopeId: 'engine-a' }],
    });
    expect(engineAAdmin).toEqual({ allowed: false, reason: 'no-permission', sources: [] });
    expect(engineBView).toMatchObject({
      allowed: true,
      reason: 'role-assignment:custom.engine.admin',
      sources: [{ assignmentId: 'assignment-engine-b-admin', scopeId: 'engine-b' }],
    });
    expect(engineBAdmin.allowed).toBe(true);
    expect(engineBSecrets.allowed).toBe(true);
    expect(unknownEngine).toEqual({ allowed: false, reason: 'no-permission', sources: [] });
  });
});

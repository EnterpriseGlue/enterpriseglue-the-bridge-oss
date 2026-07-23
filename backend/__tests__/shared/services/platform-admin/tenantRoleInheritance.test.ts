import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import {
  EnginePermissions,
  PlatformPermissions,
  ProjectPermissions,
  permissionService,
} from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import {
  Engine,
  Project,
  RbacRoleAssignment,
  RuntimeResource,
} from '@enterpriseglue/shared/db/entities/index.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

function queryBuilder(rows: unknown[] = []) {
  return {
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    getMany: vi.fn().mockResolvedValue(rows),
  };
}

function tenantAssignment(roleId = 'system.tenant.engine_operator') {
  return {
    id: 'assignment-tenant-a',
    tenantId: 'tenant-a',
    roleId,
    principalType: 'service_account',
    principalId: 'service-account-1',
    source: 'manual',
    sourceRef: null,
    expiresAt: null,
    scopeType: 'tenant',
    scopeId: 'tenant-a',
  };
}

const principal = {
  userId: 'service-account-1',
  principalType: 'service_account' as const,
  principalId: 'service-account-1',
  tenantId: 'tenant-a',
};

describe('tenant role inheritance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inherits every tenant-safe project permission only to a project in the active tenant', async () => {
    for (const permission of Object.values(ProjectPermissions)) {
      const direct = queryBuilder([tenantAssignment('system.tenant.admin')]);
      (getDataSource as unknown as Mock).mockResolvedValue({
        getRepository: (entity: unknown) => {
          if (entity === RbacRoleAssignment) return { createQueryBuilder: vi.fn().mockReturnValue(direct) };
          if (entity === Project) return { findOne: vi.fn().mockResolvedValue({ id: 'project-a' }) };
          throw new Error(`Unexpected repository: ${(entity as { name?: string }).name}`);
        },
      });

      const result = await permissionService.evaluatePermission(permission, {
        ...principal,
        resourceType: 'project',
        resourceId: 'project-a',
      });

      expect(result.allowed, permission).toBe(true);
      expect(direct.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('assignment.scopeType = :tenantScope'),
        expect.objectContaining({ tenantScope: 'tenant', tenantScopeId: 'tenant-a' }),
      );
    }
  });

  it('does not inherit a tenant assignment to a sibling-tenant project or a platform permission', async () => {
    for (const permission of [ProjectPermissions.FILES_VIEW, PlatformPermissions.AUTHZ_ROLES_MANAGE]) {
      const direct = queryBuilder([]);
      (getDataSource as unknown as Mock).mockResolvedValue({
        getRepository: (entity: unknown) => {
          if (entity === RbacRoleAssignment) return { createQueryBuilder: vi.fn().mockReturnValue(direct) };
          if (entity === Project) return { findOne: vi.fn().mockResolvedValue(null) };
          throw new Error(`Unexpected repository: ${(entity as { name?: string }).name}`);
        },
      });

      const result = await permissionService.evaluatePermission(permission, {
        ...principal,
        resourceType: 'project',
        resourceId: 'project-b',
      });

      expect(result.allowed, permission).toBe(false);
      expect(direct.andWhere).not.toHaveBeenCalledWith(
        expect.stringContaining('assignment.scopeType = :tenantScope'),
        expect.objectContaining({ tenantScopeId: 'tenant-a' }),
      );
    }
  });

  it('inherits tenant-safe engine permissions only to a same-tenant dedicated engine', async () => {
    const direct = queryBuilder([tenantAssignment()]);
    const engineSet = queryBuilder([]);
    const createQueryBuilder = vi.fn()
      .mockReturnValueOnce(direct)
      .mockReturnValueOnce(engineSet);
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === RbacRoleAssignment) return { createQueryBuilder };
        if (entity === Engine) {
          return {
            findOne: vi.fn().mockResolvedValue({ id: 'engine-a' }),
          };
        }
        throw new Error(`Unexpected repository: ${(entity as { name?: string }).name}`);
      },
    });

    const result = await permissionService.evaluatePermission(EnginePermissions.PROCESS_START, {
      ...principal,
      resourceType: 'engine',
      resourceId: 'engine-a',
    });

    expect(result.allowed).toBe(true);
    expect(direct.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('assignment.scopeType = :tenantScope'),
      expect.objectContaining({ tenantScopeId: 'tenant-a' }),
    );
  });

  it('inherits a tenant role to a resolved shared runtime resource without accepting broad shared-engine scopes', async () => {
    const direct = queryBuilder([tenantAssignment()]);
    const runtimeSet = queryBuilder([]);
    const createQueryBuilder = vi.fn()
      .mockReturnValueOnce(direct)
      .mockReturnValueOnce(runtimeSet);
    const runtimeFindOne = vi.fn().mockResolvedValue({
      id: 'runtime-a',
      engineId: 'shared-engine',
      tenantId: 'tenant-a',
      tenantResolutionStatus: 'resolved',
      tenantMappingId: 'mapping-a',
      tenantMappingVersion: 7,
      tenantResolutionDetailsJson: JSON.stringify({ code: 'ENGINE_TENANT_MAPPING_MATCH' }),
      isActive: true,
    });
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === RbacRoleAssignment) return { createQueryBuilder };
        if (entity === RuntimeResource) return { findOne: runtimeFindOne };
        if (entity === Engine) return { findOne: vi.fn().mockResolvedValue({ id: 'shared-engine', tenancyMode: 'shared' }) };
        throw new Error(`Unexpected repository: ${(entity as { name?: string }).name}`);
      },
    });

    const result = await permissionService.evaluatePermission(EnginePermissions.INSTANCE_VIEW, {
      ...principal,
      resourceType: 'engine_runtime_resource',
      resourceId: 'runtime-a',
    });

    expect(result.allowed).toBe(true);
    expect(createQueryBuilder).toHaveBeenCalledTimes(2);
    expect(direct.andWhere).toHaveBeenCalledWith(
      expect.not.stringContaining('assignment.scopeType = :engineScope'),
      expect.objectContaining({
        resourceType: 'engine_runtime_resource',
        resourceId: 'runtime-a',
        tenantScope: 'tenant',
        tenantScopeId: 'tenant-a',
      }),
    );
    expect(result.sources[0]).toMatchObject({
      scopeType: 'tenant',
      scopeId: 'tenant-a',
      runtimeTenantResolution: {
        tenantId: 'tenant-a',
        status: 'resolved',
        mappingId: 'mapping-a',
        mappingVersion: 7,
        code: 'ENGINE_TENANT_MAPPING_MATCH',
        engineTenancyMode: 'shared',
      },
    });
  });

  it('denies unresolved shared runtime inventory before assignment evaluation', async () => {
    const runtimeFindOne = vi.fn().mockResolvedValue(null);
    const createQueryBuilder = vi.fn();
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === RbacRoleAssignment) return { createQueryBuilder };
        if (entity === RuntimeResource) return { findOne: runtimeFindOne };
        throw new Error(`Unexpected repository: ${(entity as { name?: string }).name}`);
      },
    });

    const result = await permissionService.evaluatePermission(EnginePermissions.INSTANCE_VIEW, {
      ...principal,
      resourceType: 'engine_runtime_resource',
      resourceId: 'runtime-unmapped',
    });

    expect(result).toEqual({ allowed: false, reason: 'no-permission', sources: [] });
    expect(runtimeFindOne).toHaveBeenCalledWith({
      where: [{
        id: 'runtime-unmapped',
        isActive: true,
        tenantId: 'tenant-a',
        tenantResolutionStatus: 'resolved',
      }],
    });
    expect(createQueryBuilder).not.toHaveBeenCalled();
  });
});

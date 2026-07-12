import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { EngineService } from '@enterpriseglue/shared/services/platform-admin/EngineService.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/db/entities/Engine.js';
import { EngineMember } from '@enterpriseglue/shared/db/entities/EngineMember.js';
import { EnvironmentTag } from '@enterpriseglue/shared/db/entities/EnvironmentTag.js';
import { RbacRoleAssignment } from '@enterpriseglue/shared/db/entities/RbacRoleAssignment.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

describe('EngineService', () => {
  const service = new EngineService();

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('returns owner role when user is owner', async () => {
    const engineRepo = {
      findOne: vi.fn().mockResolvedValue({ id: 'engine-1', ownerId: 'user-1', delegateId: null }),
    };
    const memberRepo = {
      findOne: vi.fn().mockResolvedValue(null),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) return engineRepo;
        if (entity === EngineMember) return memberRepo;
        throw new Error('Unexpected repository');
      },
    });

    const role = await service.getEngineRole('user-1', 'engine-1');
    expect(role).toBe('owner');
  });

  it('returns membership role when user is member', async () => {
    const engineRepo = {
      findOne: vi.fn().mockResolvedValue({ id: 'engine-1', ownerId: 'owner-1', delegateId: null }),
    };
    const memberRepo = {
      findOne: vi.fn().mockResolvedValue({ role: 'operator' }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) return engineRepo;
        if (entity === EngineMember) return memberRepo;
        throw new Error('Unexpected repository');
      },
    });

    const role = await service.getEngineRole('user-1', 'engine-1');
    expect(role).toBe('operator');
  });

  it('checks access for required roles', async () => {
    const engineRepo = {
      findOne: vi.fn().mockResolvedValue({ id: 'engine-1', ownerId: 'owner-1', delegateId: null }),
    };
    const memberRepo = {
      findOne: vi.fn().mockResolvedValue({ role: 'deployer' }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) return engineRepo;
        if (entity === EngineMember) return memberRepo;
        throw new Error('Unexpected repository');
      },
    });

    const allowed = await service.hasEngineAccess('user-1', 'engine-1', ['deployer', 'owner']);
    const denied = await service.hasEngineAccess('user-1', 'engine-1', ['owner']);
    expect(allowed).toBe(true);
    expect(denied).toBe(false);
  });

  it('uses scoped RBAC engine assignments when legacy membership is absent', async () => {
    const engineRepo = {
      findOne: vi.fn().mockResolvedValue({ id: 'engine-1', ownerId: 'owner-1', delegateId: null }),
    };
    const memberRepo = {
      findOne: vi.fn().mockResolvedValue(null),
    };
    const assignmentSpy = vi.spyOn(permissionService, 'getAssignedEngineRole').mockResolvedValue('operator');

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) return engineRepo;
        if (entity === EngineMember) return memberRepo;
        throw new Error('Unexpected repository');
      },
    });

    const role = await service.getEngineRole('user-1', 'engine-1');

    expect(role).toBe('operator');
    expect(assignmentSpy).toHaveBeenCalledWith('user-1', 'engine-1', undefined);
  });

  it('includes engines granted by custom scoped RBAC assignments', async () => {
    const engine = { id: 'engine-1', name: 'Engine 1', ownerId: 'owner-1', delegateId: null, environmentTagId: null };
    const engineRepo = {
      find: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([engine]),
    };
    const memberRepo = {
      find: vi.fn().mockResolvedValue([]),
    };
    const tagRepo = {
      find: vi.fn().mockResolvedValue([]),
    };
    const assignmentQb = {
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([{ id: 'assignment-1', resourceId: 'engine-1' }]),
    };
    const assignmentRepo = {
      createQueryBuilder: vi.fn().mockReturnValue(assignmentQb),
    };
    const assignmentSpy = vi.spyOn(permissionService, 'getAssignedEngineRoles').mockResolvedValue([]);

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) return engineRepo;
        if (entity === EngineMember) return memberRepo;
        if (entity === EnvironmentTag) return tagRepo;
        if (entity === RbacRoleAssignment) return assignmentRepo;
        throw new Error('Unexpected repository');
      },
    });

    const engines = await service.getUserEngines('user-1');

    expect(engines).toEqual([
      expect.objectContaining({
        engine,
        role: 'custom',
      }),
    ]);
    expect(assignmentSpy).toHaveBeenCalledWith('user-1', undefined);
  });

  it('mirrors delegate governance changes into managed role assignments', async () => {
    const engineRepo = {
      findOne: vi.fn().mockResolvedValue({
        id: 'engine-1',
        ownerId: 'owner-1',
        delegateId: null,
        tenantId: 'tenant-1',
        createdAt: 100,
        updatedAt: 200,
      }),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
    };
    const assignmentRepo = {
      find: vi.fn().mockResolvedValue([
        {
          id: 'system:engine:engine-1:owner:owner-1',
          userId: 'owner-1',
          roleId: 'system.engine.owner',
          sourceMappingId: 'engine:engine-1:governance-owner',
          sourceRef: 'engine:engine-1:governance-owner',
        },
      ]),
      delete: vi.fn().mockResolvedValue({ affected: 0 }),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
      insert: vi.fn().mockResolvedValue({ identifiers: [] }),
    };
    const legacySyncSpy = vi.spyOn(permissionService, 'syncLegacyRoleAssignments').mockResolvedValue({
      scannedProjects: 0,
      scannedEngines: 1,
      upserted: 0,
      removed: 0,
    });

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) return engineRepo;
        if (entity === RbacRoleAssignment) return assignmentRepo;
        throw new Error('Unexpected repository');
      },
    });

    await service.assignDelegate('engine-1', 'delegate-1');

    expect(engineRepo.update).toHaveBeenCalledWith({ id: 'engine-1' }, expect.objectContaining({
      delegateId: 'delegate-1',
    }));
    expect(assignmentRepo.update).toHaveBeenCalledWith({ id: 'system:engine:engine-1:owner:owner-1' }, expect.objectContaining({
      tenantId: 'tenant-1',
      principalType: 'user',
      principalId: 'owner-1',
      scopeType: 'engine',
      scopeId: 'engine-1',
    }));
    expect(assignmentRepo.insert).toHaveBeenCalledWith(expect.objectContaining({
      id: 'system:engine:engine-1:delegate:delegate-1',
      tenantId: 'tenant-1',
      userId: 'delegate-1',
      principalType: 'user',
      principalId: 'delegate-1',
      roleId: 'system.engine.delegate',
      resourceType: 'engine',
      resourceId: 'engine-1',
      scopeType: 'engine',
      scopeId: 'engine-1',
      source: 'system',
      sourceMappingId: 'engine:engine-1:governance-delegate',
      sourceRef: 'engine:engine-1:governance-delegate',
      createdById: null,
    }));
    expect(legacySyncSpy).toHaveBeenCalledWith({ engineIds: ['engine-1'] });
  });

  it('mirrors ownership transfer as accountable owner metadata plus managed owner assignment', async () => {
    const engineRepo = {
      findOne: vi.fn().mockResolvedValue({
        id: 'engine-1',
        ownerId: 'old-owner',
        delegateId: 'delegate-1',
        tenantId: null,
        createdAt: 100,
        updatedAt: 200,
      }),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
    };
    const assignmentRepo = {
      find: vi.fn().mockResolvedValue([
        {
          id: 'system:engine:engine-1:owner:old-owner',
          userId: 'old-owner',
          roleId: 'system.engine.owner',
          sourceMappingId: 'engine:engine-1:governance-owner',
          sourceRef: 'engine:engine-1:governance-owner',
        },
        {
          id: 'system:engine:engine-1:delegate:delegate-1',
          userId: 'delegate-1',
          roleId: 'system.engine.delegate',
          sourceMappingId: 'engine:engine-1:governance-delegate',
          sourceRef: 'engine:engine-1:governance-delegate',
        },
      ]),
      delete: vi.fn().mockResolvedValue({ affected: 2 }),
      update: vi.fn().mockResolvedValue({ affected: 0 }),
      insert: vi.fn().mockResolvedValue({ identifiers: [] }),
    };
    const legacySyncSpy = vi.spyOn(permissionService, 'syncLegacyRoleAssignments').mockResolvedValue({
      scannedProjects: 0,
      scannedEngines: 1,
      upserted: 0,
      removed: 0,
    });

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) return engineRepo;
        if (entity === RbacRoleAssignment) return assignmentRepo;
        throw new Error('Unexpected repository');
      },
    });

    await service.transferOwnership('engine-1', 'new-owner');

    expect(engineRepo.update).toHaveBeenCalledWith({ id: 'engine-1' }, expect.objectContaining({
      ownerId: 'new-owner',
      delegateId: null,
    }));
    expect(assignmentRepo.delete).toHaveBeenCalledWith(expect.objectContaining({
      id: expect.anything(),
    }));
    expect(assignmentRepo.insert).toHaveBeenCalledTimes(1);
    expect(assignmentRepo.insert).toHaveBeenCalledWith(expect.objectContaining({
      id: 'system:engine:engine-1:owner:new-owner',
      userId: 'new-owner',
      principalType: 'user',
      principalId: 'new-owner',
      roleId: 'system.engine.owner',
      resourceType: 'engine',
      resourceId: 'engine-1',
      source: 'system',
      sourceMappingId: 'engine:engine-1:governance-owner',
    }));
    expect(legacySyncSpy).toHaveBeenCalledWith({ engineIds: ['engine-1'] });
  });
});

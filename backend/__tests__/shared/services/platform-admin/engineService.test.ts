import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { EngineService } from '@enterpriseglue/shared/services/platform-admin/EngineService.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/db/entities/Engine.js';
import { EngineMember } from '@enterpriseglue/shared/db/entities/EngineMember.js';
import { EnvironmentTag } from '@enterpriseglue/shared/db/entities/EnvironmentTag.js';
import { RbacRoleAssignment } from '@enterpriseglue/shared/db/entities/RbacRoleAssignment.js';
import { User } from '@enterpriseglue/shared/db/entities/User.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

describe('EngineService', () => {
  const service = new EngineService();

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('returns the canonical owner role for an engine', async () => {
    const engineRepo = {
      findOne: vi.fn().mockResolvedValue({ id: 'engine-1', ownerId: 'user-1', delegateId: null }),
    };
    const assignmentSpy = vi.spyOn(permissionService, 'getAssignedEngineRole').mockResolvedValue('owner');

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) return engineRepo;
        throw new Error('Unexpected repository');
      },
    });

    const role = await service.getEngineRole('user-1', 'engine-1');
    expect(role).toBe('owner');
    expect(assignmentSpy).toHaveBeenCalledWith('user-1', 'engine-1', undefined);
  });

  it('returns the canonical member role for an engine', async () => {
    const engineRepo = {
      findOne: vi.fn().mockResolvedValue({ id: 'engine-1', ownerId: 'owner-1', delegateId: null }),
    };
    const assignmentSpy = vi.spyOn(permissionService, 'getAssignedEngineRole').mockResolvedValue('operator');

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) return engineRepo;
        throw new Error('Unexpected repository');
      },
    });

    const role = await service.getEngineRole('user-1', 'engine-1');
    expect(role).toBe('operator');
    expect(assignmentSpy).toHaveBeenCalledWith('user-1', 'engine-1', undefined);
  });

  it('checks access for required roles', async () => {
    const engineRepo = {
      findOne: vi.fn().mockResolvedValue({ id: 'engine-1', ownerId: 'owner-1', delegateId: null }),
    };
    vi.spyOn(permissionService, 'getAssignedEngineRole').mockResolvedValue('deployer');

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) return engineRepo;
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
    const engineRepo = { find: vi.fn().mockResolvedValue([engine]) };
    const tagRepo = {
      find: vi.fn().mockResolvedValue([]),
    };
    const assignmentQb = {
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([{ id: 'assignment-1', scopeId: 'engine-1' }]),
    };
    const assignmentRepo = {
      createQueryBuilder: vi.fn().mockReturnValue(assignmentQb),
    };
    const assignmentSpy = vi.spyOn(permissionService, 'getAssignedEngineRoles').mockResolvedValue([]);

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) return engineRepo;
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

  it('lists effective engine members from canonical assignments with role precedence', async () => {
    const engineRepo = { findOne: vi.fn().mockResolvedValue({ id: 'engine-1' }) };
    const assignmentQb = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([
        { id: 'legacy-owner', principalId: 'user-1', roleId: 'system.engine.owner', createdById: null, createdAt: 10, source: 'legacy' },
        { id: 'manual-operator', principalId: 'user-1', roleId: 'system.engine.operator', createdById: 'admin-1', createdAt: 20, source: 'manual' },
        { id: 'sso-deployer', principalId: 'user-2', roleId: 'system.engine.deployer', createdById: null, createdAt: 15, source: 'sso' },
      ]),
    };
    const assignmentRepo = { createQueryBuilder: vi.fn().mockReturnValue(assignmentQb) };
    const userRepo = {
      find: vi.fn().mockResolvedValue([
        { id: 'user-1', email: 'owner@example.test', firstName: 'Owner', lastName: null },
        { id: 'user-2', email: 'deployer@example.test', firstName: 'Deployer', lastName: null },
      ]),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) return engineRepo;
        if (entity === RbacRoleAssignment) return assignmentRepo;
        if (entity === User) return userRepo;
        throw new Error('Unexpected repository');
      },
    });

    const members = await service.getEngineMembers('engine-1');

    expect(members).toEqual([
      expect.objectContaining({ id: 'legacy-owner', userId: 'user-1', role: 'owner', source: 'legacy' }),
      expect.objectContaining({ id: 'sso-deployer', userId: 'user-2', role: 'deployer', source: 'sso' }),
    ]);
  });

  it('mirrors delegate governance changes into managed role assignments', async () => {
    const legacySyncSpy = vi.spyOn(permissionService, 'syncLegacyRoleAssignments');
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
          principalType: 'user',
          principalId: 'owner-1',
          roleId: 'system.engine.owner',
          sourceRef: 'engine:engine-1:governance-owner',
        },
      ]),
      delete: vi.fn().mockResolvedValue({ affected: 0 }),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
      insert: vi.fn().mockResolvedValue({ identifiers: [] }),
    };
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
      userId: null,
      principalType: 'user',
      principalId: 'delegate-1',
      roleId: 'system.engine.delegate',
      resourceType: null,
      resourceId: null,
      scopeType: 'engine',
      scopeId: 'engine-1',
      source: 'system',
      sourceMappingId: null,
      sourceRef: 'engine:engine-1:governance-delegate',
      createdById: null,
    }));
    expect(legacySyncSpy).not.toHaveBeenCalled();
  });

  it('mirrors ownership transfer as accountable owner metadata plus managed owner assignment', async () => {
    const legacySyncSpy = vi.spyOn(permissionService, 'syncLegacyRoleAssignments');
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
      userId: null,
      principalType: 'user',
      principalId: 'new-owner',
      roleId: 'system.engine.owner',
      resourceType: null,
      resourceId: null,
      source: 'system',
      sourceMappingId: null,
      sourceRef: 'engine:engine-1:governance-owner',
    }));
    expect(legacySyncSpy).not.toHaveBeenCalled();
  });

  it('updates a legacy engine member with a direct canonical legacy assignment', async () => {
    const legacySyncSpy = vi.spyOn(permissionService, 'syncLegacyRoleAssignments');
    const memberRepo = {
      findOne: vi.fn().mockResolvedValue({ engineId: 'engine-1', userId: 'user-1', role: 'operator', grantedById: 'admin-1', createdAt: 100 }),
    };
    const transactionMemberRepo = {
      delete: vi.fn().mockResolvedValue({ affected: 1 }),
      insert: vi.fn().mockResolvedValue(undefined),
    };
    const engineRepo = {
      findOne: vi.fn().mockResolvedValue({ id: 'engine-1', tenantId: 'tenant-1' }),
    };
    const assignmentRepo = {
      upsert: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue({ affected: 1 }),
    };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === EngineMember) return memberRepo;
        if (entity === Engine) return engineRepo;
        if (entity === RbacRoleAssignment) return assignmentRepo;
        throw new Error('Unexpected repository');
      },
      transaction: async (callback: any) => callback({
        getRepository: (entity: unknown) => {
          if (entity === EngineMember) return transactionMemberRepo;
          throw new Error('Unexpected transaction repository');
        },
      }),
    });

    await service.updateEngineMemberRole('engine-1', 'user-1', 'deployer', 'admin-2');

    expect(assignmentRepo.upsert).toHaveBeenCalledWith(expect.objectContaining({
      id: 'legacy:engine:engine-1:user-1:system.engine.deployer',
      tenantId: 'tenant-1',
      principalType: 'user',
      principalId: 'user-1',
      roleId: 'system.engine.deployer',
      scopeType: 'engine',
      scopeId: 'engine-1',
      source: 'legacy',
      sourceRef: 'engine_member:engine-1:user-1:deployer',
    }), expect.objectContaining({ conflictPaths: ['id'] }));
    expect(assignmentRepo.delete).toHaveBeenCalledWith({ id: expect.anything() });
    expect(legacySyncSpy).not.toHaveBeenCalled();
  });

  it('removes canonical legacy assignments when a legacy engine member is removed', async () => {
    const legacySyncSpy = vi.spyOn(permissionService, 'syncLegacyRoleAssignments');
    const memberRepo = {
      findOne: vi.fn().mockResolvedValue({ engineId: 'engine-1', userId: 'user-1', role: 'operator' }),
      delete: vi.fn().mockResolvedValue({ affected: 1 }),
    };
    const assignmentQb = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([]),
    };
    const assignmentRepo = {
      delete: vi.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: vi.fn().mockReturnValue(assignmentQb),
    };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === EngineMember) return memberRepo;
        if (entity === RbacRoleAssignment) return assignmentRepo;
        throw new Error('Unexpected repository');
      },
    });

    await service.removeEngineMember('engine-1', 'user-1', 'admin-1');

    expect(assignmentRepo.delete).toHaveBeenCalledWith({ id: expect.anything() });
    expect(legacySyncSpy).not.toHaveBeenCalled();
  });
});

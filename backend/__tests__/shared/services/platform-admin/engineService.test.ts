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

  it('keeps canonical engine visibility identical for direct and customer-sidecar transports', async () => {
    const directEngine = { id: 'engine-direct', name: 'Direct', connectionMode: 'direct', ownerId: null, delegateId: null, environmentTagId: null };
    const sidecarEngine = { id: 'engine-sidecar', name: 'Sidecar', connectionMode: 'customer_sidecar', ownerId: null, delegateId: null, environmentTagId: null };
    const assignmentQb = {
      innerJoin: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([{ scopeId: 'engine-direct' }, { scopeId: 'engine-sidecar' }]),
    };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) return { find: vi.fn().mockResolvedValue([directEngine, sidecarEngine]) };
        if (entity === EnvironmentTag) return { find: vi.fn().mockResolvedValue([]) };
        if (entity === RbacRoleAssignment) return { createQueryBuilder: vi.fn().mockReturnValue(assignmentQb) };
        throw new Error('Unexpected repository');
      },
    });
    vi.spyOn(permissionService, 'getAssignedEngineRoles').mockResolvedValue([]);

    const visible = await service.getUserEngines('user-1');

    expect(visible.map(({ engine }) => engine.id)).toEqual(['engine-direct', 'engine-sidecar']);
    expect(visible.map(({ role }) => role)).toEqual(['custom', 'custom']);
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
      principalType: 'user',
      principalId: 'delegate-1',
      roleId: 'system.engine.delegate',
      scopeType: 'engine',
      scopeId: 'engine-1',
      source: 'system',
      sourceRef: 'engine:engine-1:governance-delegate',
      createdById: null,
    }));
    const insertedAssignment = assignmentRepo.insert.mock.calls[0][0];
    expect(insertedAssignment).not.toHaveProperty('userId');
    expect(insertedAssignment).not.toHaveProperty('resourceType');
    expect(insertedAssignment).not.toHaveProperty('resourceId');
    expect(insertedAssignment).not.toHaveProperty('sourceMappingId');
    expect(legacySyncSpy).not.toHaveBeenCalled();
  });

  it('materializes a new engine owner assignment without legacy reconciliation', async () => {
    const legacySyncSpy = vi.spyOn(permissionService, 'syncLegacyRoleAssignments');
    const assignmentRepo = {
      find: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue({ affected: 0 }),
      update: vi.fn().mockResolvedValue({ affected: 0 }),
      insert: vi.fn().mockResolvedValue({ identifiers: [] }),
    };
    const engineRepo = { insert: vi.fn().mockResolvedValue({ identifiers: [] }) };
    const manager = {
      getRepository: (entity: unknown) => {
        if (entity === Engine) return engineRepo;
        if (entity === RbacRoleAssignment) return assignmentRepo;
        throw new Error('Unexpected repository');
      },
    };
    const dataSource = {
      transaction: (callback: (providedManager: typeof manager) => unknown) => callback(manager),
    } as any;

    await service.createEngineWithGovernanceAssignments({
      id: 'engine-1',
      ownerId: 'owner-1',
      delegateId: null,
      tenantId: 'tenant-1',
      createdAt: 100,
      updatedAt: 100,
    }, dataSource);

    expect(engineRepo.insert).toHaveBeenCalledWith(expect.objectContaining({ id: 'engine-1', ownerId: 'owner-1' }));
    expect(assignmentRepo.insert).toHaveBeenCalledWith(expect.objectContaining({
      id: 'system:engine:engine-1:owner:owner-1',
      principalType: 'user',
      principalId: 'owner-1',
      roleId: 'system.engine.owner',
      scopeType: 'engine',
      scopeId: 'engine-1',
      source: 'system',
      sourceRef: 'engine:engine-1:governance-owner',
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
      principalType: 'user',
      principalId: 'new-owner',
      roleId: 'system.engine.owner',
      source: 'system',
      sourceRef: 'engine:engine-1:governance-owner',
    }));
    expect(legacySyncSpy).not.toHaveBeenCalled();
  });

  it('updates a legacy engine member with a direct canonical manual assignment', async () => {
    const legacySyncSpy = vi.spyOn(permissionService, 'syncLegacyRoleAssignments');
    const assignRoleSpy = vi.spyOn(permissionService, 'assignRole').mockResolvedValue({ id: 'assignment-1', warnings: [] });
    const memberRepo = {
      findOne: vi.fn().mockResolvedValue({ engineId: 'engine-1', userId: 'user-1', role: 'operator', grantedById: 'admin-1', createdAt: 100 }),
    };
    const transactionMemberRepo = {
      delete: vi.fn().mockResolvedValue({ affected: 1 }),
      insert: vi.fn().mockResolvedValue(undefined),
    };
    const assignmentRepo = {
      delete: vi.fn().mockResolvedValue({ affected: 1 }),
    };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === EngineMember) return memberRepo;
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

    expect(assignRoleSpy).toHaveBeenCalledWith({
      principalType: 'user',
      principalId: 'user-1',
      roleId: 'system.engine.deployer',
      resourceType: 'engine',
      resourceId: 'engine-1',
      source: 'manual',
      createdById: 'admin-2',
    });
    expect(assignmentRepo.delete).toHaveBeenCalledWith({ id: expect.anything() });
    expect(legacySyncSpy).not.toHaveBeenCalled();
  });

  it('writes configuration engine updates and decommissions through a supplied transaction store', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const store = { getRepository: (entity: unknown) => {
      if (entity === Engine) return { update };
      throw new Error('Unexpected repository');
    } };
    await service.updateConfiguredEngine('engine-1', {
      name: 'Payments', baseUrl: 'https://engine.example.test', type: 'operaton', externalId: 'payments', labelsJson: '{}',
      sourceHash: 'hash-1', lastAppliedAt: 100, ownershipMode: 'config_locked', lifecycleStatus: 'active', driftStatus: 'in_sync',
      authType: 'none', username: null, passwordEnc: null, oauthTokenUrl: null, oauthScopes: null, oauthAudience: null,
      version: null, environmentTagId: null, runtimeAccessScope: 'engine_wide', deploymentIntegration: 'enterpriseglue_proxy',
      metadataDiscoveryEnabled: true, deploymentDiscoveryEnabled: true, reconciliationIntervalSeconds: 300,
      pipelineReceiptEnabled: true, connectionMode: 'direct',
    }, store as any);
    await service.decommissionConfiguredEngine('engine-1', { lastAppliedAt: 200 }, store as any);

    expect(update).toHaveBeenNthCalledWith(1, { id: 'engine-1' }, expect.objectContaining({
      name: 'Payments', sourceHash: 'hash-1', lifecycleStatus: 'active', updatedAt: expect.any(Number),
    }));
    expect(update).toHaveBeenNthCalledWith(2, { id: 'engine-1' }, expect.objectContaining({
      lifecycleStatus: 'decommissioned', driftStatus: 'decommissioned', lastAppliedAt: 200,
    }));
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

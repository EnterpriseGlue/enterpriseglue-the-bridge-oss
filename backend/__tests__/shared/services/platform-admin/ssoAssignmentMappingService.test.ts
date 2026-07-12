import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import {
  AuditLog,
  Engine,
  EngineSet,
  EngineSetMaterialization,
  ExternalEngineRegistration,
  PlatformSettings,
  RbacRole,
  RbacRoleAssignment,
  RbacRolePermission,
  SsoAssignmentMapping,
} from '@enterpriseglue/shared/db/entities/index.js';
import { ssoAssignmentMappingService } from '@enterpriseglue/shared/services/platform-admin/SsoAssignmentMappingService.js';
import { EnginePermissions, PlatformPermissions } from '@enterpriseglue/shared/services/platform-admin/permissions.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/SsoEngineAccessSnapshotService.js', () => ({
  ssoEngineAccessSnapshotService: {
    recordActiveGrant: vi.fn().mockResolvedValue(undefined),
    markAssignmentRemoved: vi.fn().mockResolvedValue(undefined),
    markMappingRemoved: vi.fn().mockResolvedValue(undefined),
  },
}));

function queryBuilder(result: unknown) {
  return {
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    getMany: vi.fn().mockResolvedValue(result),
    getOne: vi.fn().mockResolvedValue(result),
  };
}

function createDynamicEngineSetMocks(input: {
  engineSet?: any;
  engines?: any[];
  registrations?: any[];
  materializations?: any[];
} = {}) {
  const engineSetFindOne = vi.fn().mockResolvedValue(input.engineSet ?? null);
  const engineSetInsert = vi.fn().mockResolvedValue(undefined);
  const engineSetUpdate = vi.fn().mockResolvedValue(undefined);
  const engineFind = vi.fn().mockResolvedValue(input.engines ?? []);
  const registrationFind = vi.fn().mockResolvedValue(input.registrations ?? []);
  const materializationFind = vi.fn().mockResolvedValue(input.materializations ?? []);
  const materializationInsert = vi.fn().mockResolvedValue(undefined);
  const materializationUpdate = vi.fn().mockResolvedValue(undefined);
  const materializationDelete = vi.fn().mockResolvedValue(undefined);

  return {
    getRepository: (entity: unknown) => {
      if (entity === EngineSet) return { findOne: engineSetFindOne, insert: engineSetInsert, update: engineSetUpdate };
      if (entity === Engine) return { find: engineFind };
      if (entity === ExternalEngineRegistration) return { find: registrationFind };
      if (entity === EngineSetMaterialization) return {
        find: materializationFind,
        insert: materializationInsert,
        update: materializationUpdate,
        delete: materializationDelete,
      };
      return null;
    },
    engineSetFindOne,
    engineSetInsert,
    engineSetUpdate,
    engineFind,
    registrationFind,
    materializationFind,
    materializationInsert,
    materializationUpdate,
    materializationDelete,
  };
}

describe('ssoAssignmentMappingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('syncs SSO claims to an externally registered engine', async () => {
    const mapping = {
      id: 'mapping-1',
      tenantId: 'tenant-a',
      providerId: null,
      claimType: 'group',
      claimKey: 'groups',
      claimValue: 'Ops',
      targetScope: 'engine',
      targetSelectorType: 'external_engine_id',
      targetEngineId: null,
      targetExternalEngineId: 'cluster-a/prod',
      targetLabelKey: null,
      targetLabelValue: null,
      targetRoleId: 'system.engine.operator',
      syncMode: 'authoritative',
      priority: 0,
      isActive: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const insert = vi.fn().mockResolvedValue(undefined);
    const auditInsert = vi.fn().mockResolvedValue(undefined);
    const mappingQb = queryBuilder([mapping]);
    const assignmentQb = queryBuilder(null);
    assignmentQb.getOne = vi.fn().mockResolvedValue(null);

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === SsoAssignmentMapping) return { createQueryBuilder: vi.fn().mockReturnValue(mappingQb) };
        if (entity === ExternalEngineRegistration) return {
          findOne: vi.fn().mockResolvedValue({ engineId: 'engine-1' }),
        };
        if (entity === Engine) return {
          findOne: vi.fn().mockResolvedValue({ id: 'engine-1' }),
        };
        if (entity === RbacRoleAssignment) return {
          createQueryBuilder: vi.fn().mockReturnValue(assignmentQb),
          insert,
          find: vi.fn().mockResolvedValue([]),
          update: vi.fn(),
          delete: vi.fn(),
        };
        if (entity === AuditLog) return { insert: auditInsert };
        throw new Error('Unexpected repository');
      },
    });

    const result = await ssoAssignmentMappingService.syncAssignmentsForUser('user-1', { groups: ['Ops'] }, undefined, 'tenant-a');

    expect(result).toMatchObject({ created: 1, updated: 0, removed: 0 });
    expect(mappingQb.andWhere).toHaveBeenCalledWith(
      '(m.tenantId = :tenantId OR m.tenantId IS NULL)',
      { tenantId: 'tenant-a' },
    );
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      userId: null,
      roleId: 'system.engine.operator',
      resourceType: null,
      resourceId: null,
      scopeType: 'engine',
      scopeId: 'engine-1',
      source: 'sso',
      sourceMappingId: null,
      sourceRef: 'mapping-1',
    }));
    expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      action: 'authz.sso_assignment.create',
      resourceType: 'role_assignment',
      details: expect.stringContaining('mapping-1'),
    }));
  });

  it('removes stale authoritative SSO assignments without touching manual assignments', async () => {
    const mapping = {
      id: 'mapping-1',
      providerId: null,
      claimType: 'group',
      claimKey: 'groups',
      claimValue: 'Ops',
      targetScope: 'engine',
      targetSelectorType: 'engine_id',
      targetEngineId: 'engine-1',
      targetExternalEngineId: null,
      targetLabelKey: null,
      targetLabelValue: null,
      targetRoleId: 'system.engine.operator',
      syncMode: 'authoritative',
      priority: 0,
      isActive: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const deleteAssignment = vi.fn().mockResolvedValue(undefined);
    const auditInsert = vi.fn().mockResolvedValue(undefined);
    const find = vi.fn().mockResolvedValue([
      {
        id: 'stale-sso-assignment',
        userId: 'user-1',
        roleId: 'system.engine.operator',
        resourceType: 'engine',
        resourceId: 'engine-1',
        source: 'sso',
        sourceMappingId: 'mapping-1',
      },
    ]);
    const mappingQb = queryBuilder([mapping]);

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === SsoAssignmentMapping) return { createQueryBuilder: vi.fn().mockReturnValue(mappingQb) };
        if (entity === RbacRoleAssignment) return {
          createQueryBuilder: vi.fn(),
          insert: vi.fn(),
          find,
          update: vi.fn(),
          delete: deleteAssignment,
        };
        if (entity === AuditLog) return { insert: auditInsert };
        throw new Error('Unexpected repository');
      },
    });

    const result = await ssoAssignmentMappingService.syncAssignmentsForUser('user-1', { groups: ['Other'] });

    expect(result).toMatchObject({ created: 0, updated: 0, removed: 1 });
    expect(find).toHaveBeenCalledWith({
      where: {
        principalType: 'user',
        principalId: 'user-1',
        source: 'sso',
        sourceRef: 'mapping-1',
      },
    });
    expect(deleteAssignment).toHaveBeenCalledWith({ id: 'stale-sso-assignment' });
    expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      action: 'authz.sso_assignment.delete',
      resourceType: 'role_assignment',
      resourceId: 'stale-sso-assignment',
    }));
  });

  it('does not remove stale assignments in additive sync mode', async () => {
    const mapping = {
      id: 'mapping-additive',
      providerId: null,
      claimType: 'group',
      claimKey: 'groups',
      claimValue: 'Ops',
      targetScope: 'engine',
      targetSelectorType: 'engine_id',
      targetEngineId: 'engine-1',
      targetExternalEngineId: null,
      targetLabelKey: null,
      targetLabelValue: null,
      targetRoleId: 'system.engine.operator',
      syncMode: 'additive',
      priority: 0,
      isActive: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const deleteAssignment = vi.fn();
    const find = vi.fn();
    const mappingQb = queryBuilder([mapping]);

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === SsoAssignmentMapping) return { createQueryBuilder: vi.fn().mockReturnValue(mappingQb) };
        if (entity === RbacRoleAssignment) return {
          createQueryBuilder: vi.fn(),
          insert: vi.fn(),
          find,
          update: vi.fn(),
          delete: deleteAssignment,
        };
        throw new Error('Unexpected repository');
      },
    });

    const result = await ssoAssignmentMappingService.syncAssignmentsForUser('user-1', { groups: ['Other'] });

    expect(result).toMatchObject({ created: 0, updated: 0, removed: 0 });
    expect(find).not.toHaveBeenCalled();
    expect(deleteAssignment).not.toHaveBeenCalled();
  });

  it('removes SSO-managed all-engine assignments when platform settings disable the selector', async () => {
    const mapping = {
      id: 'mapping-all-engines',
      providerId: null,
      claimType: 'group',
      claimKey: 'groups',
      claimValue: 'Ops',
      targetScope: 'engine',
      targetSelectorType: 'all_engines',
      targetEngineId: null,
      targetExternalEngineId: null,
      targetLabelKey: null,
      targetLabelValue: null,
      targetRoleId: 'system.engine.operator',
      syncMode: 'additive',
      priority: 0,
      isActive: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const deleteAssignment = vi.fn().mockResolvedValue(undefined);
    const auditInsert = vi.fn().mockResolvedValue(undefined);
    const find = vi.fn().mockResolvedValue([
      {
        id: 'all-engines-sso-assignment',
        tenantId: null,
        userId: 'user-1',
        roleId: 'system.engine.operator',
        resourceType: 'engine',
        resourceId: null,
        source: 'sso',
        sourceMappingId: 'mapping-all-engines',
      },
    ]);
    const mappingQb = queryBuilder([mapping]);

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === SsoAssignmentMapping) return { createQueryBuilder: vi.fn().mockReturnValue(mappingQb) };
        if (entity === PlatformSettings) return { findOneBy: vi.fn().mockResolvedValue({ ssoAllEnginesAssignmentMappingsEnabled: false }) };
        if (entity === RbacRoleAssignment) return {
          createQueryBuilder: vi.fn(),
          insert: vi.fn(),
          find,
          update: vi.fn(),
          delete: deleteAssignment,
        };
        if (entity === AuditLog) return { insert: auditInsert };
        throw new Error('Unexpected repository');
      },
    });

    const result = await ssoAssignmentMappingService.syncAssignmentsForUser('user-1', { groups: ['Ops'] });

    expect(result).toMatchObject({ created: 0, updated: 0, removed: 1 });
    expect(find).toHaveBeenCalledWith({
      where: {
        principalType: 'user',
        principalId: 'user-1',
        source: 'sso',
        sourceRef: 'mapping-all-engines',
      },
    });
    expect(deleteAssignment).toHaveBeenCalledWith({ id: 'all-engines-sso-assignment' });
  });

  it('removes SSO-managed owner assignments when platform settings disable owner mappings', async () => {
    const mapping = {
      id: 'mapping-owner',
      providerId: null,
      claimType: 'group',
      claimKey: 'groups',
      claimValue: 'Owners',
      targetScope: 'engine',
      targetSelectorType: 'engine_id',
      targetEngineId: 'engine-1',
      targetExternalEngineId: null,
      targetLabelKey: null,
      targetLabelValue: null,
      targetRoleId: 'system.engine.owner',
      syncMode: 'additive',
      priority: 0,
      isActive: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const deleteAssignment = vi.fn().mockResolvedValue(undefined);
    const auditInsert = vi.fn().mockResolvedValue(undefined);
    const find = vi.fn().mockResolvedValue([
      {
        id: 'owner-sso-assignment',
        tenantId: null,
        userId: 'user-1',
        roleId: 'system.engine.owner',
        resourceType: 'engine',
        resourceId: 'engine-1',
        source: 'sso',
        sourceMappingId: 'mapping-owner',
      },
    ]);
    const mappingQb = queryBuilder([mapping]);

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === SsoAssignmentMapping) return { createQueryBuilder: vi.fn().mockReturnValue(mappingQb) };
        if (entity === PlatformSettings) return { findOneBy: vi.fn().mockResolvedValue({ ssoEngineOwnerAssignmentMappingsEnabled: false }) };
        if (entity === RbacRoleAssignment) return {
          createQueryBuilder: vi.fn(),
          insert: vi.fn(),
          find,
          update: vi.fn(),
          delete: deleteAssignment,
        };
        if (entity === AuditLog) return { insert: auditInsert };
        throw new Error('Unexpected repository');
      },
    });

    const result = await ssoAssignmentMappingService.syncAssignmentsForUser('user-1', { groups: ['Owners'] });

    expect(result).toMatchObject({ created: 0, updated: 0, removed: 1 });
    expect(deleteAssignment).toHaveBeenCalledWith({ id: 'owner-sso-assignment' });
  });

  it('allows exact-engine owner and delegate mappings without a dedicated acknowledgement when platform settings enable them', async () => {
    const insert = vi.fn().mockResolvedValue(undefined);
    const auditInsert = vi.fn().mockResolvedValue(undefined);
    const engineFindOne = vi.fn().mockResolvedValue({ id: 'engine-1' });

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === SsoAssignmentMapping) return { insert };
        if (entity === Engine) return { findOne: engineFindOne };
        if (entity === EngineSet) return {
          findOne: vi.fn().mockResolvedValue(null),
          update: vi.fn().mockResolvedValue(undefined),
        };
        if (entity === AuditLog) return { insert: auditInsert };
        if (entity === PlatformSettings) return {
          findOneBy: vi.fn().mockResolvedValue({
            ssoEngineOwnerAssignmentMappingsEnabled: true,
            ssoEngineDelegateAssignmentMappingsEnabled: true,
          }),
        };
        throw new Error('Unexpected repository');
      },
    });

    await ssoAssignmentMappingService.createMapping({
      actorUserId: 'admin-1',
      claimType: 'group',
      claimKey: 'groups',
      claimValue: 'Admins',
      targetSelectorType: 'engine_id',
      targetEngineId: 'engine-1',
      targetRoleId: 'system.engine.owner' as any,
    });
    await ssoAssignmentMappingService.createMapping({
      actorUserId: 'admin-1',
      claimType: 'group',
      claimKey: 'groups',
      claimValue: 'Delegates',
      targetSelectorType: 'engine_id',
      targetEngineId: 'engine-1',
      targetRoleId: 'system.engine.delegate' as any,
    });

    expect(engineFindOne).toHaveBeenCalledTimes(2);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      targetSelectorType: 'engine_id',
      targetEngineId: 'engine-1',
      targetRoleId: 'system.engine.owner',
    }));
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      targetSelectorType: 'engine_id',
      targetEngineId: 'engine-1',
      targetRoleId: 'system.engine.delegate',
    }));
    const ownerDetails = JSON.parse(auditInsert.mock.calls[0][0].details);
    const delegateDetails = JSON.parse(auditInsert.mock.calls[1][0].details);
    expect(ownerDetails).toMatchObject({
      targetRoleId: 'system.engine.owner',
      riskReasons: ['engine_owner_role'],
    });
    expect(ownerDetails.riskAcknowledged).toBeUndefined();
    expect(delegateDetails).toMatchObject({
      targetRoleId: 'system.engine.delegate',
      riskReasons: ['engine_delegate_role'],
    });
    expect(delegateDetails.riskAcknowledged).toBeUndefined();
  });

  it('rejects all-engine mappings without high-risk acknowledgement', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({});

    await expect(ssoAssignmentMappingService.createMapping({
      claimType: 'group',
      claimKey: 'groups',
      claimValue: 'Operators',
      targetSelectorType: 'all_engines',
      targetRoleId: 'system.engine.operator',
    })).rejects.toThrow('High-risk SSO assignment mapping requires acknowledgement');
  });

  it('requires acknowledgement before SSO assignment mappings use regex claim operators', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({});

    await expect(ssoAssignmentMappingService.createMapping({
      claimType: 'group',
      claimKey: 'groups',
      claimValue: '^Operators$',
      claimOperator: 'matches_regex',
      targetSelectorType: 'all_engines',
      targetRoleId: 'system.engine.operator',
    })).rejects.toThrow('High-risk SSO assignment mapping requires acknowledgement');
  });

  it('audits acknowledged all-engine mapping creation', async () => {
    const insert = vi.fn().mockResolvedValue(undefined);
    const auditInsert = vi.fn().mockResolvedValue(undefined);
    const dynamicMocks = createDynamicEngineSetMocks();

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        const dynamicRepo = dynamicMocks.getRepository(entity);
        if (dynamicRepo) return dynamicRepo;
        if (entity === SsoAssignmentMapping) return { insert };
        if (entity === AuditLog) return { insert: auditInsert };
        if (entity === PlatformSettings) return { findOneBy: vi.fn().mockResolvedValue({ ssoAllEnginesAssignmentMappingsEnabled: true }) };
        throw new Error('Unexpected repository');
      },
    });

    await ssoAssignmentMappingService.createMapping({
      actorUserId: 'admin-1',
      tenantId: 'tenant-a',
      claimType: 'group',
      claimKey: 'groups',
      claimValue: 'Operators',
      targetSelectorType: 'all_engines',
      targetRoleId: 'system.engine.operator',
      riskAcknowledged: true,
    });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      targetSelectorType: 'all_engines',
      targetRoleId: 'system.engine.operator',
    }));
    expect(dynamicMocks.engineSetInsert).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      source: 'sso',
      sourceRef: expect.any(String),
      selectorJson: expect.stringContaining('"mode":"all"'),
    }));
    expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      userId: 'admin-1',
      action: 'authz.sso_assignment_mapping.create',
      resourceType: 'sso_assignment_mapping',
    }));
    const details = JSON.parse(auditInsert.mock.calls[0][0].details);
    expect(details).toMatchObject({
      targetSelectorType: 'all_engines',
      riskAcknowledged: true,
      riskReasons: ['all_engines_selector'],
    });
  });

  it('audits acknowledged regex assignment mapping creation', async () => {
    const insert = vi.fn().mockResolvedValue(undefined);
    const auditInsert = vi.fn().mockResolvedValue(undefined);
    const dynamicMocks = createDynamicEngineSetMocks();

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        const dynamicRepo = dynamicMocks.getRepository(entity);
        if (dynamicRepo) return dynamicRepo;
        if (entity === SsoAssignmentMapping) return { insert };
        if (entity === AuditLog) return { insert: auditInsert };
        if (entity === PlatformSettings) return {
          findOneBy: vi.fn().mockResolvedValue({
            ssoAllEnginesAssignmentMappingsEnabled: true,
            ssoRegexClaimMappingsEnabled: true,
          }),
        };
        throw new Error('Unexpected repository');
      },
    });

    await ssoAssignmentMappingService.createMapping({
      actorUserId: 'admin-1',
      claimType: 'group',
      claimKey: 'groups',
      claimValue: '^Operators$',
      claimOperator: 'matches_regex',
      targetSelectorType: 'all_engines',
      targetRoleId: 'system.engine.operator',
      riskAcknowledged: true,
    });

    const details = JSON.parse(auditInsert.mock.calls[0][0].details);
    expect(details).toMatchObject({
      claimOperator: 'matches_regex',
      riskAcknowledged: true,
      riskReasons: ['all_engines_selector', 'regex_claim_operator'],
    });
  });

  it('rejects active all-engine mappings when platform settings disable the selector', async () => {
    const insert = vi.fn().mockResolvedValue(undefined);

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === SsoAssignmentMapping) return { insert };
        if (entity === PlatformSettings) return { findOneBy: vi.fn().mockResolvedValue({ ssoAllEnginesAssignmentMappingsEnabled: false }) };
        throw new Error('Unexpected repository');
      },
    });

    await expect(ssoAssignmentMappingService.createMapping({
      claimType: 'group',
      claimKey: 'groups',
      claimValue: 'Operators',
      targetSelectorType: 'all_engines',
      targetRoleId: 'system.engine.operator',
      riskAcknowledged: true,
    })).rejects.toThrow('High-risk SSO assignment mappings are disabled by platform settings: all_engines_selector');
    expect(insert).not.toHaveBeenCalled();
  });

  it('rejects active regex assignment mappings when platform settings disable regex claim mappings', async () => {
    const insert = vi.fn().mockResolvedValue(undefined);

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === SsoAssignmentMapping) return { insert };
        if (entity === PlatformSettings) return {
          findOneBy: vi.fn().mockResolvedValue({
            ssoAllEnginesAssignmentMappingsEnabled: true,
            ssoRegexClaimMappingsEnabled: false,
          }),
        };
        throw new Error('Unexpected repository');
      },
    });

    await expect(ssoAssignmentMappingService.createMapping({
      claimType: 'group',
      claimKey: 'groups',
      claimValue: '^Operators$',
      claimOperator: 'matches_regex',
      targetSelectorType: 'all_engines',
      targetRoleId: 'system.engine.operator',
      riskAcknowledged: true,
    })).rejects.toThrow('regex_claim_operator');
    expect(insert).not.toHaveBeenCalled();
  });

  it('rejects acknowledged owner or delegate mappings when platform settings disable them', async () => {
    const insert = vi.fn().mockResolvedValue(undefined);

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === SsoAssignmentMapping) return { insert };
        if (entity === PlatformSettings) return {
          findOneBy: vi.fn().mockResolvedValue({
            ssoAllEnginesAssignmentMappingsEnabled: true,
            ssoEngineOwnerAssignmentMappingsEnabled: false,
            ssoEngineDelegateAssignmentMappingsEnabled: false,
          }),
        };
        throw new Error('Unexpected repository');
      },
    });

    await expect(ssoAssignmentMappingService.createMapping({
      claimType: 'group',
      claimKey: 'groups',
      claimValue: 'Admins',
      targetSelectorType: 'all_engines',
      targetRoleId: 'system.engine.owner',
      riskAcknowledged: true,
    })).rejects.toThrow('engine_owner_role');
    await expect(ssoAssignmentMappingService.createMapping({
      claimType: 'group',
      claimKey: 'groups',
      claimValue: 'Delegates',
      targetSelectorType: 'all_engines',
      targetRoleId: 'system.engine.delegate',
      riskAcknowledged: true,
    })).rejects.toThrow('engine_delegate_role');
    expect(insert).not.toHaveBeenCalled();
  });

  it('allows acknowledged owner mappings when platform settings enable them', async () => {
    const insert = vi.fn().mockResolvedValue(undefined);
    const auditInsert = vi.fn().mockResolvedValue(undefined);
    const dynamicMocks = createDynamicEngineSetMocks();

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        const dynamicRepo = dynamicMocks.getRepository(entity);
        if (dynamicRepo) return dynamicRepo;
        if (entity === SsoAssignmentMapping) return { insert };
        if (entity === AuditLog) return { insert: auditInsert };
        if (entity === PlatformSettings) return {
          findOneBy: vi.fn().mockResolvedValue({
            ssoAllEnginesAssignmentMappingsEnabled: true,
            ssoEngineOwnerAssignmentMappingsEnabled: true,
          }),
        };
        throw new Error('Unexpected repository');
      },
    });

    await ssoAssignmentMappingService.createMapping({
      actorUserId: 'admin-1',
      claimType: 'group',
      claimKey: 'groups',
      claimValue: 'Owners',
      targetSelectorType: 'all_engines',
      targetRoleId: 'system.engine.owner',
      riskAcknowledged: true,
    });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      targetSelectorType: 'all_engines',
      targetRoleId: 'system.engine.owner',
    }));
    const details = JSON.parse(auditInsert.mock.calls[0][0].details);
    expect(details.riskReasons).toEqual(['all_engines_selector', 'engine_owner_role']);
  });

  it('rejects updates that broaden a mapping to all engines without acknowledgement', async () => {
    const update = vi.fn().mockResolvedValue(undefined);

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === SsoAssignmentMapping) return {
          findOneBy: vi.fn().mockResolvedValue({
            id: 'mapping-1',
            tenantId: null,
            providerId: null,
            claimType: 'group',
            claimKey: 'groups',
            claimValue: 'Operators',
            targetSelectorType: 'engine_id',
            targetEngineId: 'engine-1',
            targetExternalEngineId: null,
            targetLabelKey: null,
            targetLabelValue: null,
            targetRoleId: 'system.engine.operator',
            syncMode: 'authoritative',
            priority: 0,
            isActive: true,
          }),
          update,
        };
        throw new Error('Unexpected repository');
      },
    });

    await expect(ssoAssignmentMappingService.updateMapping('mapping-1', {
      targetSelectorType: 'all_engines',
      targetEngineId: null,
    })).rejects.toThrow('High-risk SSO assignment mapping requires acknowledgement');
    expect(update).not.toHaveBeenCalled();
  });

  it('allows disabling an all-engine mapping without acknowledgement', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const findAssignments = vi.fn().mockResolvedValue([]);
    const deleteAssignments = vi.fn().mockResolvedValue(undefined);
    const auditInsert = vi.fn().mockResolvedValue(undefined);
    const dynamicMocks = createDynamicEngineSetMocks();

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        const dynamicRepo = dynamicMocks.getRepository(entity);
        if (dynamicRepo) return dynamicRepo;
        if (entity === SsoAssignmentMapping) return {
          findOneBy: vi.fn().mockResolvedValue({
            id: 'mapping-1',
            tenantId: null,
            providerId: null,
            claimType: 'group',
            claimKey: 'groups',
            claimValue: 'Operators',
            targetSelectorType: 'all_engines',
            targetEngineId: null,
            targetExternalEngineId: null,
            targetLabelKey: null,
            targetLabelValue: null,
            targetRoleId: 'system.engine.operator',
            syncMode: 'authoritative',
            priority: 0,
            isActive: true,
          }),
          update,
        };
        if (entity === RbacRoleAssignment) return { find: findAssignments, delete: deleteAssignments };
        if (entity === AuditLog) return { insert: auditInsert };
        throw new Error('Unexpected repository');
      },
    });

    await ssoAssignmentMappingService.updateMapping('mapping-1', {
      isActive: false,
    });

    expect(update).toHaveBeenCalledWith({ id: 'mapping-1' }, expect.objectContaining({
      targetSelectorType: 'all_engines',
      isActive: false,
    }));
    expect(deleteAssignments).toHaveBeenCalledWith({ source: 'sso', sourceMappingId: 'mapping-1' });
  });

  it('allows SSO assignment mappings to target assignable custom engine roles', async () => {
    const insert = vi.fn().mockResolvedValue(undefined);
    const auditInsert = vi.fn().mockResolvedValue(undefined);
    const dynamicMocks = createDynamicEngineSetMocks();
    const findRole = vi.fn().mockResolvedValue({
      id: 'custom.engine.incident-responder',
      scope: 'engine',
      kind: 'custom',
      isAssignable: true,
      isArchived: false,
    });

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        const dynamicRepo = dynamicMocks.getRepository(entity);
        if (dynamicRepo) return dynamicRepo;
        if (entity === RbacRole) return { findOne: findRole };
        if (entity === RbacRolePermission) return { find: vi.fn().mockResolvedValue([]) };
        if (entity === SsoAssignmentMapping) return { insert };
        if (entity === AuditLog) return { insert: auditInsert };
        if (entity === PlatformSettings) return { findOneBy: vi.fn().mockResolvedValue({ ssoAllEnginesAssignmentMappingsEnabled: true }) };
        throw new Error('Unexpected repository');
      },
    });

    await ssoAssignmentMappingService.createMapping({
      claimType: 'group',
      claimKey: 'groups',
      claimValue: 'Incident Responders',
      targetSelectorType: 'all_engines',
      targetRoleId: 'custom.engine.incident-responder',
      riskAcknowledged: true,
    });

    expect(findRole).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'custom.engine.incident-responder' },
    }));
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      targetRoleId: 'custom.engine.incident-responder',
    }));
  });

  it('requires acknowledgement before SSO mappings target custom engine roles with secret access', async () => {
    const insert = vi.fn().mockResolvedValue(undefined);
    const findRole = vi.fn().mockResolvedValue({
      id: 'custom.engine.secret-reader',
      scope: 'engine',
      kind: 'custom',
      isAssignable: true,
      isArchived: false,
    });
    const findRolePermissions = vi.fn().mockResolvedValue([
      { permissionId: EnginePermissions.SECRETS_VIEW },
    ]);

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === RbacRole) return { findOne: findRole };
        if (entity === RbacRolePermission) return { find: findRolePermissions };
        if (entity === SsoAssignmentMapping) return { insert };
        throw new Error('Unexpected repository');
      },
    });

    await expect(ssoAssignmentMappingService.createMapping({
      claimType: 'group',
      claimKey: 'groups',
      claimValue: 'Secret Readers',
      targetSelectorType: 'engine_label',
      targetLabelKey: 'environment',
      targetLabelValue: 'prod',
      targetRoleId: 'custom.engine.secret-reader',
    })).rejects.toThrow('High-risk SSO assignment mapping requires acknowledgement');
    expect(insert).not.toHaveBeenCalled();
  });

  for (const scenario of [
    {
      label: 'unredacted audit',
      roleId: 'custom.engine.audit-reader',
      permissionId: PlatformPermissions.AUDIT_UNREDACTED_VIEW,
      settingKey: 'ssoUnredactedAuditMappingsEnabled',
      riskReason: 'unredacted_audit_permission',
    },
    {
      label: 'permanent-delete',
      roleId: 'custom.engine.user-destroyer',
      permissionId: PlatformPermissions.USERS_PERMANENT_DELETE,
      settingKey: 'ssoPermanentDeleteMappingsEnabled',
      riskReason: 'permanent_delete_permission',
    },
  ]) {
    it(`requires acknowledgement before SSO mappings target custom engine roles with ${scenario.label} permissions`, async () => {
      const insert = vi.fn().mockResolvedValue(undefined);
      const findRole = vi.fn().mockResolvedValue({
        id: scenario.roleId,
        scope: 'engine',
        kind: 'custom',
        isAssignable: true,
        isArchived: false,
      });
      const findRolePermissions = vi.fn().mockResolvedValue([
        { permissionId: scenario.permissionId },
      ]);

      (getDataSource as unknown as Mock).mockResolvedValue({
        getRepository: (entity: unknown) => {
          if (entity === RbacRole) return { findOne: findRole };
          if (entity === RbacRolePermission) return { find: findRolePermissions };
          if (entity === SsoAssignmentMapping) return { insert };
          throw new Error('Unexpected repository');
        },
      });

      await expect(ssoAssignmentMappingService.createMapping({
        claimType: 'group',
        claimKey: 'groups',
        claimValue: 'Sensitive Readers',
        targetSelectorType: 'external_engine_id',
        targetExternalEngineId: 'cluster-a/prod',
        targetRoleId: scenario.roleId,
      })).rejects.toThrow('High-risk SSO assignment mapping requires acknowledgement');
      expect(insert).not.toHaveBeenCalled();
    });

    it(`rejects acknowledged custom ${scenario.label} mappings when platform settings disable them`, async () => {
      const insert = vi.fn().mockResolvedValue(undefined);
      const findRole = vi.fn().mockResolvedValue({
        id: scenario.roleId,
        scope: 'engine',
        kind: 'custom',
        isAssignable: true,
        isArchived: false,
      });
      const findRolePermissions = vi.fn().mockResolvedValue([
        { permissionId: scenario.permissionId },
      ]);

      (getDataSource as unknown as Mock).mockResolvedValue({
        getRepository: (entity: unknown) => {
          if (entity === RbacRole) return { findOne: findRole };
          if (entity === RbacRolePermission) return { find: findRolePermissions };
          if (entity === SsoAssignmentMapping) return { insert };
          if (entity === PlatformSettings) return {
            findOneBy: vi.fn().mockResolvedValue({
              [scenario.settingKey]: false,
            }),
          };
          throw new Error('Unexpected repository');
        },
      });

      await expect(ssoAssignmentMappingService.createMapping({
        claimType: 'group',
        claimKey: 'groups',
        claimValue: 'Sensitive Readers',
        targetSelectorType: 'external_engine_id',
        targetExternalEngineId: 'cluster-a/prod',
        targetRoleId: scenario.roleId,
        riskAcknowledged: true,
      })).rejects.toThrow(scenario.riskReason);
      expect(insert).not.toHaveBeenCalled();
    });
  }

  it('rejects acknowledged custom secret-role mappings when platform settings disable them', async () => {
    const insert = vi.fn().mockResolvedValue(undefined);
    const findRole = vi.fn().mockResolvedValue({
      id: 'custom.engine.secret-reader',
      scope: 'engine',
      kind: 'custom',
      isAssignable: true,
      isArchived: false,
    });
    const findRolePermissions = vi.fn().mockResolvedValue([
      { permissionId: EnginePermissions.SECRETS_VIEW },
    ]);

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === RbacRole) return { findOne: findRole };
        if (entity === RbacRolePermission) return { find: findRolePermissions };
        if (entity === SsoAssignmentMapping) return { insert };
        if (entity === PlatformSettings) return {
          findOneBy: vi.fn().mockResolvedValue({
            ssoSecretViewMappingsEnabled: false,
          }),
        };
        throw new Error('Unexpected repository');
      },
    });

    await expect(ssoAssignmentMappingService.createMapping({
      claimType: 'group',
      claimKey: 'groups',
      claimValue: 'Secret Readers',
      targetSelectorType: 'engine_label',
      targetLabelKey: 'environment',
      targetLabelValue: 'prod',
      targetRoleId: 'custom.engine.secret-reader',
      riskAcknowledged: true,
    })).rejects.toThrow('engine_secret_permission');
    expect(insert).not.toHaveBeenCalled();
  });

  it('allows acknowledged custom secret-role mappings when platform settings enable them', async () => {
    const insert = vi.fn().mockResolvedValue(undefined);
    const auditInsert = vi.fn().mockResolvedValue(undefined);
    const dynamicMocks = createDynamicEngineSetMocks({
      engines: [
        { id: 'engine-prod', labelsJson: JSON.stringify({ environment: 'prod' }), externalId: null, lifecycleStatus: 'active' },
      ],
    });
    const findRole = vi.fn().mockResolvedValue({
      id: 'custom.engine.secret-reader',
      scope: 'engine',
      kind: 'custom',
      isAssignable: true,
      isArchived: false,
    });
    const findRolePermissions = vi.fn().mockResolvedValue([
      { permissionId: EnginePermissions.SECRETS_VIEW },
    ]);

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        const dynamicRepo = dynamicMocks.getRepository(entity);
        if (dynamicRepo) return dynamicRepo;
        if (entity === RbacRole) return { findOne: findRole };
        if (entity === RbacRolePermission) return { find: findRolePermissions };
        if (entity === SsoAssignmentMapping) return { insert };
        if (entity === AuditLog) return { insert: auditInsert };
        if (entity === PlatformSettings) return {
          findOneBy: vi.fn().mockResolvedValue({
            ssoSecretViewMappingsEnabled: true,
          }),
        };
        throw new Error('Unexpected repository');
      },
    });

    await ssoAssignmentMappingService.createMapping({
      actorUserId: 'admin-1',
      claimType: 'group',
      claimKey: 'groups',
      claimValue: 'Secret Readers',
      targetSelectorType: 'engine_label',
      targetLabelKey: 'environment',
      targetLabelValue: 'prod',
      targetRoleId: 'custom.engine.secret-reader',
      riskAcknowledged: true,
    });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      targetRoleId: 'custom.engine.secret-reader',
    }));
    const details = JSON.parse(auditInsert.mock.calls[0][0].details);
    expect(details.riskReasons).toEqual(['engine_secret_permission']);
  });

  it('materializes an SSO-owned Engine Set when creating a label selector mapping', async () => {
    const insert = vi.fn().mockResolvedValue(undefined);
    const auditInsert = vi.fn().mockResolvedValue(undefined);
    const dynamicMocks = createDynamicEngineSetMocks({
      engines: [
        { id: 'engine-prod', labelsJson: JSON.stringify({ environment: 'prod' }), externalId: null, lifecycleStatus: 'active' },
        { id: 'engine-dev', labelsJson: JSON.stringify({ environment: 'dev' }), externalId: null, lifecycleStatus: 'active' },
      ],
      registrations: [],
    });

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        const dynamicRepo = dynamicMocks.getRepository(entity);
        if (dynamicRepo) return dynamicRepo;
        if (entity === SsoAssignmentMapping) return { insert };
        if (entity === AuditLog) return { insert: auditInsert };
        throw new Error('Unexpected repository');
      },
    });

    await ssoAssignmentMappingService.createMapping({
      claimType: 'group',
      claimKey: 'groups',
      claimValue: 'Prod Deployers',
      targetSelectorType: 'engine_label',
      targetLabelKey: 'environment',
      targetLabelValue: 'prod',
      targetRoleId: 'system.engine.deployer',
    });

    expect(dynamicMocks.engineSetInsert).toHaveBeenCalledWith(expect.objectContaining({
      source: 'sso',
      sourceRef: expect.any(String),
      selectorJson: expect.stringContaining('"environment":"prod"'),
    }));
    expect(dynamicMocks.materializationInsert).toHaveBeenCalledWith(expect.objectContaining({
      engineId: 'engine-prod',
      source: 'sso',
    }));
    expect(dynamicMocks.materializationInsert).toHaveBeenCalledTimes(1);
  });

  it('syncs label selector mappings as Engine Set-scoped role assignments', async () => {
    const mapping = {
      id: 'mapping-label',
      tenantId: 'tenant-a',
      providerId: null,
      claimType: 'group',
      claimKey: 'groups',
      claimValue: 'Prod Operators',
      targetScope: 'engine',
      targetSelectorType: 'engine_label',
      targetEngineId: null,
      targetExternalEngineId: null,
      targetLabelKey: 'environment',
      targetLabelValue: 'prod',
      targetRoleId: 'system.engine.operator',
      syncMode: 'authoritative',
      priority: 0,
      isActive: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const mappingQb = queryBuilder([mapping]);
    const assignmentQb = queryBuilder(null);
    assignmentQb.getOne = vi.fn().mockResolvedValue(null);
    const assignmentInsert = vi.fn().mockResolvedValue(undefined);
    const auditInsert = vi.fn().mockResolvedValue(undefined);
    const dynamicMocks = createDynamicEngineSetMocks({
      engineSet: null,
      engines: [
        { id: 'engine-prod', labelsJson: JSON.stringify({ environment: 'prod' }), externalId: null, tenantId: 'tenant-a', lifecycleStatus: 'active' },
        { id: 'engine-dev', labelsJson: JSON.stringify({ environment: 'dev' }), externalId: null, tenantId: 'tenant-a', lifecycleStatus: 'active' },
      ],
      registrations: [],
      materializations: [],
    });

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        const dynamicRepo = dynamicMocks.getRepository(entity);
        if (dynamicRepo) return dynamicRepo;
        if (entity === SsoAssignmentMapping) return { createQueryBuilder: vi.fn().mockReturnValue(mappingQb) };
        if (entity === RbacRoleAssignment) return {
          createQueryBuilder: vi.fn().mockReturnValue(assignmentQb),
          insert: assignmentInsert,
          find: vi.fn().mockResolvedValue([]),
          update: vi.fn(),
          delete: vi.fn(),
        };
        if (entity === AuditLog) return { insert: auditInsert };
        throw new Error('Unexpected repository');
      },
    });

    const result = await ssoAssignmentMappingService.syncAssignmentsForUser('user-1', { groups: ['Prod Operators'] }, undefined, 'tenant-a');

    expect(result).toMatchObject({ created: 1, updated: 0, removed: 0 });
    expect(dynamicMocks.engineSetInsert).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      source: 'sso',
      sourceRef: 'mapping-label',
    }));
    const engineSetId = dynamicMocks.engineSetInsert.mock.calls[0][0].id;
    expect(dynamicMocks.materializationInsert).toHaveBeenCalledWith(expect.objectContaining({
      engineSetId,
      engineId: 'engine-prod',
    }));
    expect(assignmentInsert).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      userId: null,
      roleId: 'system.engine.operator',
      resourceType: null,
      resourceId: null,
      scopeType: 'engine_set',
      scopeId: engineSetId,
      source: 'sso',
      sourceMappingId: null,
      sourceRef: 'mapping-label',
    }));
  });

  it('syncs label selector mappings through a transaction manager for scheduled snapshot replay', async () => {
    const mapping = {
      id: 'mapping-scheduled-label',
      tenantId: 'tenant-a',
      providerId: 'microsoft',
      claimType: 'group',
      claimKey: 'groups',
      claimValue: 'Prod Operators',
      targetScope: 'engine',
      targetSelectorType: 'engine_label',
      targetEngineId: null,
      targetExternalEngineId: null,
      targetLabelKey: 'environment',
      targetLabelValue: 'prod',
      targetRoleId: 'system.engine.operator',
      syncMode: 'authoritative',
      priority: 0,
      isActive: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const mappingQb = queryBuilder([mapping]);
    const assignmentQb = queryBuilder(null);
    assignmentQb.getOne = vi.fn().mockResolvedValue(null);
    const assignmentInsert = vi.fn().mockResolvedValue(undefined);
    const auditInsert = vi.fn().mockResolvedValue(undefined);
    const dynamicMocks = createDynamicEngineSetMocks({
      engineSet: null,
      engines: [
        { id: 'engine-prod', labelsJson: null, externalId: 'cluster/prod', tenantId: 'tenant-a', lifecycleStatus: 'active' },
        { id: 'engine-dev', labelsJson: JSON.stringify({ environment: 'dev' }), externalId: 'cluster/dev', tenantId: 'tenant-a', lifecycleStatus: 'active' },
      ],
      registrations: [
        { engineId: 'engine-prod', labelsJson: JSON.stringify({ environment: 'prod', region: 'eu' }), externalId: 'cluster/prod' },
      ],
      materializations: [],
    });
    const manager = {
      getRepository: (entity: unknown) => {
        const dynamicRepo = dynamicMocks.getRepository(entity);
        if (dynamicRepo) return dynamicRepo;
        if (entity === SsoAssignmentMapping) return { createQueryBuilder: vi.fn().mockReturnValue(mappingQb) };
        if (entity === RbacRoleAssignment) return {
          createQueryBuilder: vi.fn().mockReturnValue(assignmentQb),
          insert: assignmentInsert,
          find: vi.fn().mockResolvedValue([]),
          update: vi.fn(),
          delete: vi.fn(),
        };
        if (entity === AuditLog) return { insert: auditInsert };
        throw new Error('Unexpected repository');
      },
    };

    const result = await ssoAssignmentMappingService.syncAssignmentsForUserWithManager(
      manager as any,
      'user-1',
      { groups: ['Prod Operators'] },
      'microsoft',
      'tenant-a',
    );

    expect(result).toMatchObject({ created: 1, updated: 0, removed: 0 });
    expect(mappingQb.andWhere).toHaveBeenCalledWith(
      '(m.providerId IS NULL OR m.providerId = :providerId)',
      { providerId: 'microsoft' },
    );
    const engineSetId = dynamicMocks.engineSetInsert.mock.calls[0][0].id;
    expect(dynamicMocks.materializationInsert).toHaveBeenCalledWith(expect.objectContaining({
      engineSetId,
      engineId: 'engine-prod',
      source: 'sso',
      sourceRef: 'mapping-scheduled-label',
      lineageJson: expect.stringContaining('"region":"eu"'),
    }));
    expect(assignmentInsert).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      userId: null,
      roleId: 'system.engine.operator',
      resourceType: null,
      resourceId: null,
      scopeType: 'engine_set',
      scopeId: engineSetId,
      source: 'sso',
      sourceMappingId: null,
      sourceRef: 'mapping-scheduled-label',
    }));
  });

  it('rejects custom SSO target roles outside engine scope', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === RbacRole) return {
          findOne: vi.fn().mockResolvedValue({
            id: 'custom.project.editor',
            scope: 'project',
            kind: 'custom',
            isAssignable: true,
            isArchived: false,
          }),
        };
        throw new Error('Unexpected repository');
      },
    });

    await expect(ssoAssignmentMappingService.createMapping({
      claimType: 'group',
      claimKey: 'groups',
      claimValue: 'Editors',
      targetSelectorType: 'all_engines',
      targetRoleId: 'custom.project.editor',
    })).rejects.toThrow('assignable custom engine roles');
  });

  it('rejects active engine-id mappings without an existing target engine', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) return { findOne: vi.fn().mockResolvedValue(null) };
        throw new Error('Unexpected repository');
      },
    });

    await expect(ssoAssignmentMappingService.createMapping({
      claimType: 'group',
      claimKey: 'groups',
      claimValue: 'Ops',
      targetSelectorType: 'engine_id',
      targetEngineId: 'missing-engine',
      targetRoleId: 'system.engine.operator',
    })).rejects.toThrow('Target engine does not exist');
  });

  it('deleting a mapping removes only SSO assignments created by that mapping', async () => {
    const deleteAssignment = vi.fn().mockResolvedValue(undefined);
    const deleteMapping = vi.fn().mockResolvedValue(undefined);
    const auditInsert = vi.fn().mockResolvedValue(undefined);
    const dynamicMocks = createDynamicEngineSetMocks();
    const findAssignments = vi.fn().mockResolvedValue([
      {
        id: 'sso-assignment-1',
        userId: 'user-1',
        roleId: 'system.engine.deployer',
        resourceType: 'engine',
        resourceId: 'engine-1',
        source: 'sso',
        sourceMappingId: 'mapping-1',
      },
    ]);

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        const dynamicRepo = dynamicMocks.getRepository(entity);
        if (dynamicRepo) return dynamicRepo;
        if (entity === RbacRoleAssignment) return { find: findAssignments, delete: deleteAssignment };
        if (entity === SsoAssignmentMapping) return { delete: deleteMapping };
        if (entity === AuditLog) return { insert: auditInsert };
        throw new Error('Unexpected repository');
      },
    });

    await ssoAssignmentMappingService.deleteMapping('mapping-1');

    expect(findAssignments).toHaveBeenCalledWith({ where: { source: 'sso', sourceMappingId: 'mapping-1' } });
    expect(deleteAssignment).toHaveBeenCalledWith({ source: 'sso', sourceMappingId: 'mapping-1' });
    expect(deleteMapping).toHaveBeenCalledWith({ id: 'mapping-1' });
    expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      action: 'authz.sso_assignment.delete',
      resourceId: 'sso-assignment-1',
    }));
  });

  it('tests engine label selectors against matching engine labels', async () => {
    const mapping = {
      id: 'mapping-2',
      providerId: null,
      claimType: 'role',
      claimKey: 'roles',
      claimValue: 'deployer',
      targetScope: 'engine',
      targetSelectorType: 'engine_label',
      targetEngineId: null,
      targetExternalEngineId: null,
      targetLabelKey: 'environment',
      targetLabelValue: 'prod',
      targetRoleId: 'system.engine.deployer',
      syncMode: 'additive',
      priority: 0,
      isActive: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const mappingQb = queryBuilder([mapping]);

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === SsoAssignmentMapping) return { createQueryBuilder: vi.fn().mockReturnValue(mappingQb) };
        if (entity === ExternalEngineRegistration) return {
          find: vi.fn().mockResolvedValue([
            { engineId: 'engine-prod', labelsJson: JSON.stringify({ environment: 'prod' }) },
            { engineId: 'engine-dev', labelsJson: JSON.stringify({ environment: 'dev' }) },
          ]),
        };
        if (entity === Engine) return {
          find: vi.fn().mockResolvedValue([
            { id: 'engine-prod', labelsJson: JSON.stringify({ environment: 'prod' }) },
            { id: 'engine-dev', labelsJson: JSON.stringify({ environment: 'dev' }) },
          ]),
        };
        throw new Error('Unexpected repository');
      },
    });

    const result = await ssoAssignmentMappingService.testClaims({ roles: ['deployer'] });

    expect(result.assignments).toEqual([
      expect.objectContaining({
        roleId: 'system.engine.deployer',
        resourceId: 'engine-prod',
        mappingId: 'mapping-2',
      }),
    ]);
    expect(result.matchedMappings[0].targetResourceIds).toEqual(['engine-prod']);
  });
});

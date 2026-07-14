import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import {
  AuditLog,
  EngineSetMaterialization,
  RbacRoleAssignment,
  SsoEngineAccessSnapshot,
} from '@enterpriseglue/shared/db/entities/index.js';
import { ssoEngineAccessSnapshotService } from '@enterpriseglue/shared/services/platform-admin/SsoEngineAccessSnapshotService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

function snapshotRow(overrides: Partial<SsoEngineAccessSnapshot> = {}): SsoEngineAccessSnapshot {
  return {
    id: 'snapshot-1',
    tenantId: 'tenant-a',
    providerId: 'provider-1',
    mappingId: 'mapping-1',
    principalType: 'user',
    principalId: 'user-1',
    engineId: 'engine-1',
    providerSubjectIdsJson: '["subject-1"]',
    providerGroupIdsJson: '["Ops"]',
    providerAppRoleIdsJson: '[]',
    currentRoleIdsJson: '["system.engine.operator"]',
    previousRoleIdsJson: '[]',
    status: 'active',
    cleanupReason: null,
    lastSeenAt: 1000,
    lastSyncedAt: 1000,
    removedAt: null,
    details: '{}',
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  } as SsoEngineAccessSnapshot;
}

function qb(result: unknown) {
  return {
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    addOrderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    getOne: vi.fn().mockResolvedValue(result),
    getMany: vi.fn().mockResolvedValue(Array.isArray(result) ? result : []),
  };
}

describe('ssoEngineAccessSnapshotService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(2000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates an active snapshot when SSO sync grants engine access', async () => {
    const insert = vi.fn().mockResolvedValue(undefined);
    const update = vi.fn().mockResolvedValue(undefined);
    const snapshotQb = qb(null);
    const store = {
      getRepository: (entity: unknown) => {
        if (entity === SsoEngineAccessSnapshot) {
          return { createQueryBuilder: vi.fn().mockReturnValue(snapshotQb), insert, update };
        }
        throw new Error('Unexpected repository');
      },
    } as any;

    await ssoEngineAccessSnapshotService.recordActiveGrant(store, {
      tenantId: 'tenant-a',
      providerId: 'provider-1',
      mappingId: 'mapping-1',
      principalId: 'user-1',
      roleId: 'system.engine.operator',
      assignmentId: 'assignment-1',
      resourceId: 'engine-1',
      claims: {
        oid: 'subject-1',
        groups: ['Ops', 'Ops'],
        roles: ['RuntimeOperator'],
      },
    });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      providerId: 'provider-1',
      mappingId: 'mapping-1',
      principalType: 'user',
      principalId: 'user-1',
      engineId: 'engine-1',
      currentRoleIdsJson: '["system.engine.operator"]',
      previousRoleIdsJson: '[]',
      status: 'active',
      lastSeenAt: 2000,
      lastSyncedAt: 2000,
    }));
    const inserted = insert.mock.calls[0][0];
    expect(JSON.parse(inserted.providerSubjectIdsJson)).toEqual(['subject-1']);
    expect(JSON.parse(inserted.providerGroupIdsJson)).toEqual(['Ops']);
    expect(JSON.parse(inserted.providerAppRoleIdsJson)).toEqual(['RuntimeOperator']);
    expect(JSON.parse(inserted.details)).toMatchObject({
      assignmentId: 'assignment-1',
      scopeType: 'engine',
      scopeId: 'engine-1',
      source: 'sso',
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('updates current roles and preserves previous roles when an SSO grant changes role', async () => {
    const insert = vi.fn().mockResolvedValue(undefined);
    const update = vi.fn().mockResolvedValue(undefined);
    const snapshotQb = qb(snapshotRow());
    const store = {
      getRepository: (entity: unknown) => {
        if (entity === SsoEngineAccessSnapshot) {
          return { createQueryBuilder: vi.fn().mockReturnValue(snapshotQb), insert, update };
        }
        throw new Error('Unexpected repository');
      },
    } as any;

    await ssoEngineAccessSnapshotService.recordActiveGrant(store, {
      tenantId: 'tenant-a',
      providerId: 'provider-1',
      mappingId: 'mapping-1',
      principalId: 'user-1',
      roleId: 'system.engine.deployer',
      assignmentId: 'assignment-2',
      resourceId: 'engine-1',
      claims: { oid: 'subject-1', groups: ['Deployers'] },
    });

    expect(update).toHaveBeenCalledWith({ id: 'snapshot-1' }, expect.objectContaining({
      currentRoleIdsJson: '["system.engine.deployer"]',
      previousRoleIdsJson: '["system.engine.operator"]',
      status: 'active',
      cleanupReason: null,
      removedAt: null,
      lastSeenAt: 2000,
      lastSyncedAt: 2000,
    }));
    expect(insert).not.toHaveBeenCalled();
  });

  it('marks canonical SSO snapshots removed without touching non-SSO assignments', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const snapshotQb = qb(snapshotRow());
    const store = {
      getRepository: (entity: unknown) => {
        if (entity === SsoEngineAccessSnapshot) {
          return { createQueryBuilder: vi.fn().mockReturnValue(snapshotQb), update };
        }
        throw new Error('Unexpected repository');
      },
    } as any;

    await ssoEngineAccessSnapshotService.markAssignmentRemoved(store, {
      id: 'assignment-1',
      tenantId: 'tenant-a',
      userId: 'user-1',
      principalType: 'user',
      principalId: 'user-1',
      roleId: 'system.engine.operator',
      scopeType: 'engine',
      scopeId: 'engine-1',
      source: 'sso',
      sourceRef: 'legacy_sso:provider-1:mapping:mapping-1',
    } as RbacRoleAssignment, {
      status: 'removed_by_sso',
      cleanupReason: 'authoritative_claim_no_longer_matches',
    });

    expect(update).toHaveBeenCalledWith({ id: 'snapshot-1' }, expect.objectContaining({
      status: 'removed_by_sso',
      cleanupReason: 'authoritative_claim_no_longer_matches',
      removedAt: 2000,
      lastSyncedAt: 2000,
    }));
    expect(snapshotQb.where).toHaveBeenCalledWith('snapshot.mappingId = :mappingId', { mappingId: 'mapping-1' });

    await ssoEngineAccessSnapshotService.markAssignmentRemoved(store, {
      id: 'manual-1',
      userId: 'user-1',
      roleId: 'system.engine.operator',
      resourceType: 'engine',
      resourceId: 'engine-1',
      source: 'manual',
    } as RbacRoleAssignment, {
      status: 'removed_by_sso',
    });

    expect(update).toHaveBeenCalledTimes(1);
  });

  it('previews duplicate manual engine access when an SSO replacement exists', async () => {
    const manualAssignment = {
      id: 'manual-1',
      userId: 'user-1',
      principalType: 'user',
      principalId: 'user-1',
      roleId: 'system.engine.operator',
      resourceType: 'engine',
      resourceId: 'engine-1',
      source: 'manual',
    } as RbacRoleAssignment;
    const ssoAssignment = {
      id: 'sso-1',
      userId: 'user-1',
      principalType: 'user',
      principalId: 'user-1',
      roleId: 'system.engine.operator',
      resourceType: 'engine',
      resourceId: 'engine-1',
      source: 'sso',
      sourceMappingId: 'mapping-1',
      sourceRef: 'legacy_sso:provider-1:mapping:mapping-1',
    } as RbacRoleAssignment;
    const manualQb = qb([manualAssignment]);
    const ssoQb = qb([ssoAssignment]);
    const snapshotListQb = qb([snapshotRow()]);
    const store = {
      getRepository: (entity: unknown) => {
        if (entity === EngineSetMaterialization) return { find: vi.fn().mockResolvedValue([]) };
        if (entity === RbacRoleAssignment) return {
          createQueryBuilder: vi.fn()
            .mockReturnValueOnce(manualQb)
            .mockReturnValueOnce(ssoQb),
        };
        if (entity === SsoEngineAccessSnapshot) return { createQueryBuilder: vi.fn().mockReturnValue(snapshotListQb) };
        throw new Error('Unexpected repository');
      },
    } as any;

    const preview = await ssoEngineAccessSnapshotService.previewTransitionCleanupInStore(store, 'engine-1', 'tenant-a', 'preview-1');

    expect(preview).toEqual({
      previewCorrelationId: 'preview-1',
      engineId: 'engine-1',
      candidates: [
        {
          manualAssignmentId: 'manual-1',
          ssoAssignmentId: 'sso-1',
          principalType: 'user',
          principalId: 'user-1',
          engineId: 'engine-1',
          manualRoleId: 'system.engine.operator',
          ssoRoleId: 'system.engine.operator',
          sourceMappingId: 'mapping-1',
          lastSnapshotStatus: 'active',
          recommendedAction: 'remove_manual_duplicate',
        },
      ],
    });
  });

  it('applies transition cleanup only for explicitly previewed manual assignments', async () => {
    const manualAssignment = {
      id: 'manual-1',
      userId: 'user-1',
      principalType: 'user',
      principalId: 'user-1',
      roleId: 'system.engine.operator',
      resourceType: 'engine',
      resourceId: 'engine-1',
      source: 'manual',
    } as RbacRoleAssignment;
    const ssoAssignment = {
      id: 'sso-1',
      userId: 'user-1',
      principalType: 'user',
      principalId: 'user-1',
      roleId: 'system.engine.operator',
      resourceType: 'engine',
      resourceId: 'engine-1',
      source: 'sso',
      sourceMappingId: 'mapping-1',
    } as RbacRoleAssignment;
    const deleteAssignments = vi.fn().mockResolvedValue(undefined);
    const auditInsert = vi.fn().mockResolvedValue(undefined);
    const snapshotListQb = qb([snapshotRow()]);
    const manager = {
      getRepository: (entity: unknown) => {
        if (entity === EngineSetMaterialization) return { find: vi.fn().mockResolvedValue([]) };
        if (entity === RbacRoleAssignment) return {
          createQueryBuilder: vi.fn()
            .mockReturnValueOnce(qb([manualAssignment]))
            .mockReturnValueOnce(qb([ssoAssignment])),
          find: vi.fn().mockResolvedValue([manualAssignment]),
          delete: deleteAssignments,
        };
        if (entity === SsoEngineAccessSnapshot) return { createQueryBuilder: vi.fn().mockReturnValue(snapshotListQb) };
        if (entity === AuditLog) return { insert: auditInsert };
        throw new Error('Unexpected repository');
      },
	    } as any;
	    (getDataSource as unknown as Mock).mockResolvedValue({
	      transaction: async (work: (transactionManager: unknown) => Promise<unknown>) => work(manager),
	    });

    const result = await ssoEngineAccessSnapshotService.applyTransitionCleanup(
      'engine-1',
      ['manual-1'],
      'admin-1',
      'tenant-a',
      'preview-1',
    );

    expect(result).toMatchObject({
      previewCorrelationId: 'preview-1',
      engineId: 'engine-1',
      removedAssignmentIds: ['manual-1'],
      removedCount: 1,
    });
    expect(deleteAssignments).toHaveBeenCalledWith(expect.objectContaining({ source: 'manual' }));
    expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      userId: 'admin-1',
      action: 'authz.engine_access_transition_cleanup.apply',
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
  });
});

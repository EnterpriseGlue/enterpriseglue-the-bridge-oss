import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import {
  AuthzGroup,
  AuthzGroupMembership,
  Engine,
  ExternalEngineRegistration,
  RbacRoleAssignment,
  SsoAssignmentMapping,
  SsoEngineAccessSnapshot,
  SsoGroupMapping,
  SsoNormalizedIdentity,
  SsoSyncEvent,
  SsoSyncRun,
  User,
} from '@enterpriseglue/shared/db/entities/index.js';
import { ssoAssignmentMappingService } from '@enterpriseglue/shared/services/platform-admin/SsoAssignmentMappingService.js';
import { ssoGroupMappingService } from '@enterpriseglue/shared/services/platform-admin/SsoGroupMappingService.js';
import { ssoProviderIdentityCheckService } from '@enterpriseglue/shared/services/platform-admin/SsoProviderIdentityCheckService.js';
import { ssoSyncDiagnosticsService } from '@enterpriseglue/shared/services/platform-admin/SsoSyncDiagnosticsService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/SsoAssignmentMappingService.js', () => ({
  ssoAssignmentMappingService: {
    getDisabledPlatformRiskReasonsForMapping: vi.fn().mockResolvedValue([]),
    syncAssignmentsForUserWithManager: vi.fn().mockResolvedValue({ created: 0, updated: 0, removed: 0 }),
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/SsoGroupMappingService.js', () => ({
  ssoGroupMappingService: {
    syncMembershipsForUserWithManager: vi.fn().mockResolvedValue({ created: 0, updated: 0, removed: 0 }),
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/SsoProviderIdentityCheckService.js', () => ({
  ssoProviderIdentityCheckService: {
    checkIdentity: vi.fn(),
    checkGroup: vi.fn().mockResolvedValue({
      status: 'active',
      reason: 'Microsoft Graph group exists',
      checkedAt: 1000,
    }),
    refreshClaims: vi.fn().mockResolvedValue({
      status: 'unsupported',
      reason: 'Provider does not support live claim refresh yet',
      checkedAt: 1000,
    }),
  },
}));

function createSnapshotRepositoryMock(snapshot: { id: string; details: string } | null = { id: 'snapshot-1', details: '{}' }) {
  const qb: any = {};
  qb.where = vi.fn(() => qb);
  qb.andWhere = vi.fn(() => qb);
  qb.getOne = vi.fn().mockResolvedValue(snapshot);
  return {
    createQueryBuilder: vi.fn().mockReturnValue(qb),
    update: vi.fn().mockResolvedValue(undefined),
  };
}

describe('ssoSyncDiagnosticsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (ssoAssignmentMappingService.getDisabledPlatformRiskReasonsForMapping as unknown as Mock).mockResolvedValue([]);
  });

  it('records SSO sync run lifecycle diagnostics', async () => {
    const runInsert = vi.fn().mockResolvedValue(undefined);
    const runUpdate = vi.fn().mockResolvedValue(undefined);
    const eventInsert = vi.fn().mockResolvedValue(undefined);
    const dataSource = {
      getRepository: (entity: unknown) => {
        if (entity === SsoSyncRun) return { insert: runInsert, update: runUpdate };
        if (entity === SsoSyncEvent) return { insert: eventInsert };
        throw new Error('Unexpected repository');
      },
    };
    (getDataSource as unknown as Mock).mockResolvedValue(dataSource);

    const runId = await ssoSyncDiagnosticsService.startRun({
      tenantId: 'tenant-a',
      providerId: 'provider-1',
      userId: 'user-1',
      trigger: 'login',
      details: { email: 'user@example.com' },
    });

    expect(runId).toEqual(expect.any(String));
    expect(runInsert).toHaveBeenCalledWith(expect.objectContaining({
      id: runId,
      tenantId: 'tenant-a',
      providerId: 'provider-1',
      userId: 'user-1',
      trigger: 'login',
      status: 'running',
    }));
    expect(eventInsert).toHaveBeenCalledWith(expect.objectContaining({
      runId,
      severity: 'info',
      type: 'sso_sync_started',
    }));

    await ssoSyncDiagnosticsService.completeRun(runId, {
      tenantId: 'tenant-a',
      providerId: 'provider-1',
      userId: 'user-1',
      groupMembershipsCreated: 1,
      assignmentsCreated: 2,
      details: { email: 'user@example.com' },
    });

    expect(runUpdate).toHaveBeenCalledWith({ id: runId }, expect.objectContaining({
      status: 'success',
      groupMembershipsCreated: 1,
      assignmentsCreated: 2,
      errorCode: null,
      errorMessage: null,
    }));
    expect(eventInsert).toHaveBeenCalledWith(expect.objectContaining({
      runId,
      severity: 'info',
      type: 'sso_sync_completed',
    }));

    await ssoSyncDiagnosticsService.failRun(runId, new Error('materialization failed'), {
      tenantId: 'tenant-a',
      providerId: 'provider-1',
      userId: 'user-1',
    });

    expect(runUpdate).toHaveBeenCalledWith({ id: runId }, expect.objectContaining({
      status: 'failed',
      errorCode: 'Error',
      errorMessage: 'materialization failed',
    }));
    expect(eventInsert).toHaveBeenCalledWith(expect.objectContaining({
      runId,
      severity: 'error',
      type: 'sso_sync_failed',
      message: 'materialization failed',
    }));
  });

  it('lists SSO sync runs and run events with tenant-aware filters', async () => {
    const runQb: any = {};
    runQb.where = vi.fn(() => runQb);
    runQb.orderBy = vi.fn(() => runQb);
    runQb.take = vi.fn(() => runQb);
    runQb.andWhere = vi.fn(() => runQb);
    runQb.getMany = vi.fn().mockResolvedValue([
      {
        id: 'run-1',
        tenantId: 'tenant-a',
        providerId: 'provider-1',
        userId: 'user-1',
        trigger: 'login',
        status: 'failed',
        startedAt: 1000,
        completedAt: 1500,
        groupMembershipsCreated: 1,
        groupMembershipsUpdated: 0,
        groupMembershipsRemoved: 0,
        assignmentsCreated: 1,
        assignmentsUpdated: 0,
        assignmentsRemoved: 0,
        errorCode: 'Error',
        errorMessage: 'materialization failed',
        details: '{}',
      },
    ]);

    const eventQb: any = {};
    eventQb.where = vi.fn(() => eventQb);
    eventQb.orderBy = vi.fn(() => eventQb);
    eventQb.take = vi.fn(() => eventQb);
    eventQb.andWhere = vi.fn(() => eventQb);
    eventQb.getMany = vi.fn().mockResolvedValue([
      {
        id: 'event-1',
        tenantId: 'tenant-a',
        providerId: 'provider-1',
        runId: 'run-1',
        severity: 'error',
        type: 'sso_sync_failed',
        userId: 'user-1',
        mappingType: null,
        mappingId: null,
        resourceType: 'engine',
        resourceId: 'engine-1',
        message: 'materialization failed',
        details: '{}',
        createdAt: 1400,
      },
    ]);

    const runFindOne = vi.fn().mockResolvedValue({ id: 'run-1' });
    const dataSource = {
      getRepository: (entity: unknown) => {
        if (entity === SsoSyncRun) return { createQueryBuilder: vi.fn().mockReturnValue(runQb), findOne: runFindOne };
        if (entity === SsoSyncEvent) return { createQueryBuilder: vi.fn().mockReturnValue(eventQb) };
        throw new Error('Unexpected repository');
      },
    };
    (getDataSource as unknown as Mock).mockResolvedValue(dataSource);

    const runs = await ssoSyncDiagnosticsService.listRuns({
      tenantId: 'tenant-a',
      providerId: 'provider-1',
      status: 'failed',
      trigger: 'login',
      limit: 5,
    });

    expect(runs).toEqual([
      expect.objectContaining({
        id: 'run-1',
        status: 'failed',
        startedAt: 1000,
        completedAt: 1500,
      }),
    ]);
    expect(runQb.andWhere).toHaveBeenCalledWith('(run.tenantId = :tenantId OR run.tenantId IS NULL)', { tenantId: 'tenant-a' });
    expect(runQb.andWhere).toHaveBeenCalledWith('run.providerId = :providerId', { providerId: 'provider-1' });
    expect(runQb.andWhere).toHaveBeenCalledWith('run.status = :status', { status: 'failed' });
    expect(runQb.andWhere).toHaveBeenCalledWith('run.trigger = :trigger', { trigger: 'login' });
    expect(runQb.take).toHaveBeenCalledWith(5);

    const events = await ssoSyncDiagnosticsService.listEvents({
      tenantId: 'tenant-a',
      providerId: 'provider-1',
      runId: 'run-1',
      severity: 'error',
      limit: 10,
    });

    expect(events).toEqual([
      expect.objectContaining({
        id: 'event-1',
        severity: 'error',
        resourceType: 'engine',
        resourceId: 'engine-1',
      }),
    ]);
    expect(runFindOne).toHaveBeenCalledWith(expect.objectContaining({
      select: ['id'],
    }));
    expect(eventQb.andWhere).toHaveBeenCalledWith('(event.tenantId = :tenantId OR event.tenantId IS NULL)', { tenantId: 'tenant-a' });
    expect(eventQb.andWhere).toHaveBeenCalledWith('event.providerId = :providerId', { providerId: 'provider-1' });
    expect(eventQb.andWhere).toHaveBeenCalledWith('event.severity = :severity', { severity: 'error' });
    expect(eventQb.take).toHaveBeenCalledWith(10);
  });

  it('replays normalized SSO identity snapshots against current mappings', async () => {
    const runInsert = vi.fn().mockResolvedValue(undefined);
    const runUpdate = vi.fn().mockResolvedValue(undefined);
    const eventInsert = vi.fn().mockResolvedValue(undefined);
    const transaction = vi.fn(async (callback: (manager: any) => Promise<unknown>) => callback({ tx: true }));
    const identityQb: any = {};
    identityQb.where = vi.fn(() => identityQb);
    identityQb.orderBy = vi.fn(() => identityQb);
    identityQb.take = vi.fn(() => identityQb);
    identityQb.andWhere = vi.fn(() => identityQb);
    identityQb.getMany = vi.fn().mockResolvedValue([
      {
        id: 'identity-1',
        tenantId: 'tenant-a',
        providerId: 'microsoft',
        providerSubject: 'subject-1',
        userId: 'user-1',
        claimsJson: JSON.stringify({
          email: 'user@example.com',
          groups: ['ops'],
          roles: ['deployer'],
        }),
      },
      {
        id: 'identity-invalid',
        tenantId: 'tenant-a',
        providerId: 'microsoft',
        providerSubject: 'subject-invalid',
        userId: 'user-invalid',
        claimsJson: '{',
      },
      {
        id: 'identity-missing-user',
        tenantId: 'tenant-a',
        providerId: 'microsoft',
        providerSubject: 'subject-missing-user',
        userId: 'user-missing',
        claimsJson: JSON.stringify({
          email: 'missing@example.com',
          groups: ['ops'],
          roles: [],
        }),
      },
    ]);
    const userFindOne = vi.fn()
      .mockResolvedValueOnce({ id: 'user-1', isActive: true })
      .mockResolvedValueOnce(null);
    const dataSource = {
      transaction,
      getRepository: (entity: unknown) => {
        if (entity === SsoSyncRun) return { insert: runInsert, update: runUpdate };
        if (entity === SsoSyncEvent) return { insert: eventInsert };
        if (entity === SsoNormalizedIdentity) return { createQueryBuilder: vi.fn().mockReturnValue(identityQb) };
        if (entity === User) return { findOne: userFindOne };
        throw new Error('Unexpected repository');
      },
    };
    (getDataSource as unknown as Mock).mockResolvedValue(dataSource);
    (ssoGroupMappingService.syncMembershipsForUserWithManager as unknown as Mock).mockResolvedValue({
      created: 1,
      updated: 2,
      removed: 3,
    });
    (ssoAssignmentMappingService.syncAssignmentsForUserWithManager as unknown as Mock).mockResolvedValue({
      created: 4,
      updated: 5,
      removed: 6,
    });

    const result = await ssoSyncDiagnosticsService.runSnapshotReconciliation({
      tenantId: 'tenant-a',
      providerId: 'microsoft',
      trigger: 'scheduled',
      details: { source: 'test' },
    });

    expect(identityQb.andWhere).toHaveBeenCalledWith('(identity.tenantId = :tenantId OR identity.tenantId IS NULL)', { tenantId: 'tenant-a' });
    expect(identityQb.andWhere).toHaveBeenCalledWith('identity.providerId = :providerId', { providerId: 'microsoft' });
    expect(result).toMatchObject({
      scannedIdentities: 3,
      replayedIdentities: 1,
      skippedIdentities: 2,
      failedIdentities: 0,
      groupMembershipsCreated: 1,
      groupMembershipsUpdated: 2,
      groupMembershipsRemoved: 3,
      assignmentsCreated: 4,
      assignmentsUpdated: 5,
      assignmentsRemoved: 6,
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(ssoGroupMappingService.syncMembershipsForUserWithManager).toHaveBeenCalledWith(
      { tx: true },
      'user-1',
      expect.objectContaining({ groups: ['ops'], roles: ['deployer'] }),
      'microsoft',
      'tenant-a',
    );
    expect(ssoAssignmentMappingService.syncAssignmentsForUserWithManager).toHaveBeenCalledWith(
      { tx: true },
      'user-1',
      expect.objectContaining({ groups: ['ops'], roles: ['deployer'] }),
      'microsoft',
      'tenant-a',
    );
    expect(runUpdate).toHaveBeenCalledWith({ id: result.runId }, expect.objectContaining({
      status: 'success',
      groupMembershipsCreated: 1,
      assignmentsCreated: 4,
      details: expect.stringContaining('sso_snapshot_reconciliation'),
    }));
    const eventTypes = eventInsert.mock.calls.map(([event]) => event.type);
    expect(eventTypes).toEqual(expect.arrayContaining([
      'sso_snapshot_reconciliation.identity_replayed',
      'sso_snapshot_reconciliation.identity_claims_invalid',
      'sso_snapshot_reconciliation.user_missing',
    ]));
  });

  it('refreshes provider claims before snapshot replay when requested', async () => {
    const runInsert = vi.fn().mockResolvedValue(undefined);
    const runUpdate = vi.fn().mockResolvedValue(undefined);
    const eventInsert = vi.fn().mockResolvedValue(undefined);
    const identityUpdate = vi.fn().mockResolvedValue(undefined);
    const transaction = vi.fn(async (callback: (manager: any) => Promise<unknown>) => callback({ tx: true }));
    const identityQb: any = {};
    identityQb.where = vi.fn(() => identityQb);
    identityQb.orderBy = vi.fn(() => identityQb);
    identityQb.take = vi.fn(() => identityQb);
    identityQb.andWhere = vi.fn(() => identityQb);
    identityQb.getMany = vi.fn().mockResolvedValue([
      {
        id: 'identity-refresh',
        tenantId: 'tenant-a',
        providerId: 'microsoft',
        providerSubject: 'subject-refresh',
        userId: 'user-refresh',
        claimsJson: JSON.stringify({
          email: 'refresh@example.com',
          groups: ['old-group'],
          roles: ['deployer'],
        }),
      },
      {
        id: 'identity-refresh-failed',
        tenantId: 'tenant-a',
        providerId: 'microsoft',
        providerSubject: 'subject-failed',
        userId: 'user-failed',
        claimsJson: JSON.stringify({
          email: 'failed@example.com',
          groups: ['old-group'],
          roles: ['deployer'],
        }),
      },
    ]);
    const userFindOne = vi.fn().mockResolvedValue({ id: 'user-refresh', isActive: true });
    const dataSource = {
      transaction,
      getRepository: (entity: unknown) => {
        if (entity === SsoSyncRun) return { insert: runInsert, update: runUpdate };
        if (entity === SsoSyncEvent) return { insert: eventInsert };
        if (entity === SsoNormalizedIdentity) {
          return {
            createQueryBuilder: vi.fn().mockReturnValue(identityQb),
            update: identityUpdate,
          };
        }
        if (entity === User) return { findOne: userFindOne };
        throw new Error('Unexpected repository');
      },
    };
    (getDataSource as unknown as Mock).mockResolvedValue(dataSource);
    (ssoProviderIdentityCheckService.refreshClaims as unknown as Mock)
      .mockResolvedValueOnce({
        status: 'refreshed',
        reason: 'Microsoft Graph member groups refreshed',
        checkedAt: 2500,
        claims: {
          email: 'refresh@example.com',
          groups: ['group-a', 'group-b'],
          roles: ['deployer'],
        },
        details: { groupsCount: 2, preservedRolesCount: 1 },
      })
      .mockResolvedValueOnce({
        status: 'unknown',
        reason: 'Microsoft Graph member groups refresh failed with HTTP 429',
        checkedAt: 2600,
        details: { status: 429 },
      });
    (ssoGroupMappingService.syncMembershipsForUserWithManager as unknown as Mock).mockResolvedValue({
      created: 1,
      updated: 0,
      removed: 1,
    });
    (ssoAssignmentMappingService.syncAssignmentsForUserWithManager as unknown as Mock).mockResolvedValue({
      created: 0,
      updated: 1,
      removed: 0,
    });

    const result = await ssoSyncDiagnosticsService.runSnapshotReconciliation({
      tenantId: 'tenant-a',
      providerId: 'microsoft',
      refreshProviderClaims: true,
      trigger: 'scheduled',
      details: { source: 'test' },
    });

    expect(result).toMatchObject({
      scannedIdentities: 2,
      replayedIdentities: 1,
      skippedIdentities: 1,
      refreshedIdentities: 1,
      refreshFailedIdentities: 1,
      groupMembershipsCreated: 1,
      groupMembershipsRemoved: 1,
      assignmentsUpdated: 1,
    });
    expect(identityUpdate).toHaveBeenCalledWith({ id: 'identity-refresh' }, expect.objectContaining({
      groupsJson: JSON.stringify(['group-a', 'group-b']),
      rolesJson: JSON.stringify(['deployer']),
      claimsJson: JSON.stringify({
        email: 'refresh@example.com',
        groups: ['group-a', 'group-b'],
        roles: ['deployer'],
      }),
      lastProviderCheckAt: 2500,
    }));
    expect(ssoGroupMappingService.syncMembershipsForUserWithManager).toHaveBeenCalledWith(
      { tx: true },
      'user-refresh',
      expect.objectContaining({ groups: ['group-a', 'group-b'], roles: ['deployer'] }),
      'microsoft',
      'tenant-a',
    );
    expect(ssoGroupMappingService.syncMembershipsForUserWithManager).toHaveBeenCalledTimes(1);
    const eventTypes = eventInsert.mock.calls.map(([event]) => event.type);
    expect(eventTypes).toEqual(expect.arrayContaining([
      'sso_snapshot_reconciliation.identity_claims_refreshed',
      'sso_snapshot_reconciliation.identity_claim_refresh_failed',
      'sso_snapshot_reconciliation.identity_replayed',
    ]));
  });

  it('checks active normalized SSO identities against provider status and records diagnostics', async () => {
    const runInsert = vi.fn().mockResolvedValue(undefined);
    const runUpdate = vi.fn().mockResolvedValue(undefined);
    const eventInsert = vi.fn().mockResolvedValue(undefined);
    const identityUpdate = vi.fn().mockResolvedValue(undefined);
    const identityQb: any = {};
    identityQb.where = vi.fn(() => identityQb);
    identityQb.orderBy = vi.fn(() => identityQb);
    identityQb.addOrderBy = vi.fn(() => identityQb);
    identityQb.take = vi.fn(() => identityQb);
    identityQb.andWhere = vi.fn(() => identityQb);
    identityQb.getMany = vi.fn().mockResolvedValue([
      {
        id: 'identity-active',
        tenantId: 'tenant-a',
        providerId: 'microsoft',
        providerType: 'microsoft',
        providerSubject: 'subject-active',
        subjectClaim: 'oid',
        userId: 'user-active',
        email: 'old@example.com',
        displayName: 'Old Name',
        firstName: null,
        lastName: null,
      },
      {
        id: 'identity-inactive',
        tenantId: 'tenant-a',
        providerId: 'microsoft',
        providerType: 'microsoft',
        providerSubject: 'subject-inactive',
        subjectClaim: 'oid',
        userId: 'user-inactive',
      },
      {
        id: 'identity-deleted',
        tenantId: 'tenant-a',
        providerId: 'microsoft',
        providerType: 'microsoft',
        providerSubject: 'subject-deleted',
        subjectClaim: 'oid',
        userId: 'user-deleted',
      },
      {
        id: 'identity-unknown',
        tenantId: 'tenant-a',
        providerId: 'microsoft',
        providerType: 'microsoft',
        providerSubject: 'subject-unknown',
        subjectClaim: 'oid',
        userId: 'user-unknown',
      },
      {
        id: 'identity-unsupported',
        tenantId: 'tenant-a',
        providerId: 'saml-provider',
        providerType: 'saml',
        providerSubject: 'subject-unsupported',
        subjectClaim: 'nameID',
        userId: 'user-unsupported',
      },
      {
        id: 'identity-failed',
        tenantId: 'tenant-a',
        providerId: 'microsoft',
        providerType: 'microsoft',
        providerSubject: 'subject-failed',
        subjectClaim: 'oid',
        userId: 'user-failed',
      },
    ]);
    const dataSource = {
      getRepository: (entity: unknown) => {
        if (entity === SsoSyncRun) return { insert: runInsert, update: runUpdate };
        if (entity === SsoSyncEvent) return { insert: eventInsert };
        if (entity === SsoNormalizedIdentity) {
          return {
            createQueryBuilder: vi.fn().mockReturnValue(identityQb),
            update: identityUpdate,
          };
        }
        throw new Error('Unexpected repository');
      },
    };
    (getDataSource as unknown as Mock).mockResolvedValue(dataSource);
    (ssoProviderIdentityCheckService.checkIdentity as unknown as Mock)
      .mockResolvedValueOnce({
        status: 'active',
        reason: 'Microsoft Graph user is active',
        checkedAt: 2000,
        profile: {
          email: 'new@example.com',
          displayName: 'New Name',
          firstName: 'New',
          lastName: 'Name',
        },
      })
      .mockResolvedValueOnce({
        status: 'inactive',
        reason: 'Microsoft Graph user is disabled',
        checkedAt: 2100,
      })
      .mockResolvedValueOnce({
        status: 'deleted',
        reason: 'Microsoft Graph user lookup returned 404',
        checkedAt: 2200,
      })
      .mockResolvedValueOnce({
        status: 'unknown',
        reason: 'Microsoft Graph user lookup failed with HTTP 429',
        checkedAt: 2300,
        details: { status: 429 },
      })
      .mockResolvedValueOnce({
        status: 'unsupported',
        reason: 'Provider type saml does not support live identity checks yet',
        checkedAt: 2400,
      })
      .mockRejectedValueOnce(new Error('Graph unavailable'));

    const result = await ssoSyncDiagnosticsService.runProviderIdentityCheck({
      tenantId: 'tenant-a',
      providerId: 'microsoft',
      trigger: 'scheduled',
      details: { source: 'test' },
    });

    expect(identityQb.where).toHaveBeenCalledWith('identity.providerStatus = :providerStatus', { providerStatus: 'active' });
    expect(identityQb.andWhere).toHaveBeenCalledWith('(identity.tenantId = :tenantId OR identity.tenantId IS NULL)', { tenantId: 'tenant-a' });
    expect(identityQb.andWhere).toHaveBeenCalledWith('identity.providerId = :providerId', { providerId: 'microsoft' });
    expect(result).toMatchObject({
      scannedIdentities: 6,
      checkedIdentities: 4,
      unsupportedIdentities: 1,
      activeIdentities: 1,
      inactiveIdentities: 1,
      deletedIdentities: 1,
      unknownIdentities: 1,
      failedIdentities: 1,
    });
    expect(identityUpdate).toHaveBeenCalledWith({ id: 'identity-active' }, expect.objectContaining({
      providerStatus: 'active',
      lastProviderCheckAt: 2000,
      email: 'new@example.com',
      displayName: 'New Name',
      firstName: 'New',
      lastName: 'Name',
    }));
    expect(identityUpdate).toHaveBeenCalledWith({ id: 'identity-inactive' }, expect.objectContaining({
      providerStatus: 'inactive',
      lastProviderCheckAt: 2100,
    }));
    expect(identityUpdate).toHaveBeenCalledWith({ id: 'identity-deleted' }, expect.objectContaining({
      providerStatus: 'deleted',
      lastProviderCheckAt: 2200,
    }));
    expect(identityUpdate).toHaveBeenCalledWith({ id: 'identity-unknown' }, expect.objectContaining({
      lastProviderCheckAt: 2300,
    }));
    expect(identityUpdate).not.toHaveBeenCalledWith({ id: 'identity-unsupported' }, expect.anything());
    expect(runUpdate).toHaveBeenCalledWith({ id: result.runId }, expect.objectContaining({
      status: 'success',
      details: expect.stringContaining('sso_provider_identity_check'),
    }));
    const eventTypes = eventInsert.mock.calls.map(([event]) => event.type);
    expect(eventTypes).toEqual(expect.arrayContaining([
      'sso_provider_identity_check.identity_active',
      'sso_provider_identity_check.identity_inactive',
      'sso_provider_identity_check.identity_deleted',
      'sso_provider_identity_check.identity_unknown',
      'sso_provider_identity_check.identity_unsupported',
      'sso_provider_identity_check.identity_failed',
    ]));
  });

  it('runs non-destructive reconciliation diagnostics for stale SSO mappings and assignments', async () => {
    const runInsert = vi.fn().mockResolvedValue(undefined);
    const runUpdate = vi.fn().mockResolvedValue(undefined);
    const eventInsert = vi.fn().mockResolvedValue(undefined);

    const groupMappings = [
      {
        id: 'group-mapping-missing',
        tenantId: 'tenant-a',
        providerId: 'microsoft',
        claimType: 'group',
        claimKey: 'groups',
        claimValue: 'Ops',
        targetGroupId: 'group-missing',
        syncMode: 'authoritative',
        priority: 0,
        isActive: true,
      },
      {
        id: 'group-mapping-provider-deleted',
        tenantId: 'tenant-a',
        providerId: 'microsoft',
        claimType: 'group',
        claimKey: 'groups',
        claimValue: '00000000-0000-0000-0000-000000000123',
        targetGroupId: 'group-existing',
        syncMode: 'authoritative',
        priority: 1,
        isActive: true,
      },
    ];
    const memberships = [
      {
        id: 'membership-stale',
        tenantId: 'tenant-a',
        groupId: 'group-existing',
        userId: 'user-1',
        source: 'sso',
        sourceRef: 'group-mapping-deleted',
      },
    ];
    const groups = [
      {
        id: 'group-existing',
        tenantId: 'tenant-a',
        key: 'ops',
        name: 'Operations',
        isArchived: false,
      },
    ];
    const assignmentMappings = [
      {
        id: 'assignment-mapping-label',
        tenantId: 'tenant-a',
        providerId: 'microsoft',
        claimType: 'group',
        claimKey: 'groups',
        claimValue: 'QA',
        targetScope: 'engine',
        targetSelectorType: 'engine_label',
        targetEngineId: null,
        targetExternalEngineId: null,
        targetLabelKey: 'environment',
        targetLabelValue: 'qa',
        targetRoleId: 'system.engine.operator',
        syncMode: 'authoritative',
        priority: 0,
        isActive: true,
      },
      {
        id: 'assignment-mapping-engine',
        tenantId: 'tenant-a',
        providerId: 'microsoft',
        claimType: 'group',
        claimKey: 'groups',
        claimValue: 'Old',
        targetScope: 'engine',
        targetSelectorType: 'engine_id',
        targetEngineId: 'engine-decommissioned',
        targetExternalEngineId: null,
        targetLabelKey: null,
        targetLabelValue: null,
        targetRoleId: 'system.engine.deployer',
        syncMode: 'authoritative',
        priority: 1,
        isActive: true,
      },
    ];
    const assignments = [
      {
        id: 'assignment-stale',
        tenantId: 'tenant-a',
        userId: 'user-1',
        principalType: 'user',
        principalId: 'user-1',
        roleId: 'system.engine.operator',
        resourceType: 'engine',
        resourceId: 'engine-missing',
        scopeType: 'engine',
        scopeId: 'engine-missing',
        source: 'sso',
        sourceMappingId: 'assignment-mapping-deleted',
        sourceRef: null,
      },
      {
        id: 'assignment-decommissioned',
        tenantId: 'tenant-a',
        userId: 'user-2',
        principalType: 'user',
        principalId: 'user-2',
        roleId: 'system.engine.deployer',
        resourceType: 'engine',
        resourceId: 'engine-decommissioned',
        scopeType: 'engine',
        scopeId: 'engine-decommissioned',
        source: 'sso',
        sourceMappingId: 'assignment-mapping-engine',
        sourceRef: null,
      },
    ];
    const engines = [
      {
        id: 'engine-decommissioned',
        tenantId: 'tenant-a',
        externalId: 'cluster-a/old',
        labelsJson: JSON.stringify({ environment: 'old' }),
        lifecycleStatus: 'decommissioned',
      },
    ];

    const dataSource = {
      getRepository: (entity: unknown) => {
        if (entity === SsoSyncRun) return { insert: runInsert, update: runUpdate };
        if (entity === SsoSyncEvent) return { insert: eventInsert };
        if (entity === SsoGroupMapping) return { find: vi.fn().mockResolvedValue(groupMappings) };
        if (entity === AuthzGroupMembership) return { find: vi.fn().mockResolvedValue(memberships) };
        if (entity === AuthzGroup) return { find: vi.fn().mockResolvedValue(groups) };
        if (entity === SsoAssignmentMapping) return { find: vi.fn().mockResolvedValue(assignmentMappings) };
        if (entity === RbacRoleAssignment) return { find: vi.fn().mockResolvedValue(assignments) };
        if (entity === Engine) return { find: vi.fn().mockResolvedValue(engines) };
        if (entity === ExternalEngineRegistration) return { find: vi.fn().mockResolvedValue([]) };
        throw new Error('Unexpected repository');
      },
    };
    (getDataSource as unknown as Mock).mockResolvedValue(dataSource);
    (ssoProviderIdentityCheckService.checkGroup as unknown as Mock)
      .mockResolvedValueOnce({
        status: 'active',
        reason: 'Microsoft Graph group exists',
        checkedAt: 1000,
      })
      .mockResolvedValueOnce({
        status: 'deleted',
        reason: 'Microsoft Graph group lookup returned 404',
        checkedAt: 2000,
        details: { id: '00000000-0000-0000-0000-000000000123' },
      });

    const result = await ssoSyncDiagnosticsService.runReconciliationDiagnostics({
      tenantId: 'tenant-a',
      trigger: 'manual',
      details: { actorUserId: 'admin-1' },
    });

    expect(result).toMatchObject({
      scannedGroupMappings: 2,
      scannedAssignmentMappings: 2,
      scannedGroupMemberships: 1,
      scannedAssignments: 2,
      errors: 0,
    });
    expect(result.warnings).toBeGreaterThanOrEqual(5);
    const eventTypes = eventInsert.mock.calls.map(([event]) => event.type);
    expect(eventTypes).toEqual(expect.arrayContaining([
      'sso_group_mapping.target_group_missing',
      'sso_group_mapping.provider_group_deleted',
      'sso_group_membership.mapping_missing',
      'sso_assignment_mapping.engine_label_no_matches',
      'sso_assignment_mapping.target_engine_decommissioned',
      'sso_assignment.mapping_missing',
      'sso_assignment.engine_missing',
      'sso_assignment.engine_decommissioned',
    ]));
    expect(ssoProviderIdentityCheckService.checkGroup).toHaveBeenCalledWith({
      providerId: 'microsoft',
      groupClaimValue: 'Ops',
    });
    expect(ssoProviderIdentityCheckService.checkGroup).toHaveBeenCalledWith({
      providerId: 'microsoft',
      groupClaimValue: '00000000-0000-0000-0000-000000000123',
    });
    expect(runUpdate).toHaveBeenCalledWith({ id: result.runId }, expect.objectContaining({
      status: 'success',
      details: expect.stringContaining('sso_reconciliation_diagnostics'),
    }));
  });

  it('removes only stale SSO-owned rows during reconciliation cleanup', async () => {
    const runInsert = vi.fn().mockResolvedValue(undefined);
    const runUpdate = vi.fn().mockResolvedValue(undefined);
    const eventInsert = vi.fn().mockResolvedValue(undefined);
    const membershipDelete = vi.fn().mockResolvedValue(undefined);
    const assignmentDelete = vi.fn().mockResolvedValue(undefined);

    const groupMappings = [
      {
        id: 'group-mapping-active-ms',
        tenantId: 'tenant-a',
        providerId: 'microsoft',
        targetGroupId: 'group-existing',
        isActive: true,
      },
      {
        id: 'group-mapping-active-google',
        tenantId: 'tenant-a',
        providerId: 'google',
        targetGroupId: 'group-existing',
        isActive: true,
      },
      {
        id: 'group-mapping-inactive',
        tenantId: 'tenant-a',
        providerId: 'microsoft',
        targetGroupId: 'group-existing',
        isActive: false,
      },
    ];
    const memberships = [
      {
        id: 'membership-missing-mapping',
        tenantId: 'tenant-a',
        groupId: 'group-existing',
        userId: 'user-1',
        source: 'sso',
        sourceRef: 'group-mapping-deleted',
      },
      {
        id: 'membership-inactive-mapping',
        tenantId: 'tenant-a',
        groupId: 'group-existing',
        userId: 'user-2',
        source: 'sso',
        sourceRef: 'group-mapping-inactive',
      },
      {
        id: 'membership-provider-deleted',
        tenantId: 'tenant-a',
        groupId: 'group-existing',
        userId: 'user-6',
        source: 'sso',
        sourceRef: 'group-mapping-active-ms',
      },
      {
        id: 'membership-other-provider',
        tenantId: 'tenant-a',
        groupId: 'group-existing',
        userId: 'user-6',
        source: 'sso',
        sourceRef: 'group-mapping-active-google',
      },
    ];
    const groups = [
      {
        id: 'group-existing',
        tenantId: 'tenant-a',
        key: 'ops',
        name: 'Operations',
        isArchived: false,
      },
    ];
    const assignmentMappings = [
      {
        id: 'assignment-mapping-inactive',
        tenantId: 'tenant-a',
        providerId: 'microsoft',
        targetSelectorType: 'engine_id',
        targetEngineId: 'engine-1',
        targetExternalEngineId: null,
        targetLabelKey: null,
        targetLabelValue: null,
        syncMode: 'authoritative',
        isActive: false,
      },
      {
        id: 'assignment-mapping-label',
        tenantId: 'tenant-a',
        providerId: 'microsoft',
        targetSelectorType: 'engine_label',
        targetEngineId: null,
        targetExternalEngineId: null,
        targetLabelKey: 'environment',
        targetLabelValue: 'prod',
        syncMode: 'authoritative',
        isActive: true,
      },
      {
        id: 'assignment-mapping-additive',
        tenantId: 'tenant-a',
        providerId: 'microsoft',
        targetSelectorType: 'engine_label',
        targetEngineId: null,
        targetExternalEngineId: null,
        targetLabelKey: 'environment',
        targetLabelValue: 'prod',
        syncMode: 'additive',
        isActive: true,
      },
      {
        id: 'assignment-mapping-active-ms',
        tenantId: 'tenant-a',
        providerId: 'microsoft',
        targetSelectorType: 'engine_id',
        targetEngineId: 'engine-1',
        targetExternalEngineId: null,
        targetLabelKey: null,
        targetLabelValue: null,
        syncMode: 'authoritative',
        isActive: true,
      },
      {
        id: 'assignment-mapping-active-google',
        tenantId: 'tenant-a',
        providerId: 'google',
        targetSelectorType: 'engine_id',
        targetEngineId: 'engine-1',
        targetExternalEngineId: null,
        targetLabelKey: null,
        targetLabelValue: null,
        syncMode: 'authoritative',
        isActive: true,
      },
    ];
    const assignments = [
      {
        id: 'assignment-missing-mapping',
        tenantId: 'tenant-a',
        userId: 'user-1',
        roleId: 'system.engine.operator',
        resourceType: 'engine',
        resourceId: 'engine-1',
        source: 'sso',
        sourceMappingId: 'assignment-mapping-deleted',
        sourceRef: null,
      },
      {
        id: 'assignment-inactive-mapping',
        tenantId: 'tenant-a',
        userId: 'user-2',
        roleId: 'system.engine.operator',
        resourceType: 'engine',
        resourceId: 'engine-1',
        source: 'sso',
        sourceMappingId: 'assignment-mapping-inactive',
        sourceRef: null,
      },
      {
        id: 'assignment-target-moved',
        tenantId: 'tenant-a',
        userId: 'user-3',
        roleId: 'system.engine.operator',
        resourceType: 'engine',
        resourceId: 'engine-2',
        source: 'sso',
        sourceMappingId: 'assignment-mapping-label',
        sourceRef: null,
      },
      {
        id: 'assignment-additive-history',
        tenantId: 'tenant-a',
        userId: 'user-4',
        roleId: 'system.engine.operator',
        resourceType: 'engine',
        resourceId: 'engine-2',
        source: 'sso',
        sourceMappingId: 'assignment-mapping-additive',
        sourceRef: null,
      },
      {
        id: 'assignment-decommissioned-engine',
        tenantId: 'tenant-a',
        userId: 'user-5',
        roleId: 'system.engine.operator',
        resourceType: 'engine',
        resourceId: 'engine-decommissioned',
        source: 'sso',
        sourceMappingId: 'assignment-mapping-label',
        sourceRef: null,
      },
      {
        id: 'assignment-provider-inactive',
        tenantId: 'tenant-a',
        userId: 'user-7',
        roleId: 'system.engine.operator',
        resourceType: 'engine',
        resourceId: 'engine-1',
        source: 'sso',
        sourceMappingId: 'assignment-mapping-active-ms',
        sourceRef: null,
      },
      {
        id: 'assignment-other-provider',
        tenantId: 'tenant-a',
        userId: 'user-7',
        roleId: 'system.engine.operator',
        resourceType: 'engine',
        resourceId: 'engine-1',
        source: 'sso',
        sourceMappingId: 'assignment-mapping-active-google',
        sourceRef: null,
      },
    ];
    const engines = [
      {
        id: 'engine-1',
        tenantId: 'tenant-a',
        externalId: null,
        labelsJson: JSON.stringify({ environment: 'prod' }),
        lifecycleStatus: 'active',
      },
      {
        id: 'engine-2',
        tenantId: 'tenant-a',
        externalId: null,
        labelsJson: JSON.stringify({ environment: 'qa' }),
        lifecycleStatus: 'active',
      },
      {
        id: 'engine-decommissioned',
        tenantId: 'tenant-a',
        externalId: null,
        labelsJson: JSON.stringify({ environment: 'prod' }),
        lifecycleStatus: 'decommissioned',
      },
    ];
	    const providerStatusIdentities = [
      {
        id: 'identity-deleted',
        tenantId: 'tenant-a',
        providerId: 'microsoft',
        userId: 'user-6',
        providerStatus: 'deleted',
      },
      {
        id: 'identity-inactive',
        tenantId: 'tenant-a',
        providerId: 'microsoft',
        userId: 'user-7',
        providerStatus: 'inactive',
	      },
	    ];
	    const snapshotRepo = createSnapshotRepositoryMock();

	    const dataSource = {
	      getRepository: (entity: unknown) => {
        if (entity === SsoSyncRun) return { insert: runInsert, update: runUpdate };
        if (entity === SsoSyncEvent) return { insert: eventInsert };
        if (entity === SsoGroupMapping) return { find: vi.fn().mockResolvedValue(groupMappings) };
        if (entity === AuthzGroupMembership) return { find: vi.fn().mockResolvedValue(memberships), delete: membershipDelete };
        if (entity === AuthzGroup) return { find: vi.fn().mockResolvedValue(groups) };
        if (entity === SsoAssignmentMapping) return { find: vi.fn().mockResolvedValue(assignmentMappings) };
        if (entity === RbacRoleAssignment) return { find: vi.fn().mockResolvedValue(assignments), delete: assignmentDelete };
	        if (entity === Engine) return { find: vi.fn().mockResolvedValue(engines) };
	        if (entity === ExternalEngineRegistration) return { find: vi.fn().mockResolvedValue([]) };
	        if (entity === SsoNormalizedIdentity) return { find: vi.fn().mockResolvedValue(providerStatusIdentities) };
	        if (entity === SsoEngineAccessSnapshot) return snapshotRepo;
	        throw new Error('Unexpected repository');
	      },
	    };
    (getDataSource as unknown as Mock).mockResolvedValue(dataSource);

    const result = await ssoSyncDiagnosticsService.runReconciliationCleanup({
      tenantId: 'tenant-a',
      trigger: 'scheduled',
      details: { source: 'test' },
    });

    expect(result).toMatchObject({
      scannedGroupMemberships: 4,
      scannedAssignments: 7,
      groupMembershipsRemoved: 3,
      assignmentsRemoved: 5,
    });
    expect(membershipDelete).toHaveBeenCalledWith({ id: 'membership-missing-mapping' });
    expect(membershipDelete).toHaveBeenCalledWith({ id: 'membership-inactive-mapping' });
    expect(membershipDelete).toHaveBeenCalledWith({ id: 'membership-provider-deleted' });
    expect(membershipDelete).not.toHaveBeenCalledWith({ id: 'membership-other-provider' });
    expect(assignmentDelete).toHaveBeenCalledWith({ id: 'assignment-missing-mapping' });
    expect(assignmentDelete).toHaveBeenCalledWith({ id: 'assignment-inactive-mapping' });
    expect(assignmentDelete).toHaveBeenCalledWith({ id: 'assignment-target-moved' });
    expect(assignmentDelete).toHaveBeenCalledWith({ id: 'assignment-decommissioned-engine' });
    expect(assignmentDelete).toHaveBeenCalledWith({ id: 'assignment-provider-inactive' });
    expect(assignmentDelete).not.toHaveBeenCalledWith({ id: 'assignment-additive-history' });
    expect(assignmentDelete).not.toHaveBeenCalledWith({ id: 'assignment-other-provider' });
    expect(runUpdate).toHaveBeenCalledWith({ id: result.runId }, expect.objectContaining({
      status: 'success',
      groupMembershipsRemoved: 3,
      assignmentsRemoved: 5,
      details: expect.stringContaining('sso_reconciliation_cleanup'),
    }));
    const eventTypes = eventInsert.mock.calls.map(([event]) => event.type);
    expect(eventTypes.filter((type) => type === 'sso_group_membership.cleanup_removed')).toHaveLength(3);
    expect(eventTypes.filter((type) => type === 'sso_assignment.cleanup_removed')).toHaveLength(5);
    const eventDetails = eventInsert.mock.calls.map(([event]) => event.details);
    expect(eventDetails).toEqual(expect.arrayContaining([
      expect.stringContaining('provider_identity_deleted'),
      expect.stringContaining('provider_identity_inactive'),
    ]));
  });

  it('removes SSO-managed assignments when a high-risk mapping platform setting is disabled', async () => {
    const runInsert = vi.fn().mockResolvedValue(undefined);
    const runUpdate = vi.fn().mockResolvedValue(undefined);
    const eventInsert = vi.fn().mockResolvedValue(undefined);
    const assignmentDelete = vi.fn().mockResolvedValue(undefined);
    const assignmentMappings = [
      {
        id: 'assignment-mapping-sensitive',
        tenantId: 'tenant-a',
        providerId: 'microsoft',
        targetSelectorType: 'engine_id',
        targetEngineId: 'engine-1',
        targetExternalEngineId: null,
        targetLabelKey: null,
        targetLabelValue: null,
        targetRoleId: 'custom.engine.audit-reader',
        syncMode: 'additive',
        isActive: true,
      },
    ];
	    const assignments = [
      {
        id: 'assignment-sensitive',
        tenantId: 'tenant-a',
        userId: 'user-sensitive',
        roleId: 'custom.engine.audit-reader',
        resourceType: 'engine',
        resourceId: 'engine-1',
        source: 'sso',
        sourceMappingId: 'assignment-mapping-sensitive',
        sourceRef: null,
	      },
	    ];
	    const snapshotRepo = createSnapshotRepositoryMock();
	    const dataSource = {
	      getRepository: (entity: unknown) => {
        if (entity === SsoSyncRun) return { insert: runInsert, update: runUpdate };
        if (entity === SsoSyncEvent) return { insert: eventInsert };
        if (entity === SsoGroupMapping) return { find: vi.fn().mockResolvedValue([]) };
        if (entity === AuthzGroupMembership) return { find: vi.fn().mockResolvedValue([]), delete: vi.fn() };
        if (entity === AuthzGroup) return { find: vi.fn().mockResolvedValue([]) };
        if (entity === SsoAssignmentMapping) return { find: vi.fn().mockResolvedValue(assignmentMappings) };
        if (entity === RbacRoleAssignment) return { find: vi.fn().mockResolvedValue(assignments), delete: assignmentDelete };
        if (entity === Engine) return {
          find: vi.fn().mockResolvedValue([
            {
              id: 'engine-1',
              tenantId: 'tenant-a',
              externalId: null,
              labelsJson: null,
              lifecycleStatus: 'active',
            },
          ]),
	        };
	        if (entity === ExternalEngineRegistration) return { find: vi.fn().mockResolvedValue([]) };
	        if (entity === SsoNormalizedIdentity) return { find: vi.fn().mockResolvedValue([]) };
	        if (entity === SsoEngineAccessSnapshot) return snapshotRepo;
	        throw new Error('Unexpected repository');
	      },
	    };
    (getDataSource as unknown as Mock).mockResolvedValue(dataSource);
    (ssoAssignmentMappingService.getDisabledPlatformRiskReasonsForMapping as unknown as Mock).mockResolvedValue([
      'unredacted_audit_permission',
    ]);

    const result = await ssoSyncDiagnosticsService.runReconciliationCleanup({
      tenantId: 'tenant-a',
      trigger: 'scheduled',
    });

    expect(result).toMatchObject({
      scannedGroupMemberships: 0,
      scannedAssignments: 1,
      groupMembershipsRemoved: 0,
      assignmentsRemoved: 1,
    });
    expect(assignmentDelete).toHaveBeenCalledWith({ id: 'assignment-sensitive' });
    const eventDetails = eventInsert.mock.calls.map(([event]) => event.details);
    expect(eventDetails).toEqual(expect.arrayContaining([
      expect.stringContaining('platform_setting_disabled'),
      expect.stringContaining('unredacted_audit_permission'),
    ]));
  });
});

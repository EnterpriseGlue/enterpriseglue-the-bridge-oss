import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuthzGroup } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroup.js';
import { AuthzGroupMembership } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroupMembership.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { ExternalEngineRegistration } from '@enterpriseglue/shared/infrastructure/persistence/entities/ExternalEngineRegistration.js';
import { RbacRoleAssignment } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRoleAssignment.js';
import { SsoAssignmentMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/SsoAssignmentMapping.js';
import { SsoSyncEvent } from '@enterpriseglue/shared/infrastructure/persistence/entities/SsoSyncEvent.js';
import { SsoSyncRun } from '@enterpriseglue/shared/infrastructure/persistence/entities/SsoSyncRun.js';
import { SsoGroupMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/SsoGroupMapping.js';
import { SsoNormalizedIdentity } from '@enterpriseglue/shared/infrastructure/persistence/entities/SsoNormalizedIdentity.js';
import { allowlistedIdentityClaims } from './SsoNormalizedIdentityService.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { In, IsNull } from 'typeorm';
import { ssoAssignmentMappingService } from './SsoAssignmentMappingService.js';
import { ssoEngineAccessSnapshotService, type SsoEngineAccessSnapshotStatus } from './SsoEngineAccessSnapshotService.js';
import { ssoGroupMappingService } from './SsoGroupMappingService.js';
import { ssoProviderIdentityCheckService } from './SsoProviderIdentityCheckService.js';
import type { SsoClaims } from './SsoClaimsMappingService.js';

export type SsoSyncRunStatus = 'running' | 'success' | 'failed';
export type SsoSyncTrigger = 'login' | 'scheduled' | 'manual' | 'mapping_change' | 'engine_change';

export interface SsoSyncCounts {
  groupMembershipsCreated?: number;
  groupMembershipsUpdated?: number;
  groupMembershipsRemoved?: number;
  assignmentsCreated?: number;
  assignmentsUpdated?: number;
  assignmentsRemoved?: number;
}

export interface StartSsoSyncRunInput {
  tenantId?: string | null;
  providerId?: string | null;
  userId?: string | null;
  trigger: SsoSyncTrigger;
  details?: Record<string, unknown>;
}

export interface CompleteSsoSyncRunInput extends SsoSyncCounts {
  tenantId?: string | null;
  providerId?: string | null;
  userId?: string | null;
  details?: Record<string, unknown>;
}

export interface SsoSyncRunView {
  id: string;
  tenantId: string | null;
  providerId: string | null;
  userId: string | null;
  trigger: SsoSyncTrigger;
  status: SsoSyncRunStatus;
  startedAt: number;
  completedAt: number | null;
  groupMembershipsCreated: number;
  groupMembershipsUpdated: number;
  groupMembershipsRemoved: number;
  assignmentsCreated: number;
  assignmentsUpdated: number;
  assignmentsRemoved: number;
  errorCode: string | null;
  errorMessage: string | null;
  details: string;
}

export interface SsoSyncEventView {
  id: string;
  tenantId: string | null;
  providerId: string | null;
  runId: string;
  severity: 'info' | 'warning' | 'error';
  type: string;
  userId: string | null;
  mappingType: string | null;
  mappingId: string | null;
  resourceType: string | null;
  resourceId: string | null;
  message: string;
  details: string;
  createdAt: number;
}

export interface ListSsoSyncRunsInput {
  tenantId?: string | null;
  providerId?: string | null;
  userId?: string | null;
  status?: SsoSyncRunStatus;
  trigger?: SsoSyncTrigger;
  limit?: number;
}

export interface ListSsoSyncEventsInput {
  tenantId?: string | null;
  providerId?: string | null;
  runId: string;
  severity?: 'info' | 'warning' | 'error';
  limit?: number;
}

export interface RunSsoSyncDiagnosticsInput {
  tenantId?: string | null;
  providerId?: string | null;
  trigger?: Extract<SsoSyncTrigger, 'scheduled' | 'manual' | 'mapping_change' | 'engine_change'>;
  details?: Record<string, unknown>;
}

export interface RunSsoSnapshotReconciliationInput extends RunSsoSyncDiagnosticsInput {
  limit?: number;
  refreshProviderClaims?: boolean;
}

export interface RunSsoProviderIdentityCheckInput extends RunSsoSyncDiagnosticsInput {
  limit?: number;
}

export interface SsoSyncDiagnosticsScanResult {
  runId: string | null;
  scannedGroupMappings: number;
  scannedAssignmentMappings: number;
  scannedGroupMemberships: number;
  scannedAssignments: number;
  warnings: number;
  errors: number;
}

export interface SsoSyncCleanupResult {
  runId: string | null;
  scannedGroupMemberships: number;
  scannedAssignments: number;
  groupMembershipsRemoved: number;
  assignmentsRemoved: number;
}

export interface SsoSnapshotReconciliationResult extends SsoSyncCounts {
  runId: string | null;
  scannedIdentities: number;
  replayedIdentities: number;
  skippedIdentities: number;
  failedIdentities: number;
  refreshedIdentities?: number;
  refreshUnsupportedIdentities?: number;
  refreshFailedIdentities?: number;
  groupMembershipsCreated: number;
  groupMembershipsUpdated: number;
  groupMembershipsRemoved: number;
  assignmentsCreated: number;
  assignmentsUpdated: number;
  assignmentsRemoved: number;
}

export interface SsoProviderIdentityCheckRunResult {
  runId: string | null;
  scannedIdentities: number;
  checkedIdentities: number;
  unsupportedIdentities: number;
  activeIdentities: number;
  inactiveIdentities: number;
  deletedIdentities: number;
  unknownIdentities: number;
  failedIdentities: number;
}

function normalizeTenantId(tenantId?: string | null): string | null {
  const normalized = tenantId?.trim();
  return normalized || null;
}

function normalizeProviderId(providerId?: string | null): string | null {
  const normalized = providerId?.trim();
  return normalized || null;
}

function tenantScopedWhere<T extends Record<string, unknown>>(tenantId: string | null, where: T): T | Array<T & { tenantId: unknown }> {
  if (tenantId) {
    return [
      { ...where, tenantId },
      { ...where, tenantId: IsNull() },
    ];
  }
  return { ...where, tenantId: IsNull() };
}

function providerMatches(providerId: string | null, mappingProviderId: string | null | undefined): boolean {
  if (!providerId) return true;
  return !mappingProviderId || mappingProviderId === providerId;
}

function stringifyDetails(details?: Record<string, unknown>): string {
  if (!details || Object.keys(details).length === 0) return '{}';
  try {
    return JSON.stringify(details);
  } catch {
    return '{}';
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown SSO sync error';
}

function parseLabels(labelsJson: string | null | undefined): Record<string, string> {
  if (!labelsJson) return {};
  try {
    const parsed = JSON.parse(labelsJson);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    );
  } catch {
    return {};
  }
}

function isDecommissionedEngine(engine: Engine | undefined): boolean {
  return engine?.lifecycleStatus === 'decommissioned';
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function sourceMappingId(sourceMappingId: string | null | undefined, sourceRef: string | null | undefined): string | null {
  if (sourceMappingId) return sourceMappingId;
  const normalizedSourceRef = sourceRef || '';
  const marker = ':mapping:';
  const markerIndex = normalizedSourceRef.lastIndexOf(marker);
  return markerIndex >= 0
    ? normalizedSourceRef.slice(markerIndex + marker.length) || null
    : normalizedSourceRef || null;
}

function assignmentUserId(assignment: Pick<RbacRoleAssignment, 'principalType' | 'principalId' | 'userId'>): string | null {
  return assignment.principalType === 'user'
    ? assignment.principalId || assignment.userId
    : assignment.userId;
}

function assignmentScope(assignment: Pick<RbacRoleAssignment, 'scopeType' | 'scopeId' | 'resourceType' | 'resourceId'>): { type: string | null; id: string | null } {
  return {
    type: assignment.scopeType || assignment.resourceType,
    id: assignment.scopeId ?? assignment.resourceId,
  };
}

function parseClaimsSnapshot(claimsJson: string | null | undefined): SsoClaims | null {
  if (!claimsJson) return null;
  try {
    const parsed = JSON.parse(claimsJson);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as SsoClaims;
  } catch {
    return null;
  }
}

function normalizeClaimArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item || '').trim()).filter(Boolean)));
}

function stringifyJsonValue(value: unknown, fallback: string): string {
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function providerUserKey(providerId: string | null | undefined, userId: string | null | undefined): string | null {
  if (!providerId || !userId) return null;
  return `${providerId}\u0000${userId}`;
}

function toRunView(run: SsoSyncRun): SsoSyncRunView {
  return {
    id: run.id,
    tenantId: run.tenantId,
    providerId: run.providerId,
    userId: run.userId,
    trigger: run.trigger as SsoSyncTrigger,
    status: run.status as SsoSyncRunStatus,
    startedAt: Number(run.startedAt),
    completedAt: run.completedAt === null ? null : Number(run.completedAt),
    groupMembershipsCreated: Number(run.groupMembershipsCreated),
    groupMembershipsUpdated: Number(run.groupMembershipsUpdated),
    groupMembershipsRemoved: Number(run.groupMembershipsRemoved),
    assignmentsCreated: Number(run.assignmentsCreated),
    assignmentsUpdated: Number(run.assignmentsUpdated),
    assignmentsRemoved: Number(run.assignmentsRemoved),
    errorCode: run.errorCode,
    errorMessage: run.errorMessage,
    details: run.details,
  };
}

function toEventView(event: SsoSyncEvent): SsoSyncEventView {
  return {
    id: event.id,
    tenantId: event.tenantId,
    providerId: event.providerId,
    runId: event.runId,
    severity: event.severity as SsoSyncEventView['severity'],
    type: event.type,
    userId: event.userId,
    mappingType: event.mappingType,
    mappingId: event.mappingId,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    message: event.message,
    details: event.details,
    createdAt: Number(event.createdAt),
  };
}

class SsoSyncDiagnosticsServiceClass {
  async listRuns(input: ListSsoSyncRunsInput = {}): Promise<SsoSyncRunView[]> {
    const dataSource = await getDataSource();
    const normalizedTenantId = normalizeTenantId(input.tenantId);
    const qb = dataSource.getRepository(SsoSyncRun).createQueryBuilder('run')
      .where('1 = 1')
      .orderBy('run.startedAt', 'DESC')
      .take(Math.min(Math.max(input.limit ?? 25, 1), 100));

    if (normalizedTenantId) {
      qb.andWhere('(run.tenantId = :tenantId OR run.tenantId IS NULL)', { tenantId: normalizedTenantId });
    } else {
      qb.andWhere('run.tenantId IS NULL');
    }
    if (input.providerId) {
      qb.andWhere('run.providerId = :providerId', { providerId: input.providerId });
    }
    if (input.userId) {
      qb.andWhere('run.userId = :userId', { userId: input.userId });
    }
    if (input.status) {
      qb.andWhere('run.status = :status', { status: input.status });
    }
    if (input.trigger) {
      qb.andWhere('run.trigger = :trigger', { trigger: input.trigger });
    }

    return (await qb.getMany()).map(toRunView);
  }

  async listEvents(input: ListSsoSyncEventsInput): Promise<SsoSyncEventView[]> {
    const dataSource = await getDataSource();
    const normalizedTenantId = normalizeTenantId(input.tenantId);
    const run = await dataSource.getRepository(SsoSyncRun).findOne({
      where: normalizedTenantId
        ? [
          { id: input.runId, tenantId: normalizedTenantId },
          { id: input.runId, tenantId: IsNull() },
        ]
        : { id: input.runId, tenantId: IsNull() },
      select: ['id', 'providerId'],
    });
    if (!run || (input.providerId && run.providerId !== input.providerId)) {
      return [];
    }

    const qb = dataSource.getRepository(SsoSyncEvent).createQueryBuilder('event')
      .where('event.runId = :runId', { runId: input.runId })
      .orderBy('event.createdAt', 'ASC')
      .take(Math.min(Math.max(input.limit ?? 50, 1), 200));

    if (normalizedTenantId) {
      qb.andWhere('(event.tenantId = :tenantId OR event.tenantId IS NULL)', { tenantId: normalizedTenantId });
    } else {
      qb.andWhere('event.tenantId IS NULL');
    }
    if (input.providerId) {
      qb.andWhere('event.providerId = :providerId', { providerId: input.providerId });
    }
    if (input.severity) {
      qb.andWhere('event.severity = :severity', { severity: input.severity });
    }

    return (await qb.getMany()).map(toEventView);
  }

  async runSnapshotReconciliation(input: RunSsoSnapshotReconciliationInput = {}): Promise<SsoSnapshotReconciliationResult> {
    const tenantId = normalizeTenantId(input.tenantId);
    const providerId = normalizeProviderId(input.providerId);
    const runId = await this.startRun({
      tenantId,
      providerId,
      trigger: input.trigger || 'scheduled',
      details: {
        kind: 'sso_snapshot_reconciliation',
        ...input.details,
      },
    });
    const result: SsoSnapshotReconciliationResult = {
      runId,
      scannedIdentities: 0,
      replayedIdentities: 0,
      skippedIdentities: 0,
      failedIdentities: 0,
      refreshedIdentities: 0,
      refreshUnsupportedIdentities: 0,
      refreshFailedIdentities: 0,
      groupMembershipsCreated: 0,
      groupMembershipsUpdated: 0,
      groupMembershipsRemoved: 0,
      assignmentsCreated: 0,
      assignmentsUpdated: 0,
      assignmentsRemoved: 0,
    };

    const recordReplayEvent = async (event: {
      severity: 'info' | 'warning' | 'error';
      type: string;
      message: string;
      userId?: string | null;
      resourceType?: string | null;
      resourceId?: string | null;
      details?: Record<string, unknown>;
    }) => {
      if (!runId) return;
      await this.recordEvent(runId, {
        tenantId,
        providerId,
        ...event,
      });
    };

    try {
      const dataSource = await getDataSource();
      const identityRepo = dataSource.getRepository(SsoNormalizedIdentity);
      const identityQb = identityRepo.createQueryBuilder('identity')
        .where('identity.providerStatus = :providerStatus', { providerStatus: 'active' })
        .orderBy('identity.lastSeenAt', 'ASC')
        .take(Math.min(Math.max(input.limit ?? 500, 1), 5000));

      if (tenantId) {
        identityQb.andWhere('(identity.tenantId = :tenantId OR identity.tenantId IS NULL)', { tenantId });
      } else {
        identityQb.andWhere('identity.tenantId IS NULL');
      }
      if (providerId) {
        identityQb.andWhere('identity.providerId = :providerId', { providerId });
      }

      const identities = await identityQb.getMany();
      result.scannedIdentities = identities.length;

      for (const identity of identities) {
        let claims = parseClaimsSnapshot(identity.claimsJson);
        if (!claims) {
          result.skippedIdentities += 1;
          await recordReplayEvent({
            severity: 'warning',
            type: 'sso_snapshot_reconciliation.identity_claims_invalid',
            userId: identity.userId,
            resourceType: 'sso_normalized_identity',
            resourceId: identity.id,
            message: 'Skipped SSO identity snapshot because stored claims could not be parsed.',
            details: {
              providerId: identity.providerId,
              providerSubject: identity.providerSubject,
            },
          });
          continue;
        }

        if (input.refreshProviderClaims) {
          try {
            const refresh = await ssoProviderIdentityCheckService.refreshClaims(identity, claims);
            if (refresh.status === 'refreshed' && refresh.claims) {
              claims = refresh.claims;
              const persistedClaims = allowlistedIdentityClaims(claims);
              result.refreshedIdentities = (result.refreshedIdentities ?? 0) + 1;
              await identityRepo.update({ id: identity.id }, {
                groupsJson: stringifyJsonValue(normalizeClaimArray(persistedClaims.groups), '[]'),
                rolesJson: stringifyJsonValue(normalizeClaimArray(persistedClaims.roles), '[]'),
                claimsJson: stringifyJsonValue(persistedClaims, '{}'),
                lastProviderCheckAt: refresh.checkedAt,
                updatedAt: Date.now(),
              });
              await recordReplayEvent({
                severity: 'info',
                type: 'sso_snapshot_reconciliation.identity_claims_refreshed',
                userId: identity.userId,
                resourceType: 'sso_normalized_identity',
                resourceId: identity.id,
                message: refresh.reason,
                details: {
                  providerId: identity.providerId,
                  providerSubject: identity.providerSubject,
                  checkedAt: refresh.checkedAt,
                  ...refresh.details,
                },
              });
            } else if (refresh.status === 'unsupported') {
              result.refreshUnsupportedIdentities = (result.refreshUnsupportedIdentities ?? 0) + 1;
              await recordReplayEvent({
                severity: 'info',
                type: 'sso_snapshot_reconciliation.identity_claim_refresh_unsupported',
                userId: identity.userId,
                resourceType: 'sso_normalized_identity',
                resourceId: identity.id,
                message: refresh.reason,
                details: {
                  providerId: identity.providerId,
                  providerSubject: identity.providerSubject,
                  checkedAt: refresh.checkedAt,
                  ...refresh.details,
                },
              });
            } else {
              result.refreshFailedIdentities = (result.refreshFailedIdentities ?? 0) + 1;
              result.skippedIdentities += 1;
              await recordReplayEvent({
                severity: 'warning',
                type: 'sso_snapshot_reconciliation.identity_claim_refresh_failed',
                userId: identity.userId,
                resourceType: 'sso_normalized_identity',
                resourceId: identity.id,
                message: refresh.reason,
                details: {
                  providerId: identity.providerId,
                  providerSubject: identity.providerSubject,
                  checkedAt: refresh.checkedAt,
                  ...refresh.details,
                },
              });
              continue;
            }
          } catch (error) {
            result.refreshFailedIdentities = (result.refreshFailedIdentities ?? 0) + 1;
            result.skippedIdentities += 1;
            await recordReplayEvent({
              severity: 'warning',
              type: 'sso_snapshot_reconciliation.identity_claim_refresh_failed',
              userId: identity.userId,
              resourceType: 'sso_normalized_identity',
              resourceId: identity.id,
              message: errorMessage(error),
              details: {
                providerId: identity.providerId,
                providerSubject: identity.providerSubject,
              },
            });
            continue;
          }
        }

        const user = await dataSource.getRepository(User).findOne({
          where: { id: identity.userId },
          select: ['id', 'isActive'],
        });
        if (!user || !user.isActive) {
          result.skippedIdentities += 1;
          await recordReplayEvent({
            severity: 'warning',
            type: user ? 'sso_snapshot_reconciliation.user_inactive' : 'sso_snapshot_reconciliation.user_missing',
            userId: identity.userId,
            resourceType: 'sso_normalized_identity',
            resourceId: identity.id,
            message: user
              ? 'Skipped SSO identity snapshot because the linked user is inactive.'
              : 'Skipped SSO identity snapshot because the linked user is missing.',
            details: {
              providerId: identity.providerId,
              providerSubject: identity.providerSubject,
            },
          });
          continue;
        }

        try {
          const counts = await dataSource.transaction(async (manager) => {
            const groupSync = await ssoGroupMappingService.syncMembershipsForUserWithManager(
              manager,
              identity.userId,
              claims,
              identity.providerId,
              identity.tenantId
            );
            const assignmentSync = await ssoAssignmentMappingService.syncAssignmentsForUserWithManager(
              manager,
              identity.userId,
              claims,
              identity.providerId,
              identity.tenantId
            );
            return {
              groupMembershipsCreated: groupSync.created,
              groupMembershipsUpdated: groupSync.updated,
              groupMembershipsRemoved: groupSync.removed,
              assignmentsCreated: assignmentSync.created,
              assignmentsUpdated: assignmentSync.updated,
              assignmentsRemoved: assignmentSync.removed,
            };
          });

          result.replayedIdentities += 1;
          result.groupMembershipsCreated += counts.groupMembershipsCreated;
          result.groupMembershipsUpdated += counts.groupMembershipsUpdated;
          result.groupMembershipsRemoved += counts.groupMembershipsRemoved;
          result.assignmentsCreated += counts.assignmentsCreated;
          result.assignmentsUpdated += counts.assignmentsUpdated;
          result.assignmentsRemoved += counts.assignmentsRemoved;
          await recordReplayEvent({
            severity: 'info',
            type: 'sso_snapshot_reconciliation.identity_replayed',
            userId: identity.userId,
            resourceType: 'sso_normalized_identity',
            resourceId: identity.id,
            message: 'Replayed SSO identity snapshot against current mappings.',
            details: {
              providerId: identity.providerId,
              providerSubject: identity.providerSubject,
              counts,
            },
          });
        } catch (error) {
          result.failedIdentities += 1;
          await recordReplayEvent({
            severity: 'error',
            type: 'sso_snapshot_reconciliation.identity_failed',
            userId: identity.userId,
            resourceType: 'sso_normalized_identity',
            resourceId: identity.id,
            message: errorMessage(error),
            details: {
              providerId: identity.providerId,
              providerSubject: identity.providerSubject,
            },
          });
        }
      }

      await this.completeRun(runId, {
        tenantId,
        providerId,
        groupMembershipsCreated: result.groupMembershipsCreated,
        groupMembershipsUpdated: result.groupMembershipsUpdated,
        groupMembershipsRemoved: result.groupMembershipsRemoved,
        assignmentsCreated: result.assignmentsCreated,
        assignmentsUpdated: result.assignmentsUpdated,
        assignmentsRemoved: result.assignmentsRemoved,
        details: {
          kind: 'sso_snapshot_reconciliation',
          ...input.details,
          result,
        },
      });
      return result;
    } catch (error) {
      await this.failRun(runId, error, {
        tenantId,
        providerId,
        details: {
          kind: 'sso_snapshot_reconciliation',
          ...input.details,
        },
      });
      throw error;
    }
  }

  async runProviderIdentityCheck(input: RunSsoProviderIdentityCheckInput = {}): Promise<SsoProviderIdentityCheckRunResult> {
    const tenantId = normalizeTenantId(input.tenantId);
    const providerId = normalizeProviderId(input.providerId);
    const runId = await this.startRun({
      tenantId,
      providerId,
      trigger: input.trigger || 'scheduled',
      details: {
        kind: 'sso_provider_identity_check',
        ...input.details,
      },
    });
    const result: SsoProviderIdentityCheckRunResult = {
      runId,
      scannedIdentities: 0,
      checkedIdentities: 0,
      unsupportedIdentities: 0,
      activeIdentities: 0,
      inactiveIdentities: 0,
      deletedIdentities: 0,
      unknownIdentities: 0,
      failedIdentities: 0,
    };

    const recordProviderCheckEvent = async (event: {
      severity: 'info' | 'warning' | 'error';
      type: string;
      message: string;
      identity: SsoNormalizedIdentity;
      details?: Record<string, unknown>;
    }) => {
      if (!runId) return;
      await this.recordEvent(runId, {
        tenantId: event.identity.tenantId,
        providerId: event.identity.providerId,
        userId: event.identity.userId,
        severity: event.severity,
        type: event.type,
        resourceType: 'sso_normalized_identity',
        resourceId: event.identity.id,
        message: event.message,
        details: {
          providerSubject: event.identity.providerSubject,
          subjectClaim: event.identity.subjectClaim,
          ...event.details,
        },
      });
    };

    try {
      const dataSource = await getDataSource();
      const identityRepo = dataSource.getRepository(SsoNormalizedIdentity);
      const identityQb = identityRepo.createQueryBuilder('identity')
        .where('identity.providerStatus = :providerStatus', { providerStatus: 'active' })
        .orderBy('identity.lastProviderCheckAt', 'ASC')
        .addOrderBy('identity.lastSeenAt', 'ASC')
        .take(Math.min(Math.max(input.limit ?? 500, 1), 5000));

      if (tenantId) {
        identityQb.andWhere('(identity.tenantId = :tenantId OR identity.tenantId IS NULL)', { tenantId });
      } else {
        identityQb.andWhere('identity.tenantId IS NULL');
      }
      if (providerId) {
        identityQb.andWhere('identity.providerId = :providerId', { providerId });
      }

      const identities = await identityQb.getMany();
      result.scannedIdentities = identities.length;

      for (const identity of identities) {
        try {
          const check = await ssoProviderIdentityCheckService.checkIdentity(identity);
          if (check.status === 'unsupported') {
            result.unsupportedIdentities += 1;
            await recordProviderCheckEvent({
              severity: 'warning',
              type: 'sso_provider_identity_check.identity_unsupported',
              identity,
              message: check.reason,
              details: {
                status: check.status,
                reason: check.reason,
                checkedAt: check.checkedAt,
                ...check.details,
              },
            });
            continue;
          }

          result.checkedIdentities += 1;
          const now = Date.now();
          const update: Record<string, unknown> = {
            lastProviderCheckAt: check.checkedAt,
            updatedAt: now,
          };
          if (check.status === 'active' || check.status === 'inactive' || check.status === 'deleted') {
            update.providerStatus = check.status;
          }
          if (check.status === 'active' && check.profile) {
            update.email = check.profile.email?.trim().toLowerCase() || identity.email;
            update.displayName = check.profile.displayName?.trim() || identity.displayName;
            update.firstName = check.profile.firstName?.trim() || identity.firstName;
            update.lastName = check.profile.lastName?.trim() || identity.lastName;
          }
          await identityRepo.update({ id: identity.id }, update);

          if (check.status === 'active') result.activeIdentities += 1;
          if (check.status === 'inactive') result.inactiveIdentities += 1;
          if (check.status === 'deleted') result.deletedIdentities += 1;
          if (check.status === 'unknown') result.unknownIdentities += 1;

          await recordProviderCheckEvent({
            severity: check.status === 'active' ? 'info' : 'warning',
            type: `sso_provider_identity_check.identity_${check.status}`,
            identity,
            message: check.reason,
            details: {
              status: check.status,
              reason: check.reason,
              checkedAt: check.checkedAt,
              ...check.details,
            },
          });
        } catch (error) {
          result.failedIdentities += 1;
          await recordProviderCheckEvent({
            severity: 'error',
            type: 'sso_provider_identity_check.identity_failed',
            identity,
            message: errorMessage(error),
            details: {
              reason: errorMessage(error),
            },
          });
        }
      }

      await this.completeRun(runId, {
        tenantId,
        providerId,
        details: {
          kind: 'sso_provider_identity_check',
          ...input.details,
          result,
        },
      });
      return result;
    } catch (error) {
      await this.failRun(runId, error, {
        tenantId,
        providerId,
        details: {
          kind: 'sso_provider_identity_check',
          ...input.details,
        },
      });
      throw error;
    }
  }

  async runReconciliationDiagnostics(input: RunSsoSyncDiagnosticsInput = {}): Promise<SsoSyncDiagnosticsScanResult> {
    const tenantId = normalizeTenantId(input.tenantId);
    const providerId = normalizeProviderId(input.providerId);
    const runId = await this.startRun({
      tenantId,
      providerId,
      trigger: input.trigger || 'manual',
      details: {
        kind: 'sso_reconciliation_diagnostics',
        ...input.details,
      },
    });
    const result: SsoSyncDiagnosticsScanResult = {
      runId,
      scannedGroupMappings: 0,
      scannedAssignmentMappings: 0,
      scannedGroupMemberships: 0,
      scannedAssignments: 0,
      warnings: 0,
      errors: 0,
    };

    const recordDiagnosticEvent = async (event: {
      severity: 'info' | 'warning' | 'error';
      type: string;
      message: string;
      mappingType?: string | null;
      mappingId?: string | null;
      resourceType?: string | null;
      resourceId?: string | null;
      userId?: string | null;
      details?: Record<string, unknown>;
    }) => {
      if (event.severity === 'warning') result.warnings += 1;
      if (event.severity === 'error') result.errors += 1;
      if (!runId) return;
      await this.recordEvent(runId, {
        tenantId,
        providerId,
        ...event,
      });
    };

    try {
      const dataSource = await getDataSource();
      const groupMappingRepo = dataSource.getRepository(SsoGroupMapping);
      const groupMembershipRepo = dataSource.getRepository(AuthzGroupMembership);
      const groupRepo = dataSource.getRepository(AuthzGroup);
      const assignmentMappingRepo = dataSource.getRepository(SsoAssignmentMapping);
      const assignmentRepo = dataSource.getRepository(RbacRoleAssignment);
      const engineRepo = dataSource.getRepository(Engine);
      const registrationRepo = dataSource.getRepository(ExternalEngineRegistration);

      const allGroupMappings = (await groupMappingRepo.find({
        where: tenantScopedWhere(tenantId, {}) as any,
      })).filter((mapping) => providerMatches(providerId, mapping.providerId));
      const activeGroupMappings = allGroupMappings.filter((mapping) => mapping.isActive);
      const groupMemberships = await groupMembershipRepo.find({
        where: tenantScopedWhere(tenantId, { source: 'sso' }) as any,
      });
      const allAssignmentMappings = (await assignmentMappingRepo.find({
        where: tenantScopedWhere(tenantId, {}) as any,
      })).filter((mapping) => providerMatches(providerId, mapping.providerId));
      const activeAssignmentMappings = allAssignmentMappings.filter((mapping) => mapping.isActive);
      const assignments = await assignmentRepo.find({
        where: tenantScopedWhere(tenantId, { source: 'sso' }) as any,
      });

      result.scannedGroupMappings = activeGroupMappings.length;
      result.scannedGroupMemberships = groupMemberships.length;
      result.scannedAssignmentMappings = activeAssignmentMappings.length;
      result.scannedAssignments = assignments.length;

      const groupIds = uniqueStrings([
        ...activeGroupMappings.map((mapping) => mapping.targetGroupId),
        ...groupMemberships.map((membership) => membership.groupId),
      ]);
      const groups = groupIds.length
        ? await groupRepo.find({ where: tenantScopedWhere(tenantId, { id: In(groupIds) }) as any })
        : [];
      const groupById = new Map(groups.map((group) => [group.id, group]));
      const groupMappingById = new Map(allGroupMappings.map((mapping) => [mapping.id, mapping]));

      const engines = await engineRepo.find({ where: tenantScopedWhere(tenantId, {}) as any });
      const engineById = new Map(engines.map((engine) => [engine.id, engine]));
      const registrations = await registrationRepo.find();
      const registrationByEngineId = new Map(registrations.map((registration) => [registration.engineId, registration]));
      const assignmentMappingById = new Map(allAssignmentMappings.map((mapping) => [mapping.id, mapping]));
      const assignmentTargetsByMappingId = new Map<string, Set<string | null>>();

      const resolveAssignmentTargetIds = (mapping: SsoAssignmentMapping): Set<string | null> => {
        const targetIds = new Set<string | null>();
        if (mapping.targetSelectorType === 'all_engines') {
          targetIds.add(null);
          return targetIds;
        }
        if (mapping.targetSelectorType === 'engine_id') {
          if (mapping.targetEngineId) targetIds.add(mapping.targetEngineId);
          return targetIds;
        }
        if (mapping.targetSelectorType === 'external_engine_id') {
          if (!mapping.targetExternalEngineId) return targetIds;
          engines.forEach((engine) => {
            const registration = registrationByEngineId.get(engine.id);
            if (
              !isDecommissionedEngine(engine) &&
              (engine.externalId === mapping.targetExternalEngineId || registration?.externalId === mapping.targetExternalEngineId)
            ) {
              targetIds.add(engine.id);
            }
          });
          return targetIds;
        }
        if (mapping.targetSelectorType === 'engine_label') {
          if (!mapping.targetLabelKey || !mapping.targetLabelValue) return targetIds;
          engines.forEach((engine) => {
            if (isDecommissionedEngine(engine)) return;
            const registration = registrationByEngineId.get(engine.id);
            const labels = {
              ...parseLabels(engine.labelsJson),
              ...parseLabels(registration?.labelsJson),
            };
            if (labels[mapping.targetLabelKey!] === mapping.targetLabelValue) {
              targetIds.add(engine.id);
            }
          });
        }
        return targetIds;
      };

      for (const mapping of activeGroupMappings) {
        const targetGroup = groupById.get(mapping.targetGroupId);
        if (!targetGroup) {
          await recordDiagnosticEvent({
            severity: 'warning',
            type: 'sso_group_mapping.target_group_missing',
            mappingType: 'sso_group_mapping',
            mappingId: mapping.id,
            resourceType: 'authz_group',
            resourceId: mapping.targetGroupId,
            message: 'Active SSO group mapping targets a missing authorization group.',
            details: { claimType: mapping.claimType, claimKey: mapping.claimKey, claimValue: mapping.claimValue },
          });
        } else if (targetGroup.isArchived) {
          await recordDiagnosticEvent({
            severity: 'warning',
            type: 'sso_group_mapping.target_group_archived',
            mappingType: 'sso_group_mapping',
            mappingId: mapping.id,
            resourceType: 'authz_group',
            resourceId: mapping.targetGroupId,
            message: 'Active SSO group mapping targets an archived authorization group.',
            details: { groupKey: targetGroup.key, groupName: targetGroup.name },
          });
        }

        if (mapping.claimType === 'group' && mapping.providerId) {
          try {
            const groupCheck = await ssoProviderIdentityCheckService.checkGroup({
              providerId: mapping.providerId,
              groupClaimValue: mapping.claimValue,
            });
            if (groupCheck.status === 'deleted') {
              await recordDiagnosticEvent({
                severity: 'warning',
                type: 'sso_group_mapping.provider_group_deleted',
                mappingType: 'sso_group_mapping',
                mappingId: mapping.id,
                resourceType: 'idp_group',
                resourceId: mapping.claimValue,
                message: groupCheck.reason,
                details: {
                  claimType: mapping.claimType,
                  claimKey: mapping.claimKey,
                  claimValue: mapping.claimValue,
                  providerId: mapping.providerId,
                  checkedAt: groupCheck.checkedAt,
                  ...groupCheck.details,
                },
              });
            } else if (groupCheck.status === 'unknown') {
              await recordDiagnosticEvent({
                severity: 'warning',
                type: 'sso_group_mapping.provider_group_unknown',
                mappingType: 'sso_group_mapping',
                mappingId: mapping.id,
                resourceType: 'idp_group',
                resourceId: mapping.claimValue,
                message: groupCheck.reason,
                details: {
                  claimType: mapping.claimType,
                  claimKey: mapping.claimKey,
                  claimValue: mapping.claimValue,
                  providerId: mapping.providerId,
                  checkedAt: groupCheck.checkedAt,
                  ...groupCheck.details,
                },
              });
            } else if (groupCheck.status === 'unsupported') {
              await recordDiagnosticEvent({
                severity: 'info',
                type: 'sso_group_mapping.provider_group_check_unsupported',
                mappingType: 'sso_group_mapping',
                mappingId: mapping.id,
                resourceType: 'idp_group',
                resourceId: mapping.claimValue,
                message: groupCheck.reason,
                details: {
                  claimType: mapping.claimType,
                  claimKey: mapping.claimKey,
                  claimValue: mapping.claimValue,
                  providerId: mapping.providerId,
                  checkedAt: groupCheck.checkedAt,
                  ...groupCheck.details,
                },
              });
            }
          } catch (error) {
            await recordDiagnosticEvent({
              severity: 'error',
              type: 'sso_group_mapping.provider_group_check_failed',
              mappingType: 'sso_group_mapping',
              mappingId: mapping.id,
              resourceType: 'idp_group',
              resourceId: mapping.claimValue,
              message: errorMessage(error),
              details: {
                claimType: mapping.claimType,
                claimKey: mapping.claimKey,
                claimValue: mapping.claimValue,
                providerId: mapping.providerId,
              },
            });
          }
        }
      }

      for (const membership of groupMemberships) {
        const mappingId = membership.sourceRef || null;
        const mapping = mappingId ? groupMappingById.get(mappingId) : null;
        if (!mappingId || !mapping) {
          if (providerId) continue;
          await recordDiagnosticEvent({
            severity: 'warning',
            type: 'sso_group_membership.mapping_missing',
            mappingType: 'sso_group_mapping',
            mappingId,
            resourceType: 'authz_group_membership',
            resourceId: membership.id,
            userId: membership.userId,
            message: 'SSO-managed group membership no longer has a matching source mapping.',
            details: { groupId: membership.groupId, sourceRef: membership.sourceRef },
          });
        } else if (!mapping.isActive) {
          await recordDiagnosticEvent({
            severity: 'warning',
            type: 'sso_group_membership.mapping_inactive',
            mappingType: 'sso_group_mapping',
            mappingId,
            resourceType: 'authz_group_membership',
            resourceId: membership.id,
            userId: membership.userId,
            message: 'SSO-managed group membership was created by an inactive source mapping.',
            details: { groupId: membership.groupId, sourceRef: membership.sourceRef },
          });
        }

        const group = groupById.get(membership.groupId);
        if (!group) {
          await recordDiagnosticEvent({
            severity: 'warning',
            type: 'sso_group_membership.group_missing',
            mappingType: 'sso_group_mapping',
            mappingId,
            resourceType: 'authz_group',
            resourceId: membership.groupId,
            userId: membership.userId,
            message: 'SSO-managed group membership references a missing authorization group.',
            details: { membershipId: membership.id },
          });
        } else if (group.isArchived) {
          await recordDiagnosticEvent({
            severity: 'warning',
            type: 'sso_group_membership.group_archived',
            mappingType: 'sso_group_mapping',
            mappingId,
            resourceType: 'authz_group',
            resourceId: membership.groupId,
            userId: membership.userId,
            message: 'SSO-managed group membership references an archived authorization group.',
            details: { membershipId: membership.id, groupKey: group.key },
          });
        }
      }

      for (const mapping of activeAssignmentMappings) {
        const targetIds = resolveAssignmentTargetIds(mapping);
        assignmentTargetsByMappingId.set(mapping.id, targetIds);
        if (mapping.targetSelectorType === 'engine_id') {
          const engine = mapping.targetEngineId ? engineById.get(mapping.targetEngineId) : undefined;
          if (!mapping.targetEngineId || !engine) {
            await recordDiagnosticEvent({
              severity: 'warning',
              type: 'sso_assignment_mapping.target_engine_missing',
              mappingType: 'sso_assignment_mapping',
              mappingId: mapping.id,
              resourceType: 'engine',
              resourceId: mapping.targetEngineId,
              message: 'Active SSO engine assignment mapping targets a missing engine.',
              details: { targetSelectorType: mapping.targetSelectorType },
            });
          } else if (isDecommissionedEngine(engine)) {
            await recordDiagnosticEvent({
              severity: 'warning',
              type: 'sso_assignment_mapping.target_engine_decommissioned',
              mappingType: 'sso_assignment_mapping',
              mappingId: mapping.id,
              resourceType: 'engine',
              resourceId: mapping.targetEngineId,
              message: 'Active SSO engine assignment mapping targets a decommissioned engine.',
              details: { targetSelectorType: mapping.targetSelectorType },
            });
          }
        } else if (mapping.targetSelectorType === 'external_engine_id' && targetIds.size === 0) {
          await recordDiagnosticEvent({
            severity: 'warning',
            type: 'sso_assignment_mapping.external_engine_no_matches',
            mappingType: 'sso_assignment_mapping',
            mappingId: mapping.id,
            resourceType: 'engine',
            resourceId: mapping.targetExternalEngineId,
            message: 'Active SSO engine assignment mapping did not match any active engine by external id.',
            details: { targetExternalEngineId: mapping.targetExternalEngineId },
          });
        } else if (mapping.targetSelectorType === 'engine_label' && targetIds.size === 0) {
          await recordDiagnosticEvent({
            severity: 'warning',
            type: 'sso_assignment_mapping.engine_label_no_matches',
            mappingType: 'sso_assignment_mapping',
            mappingId: mapping.id,
            resourceType: 'engine',
            resourceId: null,
            message: 'Active SSO engine assignment mapping did not match any active engine by label selector.',
            details: { targetLabelKey: mapping.targetLabelKey, targetLabelValue: mapping.targetLabelValue },
          });
        }
      }

      for (const assignment of assignments) {
        // SSO diagnostics apply only to assignments materialized by the
        // SSO mapping writer. Manual, API, automation, and bootstrap grants
        // share this table but must never be inferred as stale SSO state.
        if (assignment.source !== 'sso') continue;
        const mappingId = sourceMappingId(assignment.sourceMappingId, assignment.sourceRef);
        const mapping = mappingId ? assignmentMappingById.get(mappingId) : null;
        const userId = assignmentUserId(assignment);
        const scope = assignmentScope(assignment);
        if (providerId && mapping && !providerMatches(providerId, mapping.providerId)) continue;
        if (providerId && !mapping) continue;

        if (!mappingId || !mapping) {
          await recordDiagnosticEvent({
            severity: 'warning',
            type: 'sso_assignment.mapping_missing',
            mappingType: 'sso_assignment_mapping',
            mappingId,
            resourceType: 'role_assignment',
            resourceId: assignment.id,
            userId,
            message: 'SSO-managed role assignment no longer has a matching source mapping.',
            details: { roleId: assignment.roleId, sourceMappingId: assignment.sourceMappingId, sourceRef: assignment.sourceRef },
          });
        } else if (!mapping.isActive) {
          await recordDiagnosticEvent({
            severity: 'warning',
            type: 'sso_assignment.mapping_inactive',
            mappingType: 'sso_assignment_mapping',
            mappingId,
            resourceType: 'role_assignment',
            resourceId: assignment.id,
            userId,
            message: 'SSO-managed role assignment was created by an inactive source mapping.',
            details: { roleId: assignment.roleId },
          });
        }

        if (scope.type === 'engine' && scope.id) {
          const engine = engineById.get(scope.id);
          if (!engine) {
            await recordDiagnosticEvent({
              severity: 'warning',
              type: 'sso_assignment.engine_missing',
              mappingType: 'sso_assignment_mapping',
              mappingId,
              resourceType: 'engine',
              resourceId: scope.id,
              userId,
              message: 'SSO-managed role assignment references a missing engine.',
              details: { roleId: assignment.roleId, assignmentId: assignment.id },
            });
          } else if (isDecommissionedEngine(engine)) {
            await recordDiagnosticEvent({
              severity: 'warning',
              type: 'sso_assignment.engine_decommissioned',
              mappingType: 'sso_assignment_mapping',
              mappingId,
              resourceType: 'engine',
              resourceId: scope.id,
              userId,
              message: 'SSO-managed role assignment references a decommissioned engine.',
              details: { roleId: assignment.roleId, assignmentId: assignment.id },
            });
          }
        }

        if (mapping?.isActive) {
          const expectedTargets = assignmentTargetsByMappingId.get(mapping.id) || resolveAssignmentTargetIds(mapping);
          if (expectedTargets.size > 0 && !expectedTargets.has(scope.id)) {
            await recordDiagnosticEvent({
              severity: 'warning',
              type: 'sso_assignment.target_no_longer_matches',
              mappingType: 'sso_assignment_mapping',
              mappingId: mapping.id,
              resourceType: scope.type,
              resourceId: scope.id,
              userId,
              message: 'SSO-managed role assignment no longer matches its source mapping target selector.',
              details: {
                roleId: assignment.roleId,
                assignmentId: assignment.id,
                targetSelectorType: mapping.targetSelectorType,
                expectedTargets: Array.from(expectedTargets),
              },
            });
          }
        }
      }

      await this.completeRun(runId, {
        tenantId,
        providerId,
        details: {
          kind: 'sso_reconciliation_diagnostics',
          ...input.details,
          result,
        },
      });
      return result;
    } catch (error) {
      await this.failRun(runId, error, {
        tenantId,
        providerId,
        details: {
          kind: 'sso_reconciliation_diagnostics',
          ...input.details,
        },
      });
      throw error;
    }
  }

  async runReconciliationCleanup(input: RunSsoSyncDiagnosticsInput = {}): Promise<SsoSyncCleanupResult> {
    const tenantId = normalizeTenantId(input.tenantId);
    const providerId = normalizeProviderId(input.providerId);
    const runId = await this.startRun({
      tenantId,
      providerId,
      trigger: input.trigger || 'scheduled',
      details: {
        kind: 'sso_reconciliation_cleanup',
        ...input.details,
      },
    });
    const result: SsoSyncCleanupResult = {
      runId,
      scannedGroupMemberships: 0,
      scannedAssignments: 0,
      groupMembershipsRemoved: 0,
      assignmentsRemoved: 0,
    };

    const recordCleanupEvent = async (event: {
      type: string;
      message: string;
      mappingType?: string | null;
      mappingId?: string | null;
      resourceType?: string | null;
      resourceId?: string | null;
      userId?: string | null;
      details?: Record<string, unknown>;
    }) => {
      if (!runId) return;
      await this.recordEvent(runId, {
        tenantId,
        providerId,
        severity: 'info',
        ...event,
      });
    };

    try {
      const dataSource = await getDataSource();
      const groupMappingRepo = dataSource.getRepository(SsoGroupMapping);
      const groupMembershipRepo = dataSource.getRepository(AuthzGroupMembership);
      const groupRepo = dataSource.getRepository(AuthzGroup);
      const assignmentMappingRepo = dataSource.getRepository(SsoAssignmentMapping);
      const assignmentRepo = dataSource.getRepository(RbacRoleAssignment);
      const engineRepo = dataSource.getRepository(Engine);
      const registrationRepo = dataSource.getRepository(ExternalEngineRegistration);
      const identityRepo = dataSource.getRepository(SsoNormalizedIdentity);

      const allGroupMappings = (await groupMappingRepo.find({
        where: tenantScopedWhere(tenantId, {}) as any,
      })).filter((mapping) => providerMatches(providerId, mapping.providerId));
      const groupMemberships = await groupMembershipRepo.find({
        where: tenantScopedWhere(tenantId, { source: 'sso' }) as any,
      });
      const allAssignmentMappings = (await assignmentMappingRepo.find({
        where: tenantScopedWhere(tenantId, {}) as any,
      })).filter((mapping) => providerMatches(providerId, mapping.providerId));
      const assignments = await assignmentRepo.find({
        where: tenantScopedWhere(tenantId, { source: 'sso' }) as any,
      });
      const engines = await engineRepo.find({ where: tenantScopedWhere(tenantId, {}) as any });
      const registrations = await registrationRepo.find();
      const providerStatusIdentities = await identityRepo.find({
        where: tenantScopedWhere(tenantId, { providerStatus: In(['inactive', 'deleted']) }) as any,
      });

      result.scannedGroupMemberships = groupMemberships.length;
      result.scannedAssignments = assignments.length;

      const groupIds = uniqueStrings(groupMemberships.map((membership) => membership.groupId));
      const groups = groupIds.length
        ? await groupRepo.find({ where: tenantScopedWhere(tenantId, { id: In(groupIds) }) as any })
        : [];
      const groupById = new Map(groups.map((group) => [group.id, group]));
      const groupMappingById = new Map(allGroupMappings.map((mapping) => [mapping.id, mapping]));
      const engineById = new Map(engines.map((engine) => [engine.id, engine]));
      const registrationByEngineId = new Map(registrations.map((registration) => [registration.engineId, registration]));
      const assignmentMappingById = new Map(allAssignmentMappings.map((mapping) => [mapping.id, mapping]));
      const inactiveIdentityByProviderUser = new Map(
        providerStatusIdentities
          .filter((identity) => identity.providerStatus === 'inactive' || identity.providerStatus === 'deleted')
          .map((identity) => [providerUserKey(identity.providerId, identity.userId), identity] as const)
          .filter((entry): entry is [string, SsoNormalizedIdentity] => Boolean(entry[0]))
      );

      const providerStatusReason = (mappingProviderId: string | null | undefined, userId: string | null | undefined): string | null => {
        const identity = inactiveIdentityByProviderUser.get(providerUserKey(mappingProviderId, userId) || '');
        if (!identity) return null;
        return identity.providerStatus === 'deleted' ? 'provider_identity_deleted' : 'provider_identity_inactive';
      };

      const resolveAssignmentTargetIds = (mapping: SsoAssignmentMapping): Set<string | null> => {
        const targetIds = new Set<string | null>();
        if (mapping.targetSelectorType === 'all_engines') {
          targetIds.add(null);
          return targetIds;
        }
        if (mapping.targetSelectorType === 'engine_id') {
          if (mapping.targetEngineId) targetIds.add(mapping.targetEngineId);
          return targetIds;
        }
        if (mapping.targetSelectorType === 'external_engine_id') {
          if (!mapping.targetExternalEngineId) return targetIds;
          engines.forEach((engine) => {
            const registration = registrationByEngineId.get(engine.id);
            if (
              !isDecommissionedEngine(engine) &&
              (engine.externalId === mapping.targetExternalEngineId || registration?.externalId === mapping.targetExternalEngineId)
            ) {
              targetIds.add(engine.id);
            }
          });
          return targetIds;
        }
        if (mapping.targetSelectorType === 'engine_label') {
          if (!mapping.targetLabelKey || !mapping.targetLabelValue) return targetIds;
          engines.forEach((engine) => {
            if (isDecommissionedEngine(engine)) return;
            const registration = registrationByEngineId.get(engine.id);
            const labels = {
              ...parseLabels(engine.labelsJson),
              ...parseLabels(registration?.labelsJson),
            };
            if (labels[mapping.targetLabelKey!] === mapping.targetLabelValue) {
              targetIds.add(engine.id);
            }
          });
        }
        return targetIds;
      };

      for (const membership of groupMemberships) {
        const mappingId = membership.sourceRef || null;
        const mapping = mappingId ? groupMappingById.get(mappingId) : null;
        if (providerId && !mapping) continue;

        const group = groupById.get(membership.groupId);
        const reason = !mappingId || !mapping
          ? 'mapping_missing'
          : !mapping.isActive
            ? 'mapping_inactive'
            : providerStatusReason(mapping.providerId, membership.userId) ||
              (!group
                ? 'group_missing'
                : group.isArchived
                  ? 'group_archived'
                  : null);
        if (!reason) continue;

        await groupMembershipRepo.delete({ id: membership.id });
        result.groupMembershipsRemoved += 1;
        await recordCleanupEvent({
          type: 'sso_group_membership.cleanup_removed',
          mappingType: 'sso_group_mapping',
          mappingId,
          resourceType: 'authz_group_membership',
          resourceId: membership.id,
          userId: membership.userId,
          message: 'Removed stale SSO-managed group membership.',
          details: {
            reason,
            groupId: membership.groupId,
            sourceRef: membership.sourceRef,
          },
        });
      }

      const expectedTargetsByMappingId = new Map<string, Set<string | null>>();
      const disabledRiskReasonsByMappingId = new Map<string, string[]>();
      const getDisabledRiskReasons = async (mapping: SsoAssignmentMapping): Promise<string[]> => {
        if (disabledRiskReasonsByMappingId.has(mapping.id)) {
          return disabledRiskReasonsByMappingId.get(mapping.id) || [];
        }
        const disabledRiskReasons = await ssoAssignmentMappingService.getDisabledPlatformRiskReasonsForMapping(dataSource, mapping);
        disabledRiskReasonsByMappingId.set(mapping.id, disabledRiskReasons);
        return disabledRiskReasons;
      };

      for (const assignment of assignments) {
        // Cleanup is source-scoped: only assignments materialized by the SSO
        // mapping writer can be removed by reconciliation.
        if (assignment.source !== 'sso') continue;
        const mappingId = sourceMappingId(assignment.sourceMappingId, assignment.sourceRef);
        const mapping = mappingId ? assignmentMappingById.get(mappingId) : null;
        const userId = assignmentUserId(assignment);
        const scope = assignmentScope(assignment);
        if (providerId && !mapping) continue;

        let reason: string | null = null;
        let disabledRiskReasons: string[] = [];
        if (!mappingId || !mapping) {
          reason = 'mapping_missing';
        } else if (!mapping.isActive) {
          reason = 'mapping_inactive';
        } else {
          reason = providerStatusReason(mapping.providerId, userId);
        }
        if (!reason && mapping?.isActive) {
          disabledRiskReasons = await getDisabledRiskReasons(mapping);
          if (disabledRiskReasons.length > 0) {
            reason = 'platform_setting_disabled';
          }
        }
        if (!reason && mapping?.isActive && scope.type === 'engine' && scope.id) {
          const engine = engineById.get(scope.id);
          if (!engine) {
            reason = 'engine_missing';
          } else if (isDecommissionedEngine(engine)) {
            reason = 'engine_decommissioned';
          } else if (mapping.syncMode === 'authoritative') {
            const expectedTargets = expectedTargetsByMappingId.get(mapping.id) || resolveAssignmentTargetIds(mapping);
            expectedTargetsByMappingId.set(mapping.id, expectedTargets);
            if (!expectedTargets.has(scope.id)) {
              reason = 'target_no_longer_matches';
            }
          }
        }
        if (!reason) continue;

        const snapshotStatusByReason: Record<string, Exclude<SsoEngineAccessSnapshotStatus, 'active'>> = {
          mapping_missing: 'mapping_disabled',
          mapping_inactive: 'mapping_disabled',
          provider_identity_deleted: 'provider_identity_missing',
          provider_identity_inactive: 'provider_identity_missing',
          platform_setting_disabled: 'mapping_disabled',
          engine_missing: 'engine_no_longer_matches_selector',
          engine_decommissioned: 'engine_no_longer_matches_selector',
          target_no_longer_matches: 'engine_no_longer_matches_selector',
        };
        await ssoEngineAccessSnapshotService.markAssignmentRemoved(dataSource, assignment, {
          status: snapshotStatusByReason[reason] ?? 'removed_by_sso',
          cleanupReason: reason,
          details: {
            runId,
            mappingId,
            disabledRiskReasons,
          },
        });
        await assignmentRepo.delete({ id: assignment.id });
        result.assignmentsRemoved += 1;
        await recordCleanupEvent({
          type: 'sso_assignment.cleanup_removed',
          mappingType: 'sso_assignment_mapping',
          mappingId,
          resourceType: 'role_assignment',
          resourceId: assignment.id,
          userId,
          message: 'Removed stale SSO-managed role assignment.',
          details: {
            reason,
            roleId: assignment.roleId,
            assignmentResourceType: scope.type,
            assignmentResourceId: scope.id,
            sourceMappingId: assignment.sourceMappingId,
            sourceRef: assignment.sourceRef,
            disabledRiskReasons,
          },
        });
      }

      await this.completeRun(runId, {
        tenantId,
        providerId,
        groupMembershipsRemoved: result.groupMembershipsRemoved,
        assignmentsRemoved: result.assignmentsRemoved,
        details: {
          kind: 'sso_reconciliation_cleanup',
          ...input.details,
          result,
        },
      });
      return result;
    } catch (error) {
      await this.failRun(runId, error, {
        tenantId,
        providerId,
        details: {
          kind: 'sso_reconciliation_cleanup',
          ...input.details,
        },
      });
      throw error;
    }
  }

  async startRun(input: StartSsoSyncRunInput): Promise<string | null> {
    try {
      const dataSource = await getDataSource();
      const id = generateId();
      const now = Date.now();
      await dataSource.getRepository(SsoSyncRun).insert({
        id,
        tenantId: normalizeTenantId(input.tenantId),
        providerId: input.providerId || null,
        userId: input.userId || null,
        trigger: input.trigger,
        status: 'running',
        startedAt: now,
        completedAt: null,
        groupMembershipsCreated: 0,
        groupMembershipsUpdated: 0,
        groupMembershipsRemoved: 0,
        assignmentsCreated: 0,
        assignmentsUpdated: 0,
        assignmentsRemoved: 0,
        errorCode: null,
        errorMessage: null,
        details: stringifyDetails(input.details),
      });
      await this.recordEvent(id, {
        tenantId: input.tenantId,
        providerId: input.providerId,
        userId: input.userId,
        severity: 'info',
        type: 'sso_sync_started',
        message: 'SSO authorization sync started',
        details: input.details,
      });
      return id;
    } catch (error) {
      logger.warn('Failed to start SSO sync diagnostic run:', error);
      return null;
    }
  }

  async completeRun(runId: string | null, input: CompleteSsoSyncRunInput = {}): Promise<void> {
    if (!runId) return;
    try {
      const dataSource = await getDataSource();
      await dataSource.getRepository(SsoSyncRun).update({ id: runId }, {
        status: 'success',
        completedAt: Date.now(),
        groupMembershipsCreated: input.groupMembershipsCreated ?? 0,
        groupMembershipsUpdated: input.groupMembershipsUpdated ?? 0,
        groupMembershipsRemoved: input.groupMembershipsRemoved ?? 0,
        assignmentsCreated: input.assignmentsCreated ?? 0,
        assignmentsUpdated: input.assignmentsUpdated ?? 0,
        assignmentsRemoved: input.assignmentsRemoved ?? 0,
        errorCode: null,
        errorMessage: null,
        details: stringifyDetails(input.details),
      });
      await this.recordEvent(runId, {
        tenantId: input.tenantId,
        providerId: input.providerId,
        userId: input.userId,
        severity: 'info',
        type: 'sso_sync_completed',
        message: 'SSO authorization sync completed',
        details: {
          ...input.details,
          counts: {
            groupMembershipsCreated: input.groupMembershipsCreated ?? 0,
            groupMembershipsUpdated: input.groupMembershipsUpdated ?? 0,
            groupMembershipsRemoved: input.groupMembershipsRemoved ?? 0,
            assignmentsCreated: input.assignmentsCreated ?? 0,
            assignmentsUpdated: input.assignmentsUpdated ?? 0,
            assignmentsRemoved: input.assignmentsRemoved ?? 0,
          },
        },
      });
    } catch (error) {
      logger.warn('Failed to complete SSO sync diagnostic run:', error);
    }
  }

  async failRun(runId: string | null, error: unknown, input: Omit<CompleteSsoSyncRunInput, keyof SsoSyncCounts> = {}): Promise<void> {
    if (!runId) return;
    try {
      const dataSource = await getDataSource();
      const message = errorMessage(error);
      const code = error instanceof Error && error.name ? error.name : 'SsoSyncError';
      await dataSource.getRepository(SsoSyncRun).update({ id: runId }, {
        status: 'failed',
        completedAt: Date.now(),
        errorCode: code,
        errorMessage: message,
        details: stringifyDetails(input.details),
      });
      await this.recordEvent(runId, {
        tenantId: input.tenantId,
        providerId: input.providerId,
        userId: input.userId,
        severity: 'error',
        type: 'sso_sync_failed',
        message,
        details: input.details,
      });
    } catch (diagnosticError) {
      logger.warn('Failed to mark SSO sync diagnostic run as failed:', diagnosticError);
    }
  }

  private async recordEvent(runId: string, input: {
    tenantId?: string | null;
    providerId?: string | null;
    userId?: string | null;
    severity: 'info' | 'warning' | 'error';
    type: string;
    message: string;
    mappingType?: string | null;
    mappingId?: string | null;
    resourceType?: string | null;
    resourceId?: string | null;
    details?: Record<string, unknown>;
  }): Promise<void> {
    const dataSource = await getDataSource();
    await dataSource.getRepository(SsoSyncEvent).insert({
      id: generateId(),
      tenantId: normalizeTenantId(input.tenantId),
      providerId: input.providerId || null,
      runId,
      severity: input.severity,
      type: input.type,
      userId: input.userId || null,
      mappingType: input.mappingType || null,
      mappingId: input.mappingId || null,
      resourceType: input.resourceType || null,
      resourceId: input.resourceId || null,
      message: input.message,
      details: stringifyDetails(input.details),
      createdAt: Date.now(),
    });
  }
}

export const ssoSyncDiagnosticsService = new SsoSyncDiagnosticsServiceClass();

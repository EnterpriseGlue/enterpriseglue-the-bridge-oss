import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuditLog } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuditLog.js';
import { EngineSetMaterialization } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineSetMaterialization.js';
import { RbacRoleAssignment } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRoleAssignment.js';
import { SsoEngineAccessSnapshot } from '@enterpriseglue/shared/infrastructure/persistence/entities/SsoEngineAccessSnapshot.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { In, IsNull, type DataSource, type EntityManager } from 'typeorm';
import type { SsoClaims } from './SsoClaimsMappingService.js';

type SnapshotStore = DataSource | EntityManager;

export type SsoEngineAccessSnapshotStatus =
  | 'active'
  | 'stale'
  | 'removed_by_sso'
  | 'removed_by_admin'
  | 'mapping_disabled'
  | 'provider_identity_missing'
  | 'provider_group_missing'
  | 'engine_no_longer_matches_selector';

export interface SsoEngineAccessSnapshotView {
  id: string;
  tenantId: string | null;
  providerId: string | null;
  mappingId: string;
  principalType: string;
  principalId: string;
  engineId: string;
  providerSubjectIds: string[];
  providerGroupIds: string[];
  providerAppRoleIds: string[];
  currentRoleIds: string[];
  previousRoleIds: string[];
  status: SsoEngineAccessSnapshotStatus;
  cleanupReason: string | null;
  lastSeenAt: number;
  lastSyncedAt: number;
  removedAt: number | null;
  details: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface SsoEngineAccessSnapshotQuery {
  tenantId?: string | null;
  providerId?: string | null;
  mappingId?: string | null;
  principalType?: string | null;
  principalId?: string | null;
  engineId?: string | null;
  status?: SsoEngineAccessSnapshotStatus | null;
  limit?: number | null;
}

export interface SsoSnapshotActiveGrantInput {
  tenantId?: string | null;
  providerId?: string | null;
  mappingId: string;
  principalType?: string | null;
  principalId: string;
  roleId: string;
  assignmentId: string;
  resourceId?: string | null;
  scopeType?: string | null;
  scopeId?: string | null;
  claims?: SsoClaims | null;
  details?: Record<string, unknown>;
}

export interface SsoSnapshotRemovalInput {
  status: Exclude<SsoEngineAccessSnapshotStatus, 'active'>;
  cleanupReason?: string | null;
  details?: Record<string, unknown>;
}

export interface EngineAccessTransitionCleanupCandidate {
  manualAssignmentId: string;
  ssoAssignmentId: string;
  principalType: string;
  principalId: string;
  engineId: string;
  manualRoleId: string;
  ssoRoleId: string;
  sourceMappingId: string | null;
  lastSnapshotStatus: SsoEngineAccessSnapshotStatus | null;
  recommendedAction: 'remove_manual_duplicate' | 'review_manual_conflict';
}

export interface EngineAccessTransitionCleanupPreview {
  previewCorrelationId: string;
  engineId: string;
  candidates: EngineAccessTransitionCleanupCandidate[];
}

export interface EngineAccessTransitionCleanupApplyResult {
  previewCorrelationId: string;
  engineId: string;
  removedAssignmentIds: string[];
  removedCount: number;
}

function normalizeTenantId(tenantId?: string | null): string | null {
  const normalized = tenantId?.trim();
  return normalized || null;
}

function safeParseStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return Array.from(new Set(parsed.map((item) => String(item || '').trim()).filter(Boolean)));
  } catch {
    return [];
  }
}

function safeParseObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function serializeStringArray(values: string[]): string {
  return JSON.stringify(Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean))).sort());
}

function toSnapshotView(snapshot: SsoEngineAccessSnapshot): SsoEngineAccessSnapshotView {
  return {
    id: snapshot.id,
    tenantId: snapshot.tenantId,
    providerId: snapshot.providerId,
    mappingId: snapshot.mappingId,
    principalType: snapshot.principalType,
    principalId: snapshot.principalId,
    engineId: snapshot.engineId,
    providerSubjectIds: safeParseStringArray(snapshot.providerSubjectIdsJson),
    providerGroupIds: safeParseStringArray(snapshot.providerGroupIdsJson),
    providerAppRoleIds: safeParseStringArray(snapshot.providerAppRoleIdsJson),
    currentRoleIds: safeParseStringArray(snapshot.currentRoleIdsJson),
    previousRoleIds: safeParseStringArray(snapshot.previousRoleIdsJson),
    status: snapshot.status as SsoEngineAccessSnapshotStatus,
    cleanupReason: snapshot.cleanupReason,
    lastSeenAt: Number(snapshot.lastSeenAt),
    lastSyncedAt: Number(snapshot.lastSyncedAt),
    removedAt: snapshot.removedAt === null ? null : Number(snapshot.removedAt),
    details: safeParseObject(snapshot.details),
    createdAt: Number(snapshot.createdAt),
    updatedAt: Number(snapshot.updatedAt),
  };
}

function addTenantScopeFilter(qb: { andWhere: (...args: any[]) => any }, alias: string, tenantId?: string | null): void {
  const normalizedTenantId = normalizeTenantId(tenantId);
  if (!normalizedTenantId) return;
  qb.andWhere(`(${alias}.tenantId = :tenantId OR ${alias}.tenantId IS NULL)`, { tenantId: normalizedTenantId });
}

function extractClaimValues(claims: SsoClaims | null | undefined, keys: string[]): string[] {
  if (!claims) return [];
  const values: string[] = [];
  for (const key of keys) {
    const value = claims[key];
    if (Array.isArray(value)) {
      values.push(...value.map((item) => String(item || '').trim()).filter(Boolean));
    } else if (value !== undefined && value !== null) {
      values.push(String(value).trim());
    }
  }
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function extractProviderSubjectIds(claims: SsoClaims | null | undefined): string[] {
  return extractClaimValues(claims, ['oid', 'sub', 'nameId', 'name_id', 'email', 'preferred_username', 'upn']);
}

function extractProviderGroupIds(claims: SsoClaims | null | undefined): string[] {
  return extractClaimValues(claims, ['groups', 'group', 'groupIds']);
}

function extractProviderAppRoleIds(claims: SsoClaims | null | undefined): string[] {
  return extractClaimValues(claims, ['roles', 'role', 'appRoles', 'appRoleIds']);
}

async function resolveAssignmentEngineIds(store: SnapshotStore, assignment: Pick<RbacRoleAssignment, 'resourceId' | 'scopeType' | 'scopeId'>): Promise<string[]> {
  if (assignment.resourceId) {
    return [assignment.resourceId];
  }
  if (assignment.scopeType === 'engine' && assignment.scopeId) {
    return [assignment.scopeId];
  }
  if (assignment.scopeType === 'engine_set' && assignment.scopeId) {
    const rows = await store.getRepository(EngineSetMaterialization).find({
      where: { engineSetId: assignment.scopeId },
      select: ['engineId'],
    });
    return rows.map((row) => row.engineId).sort();
  }
  return [];
}

function roleAssignmentMatchesEngine(assignment: RbacRoleAssignment, engineId: string, materializedEngineSetIds: Set<string>): boolean {
  // Transition diagnostics must inspect pre-canonical rows while local data
  // migrations are still in progress. Authorization never uses this fallback.
  if (assignment.resourceType === 'engine' && assignment.resourceId === engineId) return true;
  if (assignment.scopeType === 'engine' && assignment.scopeId === engineId) return true;
  return assignment.scopeType === 'engine_set' && Boolean(assignment.scopeId && materializedEngineSetIds.has(assignment.scopeId));
}

export class SsoEngineAccessSnapshotService {
  async listSnapshots(query: SsoEngineAccessSnapshotQuery = {}): Promise<SsoEngineAccessSnapshotView[]> {
    const dataSource = await getDataSource();
    return this.listSnapshotsInStore(dataSource, query);
  }

  async listSnapshotsForEngine(engineId: string, tenantId?: string | null): Promise<SsoEngineAccessSnapshotView[]> {
    return this.listSnapshots({ engineId, tenantId });
  }

  async listSnapshotsInStore(store: SnapshotStore, query: SsoEngineAccessSnapshotQuery = {}): Promise<SsoEngineAccessSnapshotView[]> {
    const qb = store.getRepository(SsoEngineAccessSnapshot).createQueryBuilder('snapshot')
      .orderBy('snapshot.lastSyncedAt', 'DESC')
      .addOrderBy('snapshot.updatedAt', 'DESC')
      .limit(Math.min(Math.max(Number(query.limit ?? 200), 1), 500));

    addTenantScopeFilter(qb, 'snapshot', query.tenantId);
    if (query.providerId) qb.andWhere('snapshot.providerId = :providerId', { providerId: query.providerId });
    if (query.mappingId) qb.andWhere('snapshot.mappingId = :mappingId', { mappingId: query.mappingId });
    if (query.principalType) qb.andWhere('snapshot.principalType = :principalType', { principalType: query.principalType });
    if (query.principalId) qb.andWhere('snapshot.principalId = :principalId', { principalId: query.principalId });
    if (query.engineId) qb.andWhere('snapshot.engineId = :engineId', { engineId: query.engineId });
    if (query.status) qb.andWhere('snapshot.status = :status', { status: query.status });

    return (await qb.getMany()).map(toSnapshotView);
  }

  async recordActiveGrant(store: SnapshotStore, input: SsoSnapshotActiveGrantInput): Promise<void> {
    const snapshotRepo = store.getRepository(SsoEngineAccessSnapshot);
    const tenantId = normalizeTenantId(input.tenantId);
    const providerId = input.providerId || null;
    const principalType = input.principalType || 'user';
    const engineIds = await resolveAssignmentEngineIds(store, {
      resourceId: input.resourceId ?? null,
      scopeType: input.scopeType ?? null,
      scopeId: input.scopeId ?? null,
    } as RbacRoleAssignment);
    const now = Date.now();

    for (const engineId of engineIds) {
      const qb = snapshotRepo.createQueryBuilder('snapshot')
        .where('snapshot.mappingId = :mappingId', { mappingId: input.mappingId })
        .andWhere('snapshot.principalType = :principalType', { principalType })
        .andWhere('snapshot.principalId = :principalId', { principalId: input.principalId })
        .andWhere('snapshot.engineId = :engineId', { engineId });
      if (tenantId) {
        qb.andWhere('snapshot.tenantId = :tenantId', { tenantId });
      } else {
        qb.andWhere('snapshot.tenantId IS NULL');
      }
      if (providerId) {
        qb.andWhere('snapshot.providerId = :providerId', { providerId });
      } else {
        qb.andWhere('snapshot.providerId IS NULL');
      }

      const existing = await qb.getOne();
      const currentRoleIds = [input.roleId];
      const previousRoleIds = existing ? safeParseStringArray(existing.currentRoleIdsJson) : [];
      const roleChanged = existing && serializeStringArray(previousRoleIds) !== serializeStringArray(currentRoleIds);
      const details = {
        ...(existing ? safeParseObject(existing.details) : {}),
        ...(input.details ?? {}),
        assignmentId: input.assignmentId,
        scopeType: input.scopeType ?? 'engine',
        scopeId: input.scopeId ?? engineId,
        source: 'sso',
      };

      if (existing) {
        await snapshotRepo.update({ id: existing.id }, {
          providerSubjectIdsJson: serializeStringArray(extractProviderSubjectIds(input.claims)),
          providerGroupIdsJson: serializeStringArray(extractProviderGroupIds(input.claims)),
          providerAppRoleIdsJson: serializeStringArray(extractProviderAppRoleIds(input.claims)),
          currentRoleIdsJson: serializeStringArray(currentRoleIds),
          previousRoleIdsJson: roleChanged ? serializeStringArray(previousRoleIds) : existing.previousRoleIdsJson,
          status: 'active',
          cleanupReason: null,
          lastSeenAt: now,
          lastSyncedAt: now,
          removedAt: null,
          details: JSON.stringify(details),
          updatedAt: now,
        });
      } else {
        await snapshotRepo.insert({
          id: generateId(),
          tenantId,
          providerId,
          mappingId: input.mappingId,
          principalType,
          principalId: input.principalId,
          engineId,
          providerSubjectIdsJson: serializeStringArray(extractProviderSubjectIds(input.claims)),
          providerGroupIdsJson: serializeStringArray(extractProviderGroupIds(input.claims)),
          providerAppRoleIdsJson: serializeStringArray(extractProviderAppRoleIds(input.claims)),
          currentRoleIdsJson: serializeStringArray(currentRoleIds),
          previousRoleIdsJson: '[]',
          status: 'active',
          cleanupReason: null,
          lastSeenAt: now,
          lastSyncedAt: now,
          removedAt: null,
          details: JSON.stringify(details),
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  }

  async markAssignmentRemoved(store: SnapshotStore, assignment: RbacRoleAssignment, input: SsoSnapshotRemovalInput): Promise<void> {
    const mappingId = assignment.sourceRef || assignment.sourceMappingId;
    if (assignment.source !== 'sso' || !mappingId || !assignment.principalId) return;
    const snapshotRepo = store.getRepository(SsoEngineAccessSnapshot);
    const engineIds = await resolveAssignmentEngineIds(store, assignment);
    if (engineIds.length === 0) return;
    const now = Date.now();

    for (const engineId of engineIds) {
      const qb = snapshotRepo.createQueryBuilder('snapshot')
        .where('snapshot.mappingId = :mappingId', { mappingId })
        .andWhere('snapshot.principalType = :principalType', { principalType: assignment.principalType || 'user' })
        .andWhere('snapshot.principalId = :principalId', { principalId: assignment.principalId })
        .andWhere('snapshot.engineId = :engineId', { engineId });
      if (assignment.tenantId) {
        qb.andWhere('snapshot.tenantId = :tenantId', { tenantId: assignment.tenantId });
      } else {
        qb.andWhere('snapshot.tenantId IS NULL');
      }
      const existing = await qb.getOne();
      if (!existing) continue;
      await snapshotRepo.update({ id: existing.id }, {
        status: input.status,
        cleanupReason: input.cleanupReason ?? null,
        lastSyncedAt: now,
        removedAt: now,
        details: JSON.stringify({
          ...safeParseObject(existing.details),
          ...(input.details ?? {}),
          removedAssignmentId: assignment.id,
        }),
        updatedAt: now,
      });
    }
  }

  async markMappingRemoved(store: SnapshotStore, mappingId: string, status: SsoSnapshotRemovalInput['status'], cleanupReason?: string | null): Promise<void> {
    const now = Date.now();
    await store.getRepository(SsoEngineAccessSnapshot).createQueryBuilder()
      .update(SsoEngineAccessSnapshot)
      .set({
        status,
        cleanupReason: cleanupReason ?? null,
        lastSyncedAt: now,
        removedAt: now,
        updatedAt: now,
      })
      .where('mappingId = :mappingId', { mappingId })
      .andWhere('status = :status', { status: 'active' })
      .execute();
  }

  async previewTransitionCleanup(engineId: string, tenantId?: string | null): Promise<EngineAccessTransitionCleanupPreview> {
    const dataSource = await getDataSource();
    return this.previewTransitionCleanupInStore(dataSource, engineId, tenantId);
  }

  async applyTransitionCleanup(
    engineId: string,
    assignmentIds: string[],
    actorUserId: string,
    tenantId?: string | null,
    previewCorrelationId?: string | null
  ): Promise<EngineAccessTransitionCleanupApplyResult> {
    const dataSource = await getDataSource();
    const requestedIds = Array.from(new Set(assignmentIds.map((id) => String(id || '').trim()).filter(Boolean)));
    if (requestedIds.length === 0) {
      throw new Error('assignmentIds is required');
    }

    return dataSource.transaction(async (manager) => {
      const preview = await this.previewTransitionCleanupInStore(manager, engineId, tenantId, previewCorrelationId || undefined);
      const previewByManualId = new Map(preview.candidates.map((candidate) => [candidate.manualAssignmentId, candidate]));
      const invalidIds = requestedIds.filter((id) => !previewByManualId.has(id));
      if (invalidIds.length > 0) {
        throw new Error(`Cleanup apply contains assignments not present in the current preview: ${invalidIds.join(', ')}`);
      }

      const assignments = await manager.getRepository(RbacRoleAssignment).find({
        where: { id: In(requestedIds), source: 'manual' },
      });
      const removableIds = assignments
        .filter((assignment) => roleAssignmentMatchesEngine(assignment, engineId, new Set()))
        .map((assignment) => assignment.id);
      if (removableIds.length === 0) {
        return {
          previewCorrelationId: preview.previewCorrelationId,
          engineId,
          removedAssignmentIds: [],
          removedCount: 0,
        };
      }

      await manager.getRepository(RbacRoleAssignment).delete({ id: In(removableIds), source: 'manual' });
      await manager.getRepository(AuditLog).insert({
        id: generateId(),
        tenantId: normalizeTenantId(tenantId),
        userId: actorUserId,
        action: 'authz.engine_access_transition_cleanup.apply',
        resourceType: 'engine',
        resourceId: engineId,
        ipAddress: null,
        userAgent: null,
        details: JSON.stringify({
          previewCorrelationId: preview.previewCorrelationId,
          engineId,
          removedAssignmentIds: removableIds,
          replacementSsoAssignments: removableIds.map((id) => {
            const candidate = previewByManualId.get(id)!;
            return {
              manualAssignmentId: candidate.manualAssignmentId,
              ssoAssignmentId: candidate.ssoAssignmentId,
              sourceMappingId: candidate.sourceMappingId,
              principalType: candidate.principalType,
              principalId: candidate.principalId,
              manualRoleId: candidate.manualRoleId,
              ssoRoleId: candidate.ssoRoleId,
              recommendedAction: candidate.recommendedAction,
            };
          }),
        }),
        createdAt: Date.now(),
      });

      return {
        previewCorrelationId: preview.previewCorrelationId,
        engineId,
        removedAssignmentIds: removableIds,
        removedCount: removableIds.length,
      };
    });
  }

  async previewTransitionCleanupInStore(
    store: SnapshotStore,
    engineId: string,
    tenantId?: string | null,
    previewCorrelationId = generateId()
  ): Promise<EngineAccessTransitionCleanupPreview> {
    const assignmentRepo = store.getRepository(RbacRoleAssignment);
    const materializedRows = await store.getRepository(EngineSetMaterialization).find({
      where: { engineId },
      select: ['engineSetId'],
    });
    const materializedEngineSetIds = new Set(materializedRows.map((row) => row.engineSetId));

    const manualQb = assignmentRepo.createQueryBuilder('assignment')
      .where('assignment.source = :source', { source: 'manual' })
      .andWhere('(assignment.resourceId = :engineId OR (assignment.scopeType = :engineScope AND assignment.scopeId = :engineId))', {
        engineId,
        engineScope: 'engine',
      });
    addTenantScopeFilter(manualQb, 'assignment', tenantId);
    const manualAssignments = await manualQb.getMany();

    const ssoQb = assignmentRepo.createQueryBuilder('assignment')
      .where('assignment.source = :source', { source: 'sso' })
      .andWhere(new Array(materializedEngineSetIds.size > 0 ? 3 : 2).fill('').map((_value, index) => {
        if (index === 0) return 'assignment.resourceId = :engineId';
        if (index === 1) return '(assignment.scopeType = :engineScope AND assignment.scopeId = :engineId)';
        return '(assignment.scopeType = :engineSetScope AND assignment.scopeId IN (:...engineSetIds))';
      }).join(' OR '), {
        engineId,
        engineScope: 'engine',
        engineSetScope: 'engine_set',
        engineSetIds: Array.from(materializedEngineSetIds),
      });
    addTenantScopeFilter(ssoQb, 'assignment', tenantId);
    const ssoAssignments = await ssoQb.getMany();

    const snapshots = await this.listSnapshotsInStore(store, { engineId, tenantId, limit: 500 });
    const snapshotByPrincipalMapping = new Map(
      snapshots.map((snapshot) => [`${snapshot.principalType}:${snapshot.principalId}:${snapshot.mappingId}`, snapshot])
    );

    const candidates: EngineAccessTransitionCleanupCandidate[] = [];
    for (const manualAssignment of manualAssignments) {
      for (const ssoAssignment of ssoAssignments) {
        const manualPrincipalType = manualAssignment.principalType || 'user';
        const manualPrincipalId = manualAssignment.principalId || manualAssignment.userId;
        const ssoPrincipalType = ssoAssignment.principalType || 'user';
        const ssoPrincipalId = ssoAssignment.principalId || ssoAssignment.userId;
        if (!manualPrincipalId || !ssoPrincipalId) continue;
        if (manualPrincipalType !== ssoPrincipalType || manualPrincipalId !== ssoPrincipalId) continue;
        if (!roleAssignmentMatchesEngine(ssoAssignment, engineId, materializedEngineSetIds)) continue;

        const ssoMappingId = ssoAssignment.sourceRef || ssoAssignment.sourceMappingId;
        const snapshot = ssoMappingId
          ? snapshotByPrincipalMapping.get(`${ssoPrincipalType}:${ssoPrincipalId}:${ssoMappingId}`)
          : null;
        candidates.push({
          manualAssignmentId: manualAssignment.id,
          ssoAssignmentId: ssoAssignment.id,
          principalType: manualPrincipalType,
          principalId: manualPrincipalId,
          engineId,
          manualRoleId: manualAssignment.roleId,
          ssoRoleId: ssoAssignment.roleId,
          sourceMappingId: ssoMappingId || null,
          lastSnapshotStatus: snapshot?.status ?? null,
          recommendedAction: manualAssignment.roleId === ssoAssignment.roleId
            ? 'remove_manual_duplicate'
            : 'review_manual_conflict',
        });
      }
    }

    return {
      previewCorrelationId,
      engineId,
      candidates: candidates.sort((left, right) =>
        left.principalId.localeCompare(right.principalId) ||
        left.manualRoleId.localeCompare(right.manualRoleId) ||
        left.ssoRoleId.localeCompare(right.ssoRoleId)
      ),
    };
  }
}

export const ssoEngineAccessSnapshotService = new SsoEngineAccessSnapshotService();

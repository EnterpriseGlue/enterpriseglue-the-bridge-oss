import { camundaDelete, camundaPost } from '../bpmn-engine-client.js';
import { getDataSource } from '../../db/data-source.js';
import { Engine } from '../../infrastructure/persistence/entities/Engine.js';
import { EngineSetMaterialization } from '../../infrastructure/persistence/entities/EngineSetMaterialization.js';
import { RbacRoleAssignment } from '../../infrastructure/persistence/entities/RbacRoleAssignment.js';
import { RbacRolePermission } from '../../infrastructure/persistence/entities/RbacRolePermission.js';
import { RuntimeResource } from '../../infrastructure/persistence/entities/RuntimeResource.js';
import { RuntimeResourceSetMaterialization } from '../../infrastructure/persistence/entities/RuntimeResourceSetMaterialization.js';
import { Errors } from '../../middleware/errorHandler.js';
import {
  EngineBackstopProjectionSchema,
  EngineBackstopSyncApplyRequestSchema,
  EngineBackstopSyncRollbackRequestSchema,
  type EngineBackstopProjection,
  type EngineBackstopProjectionCandidate,
  type EngineBackstopSyncApplyRequest,
  type EngineBackstopSyncRollbackRequest,
  type EngineBackstopSyncRunSummary,
} from '../../schemas/platform-admin/engine-backstop.js';
import { hash } from '../encryption.js';
import { engineBackstopGroupMappingService, type EngineBackstopGroupMappingService } from './EngineBackstopGroupMappingService.js';
import { engineBackstopProjectionService, type EngineBackstopProjectionService } from './EngineBackstopProjectionService.js';
import { engineBackstopSyncRunService, type EngineBackstopSyncRunService } from './EngineBackstopSyncRunService.js';
import { engineBackstopSyncTaskService, type EngineBackstopSyncTaskService, type EngineBackstopSyncTaskResult } from './EngineBackstopSyncTaskService.js';

export interface CamundaBackstopOwnedGrant {
  id: string;
  nativeGroupId: string;
  camundaResourceType: 6 | 10;
  resourceKey: string;
}

export interface CamundaBackstopNativeClient {
  createAuthorization(engineId: string, input: Omit<CamundaBackstopOwnedGrant, 'id'>): Promise<{ id: string }>;
  deleteAuthorization(engineId: string, authorizationId: string): Promise<void>;
}

export class Camunda7BackstopNativeClient implements CamundaBackstopNativeClient {
  async createAuthorization(engineId: string, input: Omit<CamundaBackstopOwnedGrant, 'id'>): Promise<{ id: string }> {
    const response = await camundaPost<unknown>(engineId, '/authorization/create', {
      type: 1,
      permissions: ['READ'],
      groupId: input.nativeGroupId,
      resourceType: input.camundaResourceType,
      resourceId: input.resourceKey,
    });
    const id = response && typeof response === 'object' && 'id' in response ? String((response as { id?: unknown }).id || '').trim() : '';
    if (!id) throw new Error('Camunda authorization create response did not include an authorization id');
    return { id };
  }

  async deleteAuthorization(engineId: string, authorizationId: string): Promise<void> {
    await camundaDelete(engineId, `/authorization/${encodeURIComponent(authorizationId)}`);
  }
}

interface ProjectionBuild {
  engine: Engine;
  tenantId: string | null;
  projection: EngineBackstopProjection;
  sourceHash: string;
  desiredHash: string;
  capability: Record<string, boolean>;
}

export type EngineBackstopProjectionBuilder = (input: { engineId: string; tenantId?: string | null }) => Promise<ProjectionBuild>;

export interface EngineBackstopSyncDependencies {
  projectionBuilder?: EngineBackstopProjectionBuilder;
  projectionService?: EngineBackstopProjectionService;
  mappingService?: Pick<EngineBackstopGroupMappingService, 'activeProjectionMappings'>;
  runService?: Pick<EngineBackstopSyncRunService, 'createPreview' | 'getSummary' | 'getDetailedSnapshot' | 'listForEngine' | 'updateRun'>;
  taskService?: Pick<EngineBackstopSyncTaskService, 'enqueue' | 'runNext'>;
  nativeClient?: CamundaBackstopNativeClient;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(',')}}`;
}

function normalizeTenant(value?: string | null): string | null {
  return value?.trim() || null;
}

function desiredIdentity(grant: Pick<CamundaBackstopOwnedGrant, 'nativeGroupId' | 'camundaResourceType' | 'resourceKey'>): string {
  return `${grant.nativeGroupId}\u0000${grant.camundaResourceType}\u0000${grant.resourceKey}`;
}

function parseOwnedGrants(detail: unknown): CamundaBackstopOwnedGrant[] {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return [];
  const raw = (detail as Record<string, unknown>).ownedGrants;
  if (!Array.isArray(raw)) return [];
  const owned = raw.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const value = item as Record<string, unknown>;
    const id = typeof value.id === 'string' ? value.id.trim() : '';
    const nativeGroupId = typeof value.nativeGroupId === 'string' ? value.nativeGroupId.trim() : '';
    const resourceKey = typeof value.resourceKey === 'string' ? value.resourceKey.trim() : '';
    const camundaResourceType = value.camundaResourceType === 6 || value.camundaResourceType === 10 ? value.camundaResourceType : null;
    return id && nativeGroupId && resourceKey && camundaResourceType
      ? [{ id, nativeGroupId, resourceKey, camundaResourceType: camundaResourceType as 6 | 10 }]
      : [];
  });
  return [...new Map(owned.map((grant) => [grant.id, grant])).values()];
}

function projectionFromDetail(detail: unknown): EngineBackstopProjection {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) throw new Error('Backstop preview detail is invalid');
  return EngineBackstopProjectionSchema.parse((detail as Record<string, unknown>).projection);
}

function candidateFor(assignment: RbacRoleAssignment, permissionIds: string[], resource: RuntimeResource | null): EngineBackstopProjectionCandidate {
  const principalType = assignment.principalType === 'group' || assignment.principalType === 'user' || assignment.principalType === 'api_client'
    ? assignment.principalType
    : 'service_account';
  return {
    sourceAssignmentId: assignment.id,
    tenantId: assignment.tenantId || null,
    principal: { type: principalType, id: assignment.principalId },
    permissionIds,
    expiresAt: assignment.expiresAt == null ? null : Number(assignment.expiresAt),
    resource: resource ? {
      engineId: resource.engineId,
      kind: resource.resourceKind,
      key: resource.resourceKey,
      tenantId: resource.tenantId || null,
      isActive: resource.isActive,
      tenantResolutionStatus: ['resolved', 'unmapped', 'conflict', 'stale'].includes(resource.tenantResolutionStatus)
        ? resource.tenantResolutionStatus as 'resolved' | 'unmapped' | 'conflict' | 'stale'
        : 'unmapped',
    } : null,
  };
}

function backstopError(code: 'ENGINE_BACKSTOP_ENGINE_NOT_SUPPORTED' | 'ENGINE_BACKSTOP_ENGINE_INACTIVE' | 'ENGINE_BACKSTOP_CONNECTION_NOT_SUPPORTED' | 'ENGINE_BACKSTOP_TENANT_REQUIRED' | 'ENGINE_BACKSTOP_SOURCE_CHANGED' | 'ENGINE_BACKSTOP_PREVIEW_NOT_USABLE', message: string, status = 409) {
  return Errors.withCode(code, message, status, 'backstop');
}

export class EngineBackstopSyncService {
  private readonly projectionService: EngineBackstopProjectionService;
  private readonly mappingService: Pick<EngineBackstopGroupMappingService, 'activeProjectionMappings'>;
  private readonly runService: Pick<EngineBackstopSyncRunService, 'createPreview' | 'getSummary' | 'getDetailedSnapshot' | 'listForEngine' | 'updateRun'>;
  private readonly taskService: Pick<EngineBackstopSyncTaskService, 'enqueue' | 'runNext'>;
  private readonly nativeClient: CamundaBackstopNativeClient;
  private readonly projectionBuilder?: EngineBackstopProjectionBuilder;

  constructor(dependencies: EngineBackstopSyncDependencies = {}) {
    this.projectionService = dependencies.projectionService || engineBackstopProjectionService;
    this.mappingService = dependencies.mappingService || engineBackstopGroupMappingService;
    this.runService = dependencies.runService || engineBackstopSyncRunService;
    this.taskService = dependencies.taskService || engineBackstopSyncTaskService;
    this.nativeClient = dependencies.nativeClient || new Camunda7BackstopNativeClient();
    this.projectionBuilder = dependencies.projectionBuilder;
  }

  async preview(input: { engineId: string; tenantId?: string | null; actorId?: string | null }): Promise<EngineBackstopSyncRunSummary> {
    const built = await this.buildProjection(input);
    return this.runService.createPreview({
      engineId: built.engine.id,
      tenantId: built.tenantId,
      sourceHash: built.sourceHash,
      desiredHash: built.desiredHash,
      projection: built.projection,
      capability: built.capability,
      actorId: input.actorId || null,
    });
  }

  async apply(input: { engineId: string; tenantId?: string | null; runId: string; request: EngineBackstopSyncApplyRequest; actorId?: string | null }): Promise<{ run: EngineBackstopSyncRunSummary; task: EngineBackstopSyncTaskResult | null }> {
    const request = EngineBackstopSyncApplyRequestSchema.parse(input.request);
    const run = await this.runService.getSummary(input.runId);
    const tenantId = normalizeTenant(input.tenantId);
    if (!run || run.engineId !== input.engineId.trim() || run.tenantId !== tenantId) throw Errors.notFound('Backstop sync run');
    if (run.status !== 'previewed' && run.status !== 'failed') {
      throw backstopError('ENGINE_BACKSTOP_PREVIEW_NOT_USABLE', 'Only a previewed or retryable failed backstop run may be applied');
    }
    if (run.desiredHash !== request.desiredHash) {
      throw backstopError('ENGINE_BACKSTOP_SOURCE_CHANGED', 'The reviewed desired hash does not match the preview; create a new preview');
    }
    const built = await this.buildProjection({ engineId: run.engineId, tenantId: run.tenantId });
    if (built.sourceHash !== run.sourceHash || built.desiredHash !== run.desiredHash) {
      throw backstopError('ENGINE_BACKSTOP_SOURCE_CHANGED', 'Authorization source changed since preview; create and review a new preview');
    }
    await this.runService.updateRun({ id: run.id, status: 'queued' });
    await this.taskService.enqueue({ engineId: run.engineId, tenantId: run.tenantId, runId: run.id, sourceHash: run.sourceHash, operation: 'apply' });
    const task = await this.taskService.runNext((task) => this.executeTask(task), { runId: run.id });
    const updated = await this.runService.getSummary(run.id);
    if (!updated) throw Errors.notFound('Backstop sync run');
    return { run: updated, task };
  }

  async rollback(input: { engineId: string; tenantId?: string | null; runId: string; request: EngineBackstopSyncRollbackRequest; actorId?: string | null }): Promise<{ run: EngineBackstopSyncRunSummary; task: EngineBackstopSyncTaskResult | null }> {
    EngineBackstopSyncRollbackRequestSchema.parse(input.request);
    const sourceRun = await this.runService.getSummary(input.runId);
    const tenantId = normalizeTenant(input.tenantId);
    if (!sourceRun || sourceRun.engineId !== input.engineId.trim() || sourceRun.tenantId !== tenantId) throw Errors.notFound('Backstop sync run');
    if (sourceRun.status !== 'succeeded') {
      throw backstopError('ENGINE_BACKSTOP_PREVIEW_NOT_USABLE', 'Only a successful backstop synchronization with retained owned-grant evidence may be rolled back');
    }
    const sourceDetail = await this.runService.getDetailedSnapshot(sourceRun.id);
    if (!sourceDetail) throw backstopError('ENGINE_BACKSTOP_PREVIEW_NOT_USABLE', 'The owned-grant receipt expired; no broad native delete is permitted');
    const projection = projectionFromDetail(sourceDetail);
    const rollbackRun = await this.runService.createPreview({
      engineId: sourceRun.engineId, tenantId: sourceRun.tenantId, sourceHash: sourceRun.sourceHash, desiredHash: sourceRun.desiredHash,
      projection, capability: sourceRun.capability, actorId: input.actorId || null,
    });
    await this.runService.updateRun({
      id: rollbackRun.id,
      status: 'queued',
      rollbackOfRunId: sourceRun.id,
      detailedSnapshot: { version: 1, rollbackOfRunId: sourceRun.id, ownedGrants: parseOwnedGrants(sourceDetail) },
    });
    await this.taskService.enqueue({ engineId: rollbackRun.engineId, tenantId: rollbackRun.tenantId, runId: rollbackRun.id, sourceHash: rollbackRun.sourceHash, operation: 'rollback' });
    const task = await this.taskService.runNext((task) => this.executeTask(task), { runId: rollbackRun.id });
    const updated = await this.runService.getSummary(rollbackRun.id);
    if (!updated) throw Errors.notFound('Backstop rollback run');
    return { run: updated, task };
  }

  private async executeTask(task: { engineId: string; tenantId: string | null; runId: string; sourceHash: string; operation: 'apply' | 'rollback' | 'drift_check' }): Promise<Record<string, unknown>> {
    if (task.operation === 'rollback') return this.executeRollback(task);
    if (task.operation !== 'apply') throw new Error(`Unsupported backstop task operation: ${task.operation}`);
    const run = await this.runService.getSummary(task.runId);
    if (!run) throw new Error('Backstop sync run was not found');
    try {
      const built = await this.buildProjection({ engineId: task.engineId, tenantId: task.tenantId });
      if (built.sourceHash !== task.sourceHash || built.sourceHash !== run.sourceHash || built.desiredHash !== run.desiredHash) {
        throw backstopError('ENGINE_BACKSTOP_SOURCE_CHANGED', 'Authorization source changed while the task was queued; create a new preview');
      }
      const detail = await this.runService.getDetailedSnapshot(run.id);
      const projection = projectionFromDetail(detail);
      const currentOwned = parseOwnedGrants(detail);
      const priorOwned = currentOwned.length > 0 ? currentOwned : await this.ownedGrantsFromPriorRun(run);
      const desired = projection.desiredGrants.map((grant) => ({
        nativeGroupId: grant.nativeGroupId,
        camundaResourceType: grant.camundaResourceType,
        resourceKey: grant.resourceKey,
      }));
      const desiredByIdentity = new Map(desired.map((grant) => [desiredIdentity(grant), grant]));
      const existingByIdentity = new Map(priorOwned.map((grant) => [desiredIdentity(grant), grant]));
      const retained = [...existingByIdentity.values()].filter((grant) => desiredByIdentity.has(desiredIdentity(grant)));
      let owned = [...retained];
      await this.runService.updateRun({ id: run.id, status: 'running', detailedSnapshot: { version: 1, projection, ownedGrants: owned } });
      for (const grant of desired) {
        if (existingByIdentity.has(desiredIdentity(grant))) continue;
        const created = await this.nativeClient.createAuthorization(run.engineId, grant);
        owned = [...owned, { ...grant, id: created.id }];
        await this.runService.updateRun({ id: run.id, status: 'running', detailedSnapshot: { version: 1, projection, ownedGrants: owned } });
      }
      const retainedIds = new Set(retained.map((grant) => grant.id));
      for (const grant of priorOwned) {
        if (retainedIds.has(grant.id)) continue;
        await this.nativeClient.deleteAuthorization(run.engineId, grant.id);
      }
      const resultHash = hash(stableJson(owned
        .map(({ id, ...grant }) => ({ ...grant, id }))
        .sort((left, right) => left.id.localeCompare(right.id))));
      const completed = await this.runService.updateRun({
        id: run.id, status: 'succeeded', resultHash, completed: true,
        detailedSnapshot: { version: 1, projection, ownedGrants: owned },
      });
      if (!completed) throw new Error('Backstop sync run disappeared during apply');
      return { createdCount: owned.length - retained.length, retainedCount: retained.length, deletedCount: priorOwned.length - retained.length, resultHash };
    } catch (error) {
      await this.runService.updateRun({ id: task.runId, status: 'failed', completed: true });
      throw error;
    }
  }

  private async executeRollback(task: { engineId: string; tenantId: string | null; runId: string; sourceHash: string }): Promise<Record<string, unknown>> {
    const rollbackRun = await this.runService.getSummary(task.runId);
    if (!rollbackRun || !rollbackRun.rollbackOfRunId) throw new Error('Backstop rollback run is invalid');
    try {
      const detail = await this.runService.getDetailedSnapshot(rollbackRun.id);
      const ownedGrants = parseOwnedGrants(detail);
      if (!detail) throw backstopError('ENGINE_BACKSTOP_PREVIEW_NOT_USABLE', 'The rollback receipt expired; no broad native delete is permitted');
      await this.runService.updateRun({ id: rollbackRun.id, status: 'running', detailedSnapshot: { version: 1, rollbackOfRunId: rollbackRun.rollbackOfRunId, ownedGrants } });
      for (const grant of ownedGrants) await this.nativeClient.deleteAuthorization(rollbackRun.engineId, grant.id);
      const resultHash = hash(stableJson(ownedGrants.map((grant) => grant.id).sort()));
      await this.runService.updateRun({ id: rollbackRun.id, status: 'rolled_back', resultHash, completed: true, detailedSnapshot: { version: 1, rollbackOfRunId: rollbackRun.rollbackOfRunId, ownedGrants } });
      await this.runService.updateRun({ id: rollbackRun.rollbackOfRunId, status: 'rolled_back', completed: true });
      return { deletedCount: ownedGrants.length, resultHash };
    } catch (error) {
      await this.runService.updateRun({ id: task.runId, status: 'failed', completed: true });
      throw error;
    }
  }

  private async ownedGrantsFromPriorRun(run: EngineBackstopSyncRunSummary): Promise<CamundaBackstopOwnedGrant[]> {
    const history = await this.runService.listForEngine({ engineId: run.engineId, tenantId: run.tenantId, limit: 100 });
    const prior = history.find((item) => item.id !== run.id && item.status === 'succeeded');
    if (!prior) return [];
    const detail = await this.runService.getDetailedSnapshot(prior.id);
    if (!detail) {
      throw backstopError('ENGINE_BACKSTOP_PREVIEW_NOT_USABLE', 'The prior owned-grant receipt expired; do not apply until it is recovered or explicitly retired', 409);
    }
    return parseOwnedGrants(detail);
  }

  private async buildProjection(input: { engineId: string; tenantId?: string | null }): Promise<ProjectionBuild> {
    if (this.projectionBuilder) return this.projectionBuilder(input);
    const dataSource = await getDataSource();
    const engineId = input.engineId.trim();
    const engine = await dataSource.getRepository(Engine).findOne({ where: { id: engineId } });
    if (!engine) throw Errors.notFound('Engine', engineId);
    if (engine.type !== 'camunda7') throw backstopError('ENGINE_BACKSTOP_ENGINE_NOT_SUPPORTED', 'Mirrored authorization backstop is supported only for Camunda 7 engines');
    if (engine.lifecycleStatus !== 'active') throw backstopError('ENGINE_BACKSTOP_ENGINE_INACTIVE', 'Mirrored authorization backstop requires an active engine');
    if (engine.connectionMode === 'customer_sidecar') throw backstopError('ENGINE_BACKSTOP_CONNECTION_NOT_SUPPORTED', 'Mirrored authorization backstop requires a direct trusted Camunda endpoint');
    const requestedTenantId = normalizeTenant(input.tenantId);
    const tenantId = engine.tenancyMode === 'shared'
      ? requestedTenantId
      : normalizeTenant(engine.tenantId);
    if (engine.tenancyMode === 'shared' && !tenantId) throw backstopError('ENGINE_BACKSTOP_TENANT_REQUIRED', 'A shared engine requires a concrete tenant for backstop synchronization');
    if (engine.tenancyMode !== 'shared' && requestedTenantId !== tenantId) throw backstopError('ENGINE_BACKSTOP_TENANT_REQUIRED', 'The requested tenant does not match the dedicated engine tenant');
    const [mappings, assignments, rolePermissions, resources, resourceSetMaterializations, engineSetMaterializations] = await Promise.all([
      this.mappingService.activeProjectionMappings(engineId, tenantId),
      dataSource.getRepository(RbacRoleAssignment).find(),
      dataSource.getRepository(RbacRolePermission).find(),
      dataSource.getRepository(RuntimeResource).find({ where: { engineId, isActive: true } }),
      dataSource.getRepository(RuntimeResourceSetMaterialization).find(),
      dataSource.getRepository(EngineSetMaterialization).find({ where: { engineId } }),
    ]);
    const permissionsByRole = new Map<string, string[]>();
    for (const permission of rolePermissions) {
      permissionsByRole.set(permission.roleId, [...(permissionsByRole.get(permission.roleId) || []), permission.permissionId]);
    }
    const resourcesById = new Map(resources.map((resource) => [resource.id, resource]));
    const resourceIdsBySet = new Map<string, string[]>();
    for (const materialization of resourceSetMaterializations) {
      resourceIdsBySet.set(materialization.runtimeResourceSetId, [...(resourceIdsBySet.get(materialization.runtimeResourceSetId) || []), materialization.runtimeResourceId]);
    }
    const engineSetIds = new Set(engineSetMaterializations.map((materialization) => materialization.engineSetId));
    const candidates: EngineBackstopProjectionCandidate[] = [];
    for (const assignment of assignments) {
      if ((assignment.tenantId || null) !== tenantId) continue;
      const permissionIds = [...new Set(permissionsByRole.get(assignment.roleId) || [])].sort();
      if (!permissionIds.includes('engine:instance:view')) continue;
      if (assignment.scopeType === 'engine_runtime_resource') {
        const resource = assignment.scopeId ? resourcesById.get(assignment.scopeId) || null : null;
        if (resource) candidates.push(candidateFor(assignment, permissionIds, resource));
        continue;
      }
      if (assignment.scopeType === 'engine_runtime_resource_set') {
        const matched = assignment.scopeId ? (resourceIdsBySet.get(assignment.scopeId) || []).map((id) => resourcesById.get(id)).filter((resource): resource is RuntimeResource => Boolean(resource)) : [];
        if (matched.length === 0) candidates.push(candidateFor(assignment, permissionIds, null));
        else matched.forEach((resource) => candidates.push(candidateFor(assignment, permissionIds, resource)));
        continue;
      }
      const relevantBroadScope = (assignment.scopeType === 'engine' && (!assignment.scopeId || assignment.scopeId === engineId))
        || (assignment.scopeType === 'engine_set' && assignment.scopeId !== null && engineSetIds.has(assignment.scopeId))
        || ['platform', 'tenant', 'project'].includes(assignment.scopeType);
      if (relevantBroadScope) candidates.push(candidateFor(assignment, permissionIds, null));
    }
    if (candidates.length > 50_000) throw backstopError('ENGINE_BACKSTOP_PREVIEW_NOT_USABLE', 'Backstop preview exceeds the supported candidate limit; narrow the authorization scope');
    const projection = this.projectionService.project({
      engineId, engineType: engine.type, tenancyMode: engine.tenancyMode === 'shared' ? 'shared' : 'dedicated', tenantId,
      mappings, candidates,
    });
    const sourceHash = hash(stableJson({
      engine: { id: engineId, tenancyMode: engine.tenancyMode, tenantId, runtimeAccessScope: engine.runtimeAccessScope },
      mappings: mappings.map((mapping) => ({ ...mapping })).sort((left, right) => left.authzGroupId.localeCompare(right.authzGroupId)),
      candidates: candidates.sort((left, right) => left.sourceAssignmentId.localeCompare(right.sourceAssignmentId)),
    }));
    const desiredHash = hash(stableJson(projection.desiredGrants));
    return { engine, tenantId, projection, sourceHash, desiredHash, capability: { nativeAuthorizationWrite: true, directTrustedEndpoint: true } };
  }
}

export const engineBackstopSyncService = new EngineBackstopSyncService();

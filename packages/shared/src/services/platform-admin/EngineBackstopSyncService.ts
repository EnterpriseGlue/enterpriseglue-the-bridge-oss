import {
  BpmnEngineOperationError,
  camundaDelete,
  camundaDeleteWithConnection,
  camundaGet,
  camundaGetWithConnection,
  camundaPost,
  camundaPostWithConnection,
  type EngineConnectionInput,
} from '../bpmn-engine-client.js';
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
  isEngineBackstopNativeAuthorizationEngineType,
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

/** A grant owned by EnterpriseGlue on either compatible native engine. */
export interface CamundaCompatibleBackstopOwnedGrant {
  id: string;
  nativeGroupId: string;
  camundaResourceType: 6 | 10;
  resourceKey: string;
}

export interface EngineBackstopNativeAuthorizationClient {
  createAuthorization(engineId: string, input: Omit<CamundaCompatibleBackstopOwnedGrant, 'id'>): Promise<{ id: string }>;
  deleteAuthorization(engineId: string, authorizationId: string): Promise<void>;
  /** Returns only an ID-addressed grant; it never inventories unrelated native grants. */
  readAuthorization(engineId: string, authorizationId: string): Promise<unknown | null>;
  /**
   * An optional path for callers that have already resolved the persisted
   * engine. It avoids a second data-source lookup while retaining the normal
   * hardened BPMN transport and audit path.
   */
  createAuthorizationWithConnection?(engine: EngineConnectionInput & { id: string }, input: Omit<CamundaCompatibleBackstopOwnedGrant, 'id'>): Promise<{ id: string }>;
  deleteAuthorizationWithConnection?(engine: EngineConnectionInput & { id: string }, authorizationId: string): Promise<void>;
  readAuthorizationWithConnection?(engine: EngineConnectionInput & { id: string }, authorizationId: string): Promise<unknown | null>;
}

/**
 * Bounded transport needed for native backstop authorizations.  Keeping this
 * surface small prevents a customer-sidecar from becoming a general native
 * administration proxy: the backstop client can create an exact READ grant
 * and read or delete only a recorded authorization ID.
 */
export interface EngineBackstopNativeAuthorizationTransport {
  post(engineId: string, path: string, body: unknown): Promise<unknown>;
  get(engineId: string, path: string): Promise<unknown>;
  delete(engineId: string, path: string): Promise<void>;
}

type BackstopEngineConnection = EngineConnectionInput & { id: string };
type BackstopEngineConnectionCarrier = Pick<Engine, 'id' | 'baseUrl' | 'connectionMode' | 'authType' | 'username' | 'passwordEnc' | 'oauthTokenUrl' | 'oauthScopes' | 'oauthAudience'>;
type BackstopEngineConnectionSource = BackstopEngineConnectionCarrier | BackstopEngineConnection;

const bpmnNativeAuthorizationTransport: EngineBackstopNativeAuthorizationTransport = {
  post: (engineId, path, body) => camundaPost<unknown>(engineId, path, body),
  get: (engineId, path) => camundaGet<unknown>(engineId, path),
  delete: (engineId, path) => camundaDelete(engineId, path),
};

/**
 * Uses the authorization REST contract shared by Camunda 7 and Operaton.
 * Engine type is checked before this client is invoked, so this class never
 * turns a generic BPMN endpoint into a native authorization writer.
 */
export class CamundaCompatibleBackstopNativeClient implements EngineBackstopNativeAuthorizationClient {
  constructor(private readonly transport: EngineBackstopNativeAuthorizationTransport = bpmnNativeAuthorizationTransport) {}

  async createAuthorization(engineId: string, input: Omit<CamundaCompatibleBackstopOwnedGrant, 'id'>): Promise<{ id: string }> {
    const response = await this.transport.post(engineId, '/authorization/create', {
      type: 1,
      permissions: ['READ'],
      groupId: input.nativeGroupId,
      resourceType: input.camundaResourceType,
      resourceId: input.resourceKey,
    });
    const id = response && typeof response === 'object' && 'id' in response ? String((response as { id?: unknown }).id || '').trim() : '';
    if (!id) throw new Error('Compatible engine authorization create response did not include an authorization id');
    return { id };
  }

  async deleteAuthorization(engineId: string, authorizationId: string): Promise<void> {
    await this.transport.delete(engineId, `/authorization/${encodeURIComponent(authorizationId)}`);
  }

  async readAuthorization(engineId: string, authorizationId: string): Promise<unknown | null> {
    try {
      return await this.transport.get(engineId, `/authorization/${encodeURIComponent(authorizationId)}`);
    } catch (error) {
      if (error instanceof BpmnEngineOperationError && Number(error.details?.engineStatus) === 404) return null;
      throw error;
    }
  }

  async createAuthorizationWithConnection(engine: EngineConnectionInput & { id: string }, input: Omit<CamundaCompatibleBackstopOwnedGrant, 'id'>): Promise<{ id: string }> {
    const response = await camundaPostWithConnection(engine, '/authorization/create', {
      type: 1,
      permissions: ['READ'],
      groupId: input.nativeGroupId,
      resourceType: input.camundaResourceType,
      resourceId: input.resourceKey,
    });
    const id = response && typeof response === 'object' && 'id' in response ? String((response as { id?: unknown }).id || '').trim() : '';
    if (!id) throw new Error('Compatible engine authorization create response did not include an authorization id');
    return { id };
  }

  async deleteAuthorizationWithConnection(engine: EngineConnectionInput & { id: string }, authorizationId: string): Promise<void> {
    await camundaDeleteWithConnection(engine, `/authorization/${encodeURIComponent(authorizationId)}`);
  }

  async readAuthorizationWithConnection(engine: EngineConnectionInput & { id: string }, authorizationId: string): Promise<unknown | null> {
    try {
      return await camundaGetWithConnection(engine, `/authorization/${encodeURIComponent(authorizationId)}`);
    } catch (error) {
      if (error instanceof BpmnEngineOperationError && Number(error.details?.engineStatus) === 404) return null;
      throw error;
    }
  }
}

/**
 * Generic customer-sidecar adapter. It deliberately uses the same bounded
 * Camunda-compatible contract as a direct engine, while the shared BPMN
 * connection resolver selects the registered `customer_sidecar` endpoint.
 * EnterpriseGlue therefore sends no downstream engine credential or peer
 * token; the customer-owned sidecar authenticates its own engine hop.
 */
export class CustomerSidecarBackstopNativeClient extends CamundaCompatibleBackstopNativeClient {}

/** @deprecated Use CamundaCompatibleBackstopNativeClient. */
export const Camunda7BackstopNativeClient = CamundaCompatibleBackstopNativeClient;
/** @deprecated Use CamundaCompatibleBackstopNativeClient. */
export type CamundaBackstopNativeClient = EngineBackstopNativeAuthorizationClient;
/** @deprecated Use CamundaCompatibleBackstopOwnedGrant. */
export type CamundaBackstopOwnedGrant = CamundaCompatibleBackstopOwnedGrant;

interface ProjectionBuild {
  /** A custom projection builder needs only the transport identity. */
  engine: BackstopEngineConnectionCarrier;
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
  /** Applies to both transports and preserves existing test/custom injections. */
  nativeClient?: EngineBackstopNativeAuthorizationClient;
  /** Optional direct-engine client; defaults to the Camunda-compatible transport. */
  directNativeClient?: EngineBackstopNativeAuthorizationClient;
  /** Optional customer-sidecar client; defaults to the generic bounded adapter. */
  customerSidecarNativeClient?: EngineBackstopNativeAuthorizationClient;
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

function matchesOwnedGrant(authorization: unknown, grant: CamundaBackstopOwnedGrant): boolean {
  if (!authorization || typeof authorization !== 'object' || Array.isArray(authorization)) return false;
  const value = authorization as Record<string, unknown>;
  const permissions = value.permissions;
  return Number(value.type) === 1
    && value.groupId === grant.nativeGroupId
    && Number(value.resourceType) === grant.camundaResourceType
    && value.resourceId === grant.resourceKey
    && Array.isArray(permissions)
    && permissions.length === 1
    && permissions[0] === 'READ';
}

function candidateFor(
  assignment: RbacRoleAssignment,
  permissionIds: string[],
  resource: RuntimeResource | null,
  nativeAuthorizationKeyCrossTenant = false,
): EngineBackstopProjectionCandidate {
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
      nativeAuthorizationKeyCrossTenant,
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
  /**
   * A preview/apply lifecycle has already resolved this connection. Keep it
   * only in process memory; a later durable worker still reloads it so normal
   * credential rotation takes effect.
   */
  private readonly connectionCache = new Map<string, BackstopEngineConnection>();
  private readonly projectionService: EngineBackstopProjectionService;
  private readonly mappingService: Pick<EngineBackstopGroupMappingService, 'activeProjectionMappings'>;
  private readonly runService: Pick<EngineBackstopSyncRunService, 'createPreview' | 'getSummary' | 'getDetailedSnapshot' | 'listForEngine' | 'updateRun'>;
  private readonly taskService: Pick<EngineBackstopSyncTaskService, 'enqueue' | 'runNext'>;
  private readonly directNativeClient: EngineBackstopNativeAuthorizationClient;
  private readonly customerSidecarNativeClient: EngineBackstopNativeAuthorizationClient;
  private readonly projectionBuilder?: EngineBackstopProjectionBuilder;

  constructor(dependencies: EngineBackstopSyncDependencies = {}) {
    this.projectionService = dependencies.projectionService || engineBackstopProjectionService;
    this.mappingService = dependencies.mappingService || engineBackstopGroupMappingService;
    this.runService = dependencies.runService || engineBackstopSyncRunService;
    this.taskService = dependencies.taskService || engineBackstopSyncTaskService;
    this.directNativeClient = dependencies.directNativeClient || dependencies.nativeClient || new CamundaCompatibleBackstopNativeClient();
    this.customerSidecarNativeClient = dependencies.customerSidecarNativeClient || dependencies.nativeClient || new CustomerSidecarBackstopNativeClient();
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
      capability: this.transportCapability(built),
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

  /**
   * Verifies only the authorization IDs retained in a prior successful apply
   * receipt. It does not enumerate, create, update, or delete native grants.
   */
  async driftCheck(input: { engineId: string; tenantId?: string | null; runId: string; actorId?: string | null }): Promise<{ run: EngineBackstopSyncRunSummary; task: EngineBackstopSyncTaskResult | null }> {
    const sourceRun = await this.runService.getSummary(input.runId);
    const tenantId = normalizeTenant(input.tenantId);
    if (!sourceRun || sourceRun.engineId !== input.engineId.trim() || sourceRun.tenantId !== tenantId) throw Errors.notFound('Backstop sync run');
    if (sourceRun.status !== 'succeeded' || sourceRun.rollbackOfRunId || sourceRun.observedOfRunId) {
      throw backstopError('ENGINE_BACKSTOP_PREVIEW_NOT_USABLE', 'Only a successful apply receipt with retained owned-grant evidence may be drift checked');
    }
    const sourceDetail = await this.runService.getDetailedSnapshot(sourceRun.id);
    if (!sourceDetail) throw backstopError('ENGINE_BACKSTOP_PREVIEW_NOT_USABLE', 'The owned-grant receipt expired; no native drift conclusion is permitted');
    const projection = projectionFromDetail(sourceDetail);
    const observation = await this.runService.createPreview({
      engineId: sourceRun.engineId, tenantId: sourceRun.tenantId, sourceHash: sourceRun.sourceHash, desiredHash: sourceRun.desiredHash,
      projection, capability: sourceRun.capability, actorId: input.actorId || null,
    });
    const ownedGrants = parseOwnedGrants(sourceDetail);
    await this.runService.updateRun({
      id: observation.id, status: 'queued', observedOfRunId: sourceRun.id,
      detailedSnapshot: { version: 1, observedOfRunId: sourceRun.id, projection, ownedGrants },
    });
    await this.taskService.enqueue({ engineId: observation.engineId, tenantId: observation.tenantId, runId: observation.id, sourceHash: observation.sourceHash, operation: 'drift_check' });
    const task = await this.taskService.runNext((next) => this.executeTask(next), { runId: observation.id });
    const updated = await this.runService.getSummary(observation.id);
    if (!updated) throw Errors.notFound('Backstop drift-check run');
    return { run: updated, task };
  }

  private async executeTask(task: { engineId: string; tenantId: string | null; runId: string; sourceHash: string; operation: 'apply' | 'rollback' | 'drift_check' }): Promise<Record<string, unknown>> {
    if (task.operation === 'rollback') return this.executeRollback(task);
    if (task.operation === 'drift_check') return this.executeDriftCheck(task);
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
      const nativeClient = this.nativeClientForRun(run);
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
        const created = await this.createAuthorization(nativeClient, built.engine, grant);
        owned = [...owned, { ...grant, id: created.id }];
        await this.runService.updateRun({ id: run.id, status: 'running', detailedSnapshot: { version: 1, projection, ownedGrants: owned } });
      }
      const retainedIds = new Set(retained.map((grant) => grant.id));
      for (const grant of priorOwned) {
        if (retainedIds.has(grant.id)) continue;
        await this.deleteAuthorization(nativeClient, built.engine, grant.id);
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
      const nativeClient = this.nativeClientForRun(rollbackRun);
      const connection = this.usesConnection(nativeClient) ? await this.connectionForEngine(rollbackRun.engineId) : null;
      await this.runService.updateRun({ id: rollbackRun.id, status: 'running', detailedSnapshot: { version: 1, rollbackOfRunId: rollbackRun.rollbackOfRunId, ownedGrants } });
      for (const grant of ownedGrants) await this.deleteAuthorization(nativeClient, connection, grant.id, rollbackRun.engineId);
      const resultHash = hash(stableJson(ownedGrants.map((grant) => grant.id).sort()));
      await this.runService.updateRun({ id: rollbackRun.id, status: 'rolled_back', resultHash, completed: true, detailedSnapshot: { version: 1, rollbackOfRunId: rollbackRun.rollbackOfRunId, ownedGrants } });
      await this.runService.updateRun({ id: rollbackRun.rollbackOfRunId, status: 'rolled_back', completed: true });
      return { deletedCount: ownedGrants.length, resultHash };
    } catch (error) {
      await this.runService.updateRun({ id: task.runId, status: 'failed', completed: true });
      throw error;
    }
  }

  private async executeDriftCheck(task: { engineId: string; tenantId: string | null; runId: string; sourceHash: string }): Promise<Record<string, unknown>> {
    const observation = await this.runService.getSummary(task.runId);
    if (!observation?.observedOfRunId) throw new Error('Backstop drift-check run is invalid');
    try {
      const detail = await this.runService.getDetailedSnapshot(observation.id);
      if (!detail) throw backstopError('ENGINE_BACKSTOP_PREVIEW_NOT_USABLE', 'The drift-check receipt expired before it could be read');
      const ownedGrants = parseOwnedGrants(detail);
      const nativeClient = this.nativeClientForRun(observation);
      const connection = this.usesConnection(nativeClient) ? await this.connectionForEngine(observation.engineId) : null;
      await this.runService.updateRun({ id: observation.id, status: 'running', detailedSnapshot: detail });
      let intactCount = 0;
      let missingCount = 0;
      let alteredCount = 0;
      for (const grant of ownedGrants) {
        const nativeGrant = await this.readAuthorization(nativeClient, connection, grant.id, observation.engineId);
        if (nativeGrant === null) missingCount += 1;
        else if (matchesOwnedGrant(nativeGrant, grant)) intactCount += 1;
        else alteredCount += 1;
      }
      const outOfSync = missingCount > 0 || alteredCount > 0;
      const resultHash = hash(stableJson({ observedOfRunId: observation.observedOfRunId, ownedGrantIds: ownedGrants.map((grant) => grant.id).sort(), intactCount, missingCount, alteredCount }));
      await this.runService.updateRun({
        id: observation.id, status: outOfSync ? 'out_of_sync' : 'succeeded', resultHash, completed: true, detailedSnapshot: detail,
      });
      return { observedGrantCount: ownedGrants.length, intactCount, missingCount, alteredCount, outOfSync, resultHash };
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

  private transportCapability(built: ProjectionBuild): Record<string, boolean> {
    const customerSidecarTransport = built.engine.connectionMode === 'customer_sidecar';
    return {
      ...built.capability,
      directTrustedEndpoint: !customerSidecarTransport,
      customerSidecarTransport,
    };
  }

  private nativeClientForRun(run: EngineBackstopSyncRunSummary): EngineBackstopNativeAuthorizationClient {
    return run.capability.customerSidecarTransport ? this.customerSidecarNativeClient : this.directNativeClient;
  }

  private usesConnection(nativeClient: EngineBackstopNativeAuthorizationClient): boolean {
    return Boolean(
      nativeClient.createAuthorizationWithConnection
      || nativeClient.deleteAuthorizationWithConnection
      || nativeClient.readAuthorizationWithConnection,
    );
  }

  private toConnection(engine: BackstopEngineConnectionSource | null): BackstopEngineConnection | null {
    if (!engine?.id || !engine.baseUrl) return null;
    return {
      id: engine.id,
      baseUrl: engine.baseUrl,
      connectionMode: engine.connectionMode,
      authType: engine.authType,
      username: engine.username,
      passwordEnc: engine.passwordEnc,
      oauthTokenUrl: engine.oauthTokenUrl,
      oauthScopes: engine.oauthScopes,
      oauthAudience: engine.oauthAudience,
    };
  }

  private async connectionForEngine(engineId: string): Promise<BackstopEngineConnection | null> {
    const cached = this.connectionCache.get(engineId);
    if (cached) return cached;
    // Do not hydrate unrelated Engine metadata merely to execute a receipt.
    // This keeps durable rollback/drift reads narrowly scoped and compatible
    // with databases that pre-date non-connection Engine columns.
    const engine = await (await getDataSource()).getRepository(Engine)
      .createQueryBuilder('engine')
      .select([
        'engine.id',
        'engine.baseUrl',
        'engine.connectionMode',
        'engine.authType',
        'engine.username',
        'engine.passwordEnc',
        'engine.oauthTokenUrl',
        'engine.oauthScopes',
        'engine.oauthAudience',
      ])
      .where('engine.id = :engineId', { engineId })
      .getOne();
    const connection = this.toConnection(engine);
    if (connection) this.connectionCache.set(connection.id, connection);
    return connection;
  }

  private async createAuthorization(nativeClient: EngineBackstopNativeAuthorizationClient, engine: BackstopEngineConnectionSource | null, grant: Omit<CamundaCompatibleBackstopOwnedGrant, 'id'>): Promise<{ id: string }> {
    const connection = this.toConnection(engine);
    if (connection && nativeClient.createAuthorizationWithConnection) return nativeClient.createAuthorizationWithConnection(connection, grant);
    return nativeClient.createAuthorization(connection?.id || engine?.id || '', grant);
  }

  private async deleteAuthorization(nativeClient: EngineBackstopNativeAuthorizationClient, engine: BackstopEngineConnectionSource | null, authorizationId: string, fallbackEngineId = ''): Promise<void> {
    const connection = this.toConnection(engine);
    if (connection && nativeClient.deleteAuthorizationWithConnection) {
      await nativeClient.deleteAuthorizationWithConnection(connection, authorizationId);
      return;
    }
    await nativeClient.deleteAuthorization(connection?.id || engine?.id || fallbackEngineId, authorizationId);
  }

  private async readAuthorization(nativeClient: EngineBackstopNativeAuthorizationClient, engine: BackstopEngineConnectionSource | null, authorizationId: string, fallbackEngineId = ''): Promise<unknown | null> {
    const connection = this.toConnection(engine);
    if (connection && nativeClient.readAuthorizationWithConnection) return nativeClient.readAuthorizationWithConnection(connection, authorizationId);
    return nativeClient.readAuthorization(connection?.id || engine?.id || fallbackEngineId, authorizationId);
  }

  private async buildProjection(input: { engineId: string; tenantId?: string | null }): Promise<ProjectionBuild> {
    if (this.projectionBuilder) {
      const built = await this.projectionBuilder(input);
      const connection = this.toConnection(built.engine);
      if (connection) this.connectionCache.set(connection.id, connection);
      return built;
    }
    const dataSource = await getDataSource();
    const engineId = input.engineId.trim();
    const engine = await dataSource.getRepository(Engine).findOne({ where: { id: engineId } });
    if (!engine) throw Errors.notFound('Engine', engineId);
    if (!isEngineBackstopNativeAuthorizationEngineType(engine.type)) throw backstopError('ENGINE_BACKSTOP_ENGINE_NOT_SUPPORTED', 'Mirrored authorization backstop is supported only for Camunda 7 and Operaton engines');
    if (engine.lifecycleStatus !== 'active') throw backstopError('ENGINE_BACKSTOP_ENGINE_INACTIVE', 'Mirrored authorization backstop requires an active engine');
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
    const tenantIdsByNativeAuthorizationKey = new Map<string, Set<string>>();
    for (const resource of resources) {
      if (!resource.isActive || resource.tenantResolutionStatus !== 'resolved') continue;
      const key = `${resource.resourceKind}\u0000${resource.resourceKey}`;
      const tenantIds = tenantIdsByNativeAuthorizationKey.get(key) || new Set<string>();
      tenantIds.add(resource.tenantId || '');
      tenantIdsByNativeAuthorizationKey.set(key, tenantIds);
    }
    const nativeAuthorizationKeyCrossTenant = (resource: RuntimeResource) => {
      if (engine.tenancyMode !== 'shared') return false;
      const key = `${resource.resourceKind}\u0000${resource.resourceKey}`;
      return (tenantIdsByNativeAuthorizationKey.get(key)?.size || 0) > 1;
    };
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
        if (resource) candidates.push(candidateFor(assignment, permissionIds, resource, nativeAuthorizationKeyCrossTenant(resource)));
        continue;
      }
      if (assignment.scopeType === 'engine_runtime_resource_set') {
        const matched = assignment.scopeId ? (resourceIdsBySet.get(assignment.scopeId) || []).map((id) => resourcesById.get(id)).filter((resource): resource is RuntimeResource => Boolean(resource)) : [];
        if (matched.length === 0) candidates.push(candidateFor(assignment, permissionIds, null));
        else matched.forEach((resource) => candidates.push(candidateFor(assignment, permissionIds, resource, nativeAuthorizationKeyCrossTenant(resource))));
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
    const built = {
      engine,
      tenantId,
      projection,
      sourceHash,
      desiredHash,
      capability: {
        nativeAuthorizationWrite: true,
        directTrustedEndpoint: engine.connectionMode !== 'customer_sidecar',
        customerSidecarTransport: engine.connectionMode === 'customer_sidecar',
      },
    };
    const connection = this.toConnection(built.engine);
    if (connection) this.connectionCache.set(connection.id, connection);
    return built;
  }
}

export const engineBackstopSyncService = new EngineBackstopSyncService();

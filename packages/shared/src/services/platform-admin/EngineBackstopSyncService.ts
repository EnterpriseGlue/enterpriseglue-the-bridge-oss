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
import { EngineSet } from '../../infrastructure/persistence/entities/EngineSet.js';
import { RbacRole } from '../../infrastructure/persistence/entities/RbacRole.js';
import { RbacRoleAssignment } from '../../infrastructure/persistence/entities/RbacRoleAssignment.js';
import { RbacRolePermission } from '../../infrastructure/persistence/entities/RbacRolePermission.js';
import { RuntimeResource } from '../../infrastructure/persistence/entities/RuntimeResource.js';
import { RuntimeResourceSet } from '../../infrastructure/persistence/entities/RuntimeResourceSet.js';
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
import { blindIndex } from '../encryption.js';
import { engineBackstopGroupMappingService, type EngineBackstopGroupMappingService } from './EngineBackstopGroupMappingService.js';
import { engineBackstopProjectionService, type EngineBackstopProjectionService } from './EngineBackstopProjectionService.js';
import { engineBackstopSyncRunService, type EngineBackstopSyncRunService, type UpdateEngineBackstopRunInput } from './EngineBackstopSyncRunService.js';
import { EngineBackstopTaskLeaseLostError, engineBackstopSyncTaskService, type EngineBackstopSyncTaskService, type EngineBackstopSyncTaskResult } from './EngineBackstopSyncTaskService.js';

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
  /** Bounded exact-match inventory used only to recover an interrupted create journal. */
  listExactAuthorizationIds(engineId: string, input: Omit<CamundaCompatibleBackstopOwnedGrant, 'id'>): Promise<string[]>;
  /**
   * An optional path for callers that have already resolved the persisted
   * engine. It avoids a second data-source lookup while retaining the normal
   * hardened BPMN transport and audit path.
   */
  createAuthorizationWithConnection?(engine: EngineConnectionInput & { id: string }, input: Omit<CamundaCompatibleBackstopOwnedGrant, 'id'>): Promise<{ id: string }>;
  deleteAuthorizationWithConnection?(engine: EngineConnectionInput & { id: string }, authorizationId: string): Promise<void>;
  readAuthorizationWithConnection?(engine: EngineConnectionInput & { id: string }, authorizationId: string): Promise<unknown | null>;
  listExactAuthorizationIdsWithConnection?(engine: EngineConnectionInput & { id: string }, input: Omit<CamundaCompatibleBackstopOwnedGrant, 'id'>): Promise<string[]>;
}

function exactAuthorizationQuery(input: Omit<CamundaCompatibleBackstopOwnedGrant, 'id'>): string {
  const query = new URLSearchParams({
    type: '1',
    groupId: input.nativeGroupId,
    resourceType: String(input.camundaResourceType),
    resourceId: input.resourceKey,
  });
  return `/authorization?${query.toString()}`;
}

function exactAuthorizationIds(response: unknown, input: Omit<CamundaCompatibleBackstopOwnedGrant, 'id'>): string[] {
  if (!Array.isArray(response)) throw new Error('Compatible engine exact authorization inventory did not return an array');
  if (response.length > 1_000) throw new Error('Compatible engine exact authorization inventory exceeded the safety limit');
  const ids = response.flatMap((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return [];
    const value = row as Record<string, unknown>;
    const id = typeof value.id === 'string' ? value.id.trim() : '';
    return id
      && Number(value.type) === 1
      && value.groupId === input.nativeGroupId
      && Number(value.resourceType) === input.camundaResourceType
      && value.resourceId === input.resourceKey
      ? [id]
      : [];
  });
  return [...new Set(ids)].sort();
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
    try {
      await this.transport.delete(engineId, `/authorization/${encodeURIComponent(authorizationId)}`);
    } catch (error) {
      // Delete is deliberately idempotent so a lease successor can resume
      // after the prior worker completed the remote call but lost its lease
      // before persisting progress.
      if (error instanceof BpmnEngineOperationError && Number(error.details?.engineStatus) === 404) return;
      throw error;
    }
  }

  async readAuthorization(engineId: string, authorizationId: string): Promise<unknown | null> {
    try {
      return await this.transport.get(engineId, `/authorization/${encodeURIComponent(authorizationId)}`);
    } catch (error) {
      if (error instanceof BpmnEngineOperationError && Number(error.details?.engineStatus) === 404) return null;
      throw error;
    }
  }

  async listExactAuthorizationIds(engineId: string, input: Omit<CamundaCompatibleBackstopOwnedGrant, 'id'>): Promise<string[]> {
    return exactAuthorizationIds(await this.transport.get(engineId, exactAuthorizationQuery(input)), input);
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
    try {
      await camundaDeleteWithConnection(engine, `/authorization/${encodeURIComponent(authorizationId)}`);
    } catch (error) {
      if (error instanceof BpmnEngineOperationError && Number(error.details?.engineStatus) === 404) return;
      throw error;
    }
  }

  async readAuthorizationWithConnection(engine: EngineConnectionInput & { id: string }, authorizationId: string): Promise<unknown | null> {
    try {
      return await camundaGetWithConnection(engine, `/authorization/${encodeURIComponent(authorizationId)}`);
    } catch (error) {
      if (error instanceof BpmnEngineOperationError && Number(error.details?.engineStatus) === 404) return null;
      throw error;
    }
  }

  async listExactAuthorizationIdsWithConnection(engine: EngineConnectionInput & { id: string }, input: Omit<CamundaCompatibleBackstopOwnedGrant, 'id'>): Promise<string[]> {
    return exactAuthorizationIds(await camundaGetWithConnection(engine, exactAuthorizationQuery(input)), input);
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
  connectionCommitment: string;
  capability: Record<string, boolean>;
}

interface ExecutableBackstopTask {
  id: string;
  leaseId: string;
  engineId: string;
  tenantId: string | null;
  runId: string;
  sourceHash: string;
  operation: 'apply' | 'rollback' | 'drift_check';
  assertLease: () => Promise<void>;
}

interface PendingBackstopCreate extends Omit<CamundaCompatibleBackstopOwnedGrant, 'id'> {
  beforeAuthorizationIds: string[];
}

export type EngineBackstopProjectionBuilder = (input: { engineId: string; tenantId?: string | null }) => Promise<Omit<ProjectionBuild, 'connectionCommitment'> & { connectionCommitment?: string }>;

export interface EngineBackstopSyncDependencies {
  projectionBuilder?: EngineBackstopProjectionBuilder;
  projectionService?: EngineBackstopProjectionService;
  mappingService?: Pick<EngineBackstopGroupMappingService, 'activeProjectionMappings'>;
  runService?: Pick<EngineBackstopSyncRunService, 'createPreview' | 'getSummary' | 'getDetailedSnapshot' | 'listForEngine' | 'getLatestSuccessfulApply' | 'updateRun' | 'updateRunWithTaskLease'>;
  taskService?: Pick<EngineBackstopSyncTaskService, 'enqueue' | 'retryNow' | 'runNext'>;
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

function protectedCommitment(domain: string, value: unknown): string {
  return blindIndex(`engine-backstop:${domain}:v1`, stableJson(value));
}

export function engineBackstopConnectionCommitment(engine: BackstopEngineConnectionSource): string {
  let baseUrl = String(engine.baseUrl || '').trim();
  try {
    const parsed = new URL(baseUrl);
    parsed.hash = '';
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    baseUrl = parsed.toString();
  } catch {
    // Invalid endpoints are rejected by the engine boundary. Keeping the
    // trimmed value here still produces a deterministic fail-closed receipt.
  }
  let oauthTokenUrl = engine.oauthTokenUrl?.trim() || null;
  if (oauthTokenUrl) {
    try {
      const parsed = new URL(oauthTokenUrl);
      parsed.hash = '';
      parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
      oauthTokenUrl = parsed.toString();
    } catch {
      // The engine boundary rejects invalid token endpoints. Preserve a
      // deterministic commitment so durable operations still fail closed.
    }
  }
  const oauthScopes = engine.oauthScopes
    ? [...new Set(engine.oauthScopes.split(/\s+/).map((scope) => scope.trim()).filter(Boolean))].sort().join(' ')
    : null;
  return protectedCommitment('engine-connection', {
    id: engine.id,
    baseUrl,
    connectionMode: engine.connectionMode,
    authType: engine.authType || 'none',
    authenticationPrincipal: engine.username?.trim() || null,
    oauthTokenUrl,
    oauthScopes,
    oauthAudience: engine.oauthAudience?.trim() || null,
  });
}

function normalizeTenant(value?: string | null): string | null {
  return value?.trim() || null;
}

function desiredIdentity(grant: Pick<CamundaBackstopOwnedGrant, 'nativeGroupId' | 'camundaResourceType' | 'resourceKey'>): string {
  return `${grant.nativeGroupId}\u0000${grant.camundaResourceType}\u0000${grant.resourceKey}`;
}

function parseGrantField(detail: unknown, field: 'ownedGrants' | 'createdByRun'): CamundaBackstopOwnedGrant[] {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return [];
  const raw = (detail as Record<string, unknown>)[field];
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

function parseOwnedGrants(detail: unknown): CamundaBackstopOwnedGrant[] {
  return parseGrantField(detail, 'ownedGrants');
}

function parseCreatedByRun(detail: unknown): CamundaBackstopOwnedGrant[] {
  return parseGrantField(detail, 'createdByRun');
}

function parsePendingCreate(detail: unknown): PendingBackstopCreate[] {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return [];
  const raw = (detail as Record<string, unknown>).pendingCreate;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const value = item as Record<string, unknown>;
    const nativeGroupId = typeof value.nativeGroupId === 'string' ? value.nativeGroupId.trim() : '';
    const resourceKey = typeof value.resourceKey === 'string' ? value.resourceKey.trim() : '';
    const camundaResourceType = value.camundaResourceType === 6 || value.camundaResourceType === 10 ? value.camundaResourceType : null;
    const beforeAuthorizationIds = Array.isArray(value.beforeAuthorizationIds)
      ? [...new Set(value.beforeAuthorizationIds.filter((id): id is string => typeof id === 'string' && Boolean(id.trim())).map((id) => id.trim()))].sort()
      : [];
    return nativeGroupId && resourceKey && camundaResourceType
      ? [{ nativeGroupId, resourceKey, camundaResourceType: camundaResourceType as 6 | 10, beforeAuthorizationIds }]
      : [];
  }).slice(0, 1);
}

function connectionCommitmentFromDetail(detail: unknown): string | null {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return null;
  const value = (detail as Record<string, unknown>).connectionCommitment;
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null;
}

function projectionFromDetail(detail: unknown): EngineBackstopProjection {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) throw new Error('Backstop preview detail is invalid');
  return EngineBackstopProjectionSchema.parse((detail as Record<string, unknown>).projection);
}

function projectionFromDetailOrEmpty(detail: unknown): EngineBackstopProjection {
  if (detail && typeof detail === 'object' && !Array.isArray(detail) && 'projection' in detail) {
    return projectionFromDetail(detail);
  }
  return EngineBackstopProjectionSchema.parse({ classifications: [], desiredGrants: [] });
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
  private readonly runService: Pick<EngineBackstopSyncRunService, 'createPreview' | 'getSummary' | 'getDetailedSnapshot' | 'listForEngine' | 'getLatestSuccessfulApply' | 'updateRun' | 'updateRunWithTaskLease'>;
  private readonly taskService: Pick<EngineBackstopSyncTaskService, 'enqueue' | 'retryNow' | 'runNext'>;
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
      connectionCommitment: built.connectionCommitment,
      capability: this.transportCapability(built),
      actorId: input.actorId || null,
    });
  }

  async apply(input: { engineId: string; tenantId?: string | null; runId: string; request: EngineBackstopSyncApplyRequest; actorId?: string | null }): Promise<{ run: EngineBackstopSyncRunSummary; task: EngineBackstopSyncTaskResult | null }> {
    const request = EngineBackstopSyncApplyRequestSchema.parse(input.request);
    const run = await this.runService.getSummary(input.runId);
    const tenantId = normalizeTenant(input.tenantId);
    if (!run || run.engineId !== input.engineId.trim() || run.tenantId !== tenantId) throw Errors.notFound('Backstop sync run');
    if (!['previewed', 'failed', 'queued', 'running'].includes(run.status)) {
      throw backstopError('ENGINE_BACKSTOP_PREVIEW_NOT_USABLE', 'Only a previewed or retryable in-progress/failed backstop run may be applied');
    }
    if (run.desiredHash !== request.desiredHash) {
      throw backstopError('ENGINE_BACKSTOP_SOURCE_CHANGED', 'The reviewed desired hash does not match the preview; create a new preview');
    }
    const built = await this.buildProjection({ engineId: run.engineId, tenantId: run.tenantId });
    const sourceChanged = built.sourceHash !== run.sourceHash || built.desiredHash !== run.desiredHash;
    const failedDetail = sourceChanged && run.status === 'failed' ? await this.runService.getDetailedSnapshot(run.id) : null;
    const needsCompensation = parseCreatedByRun(failedDetail).length > 0 || parsePendingCreate(failedDetail).length > 0;
    if (sourceChanged && !needsCompensation) {
      throw backstopError('ENGINE_BACKSTOP_SOURCE_CHANGED', 'Authorization source changed since preview; create and review a new preview');
    }
    if (run.status === 'previewed' || run.status === 'failed') {
      await this.runService.updateRun({ id: run.id, status: 'queued' });
    }
    await this.taskService.enqueue({ engineId: run.engineId, tenantId: run.tenantId, runId: run.id, sourceHash: run.sourceHash, operation: 'apply' });
    if (needsCompensation && run.status !== 'running') await this.taskService.retryNow(run.id);
    const task = await this.taskService.runNext((task) => this.executeTask(task), { runId: run.id });
    const updated = await this.runService.getSummary(run.id);
    if (!updated) throw Errors.notFound('Backstop sync run');
    if (sourceChanged) {
      const remaining = await this.runService.getDetailedSnapshot(run.id);
      if (parseCreatedByRun(remaining).length > 0) {
        throw backstopError('ENGINE_BACKSTOP_SOURCE_CHANGED', 'Authorization source changed since preview; stale-run grant cleanup is still pending and must complete before a new preview is applied');
      }
      throw backstopError('ENGINE_BACKSTOP_SOURCE_CHANGED', 'Authorization source changed since preview; grants created by the failed run were compensated and a new preview is required');
    }
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
    const projection = projectionFromDetailOrEmpty(sourceDetail);
    const connectionCommitment = connectionCommitmentFromDetail(sourceDetail);
    if (!connectionCommitment) throw backstopError('ENGINE_BACKSTOP_PREVIEW_NOT_USABLE', 'The ownership receipt is not bound to an engine connection; create a new preview');
    const rollbackRun = await this.runService.createPreview({
      engineId: sourceRun.engineId, tenantId: sourceRun.tenantId, sourceHash: sourceRun.sourceHash, desiredHash: sourceRun.desiredHash,
      projection, connectionCommitment, capability: sourceRun.capability, actorId: input.actorId || null,
    });
    await this.runService.updateRun({
      id: rollbackRun.id,
      status: 'queued',
      rollbackOfRunId: sourceRun.id,
      retainDetailedSnapshot: parseOwnedGrants(sourceDetail).length > 0,
      detailedSnapshot: { version: 1, rollbackOfRunId: sourceRun.id, connectionCommitment, ownedGrants: parseOwnedGrants(sourceDetail) },
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
    const projection = projectionFromDetailOrEmpty(sourceDetail);
    const connectionCommitment = connectionCommitmentFromDetail(sourceDetail);
    if (!connectionCommitment) throw backstopError('ENGINE_BACKSTOP_PREVIEW_NOT_USABLE', 'The ownership receipt is not bound to an engine connection; create a new preview');
    const observation = await this.runService.createPreview({
      engineId: sourceRun.engineId, tenantId: sourceRun.tenantId, sourceHash: sourceRun.sourceHash, desiredHash: sourceRun.desiredHash,
      projection, connectionCommitment, capability: sourceRun.capability, actorId: input.actorId || null,
    });
    const ownedGrants = parseOwnedGrants(sourceDetail);
    await this.runService.updateRun({
      id: observation.id, status: 'queued', observedOfRunId: sourceRun.id,
      detailedSnapshot: { version: 1, observedOfRunId: sourceRun.id, projection, connectionCommitment, ownedGrants },
    });
    await this.taskService.enqueue({ engineId: observation.engineId, tenantId: observation.tenantId, runId: observation.id, sourceHash: observation.sourceHash, operation: 'drift_check' });
    const task = await this.taskService.runNext((next) => this.executeTask(next), { runId: observation.id });
    const updated = await this.runService.getSummary(observation.id);
    if (!updated) throw Errors.notFound('Backstop drift-check run');
    return { run: updated, task };
  }

  private async executeTask(task: ExecutableBackstopTask): Promise<Record<string, unknown>> {
    if (task.operation === 'rollback') return this.executeRollback(task);
    if (task.operation === 'drift_check') return this.executeDriftCheck(task);
    if (task.operation !== 'apply') throw new Error(`Unsupported backstop task operation: ${task.operation}`);
    const run = await this.runService.getSummary(task.runId);
    if (!run) throw new Error('Backstop sync run was not found');
    try {
      const detail = await this.runService.getDetailedSnapshot(run.id);
      const projection = projectionFromDetail(detail);
      const reviewedConnectionCommitment = connectionCommitmentFromDetail(detail);
      if (!reviewedConnectionCommitment) {
        throw backstopError('ENGINE_BACKSTOP_PREVIEW_NOT_USABLE', 'The preview is not bound to an engine connection; create a new preview');
      }
      let owned = parseOwnedGrants(detail);
      let createdByRun = parseCreatedByRun(detail);
      let pendingCreate = parsePendingCreate(detail);
      const built = await this.buildProjection({ engineId: task.engineId, tenantId: task.tenantId });
      if (built.connectionCommitment !== reviewedConnectionCommitment) {
        throw backstopError('ENGINE_BACKSTOP_SOURCE_CHANGED', 'The engine endpoint, transport, or authentication identity changed since preview; create and review a new preview');
      }
      const nativeClient = this.nativeClientForRun(run);
      const persistProgress = async (pendingDelete: CamundaBackstopOwnedGrant[] = []): Promise<void> => {
        const retainsNativeSideEffectJournal = owned.length > 0
          || createdByRun.length > 0
          || pendingDelete.length > 0
          || pendingCreate.length > 0;
        await this.updateTaskRun(task, {
          id: run.id,
          status: 'running',
          retainDetailedSnapshot: retainsNativeSideEffectJournal,
          detailedSnapshot: { version: 1, projection, connectionCommitment: reviewedConnectionCommitment, ownedGrants: owned, createdByRun, pendingDelete, pendingCreate },
        });
      };
      const compensateCreated = async (): Promise<number> => {
        const uncompensated: CamundaBackstopOwnedGrant[] = [];
        for (const item of [...createdByRun].reverse()) {
          try {
            await task.assertLease();
            await this.deleteAuthorization(nativeClient, built.engine, item.id);
            await task.assertLease();
            owned = owned.filter((grant) => grant.id !== item.id);
          } catch (error) {
            if (error instanceof EngineBackstopTaskLeaseLostError) throw error;
            uncompensated.push(item);
          }
        }
        createdByRun = uncompensated.reverse();
        await persistProgress();
        return createdByRun.length;
      };
      for (const journal of pendingCreate) {
        await task.assertLease();
        const afterAuthorizationIds = await this.listExactAuthorizationIds(nativeClient, built.engine, journal);
        await task.assertLease();
        const before = new Set(journal.beforeAuthorizationIds);
        const createdIds = afterAuthorizationIds.filter((id) => !before.has(id));
        if (createdIds.length !== 1) {
          throw backstopError(
            'ENGINE_BACKSTOP_PREVIEW_NOT_USABLE',
            createdIds.length === 0
              ? 'An interrupted native grant create has no uniquely observable result; keep the journal and inspect the exact engine grant before retrying'
              : 'An interrupted native grant create is ambiguous because multiple new exact grants were observed; keep the journal and resolve it manually',
          );
        }
        const adopted = { nativeGroupId: journal.nativeGroupId, camundaResourceType: journal.camundaResourceType, resourceKey: journal.resourceKey, id: createdIds[0] };
        if (!owned.some((grant) => grant.id === adopted.id)) owned = [...owned, adopted];
        if (!createdByRun.some((grant) => grant.id === adopted.id)) createdByRun = [...createdByRun, adopted];
        pendingCreate = [];
        await persistProgress();
      }
      if (built.sourceHash !== task.sourceHash || built.sourceHash !== run.sourceHash || built.desiredHash !== run.desiredHash) {
        if (createdByRun.length > 0 && await compensateCreated() > 0) {
          throw backstopError('ENGINE_BACKSTOP_SOURCE_CHANGED', 'Authorization source changed and one or more grants from the stale run could not be compensated; inspect the retained failed-run receipt');
        }
        throw backstopError('ENGINE_BACKSTOP_SOURCE_CHANGED', 'Authorization source changed while the task was queued; create a new preview');
      }
      let priorOwnershipRunId: string | null = null;
      if (owned.length === 0) {
        const priorOwnership = await this.ownedGrantsFromPriorRun(run, reviewedConnectionCommitment);
        owned = priorOwnership.grants;
        priorOwnershipRunId = priorOwnership.runId;
      }
      const desired = projection.desiredGrants.map((grant) => ({
        nativeGroupId: grant.nativeGroupId,
        camundaResourceType: grant.camundaResourceType,
        resourceKey: grant.resourceKey,
      }));
      const desiredByIdentity = new Map(desired.map((grant) => [desiredIdentity(grant), grant]));
      const existingByIdentity = new Map(owned.map((grant) => [desiredIdentity(grant), grant]));
      const retained = [...existingByIdentity.values()].filter((grant) => desiredByIdentity.has(desiredIdentity(grant)));
      let pendingDelete = owned.filter((grant) => !desiredByIdentity.has(desiredIdentity(grant)));
      const pendingDeleteCount = pendingDelete.length;
      // Never omit an extant ID from the durable receipt before the matching
      // remote delete has completed and lease ownership is re-confirmed.
      await persistProgress(pendingDelete);
      for (const grant of desired) {
        if (existingByIdentity.has(desiredIdentity(grant))) continue;
        await task.assertLease();
        const beforeAuthorizationIds = await this.listExactAuthorizationIds(nativeClient, built.engine, grant);
        await task.assertLease();
        pendingCreate = [{ ...grant, beforeAuthorizationIds }];
        await persistProgress(pendingDelete);
        let created: { id: string };
        try {
          created = await this.createAuthorization(nativeClient, built.engine, grant);
        } catch (error) {
          // A transport error can happen after the engine committed the grant.
          // Keep the durable intent so a successor exact-inventories and
          // adopts the unique new ID instead of creating a duplicate.
          throw error;
        }
        await task.assertLease();
        const afterAuthorizationIds = await this.listExactAuthorizationIds(nativeClient, built.engine, grant);
        await task.assertLease();
        const newlyObservedIds = afterAuthorizationIds.filter((id) => !beforeAuthorizationIds.includes(id));
        if (beforeAuthorizationIds.includes(created.id) || newlyObservedIds.length !== 1 || newlyObservedIds[0] !== created.id) {
          throw backstopError(
            'ENGINE_BACKSTOP_PREVIEW_NOT_USABLE',
            'The compatible engine did not prove unique ownership of the newly created authorization; the retained create journal requires manual review',
          );
        }
        const createdAuthorization = await this.readAuthorization(nativeClient, built.engine, created.id);
        await task.assertLease();
        const ownedGrant = { ...grant, id: created.id };
        if (!matchesOwnedGrant(createdAuthorization, ownedGrant)) {
          throw backstopError(
            'ENGINE_BACKSTOP_PREVIEW_NOT_USABLE',
            'The compatible engine returned an authorization that does not exactly match the requested group READ grant; the retained create journal requires manual review',
          );
        }
        createdByRun = [...createdByRun, ownedGrant];
        owned = [...owned, ownedGrant];
        pendingCreate = [];
        await persistProgress(pendingDelete);
        const current = await this.buildProjection({ engineId: task.engineId, tenantId: task.tenantId });
        if (current.sourceHash !== task.sourceHash || current.desiredHash !== run.desiredHash) {
          if (await compensateCreated() > 0) {
            throw backstopError('ENGINE_BACKSTOP_SOURCE_CHANGED', 'Authorization source changed during apply and one or more newly created grants could not be compensated; inspect the retained failed-run receipt');
          }
          throw backstopError('ENGINE_BACKSTOP_SOURCE_CHANGED', 'Authorization source changed during apply; newly created grants were removed and a new preview is required');
        }
      }
      const currentBeforeDelete = await this.buildProjection({ engineId: task.engineId, tenantId: task.tenantId });
      if (currentBeforeDelete.sourceHash !== task.sourceHash || currentBeforeDelete.desiredHash !== run.desiredHash) {
        if (await compensateCreated() > 0) {
          throw backstopError('ENGINE_BACKSTOP_SOURCE_CHANGED', 'Authorization source changed before prior grants could be retired and one or more newly created grants could not be compensated; inspect the retained failed-run receipt');
        }
        throw backstopError('ENGINE_BACKSTOP_SOURCE_CHANGED', 'Authorization source changed before prior grants could be retired; create a new preview');
      }
      for (const grant of [...pendingDelete]) {
        await task.assertLease();
        await this.deleteAuthorization(nativeClient, built.engine, grant.id);
        await task.assertLease();
        owned = owned.filter((item) => item.id !== grant.id);
        pendingDelete = pendingDelete.filter((item) => item.id !== grant.id);
        await persistProgress(pendingDelete);
      }
      await task.assertLease();
      const finalProjection = await this.buildProjection({ engineId: task.engineId, tenantId: task.tenantId });
      if (finalProjection.sourceHash !== task.sourceHash || finalProjection.desiredHash !== run.desiredHash) {
        if (await compensateCreated() > 0) {
          throw backstopError('ENGINE_BACKSTOP_SOURCE_CHANGED', 'Authorization source changed before apply completed and one or more newly created grants could not be compensated; inspect the retained failed-run receipt');
        }
        throw backstopError('ENGINE_BACKSTOP_SOURCE_CHANGED', 'Authorization source changed before apply completed; create a new preview and reconcile the retained receipt');
      }
      const resultHash = protectedCommitment('apply-result', owned
        .map(({ id, ...grant }) => ({ ...grant, id }))
        .sort((left, right) => left.id.localeCompare(right.id)));
      if (priorOwnershipRunId) {
        await this.updateTaskRun(task, {
          id: priorOwnershipRunId,
          status: 'rolled_back',
          completed: true,
          retainDetailedSnapshot: false,
          detailedSnapshot: { version: 1, ownershipForRunId: priorOwnershipRunId, connectionCommitment: reviewedConnectionCommitment, ownedGrants: [] },
        });
      }
      const completed = await this.updateTaskRun(task, {
        id: run.id, status: 'succeeded', resultHash, completed: true,
        retainDetailedSnapshot: owned.length > 0,
        detailedSnapshot: { version: 1, ownershipForRunId: run.id, connectionCommitment: reviewedConnectionCommitment, ownedGrants: owned },
      });
      if (!completed) throw new Error('Backstop sync run disappeared during apply');
      return { createdCount: createdByRun.length, retainedCount: retained.length, deletedCount: pendingDeleteCount, resultHash };
    } catch (error) {
      if (!(error instanceof EngineBackstopTaskLeaseLostError)) {
        await this.updateTaskRun(task, { id: task.runId, status: 'failed', completed: true });
      }
      throw error;
    }
  }

  private async executeRollback(task: ExecutableBackstopTask): Promise<Record<string, unknown>> {
    const rollbackRun = await this.runService.getSummary(task.runId);
    if (!rollbackRun || !rollbackRun.rollbackOfRunId) throw new Error('Backstop rollback run is invalid');
    try {
      const detail = await this.runService.getDetailedSnapshot(rollbackRun.id);
      let ownedGrants = parseOwnedGrants(detail);
      if (!detail) throw backstopError('ENGINE_BACKSTOP_PREVIEW_NOT_USABLE', 'The rollback receipt expired; no broad native delete is permitted');
      const reviewedConnectionCommitment = connectionCommitmentFromDetail(detail);
      const currentConnectionSource = await this.connectionSourceForEngine(rollbackRun.engineId);
      if (!reviewedConnectionCommitment || !currentConnectionSource || engineBackstopConnectionCommitment(currentConnectionSource) !== reviewedConnectionCommitment) {
        throw backstopError('ENGINE_BACKSTOP_SOURCE_CHANGED', 'The engine endpoint, transport, or authentication identity changed since the owned grants were recorded; rollback is blocked');
      }
      const nativeClient = this.nativeClientForRun(rollbackRun);
      const connection = this.usesConnection(nativeClient) ? this.toConnection(currentConnectionSource) : null;
      await this.updateTaskRun(task, {
        id: rollbackRun.id,
        status: 'running',
        retainDetailedSnapshot: ownedGrants.length > 0,
        detailedSnapshot: { version: 1, rollbackOfRunId: rollbackRun.rollbackOfRunId, connectionCommitment: reviewedConnectionCommitment, ownedGrants },
      });
      const deletedCount = ownedGrants.length;
      for (const grant of [...ownedGrants]) {
        await task.assertLease();
        await this.deleteAuthorization(nativeClient, connection, grant.id, rollbackRun.engineId);
        await task.assertLease();
        ownedGrants = ownedGrants.filter((item) => item.id !== grant.id);
        await this.updateTaskRun(task, {
          id: rollbackRun.id,
          status: 'running',
          retainDetailedSnapshot: ownedGrants.length > 0,
          detailedSnapshot: { version: 1, rollbackOfRunId: rollbackRun.rollbackOfRunId, connectionCommitment: reviewedConnectionCommitment, ownedGrants },
        });
      }
      await task.assertLease();
      const resultHash = protectedCommitment('rollback-result', { rollbackOfRunId: rollbackRun.rollbackOfRunId, deletedCount });
      await this.updateTaskRun(task, {
        id: rollbackRun.id,
        status: 'rolled_back',
        resultHash,
        completed: true,
        retainDetailedSnapshot: false,
        detailedSnapshot: { version: 1, rollbackOfRunId: rollbackRun.rollbackOfRunId, connectionCommitment: reviewedConnectionCommitment, ownedGrants },
      });
      await this.updateTaskRun(task, {
        id: rollbackRun.rollbackOfRunId,
        status: 'rolled_back',
        completed: true,
        retainDetailedSnapshot: false,
        detailedSnapshot: { version: 1, ownershipForRunId: rollbackRun.rollbackOfRunId, connectionCommitment: reviewedConnectionCommitment, ownedGrants: [] },
      });
      return { deletedCount, resultHash };
    } catch (error) {
      if (!(error instanceof EngineBackstopTaskLeaseLostError)) {
        await this.updateTaskRun(task, { id: task.runId, status: 'failed', completed: true });
      }
      throw error;
    }
  }

  private async executeDriftCheck(task: ExecutableBackstopTask): Promise<Record<string, unknown>> {
    const observation = await this.runService.getSummary(task.runId);
    if (!observation?.observedOfRunId) throw new Error('Backstop drift-check run is invalid');
    try {
      const detail = await this.runService.getDetailedSnapshot(observation.id);
      if (!detail) throw backstopError('ENGINE_BACKSTOP_PREVIEW_NOT_USABLE', 'The drift-check receipt expired before it could be read');
      const ownedGrants = parseOwnedGrants(detail);
      const reviewedConnectionCommitment = connectionCommitmentFromDetail(detail);
      const currentConnectionSource = await this.connectionSourceForEngine(observation.engineId);
      if (!reviewedConnectionCommitment || !currentConnectionSource || engineBackstopConnectionCommitment(currentConnectionSource) !== reviewedConnectionCommitment) {
        throw backstopError('ENGINE_BACKSTOP_SOURCE_CHANGED', 'The engine endpoint, transport, or authentication identity changed since the owned grants were recorded; drift check is blocked');
      }
      const nativeClient = this.nativeClientForRun(observation);
      const connection = this.usesConnection(nativeClient) ? this.toConnection(currentConnectionSource) : null;
      await this.updateTaskRun(task, { id: observation.id, status: 'running', detailedSnapshot: detail });
      let intactCount = 0;
      let missingCount = 0;
      let alteredCount = 0;
      for (const grant of ownedGrants) {
        await task.assertLease();
        const nativeGrant = await this.readAuthorization(nativeClient, connection, grant.id, observation.engineId);
        if (nativeGrant === null) missingCount += 1;
        else if (matchesOwnedGrant(nativeGrant, grant)) intactCount += 1;
        else alteredCount += 1;
      }
      const outOfSync = missingCount > 0 || alteredCount > 0;
      await task.assertLease();
      const resultHash = protectedCommitment('drift-result', { observedOfRunId: observation.observedOfRunId, ownedGrantIds: ownedGrants.map((grant) => grant.id).sort(), intactCount, missingCount, alteredCount });
      await this.updateTaskRun(task, {
        id: observation.id, status: outOfSync ? 'out_of_sync' : 'succeeded', resultHash, completed: true, detailedSnapshot: detail,
      });
      return { observedGrantCount: ownedGrants.length, intactCount, missingCount, alteredCount, outOfSync, resultHash };
    } catch (error) {
      if (!(error instanceof EngineBackstopTaskLeaseLostError)) {
        await this.updateTaskRun(task, { id: task.runId, status: 'failed', completed: true });
      }
      throw error;
    }
  }

  private async ownedGrantsFromPriorRun(run: EngineBackstopSyncRunSummary, connectionCommitment: string): Promise<{ grants: CamundaBackstopOwnedGrant[]; runId: string | null }> {
    const prior = await this.runService.getLatestSuccessfulApply({
      engineId: run.engineId,
      tenantId: run.tenantId,
      excludeRunId: run.id,
    });
    if (!prior) return { grants: [], runId: null };
    const detail = await this.runService.getDetailedSnapshot(prior.id);
    if (!detail) {
      throw backstopError('ENGINE_BACKSTOP_PREVIEW_NOT_USABLE', 'The latest successful apply has no durable ownership journal; do not apply until it is recovered or explicitly retired', 409);
    }
    if (connectionCommitmentFromDetail(detail) !== connectionCommitment) {
      throw backstopError('ENGINE_BACKSTOP_SOURCE_CHANGED', 'The latest successful apply belongs to a different engine connection generation; retire or recover that ownership before applying a new preview', 409);
    }
    return { grants: parseOwnedGrants(detail), runId: prior.id };
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

  private async updateTaskRun(task: ExecutableBackstopTask, input: UpdateEngineBackstopRunInput): Promise<EngineBackstopSyncRunSummary> {
    const updated = await this.runService.updateRunWithTaskLease({ ...input, taskId: task.id, leaseId: task.leaseId, taskRunId: task.runId });
    if (!updated) throw new EngineBackstopTaskLeaseLostError('Engine backstop task lease was lost before durable run progress could be written');
    return updated;
  }

  private usesConnection(nativeClient: EngineBackstopNativeAuthorizationClient): boolean {
    return Boolean(
      nativeClient.createAuthorizationWithConnection
      || nativeClient.deleteAuthorizationWithConnection
      || nativeClient.readAuthorizationWithConnection
      || nativeClient.listExactAuthorizationIdsWithConnection,
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

  private async connectionSourceForEngine(engineId: string): Promise<BackstopEngineConnectionSource | null> {
    // Do not hydrate unrelated Engine metadata merely to execute a receipt.
    // Durable rollback/drift deliberately bypass the process cache so a
    // replacement endpoint can never inherit an older ownership receipt.
    return (await getDataSource()).getRepository(Engine)
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
  }

  private async connectionForEngine(engineId: string): Promise<BackstopEngineConnection | null> {
    return this.toConnection(await this.connectionSourceForEngine(engineId));
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

  private async listExactAuthorizationIds(nativeClient: EngineBackstopNativeAuthorizationClient, engine: BackstopEngineConnectionSource | null, grant: Omit<CamundaCompatibleBackstopOwnedGrant, 'id'>, fallbackEngineId = ''): Promise<string[]> {
    const connection = this.toConnection(engine);
    if (connection && nativeClient.listExactAuthorizationIdsWithConnection) {
      return nativeClient.listExactAuthorizationIdsWithConnection(connection, grant);
    }
    return nativeClient.listExactAuthorizationIds(connection?.id || engine?.id || fallbackEngineId, grant);
  }

  private async buildProjection(input: { engineId: string; tenantId?: string | null }): Promise<ProjectionBuild> {
    if (this.projectionBuilder) {
      const built = await this.projectionBuilder(input);
      const connectionCommitment = engineBackstopConnectionCommitment(built.engine);
      const connection = this.toConnection(built.engine);
      if (connection) this.connectionCache.set(connection.id, connection);
      return { ...built, connectionCommitment };
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
    const [mappings, roles, assignments, rolePermissions, resources, resourceSets, resourceSetMaterializations, engineSets, engineSetMaterializations] = await Promise.all([
      this.mappingService.activeProjectionMappings(engineId, tenantId),
      dataSource.getRepository(RbacRole).find(),
      dataSource.getRepository(RbacRoleAssignment).find(),
      dataSource.getRepository(RbacRolePermission).find(),
      dataSource.getRepository(RuntimeResource).find({ where: { engineId, isActive: true } }),
      dataSource.getRepository(RuntimeResourceSet).find({ where: { engineId, isArchived: false } }),
      dataSource.getRepository(RuntimeResourceSetMaterialization).find(),
      dataSource.getRepository(EngineSet).find({ where: { isArchived: false } }),
      dataSource.getRepository(EngineSetMaterialization).find({ where: { engineId } }),
    ]);
    const usableRoleIds = new Set(roles
      .filter((role) => !role.isArchived && ((role.tenantId || null) === tenantId || ((role.tenantId || null) === null && role.kind === 'system')))
      .map((role) => role.id));
    const permissionsByRole = new Map<string, string[]>();
    for (const permission of rolePermissions) {
      if (!usableRoleIds.has(permission.roleId)) continue;
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
    const usableResourceSetIds = new Set(resourceSets
      .filter((set) => (set.tenantId || null) === tenantId)
      .map((set) => set.id));
    for (const materialization of resourceSetMaterializations) {
      if (!usableResourceSetIds.has(materialization.runtimeResourceSetId)) continue;
      resourceIdsBySet.set(materialization.runtimeResourceSetId, [...(resourceIdsBySet.get(materialization.runtimeResourceSetId) || []), materialization.runtimeResourceId]);
    }
    const usableEngineSetIds = new Set(engineSets
      .filter((set) => (set.tenantId || null) === tenantId)
      .map((set) => set.id));
    const engineSetIds = new Set(engineSetMaterializations
      .filter((materialization) => usableEngineSetIds.has(materialization.engineSetId) && (materialization.tenantId || null) === tenantId)
      .map((materialization) => materialization.engineSetId));
    const candidates: EngineBackstopProjectionCandidate[] = [];
    for (const assignment of assignments) {
      if ((assignment.tenantId || null) !== tenantId) continue;
      if (!usableRoleIds.has(assignment.roleId)) continue;
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
    const connectionCommitment = engineBackstopConnectionCommitment(engine);
    const sourceHash = protectedCommitment('source', {
      engine: { id: engineId, tenancyMode: engine.tenancyMode, tenantId, runtimeAccessScope: engine.runtimeAccessScope },
      connectionCommitment,
      mappings: mappings.map((mapping) => ({ ...mapping })).sort((left, right) => left.authzGroupId.localeCompare(right.authzGroupId)),
      candidates: candidates.sort((left, right) => stableJson(left).localeCompare(stableJson(right))),
    });
    const desiredHash = protectedCommitment('desired', projection.desiredGrants);
    const built = {
      engine,
      tenantId,
      projection,
      sourceHash,
      desiredHash,
      connectionCommitment,
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

  /** Read-only current commitments used to certify that retained native grants still match canonical access. */
  async currentProjectionCommitments(input: { engineId: string; tenantId?: string | null }): Promise<Pick<ProjectionBuild, 'sourceHash' | 'desiredHash' | 'connectionCommitment'>> {
    const built = await this.buildProjection(input);
    return {
      sourceHash: built.sourceHash,
      desiredHash: built.desiredHash,
      connectionCommitment: built.connectionCommitment,
    };
  }
}

export const engineBackstopSyncService = new EngineBackstopSyncService();

import { createHash } from 'node:crypto';
import { In, type DataSource, type EntityManager } from 'typeorm';
import { getDataSource } from '../../db/data-source.js';
import { OSS_DEFAULT_TENANT_ID, normalizeTenantIdForPersistence } from '../../authz/tenant-scope.js';
import { classifyExistingEngineTenancy } from '../../engine-tenancy/classification-policy.js';
import {
  buildEngineTenancyTransitionPlan,
  type EngineTenancyTransitionInventory,
} from '../../engine-tenancy/transition-policy.js';
import { Engine } from '../../infrastructure/persistence/entities/Engine.js';
import { EngineSetMaterialization } from '../../infrastructure/persistence/entities/EngineSetMaterialization.js';
import { EngineTenantMapping } from '../../infrastructure/persistence/entities/EngineTenantMapping.js';
import { ProjectEngineTarget } from '../../infrastructure/persistence/entities/ProjectEngineTarget.js';
import { RbacRoleAssignment } from '../../infrastructure/persistence/entities/RbacRoleAssignment.js';
import { RuntimeResource } from '../../infrastructure/persistence/entities/RuntimeResource.js';
import { RuntimeResourceSet } from '../../infrastructure/persistence/entities/RuntimeResourceSet.js';
import { RuntimeResourceSetMaterialization } from '../../infrastructure/persistence/entities/RuntimeResourceSetMaterialization.js';
import { DeploymentReceipt } from '../../infrastructure/persistence/entities/DeploymentReceipt.js';
import { Errors } from '../../middleware/errorHandler.js';
import {
  EngineTenancyTransitionApplyRequestSchema,
  EngineTenancyTransitionPreviewRequestSchema,
  type EngineTenancyClassificationReport,
  type EngineTenancyConfiguration,
  type EngineTenancyTopologyState,
  type EngineTenancyTransitionApplyRequest,
  type EngineTenancyTransitionApplyResponse,
  type EngineTenancyTransitionPreviewRequest,
  type EngineTenancyTransitionPreviewResponse,
} from '../../schemas/mission-control/engine.js';
import {
  engineTenancyProvisioningService,
  type EngineTenancyPrincipalType,
  type EngineTenantReferenceResolver,
} from './EngineTenancyProvisioningService.js';

type Store = DataSource | EntityManager;

interface TransitionContext {
  requestTenantId?: string | null;
  principalType: EngineTenancyPrincipalType;
  principalId?: string | null;
  resolver?: EngineTenantReferenceResolver | null;
}

interface NormalizedTransitionPreviewRequest {
  tenancy: EngineTenancyConfiguration;
}

interface TransitionSnapshot {
  engine: Engine;
  current: EngineTenancyTopologyState;
  inventory: EngineTenancyTransitionInventory;
  resourceIds: string[];
  assignmentIdentities: string[];
  currentTenantIds: string[];
  fingerprint: string;
}

interface AffectedAssignmentSnapshot {
  count: number;
  identities: string[];
}

const PREVIEW_TTL_MS = 5 * 60 * 1000;

function transitionError(
  code:
    | 'ENGINE_TENANCY_TRANSITION_REQUIRED'
    | 'ENGINE_TENANCY_PREVIEW_STALE'
    | 'ENGINE_TENANCY_PREVIEW_EXPIRED'
    | 'ENGINE_TENANCY_ACKNOWLEDGEMENT_REQUIRED',
  message: string,
  status = 409,
) {
  return Errors.withCode(code, message, status, 'tenancy');
}

function topologyState(engine: Engine): EngineTenancyTopologyState {
  const mode = engine.tenancyMode === 'shared' ? 'shared' : 'dedicated';
  return {
    mode,
    tenantId: normalizeTenantIdForPersistence(engine.tenantId),
    mappingStrategy: mode === 'shared'
      ? engine.tenantMappingStrategy as EngineTenancyTopologyState['mappingStrategy']
      : null,
    mappingVersion: Number(engine.tenantMappingVersion || 0),
    resolutionStatus: (
      ['ready', 'incomplete', 'conflict', 'migration_required'].includes(engine.tenantResolutionStatus)
        ? engine.tenantResolutionStatus
        : 'migration_required'
    ) as EngineTenancyTopologyState['resolutionStatus'],
    runtimeAccessScope: engine.runtimeAccessScope === 'resource_aware' ? 'resource_aware' : 'engine_wide',
  };
}

function snapshotHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function loadAffectedRoleAssignments(
  store: Store,
  engineId: string,
  tenantIds: string[],
  engineSetIds: string[],
): Promise<AffectedAssignmentSnapshot> {
  const assignments = store.getRepository(RbacRoleAssignment);
  const direct = await assignments.find({ where: { scopeType: 'engine', scopeId: engineId } });
  const tenantInherited = tenantIds.length > 0
    ? await assignments.find({ where: { scopeType: 'tenant', scopeId: In(tenantIds) } })
    : [];
  const engineSetInherited = engineSetIds.length > 0
    ? await assignments.find({ where: { scopeType: 'engine_set', scopeId: In(engineSetIds) } })
    : [];
  const runtimeResources = await assignments.createQueryBuilder('assignment')
    .innerJoin(RuntimeResource, 'runtimeResource', 'runtimeResource.id = assignment.scopeId')
    .where('assignment.scopeType = :scopeType', { scopeType: 'engine_runtime_resource' })
    .andWhere('runtimeResource.engineId = :engineId', { engineId })
    .getMany();
  const runtimeSets = await assignments.createQueryBuilder('assignment')
    .innerJoin(RuntimeResourceSet, 'runtimeResourceSet', 'runtimeResourceSet.id = assignment.scopeId')
    .where('assignment.scopeType = :scopeType', { scopeType: 'engine_runtime_resource_set' })
    .andWhere('runtimeResourceSet.engineId = :engineId', { engineId })
    .getMany();
  const rows = [...direct, ...tenantInherited, ...engineSetInherited, ...runtimeResources, ...runtimeSets];
  const uniqueRows = Array.from(new Map(rows.map((row) => [row.id, row])).values());
  return {
    count: uniqueRows.length,
    identities: uniqueRows.map((row) => `${row.id}:${Number(row.updatedAt || 0)}`).sort(),
  };
}

async function loadSnapshot(store: Store, engineId: string): Promise<TransitionSnapshot> {
  const engine = await store.getRepository(Engine).findOne({ where: { id: engineId } });
  if (!engine) throw Errors.notFound('Engine', engineId);

  const resources = await store.getRepository(RuntimeResource).find({
    where: { engineId, isActive: true },
    order: { id: 'ASC' },
  });
  const mappings = await store.getRepository(EngineTenantMapping).find({
    where: { engineId, isActive: true },
    order: { id: 'ASC' },
  });
  const engineSetMemberships = await store.getRepository(EngineSetMaterialization).find({
    where: { engineId },
    order: { id: 'ASC' },
  });
  const deploymentTargets = await store.getRepository(ProjectEngineTarget).find({
    where: { engineId },
    order: { id: 'ASC' },
  });
  const deploymentReceipts = await store.getRepository(DeploymentReceipt).find({
    where: { engineId },
    order: { id: 'ASC' },
  });
  const current = topologyState(engine);
  const currentTenantIds = Array.from(new Set([
    current.tenantId,
    ...resources
      .filter((resource) => resource.tenantResolutionStatus === 'resolved')
      .map((resource) => normalizeTenantIdForPersistence(resource.tenantId)),
  ].filter((tenantId): tenantId is string => Boolean(tenantId)))).sort();
  const assignments = await loadAffectedRoleAssignments(
    store,
    engineId,
    currentTenantIds,
    engineSetMemberships.map((row) => row.engineSetId),
  );
  const inventory: EngineTenancyTransitionInventory = {
    roleAssignments: assignments.count,
    activeTenantMappings: mappings.length,
    runtimeResources: resources.map((resource) => ({
      tenantId: normalizeTenantIdForPersistence(resource.tenantId),
      tenantResolutionStatus: (
        ['resolved', 'unmapped', 'conflict', 'stale'].includes(resource.tenantResolutionStatus)
          ? resource.tenantResolutionStatus
          : 'stale'
      ) as EngineTenancyTransitionInventory['runtimeResources'][number]['tenantResolutionStatus'],
    })),
    engineSetMemberships: engineSetMemberships.length,
    deploymentTargets: deploymentTargets.length,
    deploymentReceipts: deploymentReceipts.length,
  };
  const fingerprint = snapshotHash({
    engine: {
      ...current,
      updatedAt: Number(engine.updatedAt || 0),
      registrationSource: engine.registrationSource || null,
      ownershipMode: engine.ownershipMode || null,
      managementMode: engine.managementMode || null,
      fieldOwnershipJson: engine.fieldOwnershipJson || null,
    },
    mappings: mappings.map((mapping) => ({
      id: mapping.id,
      strategy: mapping.strategy,
      externalTenantId: mapping.externalTenantId,
      enterpriseTenantId: mapping.enterpriseTenantId,
      source: mapping.source,
      sourceRef: mapping.sourceRef,
      updatedAt: Number(mapping.updatedAt || 0),
    })),
    resources: resources.map((resource) => ({
      id: resource.id,
      tenantId: resource.tenantId || null,
      tenantResolutionStatus: resource.tenantResolutionStatus,
      tenantMappingId: resource.tenantMappingId || null,
      tenantMappingVersion: Number(resource.tenantMappingVersion || 0),
      updatedAt: Number(resource.updatedAt || 0),
    })),
    inventory: {
      roleAssignments: assignments.identities,
      engineSetMemberships: engineSetMemberships.map((row) => `${row.id}:${Number(row.updatedAt || 0)}`),
      deploymentTargets: deploymentTargets.map((row) => `${row.id}:${Number(row.updatedAt || 0)}`),
      deploymentReceipts: deploymentReceipts.map((row) => `${row.id}:${Number(row.receivedAt || 0)}`),
    },
  });
  return {
    engine,
    current,
    inventory,
    resourceIds: resources.map((resource) => resource.id),
    assignmentIdentities: assignments.identities,
    currentTenantIds,
    fingerprint,
  };
}

async function proposedState(
  snapshot: TransitionSnapshot,
  request: NormalizedTransitionPreviewRequest,
  context: TransitionContext,
): Promise<EngineTenancyTopologyState> {
  const resolved = await engineTenancyProvisioningService.resolveForCreate({
    tenancy: request.tenancy,
    runtimeAccessScope: request.tenancy.mode === 'shared'
      ? 'resource_aware'
      : snapshot.current.runtimeAccessScope,
    requestTenantId: context.requestTenantId,
    principalType: context.principalType,
    principalId: context.principalId,
    resolver: context.resolver,
  });
  const replacesMappingGeneration = snapshot.current.mode !== resolved.tenancyMode
    || (
      resolved.tenancyMode === 'shared'
      && snapshot.current.mappingStrategy !== resolved.tenantMappingStrategy
    );
  return {
    mode: resolved.tenancyMode,
    tenantId: resolved.tenantId,
    mappingStrategy: resolved.tenantMappingStrategy,
    mappingVersion: resolved.tenancyMode === 'dedicated'
      ? 0
      : replacesMappingGeneration
        ? snapshot.current.mappingVersion + 1
        : snapshot.current.mappingVersion,
    resolutionStatus: resolved.tenancyMode === 'dedicated' ? 'ready' : 'incomplete',
    runtimeAccessScope: resolved.tenancyMode === 'shared'
      ? 'resource_aware'
      : snapshot.current.runtimeAccessScope,
  };
}

function previewHash(input: Omit<EngineTenancyTransitionPreviewResponse, 'previewHash'>, fingerprint: string): string {
  return snapshotHash({ ...input, fingerprint });
}

async function buildPreview(
  store: Store,
  engineId: string,
  request: NormalizedTransitionPreviewRequest,
  context: TransitionContext,
  previewExpiresAt: number,
): Promise<{ response: EngineTenancyTransitionPreviewResponse; snapshot: TransitionSnapshot }> {
  const snapshot = await loadSnapshot(store, engineId);
  const proposed = await proposedState(snapshot, request, context);
  if (proposed.tenantId && !snapshot.currentTenantIds.includes(proposed.tenantId)) {
    const targetTenantAssignments = await store.getRepository(RbacRoleAssignment).find({
      where: { scopeType: 'tenant', scopeId: proposed.tenantId },
    });
    const assignmentIdentities = Array.from(new Set([
      ...snapshot.assignmentIdentities,
      ...targetTenantAssignments.map((row) => `${row.id}:${Number(row.updatedAt || 0)}`),
    ])).sort();
    snapshot.inventory = {
      ...snapshot.inventory,
      roleAssignments: assignmentIdentities.length,
    };
    snapshot.assignmentIdentities = assignmentIdentities;
    snapshot.fingerprint = snapshotHash({
      base: snapshot.fingerprint,
      assignments: assignmentIdentities,
    });
  }
  const plan = buildEngineTenancyTransitionPlan(snapshot.current, proposed, snapshot.inventory);
  if (!plan) {
    throw transitionError(
      'ENGINE_TENANCY_TRANSITION_REQUIRED',
      'The proposed tenancy configuration does not change this engine topology',
      400,
    );
  }
  const unsigned = {
    engineId,
    kind: plan.kind,
    current: snapshot.current,
    proposed,
    effects: plan.effects,
    requiredAcknowledgements: plan.requiredAcknowledgements,
    previewExpiresAt,
  };
  return {
    response: {
      ...unsigned,
      previewHash: previewHash(unsigned, snapshot.fingerprint),
    },
    snapshot,
  };
}

export class EngineTenancyTransitionService {
  async preview(
    engineId: string,
    requestInput: EngineTenancyTransitionPreviewRequest,
    context: TransitionContext,
  ): Promise<EngineTenancyTransitionPreviewResponse> {
    const request = EngineTenancyTransitionPreviewRequestSchema.parse(requestInput);
    const dataSource = await getDataSource();
    return (await buildPreview(
      dataSource,
      engineId,
      request,
      context,
      Date.now() + PREVIEW_TTL_MS,
    )).response;
  }

  async apply(
    engineId: string,
    requestInput: EngineTenancyTransitionApplyRequest,
    context: TransitionContext,
  ): Promise<EngineTenancyTransitionApplyResponse> {
    const request = EngineTenancyTransitionApplyRequestSchema.parse(requestInput);
    const now = Date.now();
    if (request.previewExpiresAt < now) {
      throw transitionError(
        'ENGINE_TENANCY_PREVIEW_EXPIRED',
        'The tenancy transition preview has expired; create a new preview',
      );
    }
    const dataSource = await getDataSource();
    return dataSource.transaction(async (manager) => {
      const { response: transition, snapshot } = await buildPreview(
        manager,
        engineId,
        { tenancy: request.tenancy },
        context,
        request.previewExpiresAt,
      );
      if (transition.previewHash !== request.previewHash) {
        throw transitionError(
          'ENGINE_TENANCY_PREVIEW_STALE',
          'The engine tenancy state changed after preview; create a new preview',
        );
      }
      const acknowledgements = new Set(request.acknowledgements);
      const missing = transition.requiredAcknowledgements.filter((item) => !acknowledgements.has(item));
      if (missing.length > 0) {
        throw transitionError(
          'ENGINE_TENANCY_ACKNOWLEDGEMENT_REQUIRED',
          `Missing required tenancy transition acknowledgements: ${missing.join(', ')}`,
          400,
        );
      }

      const appliedAt = Date.now();
      const engineUpdate = await manager.getRepository(Engine).update(
        { id: engineId, updatedAt: snapshot.engine.updatedAt },
        {
          tenancyMode: transition.proposed.mode,
          tenantId: transition.proposed.tenantId,
          tenantMappingStrategy: transition.proposed.mappingStrategy,
          tenantMappingVersion: transition.proposed.mappingVersion,
          tenantResolutionStatus: transition.proposed.resolutionStatus,
          runtimeAccessScope: transition.proposed.runtimeAccessScope,
          lastTenantReconciledAt: null,
          driftStatus: snapshot.engine.registrationSource === 'config'
            && snapshot.engine.ownershipMode === 'config_warn'
            ? 'manual_override'
            : snapshot.engine.driftStatus,
          updatedAt: appliedAt,
        },
      );
      if (engineUpdate.affected !== 1) {
        throw transitionError(
          'ENGINE_TENANCY_PREVIEW_STALE',
          'The engine tenancy state changed while applying the preview; create a new preview',
        );
      }
      if (transition.effects.tenantMappings > 0) {
        await manager.getRepository(EngineTenantMapping).update(
          { engineId, isActive: true },
          { isActive: false, updatedAt: appliedAt },
        );
      }
      if (transition.proposed.mode === 'shared') {
        await manager.getRepository(RuntimeResource).update(
          { engineId, isActive: true },
          {
            tenantId: null,
            tenantResolutionStatus: 'unmapped',
            tenantMappingId: null,
            tenantMappingVersion: transition.proposed.mappingVersion,
            tenantResolutionDetailsJson: JSON.stringify({ code: 'topology_transition_requires_mapping' }),
            updatedAt: appliedAt,
          },
        );
      } else {
        await manager.getRepository(RuntimeResource).update(
          { engineId, isActive: true },
          {
            tenantId: transition.proposed.tenantId,
            tenantResolutionStatus: 'resolved',
            tenantMappingId: null,
            tenantMappingVersion: 0,
            tenantResolutionDetailsJson: JSON.stringify({ code: 'dedicated_engine_tenant' }),
            updatedAt: appliedAt,
          },
        );
      }
      await manager.getRepository(EngineSetMaterialization).delete({ engineId });
      if (snapshot.resourceIds.length > 0) {
        await manager.getRepository(RuntimeResourceSetMaterialization)
          .createQueryBuilder()
          .delete()
          .where('runtime_resource_id IN (:...resourceIds)', { resourceIds: snapshot.resourceIds })
          .execute();
      }
      return {
        applied: true,
        appliedAt,
        previewHash: transition.previewHash,
        transition,
      };
    });
  }

  async classificationReport(defaultTenantId = OSS_DEFAULT_TENANT_ID): Promise<EngineTenancyClassificationReport> {
    const dataSource = await getDataSource();
    const engines = await dataSource.getRepository(Engine).find({ order: { name: 'ASC', id: 'ASC' } });
    const normalizedDefaultTenantId = normalizeTenantIdForPersistence(defaultTenantId) || OSS_DEFAULT_TENANT_ID;
    const rows = engines.map((engine) => classifyExistingEngineTenancy({
      engineId: engine.id,
      engineName: engine.name,
      current: topologyState(engine),
      defaultTenantId: normalizedDefaultTenantId,
      invariantConflict: !['dedicated', 'shared'].includes(engine.tenancyMode)
        ? 'Engine tenancy mode is missing or unsupported.'
        : engine.tenancyMode === 'shared'
          && !['engine_tenant_id', 'deployment_target', 'explicit'].includes(engine.tenantMappingStrategy || '')
          ? 'Shared engine mapping strategy is missing or unsupported.'
          : !['engine_wide', 'resource_aware'].includes(engine.runtimeAccessScope)
            ? 'Engine runtime access scope is missing or unsupported.'
            : null,
    }));
    return {
      generatedAt: Date.now(),
      defaultTenantId: normalizedDefaultTenantId,
      totals: {
        engines: rows.length,
        classified: rows.filter((row) => row.status === 'classified').length,
        readyForApply: rows.filter((row) => row.status === 'ready_for_apply').length,
        requiresReview: rows.filter((row) => row.status === 'requires_review').length,
        conflicts: rows.filter((row) => row.status === 'conflict').length,
      },
      rows,
    };
  }
}

export const engineTenancyTransitionService = new EngineTenancyTransitionService();

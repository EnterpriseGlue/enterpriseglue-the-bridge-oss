import type { NextFunction, Request, Response } from 'express';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { EnvironmentTag } from '@enterpriseglue/shared/infrastructure/persistence/entities/EnvironmentTag.js';
import { File } from '@enterpriseglue/shared/infrastructure/persistence/entities/File.js';
import { Folder } from '@enterpriseglue/shared/infrastructure/persistence/entities/Folder.js';
import { GitDeployment } from '@enterpriseglue/shared/infrastructure/persistence/entities/GitDeployment.js';
import { GitLock } from '@enterpriseglue/shared/infrastructure/persistence/entities/GitLock.js';
import { GitRepository } from '@enterpriseglue/shared/infrastructure/persistence/entities/GitRepository.js';
import { Project } from '@enterpriseglue/shared/infrastructure/persistence/entities/Project.js';
import { SavedFilter } from '@enterpriseglue/shared/infrastructure/persistence/entities/SavedFilter.js';
import { Version } from '@enterpriseglue/shared/infrastructure/persistence/entities/Version.js';
import { RuntimeResource } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResource.js';
import { camundaGet } from '@enterpriseglue/shared/services/bpmn-engine-client.js';
import { In, IsNull } from 'typeorm';
import {
  AUTHZ_RESOURCE_RESOLVERS,
  assertKnownAuthzAction,
  type AuthzActionDefinition,
  type AuthzResourceResolverDefinition,
  type AuthzResourceType,
} from '@enterpriseglue/shared/authz/permission-actions.js';
import {
  isTenantVisibleForAuthz,
  tenantIdsForAuthz,
} from '@enterpriseglue/shared/authz/tenant-scope.js';
import { engineAccessService } from '@enterpriseglue/shared/services/platform-admin/EngineAccessService.js';
import {
  deploymentEligibilityService,
  type DeploymentEligibilityResult,
} from '@enterpriseglue/shared/services/platform-admin/DeploymentEligibilityService.js';
import type { ProjectEngineTargetMode } from '@enterpriseglue/shared/services/platform-admin/ProjectEngineTargetService.js';
import {
  EnginePermissions,
  permissionService,
  PlatformPermissions,
  ProjectPermissions,
  type Permission,
  type PermissionContext,
} from '../services/platform-admin/permissions.js';
import { policyService } from '../services/platform-admin/PolicyService.js';
import { Errors } from './errorHandler.js';
import { updateBpmnEngineRequestContext } from '../services/bpmn-engine-request-context.js';

type ResourceIdLocation = 'params' | 'body' | 'query' | 'any';

export interface RequireActionOptions {
  resourceResolver?: string;
  resourceIdFrom?: ResourceIdLocation;
  resourceIdKey?: string;
  collectionIdsFrom?: ResourceIdLocation;
  collectionIdsKey?: string;
  acceptedPermissions?: Permission[];
  /**
   * Allows a platform migration permission to operate only on an unowned
   * dedicated engine that is explicitly quarantined as migration_required.
   * Ordinary engine/resource authorization never treats that null owner as the
   * active or default tenant.
   */
  unownedEngineMigrationPermission?: Permission;
}

export interface RequireRuntimeCollectionActionOptions {
  resourceKind: 'process_definition' | 'decision_definition';
  engineIdFrom?: ResourceIdLocation;
  engineIdKey?: string;
}

/**
 * Resolves a definition from the engine before evaluating a resource-aware
 * permission. The client-supplied definition id is deliberately not used as
 * an authorization resource key.
 */
export interface RequireRuntimeDefinitionActionOptions extends RequireRuntimeCollectionActionOptions {
  /** Engine REST resource used to resolve the object and its runtime key. */
  definitionPath: string;
  /**
   * Some runtime objects, such as jobs, inherit access from a referenced
   * process definition rather than carrying a process definition key.
   */
  definitionReferenceField?: string;
  definitionReferencePath?: string;
  definitionLookup?: 'id' | 'key';
  definitionIdFrom?: ResourceIdLocation;
  definitionIdKey?: string;
  definitionVersionFrom?: ResourceIdLocation;
  definitionVersionKey?: string;
  resourceKeyFields?: string[];
}

export interface RequireRuntimeProcessInstanceSelectionActionOptions extends RequireRuntimeCollectionActionOptions {
  processInstanceIdsKey?: string;
}

/**
 * Resolves a runtime deployment through EnterpriseGlue's sanitized inventory.
 * It never trusts a client-supplied definition key or calls an engine to infer
 * project lineage; only active resources already observed for the deployment
 * can satisfy a narrow resource-aware authorization decision.
 */
export interface RequireRuntimeDeploymentActionOptions {
  engineIdFrom?: ResourceIdLocation;
  engineIdKey?: string;
  deploymentIdFrom?: ResourceIdLocation;
  deploymentIdKey?: string;
  resourceKinds?: Array<'process_definition' | 'decision_definition'>;
}

export interface RequireRuntimeMigrationActionOptions extends RequireRuntimeCollectionActionOptions {
  planKey?: string;
}

export interface RuntimeResourceActionDecision {
  allowed: boolean;
  reason?: string;
}

/** Returns a fail-closed UX decision for an already-resolved runtime resource set. */
export async function getRuntimeResourceActionDecision(input: {
  actionId: string;
  userId: string;
  tenantId: string | null;
  engineId: string;
  resourceKind: 'process_definition' | 'decision_definition';
  resourceKeys: string[];
}): Promise<RuntimeResourceActionDecision> {
  try {
    const action = assertKnownAuthzAction(input.actionId);
    const context: PermissionContext = {
      userId: input.userId,
      tenantId: input.tenantId,
      resourceType: 'engine',
      resourceId: input.engineId,
    };
    if (await permissionService.hasPermission(action.permissionId, context)) return { allowed: true };

    const keys = Array.from(new Set(input.resourceKeys.filter(Boolean)));
    if (!keys.length) return { allowed: false, reason: 'Action decision unavailable for this runtime resource' };
    const dataSource = await getDataSource();
    const resources = await Promise.all(keys.map((resourceKey) => dataSource.getRepository(RuntimeResource).findOne({
      where: { engineId: input.engineId, resourceKind: input.resourceKind, resourceKey, isActive: true },
      select: ['id', 'tenantId'],
    })));
    if (resources.some((resource) => !resource || !isTenantVisible(resource.tenantId, input.tenantId))) {
      return { allowed: false, reason: 'Action decision unavailable for this runtime resource' };
    }
    const allowed = await Promise.all(resources.map((resource) => permissionService.hasPermission(action.permissionId, {
      ...context,
      resourceType: 'engine_runtime_resource',
      resourceId: resource!.id,
    })));
    return allowed.every(Boolean)
      ? { allowed: true }
      : { allowed: false, reason: 'Action unavailable for this runtime resource' };
  } catch {
    return { allowed: false, reason: 'Action decision unavailable for this runtime resource' };
  }
}

export type CompositeActionKind = 'deployment';

export interface RequireCompositeActionOptions {
  kind?: CompositeActionKind;
  projectIdFrom?: ResourceIdLocation;
  projectIdKey?: string;
  engineIdFrom?: ResourceIdLocation;
  engineIdKey?: string;
  mode?: ProjectEngineTargetMode;
  optionalWhenMissingEngineId?: boolean;
  legacyAutoGrant?: boolean;
  attachDeployContext?: boolean;
  hideUnauthorizedEngine?: boolean;
}

export interface ResolvedAuthzActionResource {
  type: AuthzResourceType;
  id?: string | null;
}

export interface ResolvedCompositeActionResource {
  kind: CompositeActionKind;
  actionId: string;
  projectId: string;
  engineId: string;
  mode: ProjectEngineTargetMode;
}

export interface ResolvedAuthzCollectionResource {
  type: AuthzResourceType;
  ids: string[];
  requestedIds: string[];
  deniedIds: string[];
}

export interface ResolvedInvitationTarget {
  resourceType: 'tenant' | 'project' | 'engine';
  resourceId?: string | null;
  requiredPermissions: Permission[];
}

export interface DeployActionContext {
  projectId: string;
  engineId: string;
  projectRole: string;
  engineName: string;
  environmentTag: string | null;
}

declare global {
  namespace Express {
    interface Request {
      authzAction?: AuthzActionDefinition;
      authzResource?: ResolvedAuthzActionResource;
      authzComposite?: ResolvedCompositeActionResource;
      authzCollection?: ResolvedAuthzCollectionResource;
      authzInvitationTarget?: ResolvedInvitationTarget;
      deploymentEligibility?: DeploymentEligibilityResult;
      deployContext?: DeployActionContext;
      authorizedProjectIds?: string[];
      authorizedEngineIds?: string[];
      authorizedRuntimeResourceKeys?: string[];
      /** Stable runtime identities that must be retained when an upstream API supports tenant query filters. */
      authorizedRuntimeResourceScopes?: Array<{ resourceKey: string; runtimeTenantId: string }>;
      runtimeAccessScope?: 'engine_wide' | 'resource_aware';
    }
  }
}

function readRequestValue(req: Request, key: string, from: ResourceIdLocation = 'any'): string | null {
  const sources = from === 'any'
    ? [req.params, req.body, req.query]
    : [from === 'params' ? req.params : from === 'body' ? req.body : req.query];

  for (const source of sources) {
    const value = (source as Record<string, unknown> | undefined)?.[key];
    if (Array.isArray(value)) {
      const first = value[0];
      if (typeof first === 'string' && first.trim()) return first.trim();
    } else if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function readRequestValues(req: Request, key: string, from: ResourceIdLocation = 'any'): string[] {
  const sources = from === 'any'
    ? [req.params, req.body, req.query]
    : [from === 'params' ? req.params : from === 'body' ? req.body : req.query];

  const values: string[] = [];
  for (const source of sources) {
    const value = (source as Record<string, unknown> | undefined)?.[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item !== 'string') continue;
        values.push(...item.split(',').map((part) => part.trim()).filter(Boolean));
      }
    } else if (typeof value === 'string' && value.trim()) {
      values.push(...value.split(',').map((part) => part.trim()).filter(Boolean));
    }
  }

  return Array.from(new Set(values));
}

function isTenantVisible(rowTenantId: string | null | undefined, tenantId?: string | null): boolean {
  return isTenantVisibleForAuthz(rowTenantId, tenantId);
}

type TenantVisibleEngine = Pick<Engine, 'tenantId' | 'tenancyMode'>;
type RuntimeGuardEngine = Pick<Engine, 'tenancyMode' | 'runtimeAccessScope'>;

function isEngineVisibleInTenant(
  engine: TenantVisibleEngine,
  tenantId?: string | null,
): boolean {
  if (engine.tenancyMode === 'shared') return !engine.tenantId;
  const visibleTenantIds = tenantIdsForAuthz(tenantId);
  return Boolean(engine.tenantId && visibleTenantIds.includes(engine.tenantId));
}

function requiresResolvedRuntimeResourceGuard(
  engine: RuntimeGuardEngine,
  hasBroadPermission: boolean,
): boolean {
  return engine.tenancyMode === 'shared'
    || (!hasBroadPermission && engine.runtimeAccessScope === 'resource_aware');
}

function resolvedRuntimeResourceWhere(
  where: Record<string, unknown>,
  tenantId?: string | null,
): Record<string, unknown> | Array<Record<string, unknown>> {
  const tenantIds = tenantIdsForAuthz(tenantId);
  const resolved = { ...where, tenantResolutionStatus: 'resolved' };
  return tenantIds.length
    ? tenantIds.map((visibleTenantId) => ({ ...resolved, tenantId: visibleTenantId }))
    : resolved;
}

function isUsableRuntimeResource(
  resource: Pick<RuntimeResource, 'tenantId' | 'tenantResolutionStatus'> | null | undefined,
  tenantId: string | null,
  engine: RuntimeGuardEngine,
): boolean {
  if (!resource || !isTenantVisible(resource.tenantId, tenantId)) return false;
  if (engine.tenancyMode === 'shared') {
    return Boolean(resource.tenantId) && resource.tenantResolutionStatus === 'resolved';
  }
  // Persisted inventory always carries the status. The undefined compatibility
  // case keeps older adapters/tests on the dedicated-engine path only.
  return resource.tenantResolutionStatus === undefined
    || resource.tenantResolutionStatus === 'resolved';
}

function resolverDefinition(resolverId: string): AuthzResourceResolverDefinition {
  const resolver = AUTHZ_RESOURCE_RESOLVERS.find((candidate) => candidate.id === resolverId);
  if (!resolver) {
    throw Errors.internal(`Unknown authorization resource resolver: ${resolverId}`);
  }
  return resolver;
}

function requiredResourceId(
  req: Request,
  resolver: AuthzResourceResolverDefinition,
  options: RequireActionOptions
): string {
  const key = options.resourceIdKey || resolver.requiredParams[0];
  const id = readRequestValue(req, key, options.resourceIdFrom);
  if (!id) {
    throw Errors.validation(`${key} is required`);
  }
  return id;
}

async function resolveVisibleProjectById(
  dataSource: Awaited<ReturnType<typeof getDataSource>>,
  projectId: string,
  tenantId?: string | null
): Promise<Project> {
  const project = await dataSource.getRepository(Project).findOne({
    where: { id: projectId },
    select: ['id', 'tenantId'],
  });
  if (!project) {
    throw Errors.notFound('Project not found');
  }
  if (!isTenantVisible(project.tenantId, tenantId)) {
    throw Errors.forbidden('Project not accessible in this tenant');
  }
  return project;
}

async function resolveActionResource(
  req: Request,
  resolverId: string,
  options: RequireActionOptions
): Promise<ResolvedAuthzActionResource> {
  const resolver = resolverDefinition(resolverId);
  if (resolver.id === 'platform.self') {
    return { type: 'platform', id: null };
  }

  const tenantId = req.tenant?.tenantId || null;
  const dataSource = await getDataSource();

  if (resolver.id === 'engine.byId') {
    const engineId = requiredResourceId(req, resolver, options);
    const engine = await dataSource.getRepository(Engine).findOne({
      where: { id: engineId },
      select: ['id', 'tenantId', 'tenancyMode', 'tenantResolutionStatus'],
    });
    if (!engine) {
      throw Errors.notFound('Engine not found');
    }
    const unownedMigration = engine.tenancyMode === 'dedicated'
      && !engine.tenantId
      && engine.tenantResolutionStatus === 'migration_required'
      && Boolean(options.unownedEngineMigrationPermission);
    if (!unownedMigration && !isEngineVisibleInTenant(engine, tenantId)) {
      throw Errors.forbidden('Engine not accessible in this tenant');
    }
    if (unownedMigration) {
      (req as Request & { unownedEngineMigrationId?: string }).unownedEngineMigrationId = engineId;
    }
    (req as Request & { engineId?: string }).engineId = engineId;
    return { type: 'engine', id: engineId };
  }

  if (resolver.id === 'engine.bySavedFilterId') {
    const savedFilterId = requiredResourceId(req, resolver, options);
    const savedFilter = await dataSource.getRepository(SavedFilter).findOne({
      where: { id: savedFilterId },
      select: ['id', 'engineId'],
    });
    if (!savedFilter) {
      throw Errors.notFound('Saved filter not found');
    }
    const engine = await dataSource.getRepository(Engine).findOne({
      where: { id: savedFilter.engineId },
      select: ['id', 'tenantId', 'tenancyMode'],
    });
    if (!engine) {
      throw Errors.notFound('Engine not found');
    }
    if (!isEngineVisibleInTenant(engine, tenantId)) {
      throw Errors.forbidden('Engine not accessible in this tenant');
    }
    (req as Request & { savedFilterId?: string; engineId?: string }).savedFilterId = savedFilterId;
    (req as Request & { engineId?: string }).engineId = savedFilter.engineId;
    return { type: 'engine', id: savedFilter.engineId };
  }

  if (resolver.id === 'project.byId') {
    const projectId = requiredResourceId(req, resolver, options);
    await resolveVisibleProjectById(dataSource, projectId, tenantId);
    (req as Request & { projectId?: string }).projectId = projectId;
    return { type: 'project', id: projectId };
  }

  if (resolver.id === 'project.byFileId') {
    const fileId = requiredResourceId(req, resolver, options);
    const file = await dataSource.getRepository(File).findOne({
      where: { id: fileId },
      select: ['id', 'projectId'],
    });
    if (!file) {
      throw Errors.notFound('File not found');
    }
    await resolveVisibleProjectById(dataSource, file.projectId, tenantId);
    (req as Request & { fileId?: string; projectId?: string }).fileId = fileId;
    (req as Request & { projectId?: string }).projectId = file.projectId;
    return { type: 'project', id: file.projectId };
  }

  if (resolver.id === 'project.byFolderId') {
    const folderId = requiredResourceId(req, resolver, options);
    const folder = await dataSource.getRepository(Folder).findOne({
      where: { id: folderId },
      select: ['id', 'projectId'],
    });
    if (!folder) {
      throw Errors.notFound('Folder not found');
    }
    await resolveVisibleProjectById(dataSource, folder.projectId, tenantId);
    (req as Request & { folderId?: string; projectId?: string }).folderId = folderId;
    (req as Request & { projectId?: string }).projectId = folder.projectId;
    return { type: 'project', id: folder.projectId };
  }

  if (resolver.id === 'project.byVersionId') {
    const versionId = requiredResourceId(req, resolver, options);
    const version = await dataSource.getRepository(Version).findOne({
      where: { id: versionId },
      select: ['id', 'fileId'],
    });
    if (!version) {
      throw Errors.notFound('Version not found');
    }
    const file = await dataSource.getRepository(File).findOne({
      where: { id: version.fileId },
      select: ['id', 'projectId'],
    });
    if (!file) {
      throw Errors.notFound('File not found');
    }
    await resolveVisibleProjectById(dataSource, file.projectId, tenantId);
    (req as Request & { versionId?: string; fileId?: string; projectId?: string }).versionId = versionId;
    (req as Request & { fileId?: string; projectId?: string }).fileId = version.fileId;
    (req as Request & { projectId?: string }).projectId = file.projectId;
    return { type: 'project', id: file.projectId };
  }

  if (resolver.id === 'project.byGitRepositoryId') {
    const repositoryId = requiredResourceId(req, resolver, options);
    const repository = await dataSource.getRepository(GitRepository).findOne({
      where: { id: repositoryId },
      select: ['id', 'projectId'],
    });
    if (!repository) {
      throw Errors.notFound('Repository not found');
    }
    await resolveVisibleProjectById(dataSource, repository.projectId, tenantId);
    (req as Request & { repositoryId?: string; projectId?: string }).repositoryId = repositoryId;
    (req as Request & { projectId?: string }).projectId = repository.projectId;
    return { type: 'project', id: repository.projectId };
  }

  if (resolver.id === 'project.byGitDeploymentId') {
    const deploymentId = requiredResourceId(req, resolver, options);
    const deployment = await dataSource.getRepository(GitDeployment).findOne({
      where: { id: deploymentId },
      select: ['id', 'projectId'],
    });
    if (!deployment) {
      throw Errors.notFound('Deployment not found');
    }
    await resolveVisibleProjectById(dataSource, deployment.projectId, tenantId);
    (req as Request & { deploymentId?: string; projectId?: string }).deploymentId = deploymentId;
    (req as Request & { projectId?: string }).projectId = deployment.projectId;
    return { type: 'project', id: deployment.projectId };
  }

  if (resolver.id === 'project.byGitLockId') {
    const lockId = requiredResourceId(req, resolver, options);
    const lock = await dataSource.getRepository(GitLock).findOne({
      where: { id: lockId },
      select: ['id', 'fileId'],
    });
    if (!lock) {
      throw Errors.notFound('Lock not found');
    }
    const file = await dataSource.getRepository(File).findOne({
      where: { id: lock.fileId },
      select: ['id', 'projectId'],
    });
    if (!file) {
      throw Errors.notFound('File not found');
    }
    await resolveVisibleProjectById(dataSource, file.projectId, tenantId);
    (req as Request & { lockId?: string; fileId?: string; projectId?: string }).lockId = lockId;
    (req as Request & { fileId?: string; projectId?: string }).fileId = lock.fileId;
    (req as Request & { projectId?: string }).projectId = file.projectId;
    return { type: 'project', id: file.projectId };
  }

  throw Errors.internal(`Authorization resolver is not implemented for middleware: ${resolver.id}`);
}

async function resolveProjectVisibleCollection(
  req: Request,
  action: AuthzActionDefinition,
  options: RequireActionOptions
): Promise<ResolvedAuthzCollectionResource> {
  let requestedIds = readRequestValues(
    req,
    options.collectionIdsKey || 'projectIds',
    options.collectionIdsFrom || 'query'
  );
  if (requestedIds.length === 0) {
    const tenantId = req.tenant?.tenantId || null;
    const hasCollectionWideAccess = await permissionService.hasPermission(action.permissionId, {
      userId: req.user!.userId,
      tenantId,
      resourceType: 'project',
    });
    if (hasCollectionWideAccess) {
      const dataSource = await getDataSource();
      const visibleTenantIds = tenantIdsForAuthz(tenantId);
      const rows = await dataSource.getRepository(Project).find({
        where: visibleTenantIds.length > 0
          ? [{ tenantId: In(visibleTenantIds) }, { tenantId: IsNull() }]
          : undefined,
        select: ['id'],
      });
      requestedIds = rows.map((row) => String(row.id)).sort();
    } else {
      requestedIds = await permissionService.getKnownProjectIdsForUser(
        req.user!.userId,
        tenantId
      );
    }
  }
  if (requestedIds.length === 0) {
    return { type: 'project', ids: [], requestedIds: [], deniedIds: [] };
  }

  const dataSource = await getDataSource();
  const rows = await dataSource.getRepository(Project).find({
    where: { id: In(requestedIds) },
    select: ['id', 'tenantId'],
  });
  const existingIds = new Set(rows.map((row) => String(row.id)));
  const allowedIds = new Set<string>();

  for (const projectId of requestedIds) {
    if (!existingIds.has(projectId)) continue;
    const allowed = await permissionService.hasPermission(action.permissionId, {
      userId: req.user!.userId,
      tenantId: req.tenant?.tenantId || null,
      resourceType: 'project',
      resourceId: projectId,
    });
    if (allowed) {
      allowedIds.add(projectId);
    }
  }

  const ids = requestedIds.filter((id) => allowedIds.has(id));
  const deniedIds = requestedIds.filter((id) => existingIds.has(id) && !allowedIds.has(id));
  return { type: 'project', ids, requestedIds, deniedIds };
}

async function resolveEngineVisibleCollection(
  req: Request,
  action: AuthzActionDefinition,
  options: RequireActionOptions
): Promise<ResolvedAuthzCollectionResource> {
  const includeManageableShared = req.query.includeManageableShared === 'true';
  let requestedIds = readRequestValues(
    req,
    options.collectionIdsKey || 'engineIds',
    options.collectionIdsFrom || 'query'
  );
  if (requestedIds.length === 0) {
    const tenantId = req.tenant?.tenantId || null;
    const hasCollectionWideAccess = await permissionService.hasPermission(action.permissionId, {
      userId: req.user!.userId,
      tenantId,
      resourceType: 'engine',
    });
    if (hasCollectionWideAccess) {
      const dataSource = await getDataSource();
      const visibleTenantIds = tenantIdsForAuthz(tenantId);
      const rows = await dataSource.getRepository(Engine).find({
        where: visibleTenantIds.length > 0
          ? [{ tenantId: In(visibleTenantIds) }, { tenantId: IsNull(), tenancyMode: 'shared' }]
          : { tenantId: IsNull(), tenancyMode: 'shared' },
        select: ['id', 'tenantId', 'tenancyMode'],
      });
      requestedIds = rows.map((row) => String(row.id)).sort();
    } else {
      requestedIds = await permissionService.getKnownEngineIdsForUser(
        req.user!.userId,
        tenantId
      );
    }
  }
  if (requestedIds.length === 0) {
    return { type: 'engine', ids: [], requestedIds: [], deniedIds: [] };
  }

  const dataSource = await getDataSource();
  const rows = await dataSource.getRepository(Engine).find({
    where: { id: In(requestedIds) },
    select: ['id', 'tenantId', 'tenancyMode', 'runtimeAccessScope'],
  });
  const existingIds = new Set(rows.map((row) => String(row.id)));
  const visibleIds = new Set(rows
    .filter((row) => isEngineVisibleInTenant(row, req.tenant?.tenantId || null))
    .map((row) => String(row.id)));
  const allowedIds = new Set<string>();

  for (const engineId of requestedIds) {
    if (!visibleIds.has(engineId)) continue;
    const allowed = await permissionService.hasPermission(action.permissionId, {
      userId: req.user!.userId,
      tenantId: req.tenant?.tenantId || null,
      resourceType: 'engine',
      resourceId: engineId,
    });
    const engine = rows.find((row) => String(row.id) === engineId);
    if (allowed && engine?.tenancyMode !== 'shared') {
      allowedIds.add(engineId);
      continue;
    }
    if (engine?.tenancyMode === 'shared' && includeManageableShared) {
      const manageable = await permissionService.hasPermission(EnginePermissions.ENGINE_EDIT, {
        userId: req.user!.userId,
        tenantId: req.tenant?.tenantId || null,
        resourceType: 'engine',
        resourceId: engineId,
      });
      if (manageable) {
        allowedIds.add(engineId);
        continue;
      }
    }
    if (engine?.runtimeAccessScope !== 'resource_aware') continue;
    // A resource-only grant provides Mission Control discovery without
    // widening the engine's inventory permission. Shared engines always take
    // this path, even with a broad engine grant, so an empty or quarantined
    // mapping never creates a selector entry.
    const runtimeVisible = await Promise.all([
      permissionService.getVisibleRuntimeResources({
        userId: req.user!.userId,
        tenantId: req.tenant?.tenantId || null,
        engineId,
        resourceKind: 'process_definition',
        permission: EnginePermissions.INSTANCE_VIEW,
        limit: 5_000,
      }),
      permissionService.getVisibleRuntimeResources({
        userId: req.user!.userId,
        tenantId: req.tenant?.tenantId || null,
        engineId,
        resourceKind: 'decision_definition',
        permission: EnginePermissions.INSTANCE_VIEW,
        limit: 5_000,
      }),
    ]).catch(() => [[], []] as [RuntimeResource[], RuntimeResource[]]);
    if (runtimeVisible.some((resources) => resources.length > 0)) {
      allowedIds.add(engineId);
    }
  }

  const ids = requestedIds.filter((id) => allowedIds.has(id));
  const deniedIds = requestedIds.filter((id) => existingIds.has(id) && !allowedIds.has(id));
  return { type: 'engine', ids, requestedIds, deniedIds };
}

function routeResolver(action: AuthzActionDefinition, options: RequireActionOptions): string {
  const resolverId = options.resourceResolver || action.routes?.[0]?.resourceResolver;
  if (!resolverId) {
    throw Errors.internal(`Authorization action has no resource resolver: ${action.actionId}`);
  }
  return resolverId;
}

function hasDeniedCheck(result: DeploymentEligibilityResult, checkId: string): boolean {
  return result.checks.some((check) => check.id === checkId && !check.allowed);
}

function deniedCheckIds(result: DeploymentEligibilityResult): string[] {
  return result.checks
    .filter((check) => !check.allowed)
    .map((check) => check.id);
}

function deploymentDeniedPayload(result: DeploymentEligibilityResult) {
  const remediation = result.checks.find((check) => !check.allowed && check.remediation)?.remediation;
  return {
    error: result.reasons[0] || 'Deployment is not allowed',
    reasons: result.reasons,
    checks: result.checks,
    ...(remediation ? { hint: remediation } : {}),
  };
}

async function canViewEngineForDeploy(userId: string, engineId: string, tenantId?: string | null): Promise<boolean> {
  const canViewDeployments = await permissionService.hasPermission(EnginePermissions.DEPLOY_VIEW, {
    userId,
    tenantId,
    resourceType: 'engine',
    resourceId: engineId,
  });
  if (canViewDeployments) return true;
  return permissionService.hasPermission(EnginePermissions.INSTANCE_VIEW, {
    userId,
    tenantId,
    resourceType: 'engine',
      resourceId: engineId,
    });
}

async function canAutoGrantProjectAccess(userId: string, engineId: string, tenantId?: string | null): Promise<boolean> {
  return permissionService.hasPermission(EnginePermissions.PROJECT_ACCESS_APPROVE, {
    userId,
    tenantId,
    resourceType: 'engine',
    resourceId: engineId,
  });
}

async function evaluateDeploymentComposite(
  userId: string,
  tenantId: string | null,
  projectId: string,
  engineId: string,
  mode: ProjectEngineTargetMode,
  legacyAutoGrant: boolean
): Promise<DeploymentEligibilityResult> {
  let result = await deploymentEligibilityService.evaluate({
    userId,
    tenantId,
    projectId,
    engineId,
    mode,
  });
  if (result.allowed || !legacyAutoGrant || mode !== 'manual') {
    return result;
  }

  const failedChecks = deniedCheckIds(result);
  if (failedChecks.length === 1 && failedChecks[0] === 'project_engine_target.active') {
    const canAutoGrant = await canAutoGrantProjectAccess(userId, engineId, tenantId);
    if (canAutoGrant) {
      await engineAccessService.grantAccess(projectId, engineId, userId, true);
      result = await deploymentEligibilityService.evaluate({
        userId,
        tenantId,
        projectId,
        engineId,
        mode,
      });
    }
  }

  return result;
}

async function loadDeployActionContext(projectId: string, engineId: string): Promise<DeployActionContext> {
  const dataSource = await getDataSource();
  const engine = await dataSource.getRepository(Engine).findOneBy({ id: engineId });
  if (!engine) {
    throw Errors.engineNotFound();
  }

  let envTagName: string | null = null;
  if (engine.environmentTagId) {
    const envTag = await dataSource.getRepository(EnvironmentTag).findOneBy({ id: engine.environmentTagId });
    envTagName = envTag?.name || null;
  }

  return {
    projectId,
    engineId,
    projectRole: 'permission',
    engineName: engine.name,
    environmentTag: envTagName,
  };
}

export function requireAction(actionId: string, options: RequireActionOptions = {}) {
  return async function requireKnownAction(req: Request, _res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        throw Errors.unauthorized('Authentication required');
      }

      const action = assertKnownAuthzAction(actionId);
      const resolverId = routeResolver(action, options);
      if (resolverId === 'project.visibleCollection') {
        const collection = await resolveProjectVisibleCollection(req, action, options);
        const policy = await policyService.evaluateGate(action.permissionId, {
          userId: req.user.userId,
          tenantId: req.tenant?.tenantId || null,
          resourceType: 'project',
        });
        if (policy.decision === 'deny') {
          throw Errors.forbidden(`Access denied for action ${action.actionId}: ${policy.reason}`);
        }
        req.authzAction = action;
        req.authzResource = { type: 'project', id: null };
        req.authzCollection = collection;
        req.authorizedProjectIds = collection.ids;
        updateBpmnEngineRequestContext({ actionId: action.actionId });
        return next();
      }
      if (resolverId === 'engine.visibleCollection') {
        const collection = await resolveEngineVisibleCollection(req, action, options);
        const policy = await policyService.evaluateGate(action.permissionId, {
          userId: req.user.userId,
          tenantId: req.tenant?.tenantId || null,
          resourceType: 'engine',
        });
        if (policy.decision === 'deny') {
          throw Errors.forbidden(`Access denied for action ${action.actionId}: ${policy.reason}`);
        }
        req.authzAction = action;
        req.authzResource = { type: 'engine', id: null };
        req.authzCollection = collection;
        req.authorizedEngineIds = collection.ids;
        updateBpmnEngineRequestContext({ actionId: action.actionId });
        return next();
      }

      const resource = await resolveActionResource(req, resolverId, options);
      const context: PermissionContext = {
        userId: req.user.userId,
        tenantId: req.tenant?.tenantId || null,
        resourceType: resource.type,
        resourceId: resource.id || undefined,
      };

      const acceptedPermissions = options.acceptedPermissions?.length
        ? options.acceptedPermissions
        : [action.permissionId];
      let allowed = (await Promise.all(
        acceptedPermissions.map((permission) => permissionService.hasPermission(permission, context))
      )).some(Boolean);
      let policyPermission = action.permissionId;
      let policyContext = context;
      const unownedMigrationId = (req as Request & { unownedEngineMigrationId?: string })
        .unownedEngineMigrationId;
      if (
        !allowed
        && unownedMigrationId === resource.id
        && options.unownedEngineMigrationPermission
      ) {
        const platformContext: PermissionContext = {
          userId: req.user.userId,
          tenantId: req.tenant?.tenantId || null,
          resourceType: 'platform',
        };
        allowed = await permissionService.hasPermission(
          options.unownedEngineMigrationPermission,
          platformContext,
        );
        if (allowed) {
          policyPermission = options.unownedEngineMigrationPermission;
          policyContext = platformContext;
        }
      }
      if (!allowed) {
        throw Errors.forbidden(`Access denied for action ${action.actionId}`);
      }

      const policy = await policyService.evaluateGate(policyPermission, policyContext);
      if (policy.decision === 'deny') {
        throw Errors.forbidden(`Access denied for action ${action.actionId}: ${policy.reason}`);
      }

      req.authzAction = action;
      req.authzResource = resource;
      (req as Request & { permissionContext?: PermissionContext }).permissionContext = context;
      updateBpmnEngineRequestContext({
        actionId: action.actionId,
        ...(resource.type === 'engine' && resource.id ? { engineId: resource.id } : {}),
        ...(resource.type === 'project' && resource.id ? { projectId: resource.id } : {}),
      });
      return next();
    } catch (error) {
      if (error instanceof Error) {
        return next(error);
      }
      return next(Errors.internal('Authorization action check failed'));
    }
  };
}

export function requireCompositeAction(actionId: string, options: RequireCompositeActionOptions = {}) {
  const action = assertKnownAuthzAction(actionId);
  const kind = options.kind || 'deployment';

  if (kind !== 'deployment') {
    throw Errors.internal(`Unsupported composite authorization kind: ${kind}`);
  }

  return async function requireKnownCompositeAction(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        throw Errors.unauthorized('Authentication required');
      }

      const projectId = readRequestValue(
        req,
        options.projectIdKey || 'projectId',
        options.projectIdFrom || 'body'
      );
      const engineId = readRequestValue(
        req,
        options.engineIdKey || 'engineId',
        options.engineIdFrom || 'body'
      );
      if (!engineId && options.optionalWhenMissingEngineId) {
        return next();
      }
      if (!projectId || !engineId) {
        throw Errors.validation('projectId and engineId required');
      }

      const mode = options.mode || 'manual';
      const tenantId = req.tenant?.tenantId || null;
      const result = await evaluateDeploymentComposite(
        req.user.userId,
        tenantId,
        projectId,
        engineId,
        mode,
        options.legacyAutoGrant !== false
      );
      req.deploymentEligibility = result;

      if (!result.allowed) {
        if (hasDeniedCheck(result, 'project.exists')) {
          throw Errors.projectNotFound();
        }
        if (hasDeniedCheck(result, 'engine.exists')) {
          throw Errors.engineNotFound();
        }
        if (options.hideUnauthorizedEngine !== false && hasDeniedCheck(result, 'engine.permission.deploy')) {
          const canViewEngine = await canViewEngineForDeploy(req.user.userId, engineId, tenantId);
          if (!canViewEngine) {
            throw Errors.engineNotFound();
          }
        }
        return res.status(403).json(deploymentDeniedPayload(result));
      }

      req.authzAction = action;
      req.authzResource = { type: 'project', id: projectId };
      req.authzComposite = {
        kind: 'deployment',
        actionId: action.actionId,
        projectId,
        engineId,
        mode,
      };
      if (options.attachDeployContext !== false) {
        req.deployContext = await loadDeployActionContext(projectId, engineId);
      }
      updateBpmnEngineRequestContext({ actionId: action.actionId, projectId, engineId });

      return next();
    } catch (error) {
      if (error instanceof Error) {
        return next(error);
      }
      return next(Errors.internal('Composite authorization action check failed'));
    }
  };
}

function invitationTargetError(resourceType: ResolvedInvitationTarget['resourceType']): Error {
  if (resourceType === 'tenant') {
    return Errors.forbidden('Only platform admins can invite workspace users');
  }
  if (resourceType === 'project') {
    return Errors.forbidden('Only project member managers can invite project members');
  }
  return Errors.forbidden('Only engine member managers can invite engine members');
}

async function resolveInvitationTarget(req: Request): Promise<{
  resource: ResolvedAuthzActionResource;
  target: ResolvedInvitationTarget;
  context: PermissionContext;
}> {
  const resourceType = typeof req.body?.resourceType === 'string'
    ? req.body.resourceType.trim()
    : '';

  if (resourceType !== 'tenant' && resourceType !== 'project' && resourceType !== 'engine') {
    throw Errors.validation('resourceType must be tenant, project, or engine');
  }

  const baseContext = {
    userId: req.user!.userId,
    tenantId: req.tenant?.tenantId || null,
  };

  if (resourceType === 'tenant') {
    const requiredPermissions = [
      PlatformPermissions.USER_MANAGE,
      PlatformPermissions.USERS_CREATE,
    ];
    return {
      resource: { type: 'platform', id: null },
      target: { resourceType, resourceId: null, requiredPermissions },
      context: { ...baseContext, resourceType: 'platform' },
    };
  }

  const resourceId = typeof req.body?.resourceId === 'string'
    ? req.body.resourceId.trim()
    : '';
  if (!resourceId) {
    throw Errors.validation('Resource ID is required');
  }

  const dataSource = await getDataSource();
  if (resourceType === 'project') {
    await resolveVisibleProjectById(dataSource, resourceId, req.tenant?.tenantId || null);
    const requiredPermissions = [ProjectPermissions.MEMBERS_MANAGE];
    return {
      resource: { type: 'project', id: resourceId },
      target: { resourceType, resourceId, requiredPermissions },
      context: {
        ...baseContext,
        resourceType: 'project',
        resourceId,
      },
    };
  }

  const engine = await dataSource.getRepository(Engine).findOne({
    where: { id: resourceId },
    select: ['id', 'tenantId', 'tenancyMode'],
  });
  if (!engine) {
    throw Errors.notFound('Engine not found');
  }
  if (!isEngineVisibleInTenant(engine, req.tenant?.tenantId || null)) {
    throw Errors.forbidden('Engine not accessible in this tenant');
  }

  const requiredPermissions = [EnginePermissions.MEMBERS_MANAGE];
  return {
    resource: { type: 'engine', id: resourceId },
    target: { resourceType, resourceId, requiredPermissions },
    context: {
      ...baseContext,
      resourceType: 'engine',
      resourceId,
    },
  };
}

export function requireInvitationCreateAction(actionId = 'invitations.create') {
  return async function requireInvitationCreate(req: Request, _res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        throw Errors.unauthorized('Authentication required');
      }

      const action = assertKnownAuthzAction(actionId);
      const { resource, target, context } = await resolveInvitationTarget(req);
      const allowed = (await Promise.all(
        target.requiredPermissions.map((permission) => permissionService.hasPermission(permission, context))
      )).some(Boolean);

      if (!allowed) {
        throw invitationTargetError(target.resourceType);
      }

      req.authzAction = action;
      req.authzResource = resource;
      req.authzInvitationTarget = target;
      (req as Request & { permissionContext?: PermissionContext }).permissionContext = context;
      return next();
    } catch (error) {
      if (error instanceof Error) {
        return next(error);
      }
      return next(Errors.internal('Invitation authorization check failed'));
    }
  };
}

export function requireRuntimeCollectionAction(actionId: string, options: RequireRuntimeCollectionActionOptions) {
  return async function requireRuntimeCollection(req: Request, _res: Response, next: NextFunction) {
    try {
      if (!req.user) throw Errors.unauthorized('Authentication required');
      const action = assertKnownAuthzAction(actionId);
      const engineId = readRequestValue(req, options.engineIdKey || 'engineId', options.engineIdFrom || 'query') || (req as Request & { engineId?: string }).engineId;
      if (!engineId) throw Errors.validation('engineId is required');
      const tenantId = req.tenant?.tenantId || null;
      const engine = await (await getDataSource()).getRepository(Engine).findOne({
        where: { id: engineId },
        select: ['id', 'tenantId', 'tenancyMode', 'runtimeAccessScope'],
      });
      if (!engine || !isEngineVisibleInTenant(engine, tenantId)) throw Errors.notFound('Engine not found');
      const context = { userId: req.user.userId, tenantId, resourceType: 'engine' as const, resourceId: engineId };
      const broad = await permissionService.hasPermission(action.permissionId, context);
      let keys: string[] | undefined;
      let scopes: Array<{ resourceKey: string; runtimeTenantId: string }> | undefined;
      if (requiresResolvedRuntimeResourceGuard(engine, broad)) {
        const visible = await permissionService.getVisibleRuntimeResources({ userId: req.user.userId, tenantId, engineId, resourceKind: options.resourceKind, permission: action.permissionId });
        keys = visible.map((resource) => resource.resourceKey);
        scopes = visible.map((resource) => ({ resourceKey: resource.resourceKey, runtimeTenantId: resource.runtimeTenantId || '' }));
        if (!keys.length) throw Errors.forbidden('No authorized runtime resources are available for this engine');
      } else if (!broad) throw Errors.forbidden('Engine runtime access is not allowed');
      req.authzAction = action;
      req.authzResource = { type: 'engine', id: engineId };
      req.authorizedRuntimeResourceKeys = keys;
      req.authorizedRuntimeResourceScopes = scopes;
      req.runtimeAccessScope = engine.runtimeAccessScope === 'resource_aware' ? 'resource_aware' : 'engine_wide';
      (req as Request & { engineId?: string }).engineId = engineId;
      updateBpmnEngineRequestContext({ actionId: action.actionId, engineId });
      return next();
    } catch (error) { return next(error instanceof Error ? error : Errors.internal('Runtime collection authorization failed')); }
  };
}

export function requireRuntimeDefinitionAction(actionId: string, options: RequireRuntimeDefinitionActionOptions) {
  return async function requireRuntimeDefinition(req: Request, _res: Response, next: NextFunction) {
    try {
      if (!req.user) throw Errors.unauthorized('Authentication required');
      const action = assertKnownAuthzAction(actionId);
      const engineId = readRequestValue(req, options.engineIdKey || 'engineId', options.engineIdFrom || 'query')
        || (req as Request & { engineId?: string }).engineId;
      if (!engineId) throw Errors.validation('engineId is required');
      const definitionLookup = options.definitionLookup || 'id';
      const definitionId = readRequestValue(
        req,
        options.definitionIdKey || (definitionLookup === 'key' ? 'key' : 'id'),
        options.definitionIdFrom || 'params'
      );
      if (!definitionId) throw Errors.validation(`${options.definitionIdKey || (definitionLookup === 'key' ? 'key' : 'id')} is required`);

      const tenantId = req.tenant?.tenantId || null;
      const dataSource = await getDataSource();
      const engine = await dataSource.getRepository(Engine).findOne({
        where: { id: engineId },
        select: ['id', 'tenantId', 'tenancyMode', 'runtimeAccessScope'],
      });
      if (!engine || !isEngineVisibleInTenant(engine, tenantId)) throw Errors.notFound('Engine not found');
      req.runtimeAccessScope = engine.runtimeAccessScope === 'resource_aware' ? 'resource_aware' : 'engine_wide';

      const context: PermissionContext = {
        userId: req.user.userId,
        tenantId,
        resourceType: 'engine',
        resourceId: engineId,
      };
      const broad = await permissionService.hasPermission(action.permissionId, context);
      if (!broad && engine.runtimeAccessScope !== 'resource_aware') {
        throw Errors.forbidden('Engine runtime access is not allowed');
      }

      let resource: ResolvedAuthzActionResource = { type: 'engine', id: engineId };
      if (requiresResolvedRuntimeResourceGuard(engine, broad)) {
        const visibleResources = engine.tenancyMode === 'shared'
          ? await permissionService.getVisibleRuntimeResources({
            userId: req.user.userId,
            tenantId,
            engineId,
            resourceKind: options.resourceKind,
            permission: action.permissionId,
            limit: 5_000,
          })
          : null;
        if (visibleResources && !visibleResources.length) {
          throw Errors.forbidden('Runtime definition is not present in the authorization inventory');
        }
        let runtimeResource: RuntimeResource | null = null;
        if (engine.tenancyMode === 'shared' && !options.definitionReferenceField) {
          if (definitionLookup === 'key') {
            const candidates = visibleResources!.filter((candidate) => candidate.resourceKey === definitionId);
            const runtimeTenantIds = new Set(candidates.map((candidate) => candidate.runtimeTenantId || ''));
            runtimeResource = candidates.length > 0 && runtimeTenantIds.size === 1
              ? candidates[0]
              : null;
          } else {
            const direct = await dataSource.getRepository(RuntimeResource).findOne({
              where: resolvedRuntimeResourceWhere({
                engineId,
                resourceKind: options.resourceKind,
                engineResourceId: definitionId,
                isActive: true,
              }, tenantId),
              select: ['id', 'tenantId', 'tenantResolutionStatus', 'resourceKey', 'runtimeTenantId'],
            });
            if (direct) {
              if (!visibleResources!.some((candidate) => candidate.id === direct.id)) {
                throw Errors.forbidden('Runtime definition is not present in the authorization inventory');
              }
              runtimeResource = direct;
            } else {
              const definition = await camundaGet<Record<string, unknown>>(
                engineId,
                `/${options.definitionPath}/${encodeURIComponent(definitionId)}`
              );
              const resourceKey = (options.resourceKeyFields || ['key'])
                .map((field) => definition[field])
                .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
                ?.trim() || '';
              const runtimeTenantId = typeof definition.tenantId === 'string' ? definition.tenantId : '';
              runtimeResource = visibleResources!.find((candidate) =>
                candidate.resourceKey === resourceKey
                && (candidate.runtimeTenantId || '') === runtimeTenantId) || null;
            }
          }
        } else {
          const resolvedDefinition = definitionLookup === 'id'
            ? await camundaGet<Record<string, unknown>>(
              engineId,
              `/${options.definitionPath}/${encodeURIComponent(definitionId)}`
            )
            : await resolveRuntimeDefinitionByKey(engineId, options, definitionId, req);
          const referenceId = options.definitionReferenceField
            ? resolvedDefinition[options.definitionReferenceField]
            : undefined;
          if (options.definitionReferenceField && (typeof referenceId !== 'string' || !referenceId.trim())) {
            throw Errors.forbidden('Runtime definition cannot be linked to an authorization resource');
          }
          const linkedDefinitionId = typeof referenceId === 'string' ? referenceId : '';
          const definition = options.definitionReferenceField
            ? await camundaGet<Record<string, unknown>>(
              engineId,
              `/${options.definitionReferencePath || 'process-definition'}/${encodeURIComponent(linkedDefinitionId)}`
            )
            : resolvedDefinition;
          const resourceKey = (options.resourceKeyFields || ['key'])
            .map((field) => definition[field])
            .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
            ?.trim() || '';
          if (!resourceKey) throw Errors.forbidden('Runtime definition cannot be resolved for authorization');
          const runtimeTenantId = typeof definition.tenantId === 'string' ? definition.tenantId : '';
          runtimeResource = await dataSource.getRepository(RuntimeResource).findOne({
            where: resolvedRuntimeResourceWhere({
              engineId,
              resourceKind: options.resourceKind,
              resourceKey,
              runtimeTenantId,
              isActive: true,
            }, tenantId),
            select: ['id', 'tenantId', 'tenantResolutionStatus', 'resourceKey', 'runtimeTenantId'],
          });
          if (visibleResources && runtimeResource && !visibleResources.some((candidate) => candidate.id === runtimeResource!.id)) {
            runtimeResource = null;
          }
        }
        if (!isUsableRuntimeResource(runtimeResource, tenantId, engine)) {
          throw Errors.forbidden('Runtime definition is not present in the authorization inventory');
        }
        const resourceAllowed = await permissionService.hasPermission(action.permissionId, {
          ...context,
          resourceType: 'engine_runtime_resource',
          resourceId: runtimeResource!.id,
        });
        if (!resourceAllowed) throw Errors.forbidden(`Access denied for action ${action.actionId}`);
        resource = { type: 'engine_runtime_resource', id: runtimeResource!.id };
        req.authorizedRuntimeResourceKeys = [runtimeResource!.resourceKey];
        req.authorizedRuntimeResourceScopes = [{
          resourceKey: runtimeResource!.resourceKey,
          runtimeTenantId: runtimeResource!.runtimeTenantId || '',
        }];
      }

      (req as Request & { engineId?: string }).engineId = engineId;
      req.authzAction = action;
      req.authzResource = resource;
      updateBpmnEngineRequestContext({ actionId: action.actionId, engineId });
      return next();
    } catch (error) {
      return next(error instanceof Error ? error : Errors.internal('Runtime definition authorization failed'));
    }
  };
}

/**
 * Authorizes an explicit multi-instance operation. Resource-aware engines
 * intentionally reject query-based selections: all selected instances must be
 * resolved to their inherited process-definition resource before an engine
 * mutation can be sent.
 */
export function requireRuntimeProcessInstanceSelectionAction(
  actionId: string,
  options: RequireRuntimeProcessInstanceSelectionActionOptions = { resourceKind: 'process_definition' }
) {
  return async function requireRuntimeProcessInstanceSelection(req: Request, _res: Response, next: NextFunction) {
    try {
      if (!req.user) throw Errors.unauthorized('Authentication required');
      const action = assertKnownAuthzAction(actionId);
      const engineId = readRequestValue(req, options.engineIdKey || 'engineId', options.engineIdFrom || 'body')
        || (req as Request & { engineId?: string }).engineId;
      if (!engineId) throw Errors.validation('engineId is required');
      const tenantId = req.tenant?.tenantId || null;
      const dataSource = await getDataSource();
      const engine = await dataSource.getRepository(Engine).findOne({
        where: { id: engineId }, select: ['id', 'tenantId', 'tenancyMode', 'runtimeAccessScope'],
      });
      if (!engine || !isEngineVisibleInTenant(engine, tenantId)) throw Errors.notFound('Engine not found');
      const context: PermissionContext = {
        userId: req.user.userId,
        tenantId,
        resourceType: 'engine',
        resourceId: engineId,
      };
      const broad = await permissionService.hasPermission(action.permissionId, context);
      if (!broad && engine.runtimeAccessScope !== 'resource_aware') {
        throw Errors.forbidden('Engine runtime access is not allowed');
      }

      let resource: ResolvedAuthzActionResource = { type: 'engine', id: engineId };
      let resourceKeys: string[] | undefined;
      if (requiresResolvedRuntimeResourceGuard(engine, broad)) {
        const ids = readRequestValues(req, options.processInstanceIdsKey || 'processInstanceIds', 'body');
        if (!ids.length) {
          throw Errors.forbidden('Resource-aware batch operations require explicit processInstanceIds');
        }
        const visibleResources = engine.tenancyMode === 'shared'
          ? await permissionService.getVisibleRuntimeResources({
            userId: req.user.userId,
            tenantId,
            engineId,
            resourceKind: options.resourceKind,
            permission: action.permissionId,
            limit: 5_000,
          })
          : null;
        if (visibleResources && !visibleResources.length) {
          throw Errors.forbidden('A selected process instance is not present in the authorization inventory');
        }
        const instances = await Promise.all(ids.map((id) => camundaGet<Record<string, unknown>>(
          engineId, `/process-instance/${encodeURIComponent(id)}`
        )));
        const resourceIdentities = Array.from(new Map(instances.map((instance) => {
          const definitionKey = instance.definitionKey;
          const key = definitionKey === null || typeof definitionKey === 'undefined'
            ? instance.processDefinitionKey
            : definitionKey;
          const resourceKey = typeof key === 'string' ? key.trim() : '';
          const runtimeTenantId = typeof instance.tenantId === 'string' ? instance.tenantId : '';
          return [`${resourceKey}\u0000${runtimeTenantId}`, { resourceKey, runtimeTenantId }] as const;
        }).filter(([, identity]) => Boolean(identity.resourceKey))).values());
        resourceKeys = Array.from(new Set(resourceIdentities.map((identity) => identity.resourceKey)));
        if (!resourceKeys.length) throw Errors.forbidden('Selected process instances cannot be resolved for authorization');
        const resources = await Promise.all(resourceIdentities.map(({ resourceKey, runtimeTenantId }) => dataSource.getRepository(RuntimeResource).findOne({
          where: resolvedRuntimeResourceWhere({ engineId, resourceKind: options.resourceKind, resourceKey, runtimeTenantId, isActive: true }, tenantId),
          select: ['id', 'tenantId', 'tenantResolutionStatus'],
        })));
        if (
          resources.some((candidate) => !isUsableRuntimeResource(candidate, tenantId, engine))
          || (visibleResources && resources.some((candidate) =>
            !visibleResources.some((visible) => visible.id === candidate!.id)))
        ) {
          throw Errors.forbidden('A selected process instance is not present in the authorization inventory');
        }
        const allowed = await Promise.all(resources.map((candidate) => permissionService.hasPermission(action.permissionId, {
          ...context,
          resourceType: 'engine_runtime_resource',
          resourceId: candidate!.id,
        })));
        if (allowed.some((candidate) => !candidate)) throw Errors.forbidden(`Access denied for action ${action.actionId}`);
        resource = { type: 'engine_runtime_resource', id: resources[0]!.id };
      }
      (req as Request & { engineId?: string }).engineId = engineId;
      req.authzAction = action;
      req.authzResource = resource;
      req.authorizedRuntimeResourceKeys = resourceKeys;
      updateBpmnEngineRequestContext({ actionId: action.actionId, engineId });
      return next();
    } catch (error) {
      return next(error instanceof Error ? error : Errors.internal('Runtime batch authorization failed'));
    }
  };
}

/**
 * Authorizes a runtime deployment query or mutation. Engine-wide grants retain
 * the existing fast path; resource-aware grants must authorize every active
 * runtime resource observed under the requested engine deployment id.
 */
export function requireRuntimeDeploymentAction(
  actionId: string,
  options: RequireRuntimeDeploymentActionOptions = {},
) {
  return async function requireRuntimeDeployment(req: Request, _res: Response, next: NextFunction) {
    try {
      if (!req.user) throw Errors.unauthorized('Authentication required');
      const action = assertKnownAuthzAction(actionId);
      const engineId = readRequestValue(req, options.engineIdKey || 'engineId', options.engineIdFrom || 'any')
        || (req as Request & { engineId?: string }).engineId;
      const deploymentId = readRequestValue(req, options.deploymentIdKey || 'deploymentId', options.deploymentIdFrom || 'params');
      if (!engineId) throw Errors.validation('engineId is required');
      if (!deploymentId) throw Errors.validation('deploymentId is required');

      const tenantId = req.tenant?.tenantId || null;
      const dataSource = await getDataSource();
      const engine = await dataSource.getRepository(Engine).findOne({
        where: { id: engineId }, select: ['id', 'tenantId', 'tenancyMode', 'runtimeAccessScope'],
      });
      if (!engine || !isEngineVisibleInTenant(engine, tenantId)) throw Errors.notFound('Engine not found');

      const context: PermissionContext = {
        userId: req.user.userId,
        tenantId,
        resourceType: 'engine',
        resourceId: engineId,
      };
      const broad = await permissionService.hasPermission(action.permissionId, context);
      if (!broad && engine.runtimeAccessScope !== 'resource_aware') {
        throw Errors.forbidden('Engine runtime access is not allowed');
      }

      let resource: ResolvedAuthzActionResource = { type: 'engine', id: engineId };
      let resourceKeys: string[] | undefined;
      if (requiresResolvedRuntimeResourceGuard(engine, broad)) {
        const resources = await dataSource.getRepository(RuntimeResource).find({
          where: resolvedRuntimeResourceWhere({
            engineId,
            deploymentId,
            isActive: true,
            ...(options.resourceKinds?.length === 1 ? { resourceKind: options.resourceKinds[0] } : {}),
          }, tenantId),
          select: ['id', 'tenantId', 'tenantResolutionStatus', 'resourceKey'],
        });
        if (!resources.length || resources.some((candidate) => !isUsableRuntimeResource(candidate, tenantId, engine))) {
          throw Errors.forbidden('Runtime deployment is not present in the authorization inventory');
        }
        const allowed = await Promise.all(resources.map((candidate) => permissionService.hasPermission(action.permissionId, {
          ...context,
          resourceType: 'engine_runtime_resource',
          resourceId: candidate.id,
        })));
        if (allowed.some((candidate) => !candidate)) throw Errors.forbidden(`Access denied for action ${action.actionId}`);
        resource = { type: 'engine_runtime_resource', id: resources[0]!.id };
        resourceKeys = Array.from(new Set(resources.map((candidate) => candidate.resourceKey).filter(Boolean)));
      }

      (req as Request & { engineId?: string }).engineId = engineId;
      req.authzAction = action;
      req.authzResource = resource;
      req.authorizedRuntimeResourceKeys = resourceKeys;
      updateBpmnEngineRequestContext({ actionId: action.actionId, engineId });
      return next();
    } catch (error) {
      return next(error instanceof Error ? error : Errors.internal('Runtime deployment authorization failed'));
    }
  };
}

/** Authorizes both sides of a process-definition migration. */
export function requireRuntimeMigrationAction(
  actionId: string,
  options: RequireRuntimeMigrationActionOptions = { resourceKind: 'process_definition' }
) {
  return async function requireRuntimeMigration(req: Request, _res: Response, next: NextFunction) {
    try {
      if (!req.user) throw Errors.unauthorized('Authentication required');
      const action = assertKnownAuthzAction(actionId);
      const engineId = readRequestValue(req, options.engineIdKey || 'engineId', options.engineIdFrom || 'body')
        || (req as Request & { engineId?: string }).engineId;
      if (!engineId) throw Errors.validation('engineId is required');
      const tenantId = req.tenant?.tenantId || null;
      const dataSource = await getDataSource();
      const engine = await dataSource.getRepository(Engine).findOne({
        where: { id: engineId }, select: ['id', 'tenantId', 'tenancyMode', 'runtimeAccessScope'],
      });
      if (!engine || !isEngineVisibleInTenant(engine, tenantId)) throw Errors.notFound('Engine not found');
      const context: PermissionContext = {
        userId: req.user.userId,
        tenantId,
        resourceType: 'engine',
        resourceId: engineId,
      };
      const broad = await permissionService.hasPermission(action.permissionId, context);
      if (!broad && engine.runtimeAccessScope !== 'resource_aware') {
        throw Errors.forbidden('Engine runtime access is not allowed');
      }
      let resource: ResolvedAuthzActionResource = { type: 'engine', id: engineId };
      let resourceKeys: string[] | undefined;
      if (requiresResolvedRuntimeResourceGuard(engine, broad)) {
        const plan = (req.body?.[options.planKey || 'plan'] && typeof req.body[options.planKey || 'plan'] === 'object')
          ? req.body[options.planKey || 'plan'] as Record<string, unknown>
          : req.body as Record<string, unknown>;
        const sourceId = typeof plan?.sourceProcessDefinitionId === 'string'
          ? plan.sourceProcessDefinitionId : plan?.sourceDefinitionId;
        const targetId = typeof plan?.targetProcessDefinitionId === 'string'
          ? plan.targetProcessDefinitionId : plan?.targetDefinitionId;
        if (typeof sourceId !== 'string' || typeof targetId !== 'string' || !sourceId || !targetId) {
          throw Errors.validation('sourceProcessDefinitionId and targetProcessDefinitionId are required');
        }
        const visibleResources = engine.tenancyMode === 'shared'
          ? await permissionService.getVisibleRuntimeResources({
            userId: req.user.userId,
            tenantId,
            engineId,
            resourceKind: options.resourceKind,
            permission: action.permissionId,
            limit: 5_000,
          })
          : null;
        if (visibleResources && !visibleResources.length) {
          throw Errors.forbidden('A migration definition is not present in the authorization inventory');
        }
        const definitions = await Promise.all([sourceId, targetId].map((id) => camundaGet<Record<string, unknown>>(
          engineId, `/process-definition/${encodeURIComponent(id)}`
        )));
        const resolvedResourceIdentities = definitions.map((definition) => ({
          resourceKey: typeof definition.key === 'string' ? definition.key.trim() : '',
          runtimeTenantId: typeof definition.tenantId === 'string' ? definition.tenantId : '',
        }));
        const resolvedResourceKeys = resolvedResourceIdentities.map((identity) => identity.resourceKey);
        if (resolvedResourceKeys.some((key) => !key)) throw Errors.forbidden('Migration definitions cannot be resolved for authorization');
        resourceKeys = resolvedResourceKeys;
        const resources = await Promise.all(resolvedResourceIdentities.map(({ resourceKey, runtimeTenantId }) => dataSource.getRepository(RuntimeResource).findOne({
          where: resolvedRuntimeResourceWhere({ engineId, resourceKind: options.resourceKind, resourceKey, runtimeTenantId, isActive: true }, tenantId),
          select: ['id', 'tenantId', 'tenantResolutionStatus'],
        })));
        if (
          resources.some((candidate) => !isUsableRuntimeResource(candidate, tenantId, engine))
          || (visibleResources && resources.some((candidate) =>
            !visibleResources.some((visible) => visible.id === candidate!.id)))
        ) {
          throw Errors.forbidden('A migration definition is not present in the authorization inventory');
        }
        const allowed = await Promise.all(resources.map((candidate) => permissionService.hasPermission(action.permissionId, {
          ...context, resourceType: 'engine_runtime_resource', resourceId: candidate!.id,
        })));
        if (allowed.some((candidate) => !candidate)) throw Errors.forbidden(`Access denied for action ${action.actionId}`);

        const instanceIds = readRequestValues(req, 'processInstanceIds', 'body');
        if (instanceIds.length) {
          const instances = await Promise.all(instanceIds.map((id) => camundaGet<Record<string, unknown>>(
            engineId, `/process-instance/${encodeURIComponent(id)}`
          )));
          if (instances.some((instance) => instance.definitionKey !== resolvedResourceKeys[0])) {
            throw Errors.forbidden('A selected process instance does not belong to the authorized migration source');
          }
        }
        resource = { type: 'engine_runtime_resource', id: resources[0]!.id };
      }
      (req as Request & { engineId?: string }).engineId = engineId;
      req.authzAction = action;
      req.authzResource = resource;
      req.authorizedRuntimeResourceKeys = resourceKeys;
      updateBpmnEngineRequestContext({ actionId: action.actionId, engineId });
      return next();
    } catch (error) {
      return next(error instanceof Error ? error : Errors.internal('Runtime migration authorization failed'));
    }
  };
}

async function resolveRuntimeDefinitionByKey(
  engineId: string,
  options: RequireRuntimeDefinitionActionOptions,
  definitionKey: string,
  req: Request
): Promise<Record<string, unknown>> {
  const versionRaw = readRequestValue(req, options.definitionVersionKey || 'version', options.definitionVersionFrom || 'query');
  const version = versionRaw ? Number(versionRaw) : null;
  if (versionRaw && (!Number.isInteger(version) || version! <= 0)) {
    throw Errors.validation(`${options.definitionVersionKey || 'version'} must be a positive integer`);
  }
  const definitions = await camundaGet<Record<string, unknown>[]>(engineId, `/${options.definitionPath}`, {
    key: definitionKey,
    ...(version ? { version } : { latestVersion: true }),
  });
  const definition = definitions.find((candidate) => candidate && candidate.key === definitionKey);
  if (!definition) throw Errors.notFound('Runtime definition not found');
  return definition;
}

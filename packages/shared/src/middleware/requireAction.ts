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
import { Errors } from './errorHandler.js';

type ResourceIdLocation = 'params' | 'body' | 'query' | 'any';

export interface RequireActionOptions {
  resourceResolver?: string;
  resourceIdFrom?: ResourceIdLocation;
  resourceIdKey?: string;
  collectionIdsFrom?: ResourceIdLocation;
  collectionIdsKey?: string;
  acceptedPermissions?: Permission[];
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
      select: ['id', 'tenantId'],
    });
    if (!engine) {
      throw Errors.notFound('Engine not found');
    }
    if (!isTenantVisible(engine.tenantId, tenantId)) {
      throw Errors.forbidden('Engine not accessible in this tenant');
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
      select: ['id', 'tenantId'],
    });
    if (!engine) {
      throw Errors.notFound('Engine not found');
    }
    if (!isTenantVisible(engine.tenantId, tenantId)) {
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
    const platformRole = req.user!.platformRole || (req.user as { role?: string }).role;
    const hasCollectionWideAccess = await permissionService.hasPermission(action.permissionId, {
      userId: req.user!.userId,
      tenantId,
      platformRole,
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
      platformRole: req.user!.platformRole || (req.user as { role?: string }).role,
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
  let requestedIds = readRequestValues(
    req,
    options.collectionIdsKey || 'engineIds',
    options.collectionIdsFrom || 'query'
  );
  if (requestedIds.length === 0) {
    const tenantId = req.tenant?.tenantId || null;
    const platformRole = req.user!.platformRole || (req.user as { role?: string }).role;
    const hasCollectionWideAccess = await permissionService.hasPermission(action.permissionId, {
      userId: req.user!.userId,
      tenantId,
      platformRole,
      resourceType: 'engine',
    });
    if (hasCollectionWideAccess) {
      const dataSource = await getDataSource();
      const visibleTenantIds = tenantIdsForAuthz(tenantId);
      const rows = await dataSource.getRepository(Engine).find({
        where: visibleTenantIds.length > 0
          ? [{ tenantId: In(visibleTenantIds) }, { tenantId: IsNull() }]
          : undefined,
        select: ['id'],
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
    select: ['id', 'tenantId'],
  });
  const existingIds = new Set(rows.map((row) => String(row.id)));
  const visibleIds = new Set(rows
    .filter((row) => isTenantVisible(row.tenantId, req.tenant?.tenantId || null))
    .map((row) => String(row.id)));
  const allowedIds = new Set<string>();

  for (const engineId of requestedIds) {
    if (!visibleIds.has(engineId)) continue;
    const allowed = await permissionService.hasPermission(action.permissionId, {
      userId: req.user!.userId,
      tenantId: req.tenant?.tenantId || null,
      platformRole: req.user!.platformRole || (req.user as { role?: string }).role,
      resourceType: 'engine',
      resourceId: engineId,
    });
    if (allowed) {
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
  return permissionService.hasPermission(EnginePermissions.DEPLOY_VIEW, {
    userId,
    tenantId,
    resourceType: 'engine',
    resourceId: engineId,
  }) ||
    permissionService.hasPermission(EnginePermissions.INSTANCE_VIEW, {
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
        req.authzAction = action;
        req.authzResource = { type: 'project', id: null };
        req.authzCollection = collection;
        req.authorizedProjectIds = collection.ids;
        return next();
      }
      if (resolverId === 'engine.visibleCollection') {
        const collection = await resolveEngineVisibleCollection(req, action, options);
        req.authzAction = action;
        req.authzResource = { type: 'engine', id: null };
        req.authzCollection = collection;
        req.authorizedEngineIds = collection.ids;
        return next();
      }

      const resource = await resolveActionResource(req, resolverId, options);
      const context: PermissionContext = {
        userId: req.user.userId,
        tenantId: req.tenant?.tenantId || null,
        platformRole: req.user.platformRole || (req.user as { role?: string }).role,
        resourceType: resource.type,
        resourceId: resource.id || undefined,
      };

      const acceptedPermissions = options.acceptedPermissions?.length
        ? options.acceptedPermissions
        : [action.permissionId];
      const allowed = (await Promise.all(
        acceptedPermissions.map((permission) => permissionService.hasPermission(permission, context))
      )).some(Boolean);
      if (!allowed) {
        throw Errors.forbidden(`Access denied for action ${action.actionId}`);
      }

      req.authzAction = action;
      req.authzResource = resource;
      (req as Request & { permissionContext?: PermissionContext }).permissionContext = context;
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

      return next();
    } catch (error) {
      if (error instanceof Error) {
        return next(error);
      }
      return next(Errors.internal('Composite authorization action check failed'));
    }
  };
}

function invitationTargetError(resourceType: string): Error {
  if (resourceType === 'tenant') {
    return Errors.forbidden('Only platform admins can invite workspace users');
  }
  if (resourceType === 'project') {
    return Errors.forbidden('Only project member managers can invite project members');
  }
  if (resourceType === 'engine') {
    return Errors.forbidden('Only engine member managers can invite engine members');
  }
  return Errors.forbidden('Invitation creation is not allowed');
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
    platformRole: req.user!.platformRole || (req.user as { role?: string }).role,
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
    select: ['id', 'tenantId'],
  });
  if (!engine) {
    throw Errors.notFound('Engine not found');
  }
  if (!isTenantVisible(engine.tenantId, req.tenant?.tenantId || null)) {
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

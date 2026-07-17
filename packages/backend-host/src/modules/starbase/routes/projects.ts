import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { requireAction } from '@enterpriseglue/shared/middleware/requireAction.js';
import { validateBody, validateParams, validateQuery } from '@enterpriseglue/shared/middleware/validate.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Project } from '@enterpriseglue/shared/infrastructure/persistence/entities/Project.js';
import { File } from '@enterpriseglue/shared/infrastructure/persistence/entities/File.js';
import { Folder } from '@enterpriseglue/shared/infrastructure/persistence/entities/Folder.js';
import { GitRepository } from '@enterpriseglue/shared/infrastructure/persistence/entities/GitRepository.js';
import { GitProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/GitProvider.js';
import { ProjectMember } from '@enterpriseglue/shared/infrastructure/persistence/entities/ProjectMember.js';
import { ProjectMemberRole } from '@enterpriseglue/shared/infrastructure/persistence/entities/ProjectMemberRole.js';
import { RbacRoleAssignment } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRoleAssignment.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import { Invitation } from '@enterpriseglue/shared/infrastructure/persistence/entities/Invitation.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { EngineHealth } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineHealth.js';
import { EngineProjectAccess } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineProjectAccess.js';
import { EngineAccessRequest } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineAccessRequest.js';
import { EnvironmentTag } from '@enterpriseglue/shared/infrastructure/persistence/entities/EnvironmentTag.js';
import { ProjectEngineTarget } from '@enterpriseglue/shared/infrastructure/persistence/entities/ProjectEngineTarget.js';
import { In, IsNull, type EntityManager } from 'typeorm';
import { CascadeDeleteService } from '@enterpriseglue/shared/services/cascade-delete.js';
import { generateId, unixTimestamp } from '@enterpriseglue/shared/utils/id.js';
import { projectMemberService } from '@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js';
import {
  deploymentEligibilityService,
  projectEngineTargetService,
  type DeploymentEligibilityResult,
} from '@enterpriseglue/shared/services/platform-admin/index.js';
import { PlatformPermissions, permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import { writeProjectMemberRoleAssignments } from '@enterpriseglue/shared/services/platform-admin/project-member-role-assignments.js';
import { projectCreateLimiter, apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import {
  applyPreparedEngineImportToProject,
  assertUserCanImportFromEngine,
  prepareLatestEngineImport,
  previewLatestEngineImport,
} from '@enterpriseglue/shared/services/starbase/engine-import-service.js';
import {
  ProjectEngineAccessResponseSchema,
  type ProjectEngineAccessedEngine,
  type ProjectEngineAccessPendingRequest,
} from '@enterpriseglue/shared/schemas/starbase/project-engine-access.js';
import { ProjectOverviewListSchema } from '@enterpriseglue/shared/schemas/starbase/project.js';

// Validation schemas
const projectIdParamSchema = z.object({ projectId: z.string().uuid() });
const createProjectBodySchema = z.object({
  name: z.string().min(1).max(255),
  importFromEngine: z.object({
    enabled: z.boolean().optional(),
    engineId: z.string().min(1).optional(),
  }).optional(),
}).superRefine((value: { importFromEngine?: { enabled?: boolean; engineId?: string } }, ctx: z.RefinementCtx) => {
  if (value.importFromEngine?.enabled && !value.importFromEngine.engineId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['importFromEngine', 'engineId'],
      message: 'Engine selection is required when import is enabled',
    });
  }
});
const renameProjectBodySchema = z.object({ name: z.string().min(1).max(255) });
const importPreviewBodySchema = z.object({ engineId: z.string().min(1) });
const projectDeploymentTargetStatusSchema = z.enum(['active', 'disabled', 'archived']);
const projectDeploymentTargetSourceSchema = z.enum(['manual', 'legacy', 'ci', 'api', 'import', 'deployment_history', 'external', 'system', 'automation']);
const projectDeploymentTargetsQuerySchema = z.object({
  status: z.enum(['active', 'disabled', 'archived', 'all']).optional(),
  source: projectDeploymentTargetSourceSchema.optional(),
});
const projectDeploymentTargetParamsSchema = projectIdParamSchema.extend({
  targetId: z.string().min(1),
});
const projectDeploymentTargetCreateSchema = z.object({
  engineId: z.string().min(1),
  status: z.enum(['active', 'disabled']).optional(),
  allowManualDeploy: z.boolean().optional(),
  allowCiDeploy: z.boolean().optional(),
  allowApiDeploy: z.boolean().optional(),
  allowImport: z.boolean().optional(),
});
const projectDeploymentTargetUpdateSchema = z.object({
  status: projectDeploymentTargetStatusSchema.optional(),
  allowManualDeploy: z.boolean().optional(),
  allowCiDeploy: z.boolean().optional(),
  allowApiDeploy: z.boolean().optional(),
  allowImport: z.boolean().optional(),
});

const r = Router();

// Type definitions for query results
interface ProjectRow {
  id: string;
  name: string;
  ownerId: string;
  createdAt: number;
}

interface CountRow {
  projectId: string;
  count: number;
}

interface RepoRow {
  projectId: string;
  remoteUrl: string | null;
  providerId: string | null;
}

interface ProviderRow {
  id: string;
  type: string;
}

interface MemberRow {
  projectId: string;
  userId: string;
  role: string;
}

interface UserRow {
  id: string;
  firstName: string | null;
  lastName: string | null;
}

const DEPLOYMENT_DIAGNOSTIC_PERMISSIONS = new Set<string>([
  PlatformPermissions.AUTHZ_CHECK,
  PlatformPermissions.PROJECT_ENGINE_TARGETS_VIEW,
  PlatformPermissions.PROJECT_ENGINE_TARGETS_MANAGE,
]);

function requestPermissionStrings(req: Request): Set<string> {
  const user = req.user as any;
  const values = [
    ...(Array.isArray(user?.permissions) ? user.permissions : []),
    ...(Array.isArray(user?.capabilities?.permissions) ? user.capabilities.permissions : []),
  ];
  return new Set(values.map(String));
}

async function canViewDeploymentDiagnostics(req: Request): Promise<boolean> {
  const permissions = requestPermissionStrings(req);
  for (const permission of DEPLOYMENT_DIAGNOSTIC_PERMISSIONS) {
    if (permissions.has(permission)) {
      return true;
    }
  }

  const user = req.user as any;
  const userId = String(user?.userId || '');
  if (!userId) {
    return false;
  }

  const checks = await Promise.all(
    Array.from(DEPLOYMENT_DIAGNOSTIC_PERMISSIONS).map((permission) =>
      permissionService.hasPermission(permission, {
        userId,
        tenantId: req.tenant?.tenantId || null,
        resourceType: 'platform',
        resourceId: 'platform',
      })
    )
  );
  return checks.some(Boolean);
}

function deploymentEligibilityView(result: DeploymentEligibilityResult, includeDiagnostics: boolean) {
  return {
    allowed: result.allowed,
    reasons: result.reasons,
    ...(includeDiagnostics ? { checks: result.checks } : {}),
  };
}

async function assertProjectDeploymentTarget(projectId: string, targetId: string, tenantId?: string | null) {
  const target = await projectEngineTargetService.getTarget(targetId, tenantId);
  if (!target || target.projectId !== projectId) {
    throw Errors.notFound('Project Engine Target');
  }
  return target;
}

/**
 * Get all projects for current user
 * 
 * ✨ Migrated to TypeORM
 */
r.get('/starbase-api/projects', apiLimiter, requireAuth, requireAction('project.projects.read', { resourceResolver: 'project.visibleCollection' }), asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource();
  const projectRepo = dataSource.getRepository(Project);
  const fileRepo = dataSource.getRepository(File);
  const folderRepo = dataSource.getRepository(Folder);
  const gitRepoRepo = dataSource.getRepository(GitRepository);
  const gitProviderRepo = dataSource.getRepository(GitProvider);
  const projectMemberRepo = dataSource.getRepository(ProjectMember);
  const userRepo = dataSource.getRepository(User);
  const authorizedProjectIds = Array.isArray(req.authorizedProjectIds)
    ? req.authorizedProjectIds
    : [];

  const projectIds = authorizedProjectIds.map(String);
  if (projectIds.length === 0) {
    return res.json([]);
  }
  const rows = await projectRepo.find({
    where: { id: In(projectIds) },
    select: ['id', 'name', 'ownerId', 'createdAt']
  }) as ProjectRow[];

  // Batch file counts
  const filesCountMap = new Map<string, number>();
  try {
    const countRows = await fileRepo.createQueryBuilder('f')
      .select('f.projectId', 'projectId')
      .addSelect('COUNT(*)', 'count')
      .where('f.projectId IN (:...projectIds)', { projectIds })
      .groupBy('f.projectId')
      .getRawMany() as CountRow[];
    for (const cr of countRows) {
      filesCountMap.set(String(cr.projectId), Number(cr.count || 0));
    }
  } catch (e) {
    logger.debug('Failed to get file counts', { error: e });
  }

  // Batch folder counts
  const foldersCountMap = new Map<string, number>();
  try {
    const countRows = await folderRepo.createQueryBuilder('f')
      .select('f.projectId', 'projectId')
      .addSelect('COUNT(*)', 'count')
      .where('f.projectId IN (:...projectIds)', { projectIds })
      .groupBy('f.projectId')
      .getRawMany() as CountRow[];
    for (const cr of countRows) {
      foldersCountMap.set(String(cr.projectId), Number(cr.count || 0));
    }
  } catch (e) {
    logger.debug('Failed to get folder counts', { error: e });
  }

  // Batch git repository lookups
  const repoByProjectId = new Map<string, { remoteUrl: string | null; providerId: string | null }>();
  try {
    const repoRows = await gitRepoRepo.find({
      where: { projectId: In(projectIds) },
      select: ['projectId', 'remoteUrl', 'providerId']
    }) as RepoRow[];
    for (const rr of repoRows) {
      const pid = String(rr.projectId);
      if (!repoByProjectId.has(pid)) {
        repoByProjectId.set(pid, {
          remoteUrl: rr.remoteUrl ?? null,
          providerId: rr.providerId ?? null,
        });
      }
    }
  } catch (e) {
    logger.debug('Failed to get git repositories', { error: e });
  }

  // Batch provider type lookup
  const providerIds = Array.from(new Set(
    Array.from(repoByProjectId.values())
      .map((r) => r.providerId)
      .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
  ));
  const providerTypeById = new Map<string, string>();
  if (providerIds.length > 0) {
    try {
      const providerRows = await gitProviderRepo.find({
        where: { id: In(providerIds) },
        select: ['id', 'type']
      }) as ProviderRow[];
      for (const pr of providerRows) {
        providerTypeById.set(String(pr.id), String(pr.type));
      }
    } catch (e) {
      logger.debug('Failed to get provider types', { error: e });
    }
  }

  // Batch project members lookup with user details
  const membersByProjectId = new Map<string, Array<{ userId: string; firstName: string | null; lastName: string | null; role: string }>>();
  try {
    const memberRowsData = await projectMemberRepo.find({
      where: { projectId: In(projectIds) },
      select: ['projectId', 'userId', 'role']
    });

    const pendingProjectInvites = await dataSource.getRepository(Invitation).find({
      where: {
        resourceType: 'project',
        resourceId: In(projectIds),
        revokedAt: IsNull(),
        completedAt: IsNull(),
      },
      select: ['resourceId', 'userId'],
    });
    const pendingMemberKeys = new Set(
      pendingProjectInvites.map((invite) => `${String(invite.resourceId)}:${String(invite.userId)}`)
    );

    // Get user details from database
    const memberUserIds = [...new Set(memberRowsData.map((m: ProjectMember) => String(m.userId)))];
    const userDetailsMap = new Map<string, { firstName: string | null; lastName: string | null }>();
    
    if (memberUserIds.length > 0) {
      const userRows = await userRepo.find({
        where: { id: In(memberUserIds) },
        select: ['id', 'firstName', 'lastName']
      }) as UserRow[];
      
      for (const u of userRows) {
        userDetailsMap.set(String(u.id), { firstName: u.firstName, lastName: u.lastName });
      }
    }

    // Group members by project
    for (const m of memberRowsData) {
      const pid = String(m.projectId);
      const uid = String(m.userId);
      if (pendingMemberKeys.has(`${pid}:${uid}`)) {
        continue;
      }
      const userDetails = userDetailsMap.get(uid) || { firstName: null, lastName: null };
      
      if (!membersByProjectId.has(pid)) {
        membersByProjectId.set(pid, []);
      }
      membersByProjectId.get(pid)!.push({
        userId: uid,
        firstName: userDetails.firstName,
        lastName: userDetails.lastName,
        role: m.role,
      });
    }
  } catch (e) {
    logger.debug('Failed to get project members', { error: e });
  }

  const out = rows.map((row) => {
    const pid = String(row.id);
    const repo = repoByProjectId.get(pid);
    const providerId = repo?.providerId ?? null;
    const members = membersByProjectId.get(pid) || [];
    return {
      id: row.id,
      name: row.name,
      createdAt: Number(row.createdAt),
      foldersCount: foldersCountMap.get(pid) ?? 0,
      filesCount: filesCountMap.get(pid) ?? 0,
      gitUrl: repo?.remoteUrl ?? null,
      gitProviderType: providerId ? (providerTypeById.get(providerId) ?? null) : null,
      gitSyncStatus: null,
      members: members.map(m => ({
        userId: m.userId,
        firstName: m.firstName,
        lastName: m.lastName,
        role: m.role,
      })),
    };
  });
  
  res.json(ProjectOverviewListSchema.parse(out));
}));

/**
 * Create a new project
 * 
 * ✨ Migrated to TypeORM
 */
r.post('/starbase-api/projects', apiLimiter, requireAuth, projectCreateLimiter, requireAction('project.projects.create', { resourceResolver: 'platform.self' }), validateBody(createProjectBodySchema), asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const {
    name,
    importFromEngine,
  } = req.body as {
    name: string;
    importFromEngine?: {
      enabled?: boolean;
      engineId?: string;
    };
  };
  const trimmed = name.trim();
  const importEngineId = importFromEngine?.enabled
    ? String(importFromEngine.engineId || '').trim()
    : '';

  let preparedImport: Awaited<ReturnType<typeof prepareLatestEngineImport>> | null = null;
  if (importEngineId) {
    await assertUserCanImportFromEngine(userId, importEngineId, req.tenant?.tenantId || null);
    preparedImport = await prepareLatestEngineImport(importEngineId);
  }

  const id = generateId();
  const now = unixTimestamp();
  const dataSource = await getDataSource();

  await dataSource.transaction(async (manager: EntityManager) => {
    await manager.getRepository(Project).insert({
      id,
      name: trimmed,
      ownerId: userId,
      createdAt: now,
      updatedAt: now
    });

    const membershipNow = now;
    await manager.getRepository(ProjectMember).createQueryBuilder()
      .insert()
      .values({
        id: generateId(),
        projectId: id,
        userId,
        role: 'owner',
        invitedById: null,
        joinedAt: membershipNow,
        createdAt: membershipNow,
        updatedAt: membershipNow,
      })
      .orIgnore()
      .execute();

    await manager.getRepository(ProjectMemberRole).createQueryBuilder()
      .insert()
      .values({
        projectId: id,
        userId,
        role: 'owner',
        createdAt: membershipNow,
      })
      .orIgnore()
      .execute();

    await writeProjectMemberRoleAssignments(manager, {
      projectId: id,
      tenantId: req.tenant?.tenantId || null,
      userId,
      roles: ['owner'],
      createdById: null,
      createdAt: membershipNow,
    });

    if (preparedImport) {
      await applyPreparedEngineImportToProject({
        manager,
        projectId: id,
        userId,
        importData: preparedImport,
      });
    }
  });

  res.json({ id, name: trimmed, ownerId: userId, createdAt: now, updatedAt: now });
}));

r.post('/starbase-api/projects/import-preview', apiLimiter, requireAuth, validateBody(importPreviewBodySchema), requireAction('project.import.preview', { resourceResolver: 'engine.byId', resourceIdFrom: 'body', resourceIdKey: 'engineId' }), asyncHandler(async (req: Request, res: Response) => {
  const preview = await previewLatestEngineImport(
    req.user!.userId,
    String(req.body.engineId).trim(),
    req.tenant?.tenantId || null
  );
  res.json(preview);
}));

/**
 * Rename project
 * 
 * ✨ Migrated to TypeORM
 */
r.patch('/starbase-api/projects/:projectId', apiLimiter, requireAuth, validateParams(projectIdParamSchema), validateBody(renameProjectBodySchema), requireAction('project.projects.update', { resourceResolver: 'project.byId', resourceIdFrom: 'params' }), asyncHandler(async (req: Request, res: Response) => {
  const projectId = String(req.params.projectId);
  const { name } = req.body;
  const trimmed = name.trim();

  const dataSource = await getDataSource();
  const projectRepo = dataSource.getRepository(Project);
  await projectRepo.update({ id: projectId }, { name: trimmed });

  res.json({ id: projectId, name: trimmed });
}));

/**
 * Delete project (cascade files + versions)
 * 
 * ✨ Migrated to TypeORM
 */
r.delete('/starbase-api/projects/:projectId', apiLimiter, requireAuth, requireAction('project.projects.delete', { resourceResolver: 'project.byId', resourceIdFrom: 'params' }), asyncHandler(async (req: Request, res: Response) => {
  const projectId = String(req.params.projectId);

  // Delete project and all its resources using cascade delete service
  await CascadeDeleteService.deleteProject(projectId);
  await (await getDataSource()).getRepository(RbacRoleAssignment).delete({
    scopeType: 'project',
    scopeId: projectId,
  });

  res.status(204).end();
}));

// ============ Project Deployment Target Routes ============

r.get('/starbase-api/projects/:projectId/deployment-targets', apiLimiter, requireAuth, validateParams(projectIdParamSchema), validateQuery(projectDeploymentTargetsQuerySchema), requireAction('project.deployment-targets.read', { resourceResolver: 'project.byId', resourceIdFrom: 'params' }), asyncHandler(async (req: Request, res: Response) => {
  const targets = await projectEngineTargetService.listTargets({
    tenantId: req.tenant?.tenantId || null,
    projectId: String(req.params.projectId),
    status: req.query.status as any,
    source: req.query.source as any,
  });
  res.json(targets);
}));

r.post('/starbase-api/projects/:projectId/deployment-targets/sync-legacy', apiLimiter, requireAuth, validateParams(projectIdParamSchema), requireAction('project.deployment-targets.manage', { resourceResolver: 'project.byId', resourceIdFrom: 'params' }), asyncHandler(async (req: Request, res: Response) => {
  const result = await projectEngineTargetService.syncLegacyAccessForProject(
    String(req.params.projectId),
    req.tenant?.tenantId || null
  );
  res.json(result);
}));

r.post('/starbase-api/projects/:projectId/deployment-targets', apiLimiter, requireAuth, validateParams(projectIdParamSchema), validateBody(projectDeploymentTargetCreateSchema), requireAction('project.deployment-targets.manage', { resourceResolver: 'project.byId', resourceIdFrom: 'params' }), asyncHandler(async (req: Request, res: Response) => {
  const result = await projectEngineTargetService.createTarget({
    tenantId: req.tenant?.tenantId || null,
    projectId: String(req.params.projectId),
    engineId: String(req.body.engineId),
    status: req.body.status || 'active',
    source: 'manual',
    allowManualDeploy: req.body.allowManualDeploy,
    allowCiDeploy: req.body.allowCiDeploy,
    allowApiDeploy: req.body.allowApiDeploy,
    allowImport: req.body.allowImport,
    createdById: req.user!.userId,
  });
  res.status(201).json(result);
}));

r.put('/starbase-api/projects/:projectId/deployment-targets/:targetId', apiLimiter, requireAuth, validateParams(projectDeploymentTargetParamsSchema), validateBody(projectDeploymentTargetUpdateSchema), requireAction('project.deployment-targets.manage', { resourceResolver: 'project.byId', resourceIdFrom: 'params' }), asyncHandler(async (req: Request, res: Response) => {
  const projectId = String(req.params.projectId);
  const targetId = String(req.params.targetId);
  await assertProjectDeploymentTarget(projectId, targetId, req.tenant?.tenantId || null);
  await projectEngineTargetService.updateTarget(targetId, {
    tenantId: req.tenant?.tenantId || null,
    status: req.body.status,
    allowManualDeploy: req.body.allowManualDeploy,
    allowCiDeploy: req.body.allowCiDeploy,
    allowApiDeploy: req.body.allowApiDeploy,
    allowImport: req.body.allowImport,
  });
  res.json({ success: true });
}));

r.delete('/starbase-api/projects/:projectId/deployment-targets/:targetId', apiLimiter, requireAuth, validateParams(projectDeploymentTargetParamsSchema), requireAction('project.deployment-targets.manage', { resourceResolver: 'project.byId', resourceIdFrom: 'params' }), asyncHandler(async (req: Request, res: Response) => {
  const projectId = String(req.params.projectId);
  const targetId = String(req.params.targetId);
  await assertProjectDeploymentTarget(projectId, targetId, req.tenant?.tenantId || null);
  await projectEngineTargetService.archiveTarget(targetId, req.tenant?.tenantId || null);
  res.status(204).send();
}));

// ============ Project Engine Access Routes ============

/**
 * GET /starbase-api/projects/:projectId/engine-access
 * Get engine access status for a project (engines it has access to + pending requests)
 * ✨ Migrated to TypeORM
 */
r.get('/starbase-api/projects/:projectId/engine-access', apiLimiter, requireAuth, requireAction('project.deployment-options.read', { resourceResolver: 'project.byId', resourceIdFrom: 'params' }), asyncHandler(async (req: Request, res: Response) => {
  const projectId = String(req.params.projectId);
  const userId = req.user!.userId;
  const tenantId = req.tenant?.tenantId || null;

  const dataSource = await getDataSource();
  const engineProjectAccessRepo = dataSource.getRepository(EngineProjectAccess);
  const projectEngineTargetRepo = dataSource.getRepository(ProjectEngineTarget);
  const engineRepo = dataSource.getRepository(Engine);
  const envTagRepo = dataSource.getRepository(EnvironmentTag);
  const engineHealthRepo = dataSource.getRepository(EngineHealth);
  const engineAccessRequestRepo = dataSource.getRepository(EngineAccessRequest);

  // Get engines this project has access to
  const accessRows = await engineProjectAccessRepo.find({
    where: { projectId },
    select: ['engineId', 'createdAt', 'autoApproved']
  });
  const targetRows = await projectEngineTargetRepo.find({
    where: { projectId, status: 'active' },
    select: [
      'id',
      'engineId',
      'status',
      'source',
      'sourceRef',
      'allowManualDeploy',
      'allowCiDeploy',
      'allowApiDeploy',
      'allowImport',
      'lastSeenAt',
      'createdAt',
      'updatedAt',
    ]
  });
  const targetByEngineId = new Map<string, Pick<ProjectEngineTarget,
    'id' |
    'engineId' |
    'status' |
    'source' |
    'sourceRef' |
    'allowManualDeploy' |
    'allowCiDeploy' |
    'allowApiDeploy' |
    'allowImport' |
    'lastSeenAt' |
    'createdAt' |
    'updatedAt'
  >>();
  for (const row of targetRows) {
    targetByEngineId.set(row.engineId, row);
  }
  const accessByEngineId = new Map<string, { engineId: string; createdAt: number; autoApproved?: boolean; allowManualDeploy?: boolean }>();
  for (const row of accessRows) {
    accessByEngineId.set(row.engineId, row);
  }
  for (const row of targetRows) {
    if (!accessByEngineId.has(row.engineId)) {
      accessByEngineId.set(row.engineId, {
        engineId: row.engineId,
        createdAt: Number(row.createdAt),
        allowManualDeploy: row.allowManualDeploy,
      });
    }
  }
  const connectedRows = Array.from(accessByEngineId.values());

  // Get engine details for accessed engines
  const engineIds = connectedRows
    .map((r) => r.engineId)
    .filter((id: string) => id !== '__env__');
  const accessedEngines: ProjectEngineAccessedEngine[] = [];
  
  // Handle special __env__ engine (legacy environment-based engine)
  const envEngineAccess = connectedRows.find((r) => r.engineId === '__env__');
  if (envEngineAccess) {
    // Get env engine health from environment variable
    const envBaseUrl = process.env.CAMUNDA_BASE_URL || process.env.ENGINE_BASE_URL;
    accessedEngines.push({
      engineId: '__env__',
      engineName: 'Environment Engine (Legacy)',
      baseUrl: envBaseUrl || '(not configured)',
      environment: null,
      health: null, // Will be fetched client-side if needed
      grantedAt: envEngineAccess.createdAt,
      isLegacy: true,
    });
  }
  
  if (engineIds.length > 0) {
    const includeDeploymentDiagnostics = await canViewDeploymentDiagnostics(req);
    const engineRows = await engineRepo.find({
      where: { id: In(engineIds) },
      select: ['id', 'name', 'baseUrl', 'environmentTagId', 'deploymentIntegration']
    });
    
    // Get environment tags for all engines
    const envTagIds = engineRows
      .map((e: Pick<Engine, 'environmentTagId'>) => e.environmentTagId)
      .filter(Boolean) as string[];
    let envTagMap = new Map<string, { name: string; color: string; manualDeployAllowed: boolean }>();
    if (envTagIds.length > 0) {
      const envTags = await envTagRepo.find({
        where: { id: In(envTagIds) },
        select: ['id', 'name', 'color', 'manualDeployAllowed']
      });
      for (const t of envTags) {
        envTagMap.set(t.id, { name: t.name, color: t.color, manualDeployAllowed: t.manualDeployAllowed });
      }
    }
    
    // Get latest health status for all engines
    const healthRows = await engineHealthRepo.find({
      where: { engineId: In(engineIds) },
      order: { checkedAt: 'DESC' },
      select: ['engineId', 'status', 'latencyMs', 'checkedAt']
    });
    
    // Build map of latest health per engine
    const healthMap = new Map<string, { status: string; latencyMs: number | null; checkedAt: number }>();
    for (const h of healthRows) {
      if (!healthMap.has(h.engineId)) {
        healthMap.set(h.engineId, { status: h.status, latencyMs: h.latencyMs, checkedAt: h.checkedAt });
      }
    }
    
    for (const a of connectedRows.filter((r) => r.engineId !== '__env__')) {
      const engine = engineRows.find((e: Pick<Engine, 'id' | 'name' | 'baseUrl' | 'environmentTagId'>) => e.id === a.engineId);
      const envTag = engine?.environmentTagId ? envTagMap.get(engine.environmentTagId) : null;
      const health = healthMap.get(a.engineId) || null;
      const target = targetByEngineId.get(a.engineId) || null;
      const deploymentEligibility = await deploymentEligibilityService.evaluateModes({
        userId,
        tenantId,
        projectId,
        engineId: a.engineId,
        modes: ['manual', 'ci'],
      });
      const manualEligibility = deploymentEligibility.manual!;
      const ciEligibility = deploymentEligibility.ci!;
      accessedEngines.push({
        engineId: a.engineId,
        engineName: engine?.name || 'Unnamed Engine',
        baseUrl: engine?.baseUrl || '',
        deploymentIntegration: engine?.deploymentIntegration === 'direct_engine' ? 'direct_engine' : 'enterpriseglue_proxy',
        environment: envTag ? { name: envTag.name, color: envTag.color } : null,
        deploymentTarget: target ? {
          id: target.id,
          status: target.status,
          source: target.source,
          sourceRef: target.sourceRef,
          allowManualDeploy: Boolean(target.allowManualDeploy),
          allowCiDeploy: Boolean(target.allowCiDeploy),
          allowApiDeploy: Boolean(target.allowApiDeploy),
          allowImport: Boolean(target.allowImport),
          lastSeenAt: target.lastSeenAt === null ? null : Number(target.lastSeenAt),
          createdAt: Number(target.createdAt),
          updatedAt: Number(target.updatedAt),
        } : undefined,
        manualDeployAllowed: manualEligibility.allowed,
        manualDeployDeniedReasons: manualEligibility.allowed ? undefined : manualEligibility.reasons,
        ciDeployAllowed: ciEligibility.allowed,
        ciDeployDeniedReasons: ciEligibility.allowed ? undefined : ciEligibility.reasons,
        deploymentEligibility: {
          diagnosticsVisible: includeDeploymentDiagnostics,
          manual: deploymentEligibilityView(manualEligibility, includeDeploymentDiagnostics),
          ci: deploymentEligibilityView(ciEligibility, includeDeploymentDiagnostics),
        },
        health: health ? { status: health.status, latencyMs: health.latencyMs } : null,
        grantedAt: a.createdAt,
      });
    }
  }

  // Get pending access requests for this project
  const pendingRequests = await engineAccessRequestRepo.find({
    where: { projectId, status: 'pending' },
    select: ['id', 'engineId', 'createdAt']
  });

  // Get engine details for pending requests
  const pendingEngineIds = pendingRequests.map((r: Pick<EngineAccessRequest, 'engineId'>) => r.engineId);
  let pendingWithDetails: ProjectEngineAccessPendingRequest[] = [];
  if (pendingEngineIds.length > 0) {
    const pendingEngineRows = await engineRepo.find({
      where: { id: In(pendingEngineIds) },
      select: ['id', 'name', 'baseUrl']
    });
    
    pendingWithDetails = pendingRequests.map((r: Pick<EngineAccessRequest, 'id' | 'engineId' | 'createdAt'>) => {
      const engine = pendingEngineRows.find((e: Pick<Engine, 'id' | 'name' | 'baseUrl'>) => e.id === r.engineId);
      return {
        requestId: r.id,
        engineId: r.engineId,
        engineName: engine?.name || engine?.baseUrl || 'Unknown',
        requestedAt: r.createdAt,
      };
    });
  }

  // Get all available engines (for requesting access)
  const allEngines = await engineRepo.find({
    select: ['id', 'name', 'baseUrl']
  });

  // Filter out engines that are already accessed or have pending requests
  const usedEngineIds = new Set([...engineIds, ...pendingEngineIds]);
  const availableEngines = allEngines
    .filter((e: Pick<Engine, 'id'>) => !usedEngineIds.has(e.id))
    .map((e: Pick<Engine, 'id' | 'name' | 'baseUrl'>) => ({ id: e.id, name: e.name || e.baseUrl || 'Unknown' }));

  res.json(ProjectEngineAccessResponseSchema.parse({
    accessedEngines,
    pendingRequests: pendingWithDetails,
    availableEngines,
  }));
}));

export default r;

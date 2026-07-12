import { Router, Request, Response } from 'express';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { z } from 'zod';
import { GitService } from '@enterpriseglue/shared/services/git/GitService.js';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { requireAction } from '@enterpriseglue/shared/middleware/requireAction.js';
import { validateBody } from '@enterpriseglue/shared/middleware/validate.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { GitRepository } from '@enterpriseglue/shared/infrastructure/persistence/entities/GitRepository.js';
import { Project } from '@enterpriseglue/shared/infrastructure/persistence/entities/Project.js';
import { ProjectPermissions, permissionService, type Permission } from '@enterpriseglue/shared/services/platform-admin/permissions.js';

// Validation schemas
const initRepoBodySchema = z.object({
  projectId: z.string().uuid(),
  providerId: z.string().uuid(),
  remoteUrl: z.string().url(),
  namespace: z.string().optional(),
});

const router = Router();
const gitService = new GitService();

async function hasProjectPermission(req: Request, projectId: string, permission: Permission): Promise<boolean> {
  return permissionService.hasPermission(permission, {
    userId: req.user!.userId,
    platformRole: req.user!.platformRole || (req.user as any).role,
    resourceType: 'project',
    resourceId: projectId,
  });
}

async function canViewProjectRepository(req: Request, projectId: string): Promise<boolean> {
  return hasProjectPermission(req, projectId, ProjectPermissions.FILES_VIEW);
}

/**
 * POST /git-api/repositories/init
 * Initialize a new Git repository for a project
 */
router.post('/git-api/repositories/init', apiLimiter, requireAuth, validateBody(initRepoBodySchema), requireAction('project.git.repositories.manage', { resourceIdFrom: 'body' }), asyncHandler(async (req: Request, res: Response) => {
  const { projectId, providerId, remoteUrl, namespace } = req.body;
  const userId = req.user!.userId;

  const repo = await gitService.initRepository(projectId, providerId, remoteUrl, userId, namespace);
  
  res.status(201).json(repo);
}));

/**
 * POST /git-api/repositories/clone
 * Clone an existing Git repository
 */
router.post('/git-api/repositories/clone', apiLimiter, requireAuth, validateBody(initRepoBodySchema), requireAction('project.git.repositories.manage', { resourceIdFrom: 'body' }), asyncHandler(async (req: Request, res: Response) => {
  const { projectId, providerId, remoteUrl, namespace } = req.body;
  const userId = req.user!.userId;

  const repo = await gitService.cloneRepository(projectId, providerId, remoteUrl, userId, namespace);
  
  res.status(201).json(repo);
}));

/**
 * GET /git-api/repositories
 * List all repositories for the current user's projects
 * ✨ Migrated to TypeORM
 */
router.get('/git-api/repositories', apiLimiter, requireAuth, requireAction('project.git.repositories.read', {
  resourceResolver: 'project.visibleCollection',
  collectionIdsFrom: 'query',
  collectionIdsKey: 'projectId',
}), asyncHandler(async (req: Request, res: Response) => {
  const { projectId } = req.query;
  const dataSource = await getDataSource();
  const gitRepoRepo = dataSource.getRepository(GitRepository);

  if (projectId && typeof projectId === 'string') {
    if (!(await canViewProjectRepository(req, projectId))) {
      throw Errors.notFound('Project');
    }
  }

  const qb = gitRepoRepo.createQueryBuilder('r')
    .innerJoin(Project, 'p', 'r.projectId = p.id')
    .select([
      'r.id AS id',
      'r.projectId AS "projectId"',
      'r.providerId AS "providerId"',
      'r.remoteUrl AS "remoteUrl"',
      'r.repositoryName AS "repositoryName"',
      'r.defaultBranch AS "defaultBranch"',
      'r.lastCommitSha AS "lastCommitSha"',
      'r.lastSyncAt AS "lastSyncAt"',
      'p.name AS "projectName"',
    ])
    .orderBy('r.createdAt', 'DESC');

  if (projectId && typeof projectId === 'string') {
    qb.where('r.projectId = :projectId', { projectId });
  }

  const rows = await qb.getRawMany();
  const repositories = [];
  for (const row of rows) {
    if (await canViewProjectRepository(req, String(row.projectId))) {
      repositories.push(row);
    }
  }

  res.json(repositories);
}));

/**
 * GET /git-api/repositories/:id
 * Get repository details
 * ✨ Migrated to TypeORM
 */
router.get('/git-api/repositories/:id', apiLimiter, requireAuth, requireAction('project.git.repositories.read', {
  resourceResolver: 'project.byGitRepositoryId',
  resourceIdFrom: 'params',
  resourceIdKey: 'id',
}), asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const dataSource = await getDataSource();
  const gitRepoRepo = dataSource.getRepository(GitRepository);

  const result = await gitRepoRepo.createQueryBuilder('r')
    .innerJoin(Project, 'p', 'r.projectId = p.id')
    .select([
      'r.id AS id',
      'r.projectId AS "projectId"',
      'r.providerId AS "providerId"',
      'r.remoteUrl AS "remoteUrl"',
      'r.repositoryName AS "repositoryName"',
      'r.defaultBranch AS "defaultBranch"',
      'r.lastCommitSha AS "lastCommitSha"',
      'r.lastSyncAt AS "lastSyncAt"',
      'r.createdAt AS "createdAt"',
      'r.updatedAt AS "updatedAt"',
      'p.name AS "project_name"',
    ])
    .where('r.id = :id', { id })
    .getRawOne();
  
  if (!result || !(await canViewProjectRepository(req, String(result.projectId)))) {
    throw Errors.notFound('Repository');
  }

  res.json(result);
}));

/**
 * DELETE /git-api/repositories/:id
 * Delete a repository (removes from database, keeps remote)
 */
router.delete('/git-api/repositories/:id', apiLimiter, requireAuth, requireAction('project.git.repositories.manage', {
  resourceResolver: 'project.byGitRepositoryId',
  resourceIdFrom: 'params',
  resourceIdKey: 'id',
}), asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const dataSource = await getDataSource();
  const gitRepoRepo = dataSource.getRepository(GitRepository);

  // Delete repository record
  await gitRepoRepo.delete({ id });

  res.status(204).send();
}));

export default router;

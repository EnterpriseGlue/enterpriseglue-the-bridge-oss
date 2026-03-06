import { Router, Request, Response } from 'express';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { z } from 'zod';
import { GitService } from '@enterpriseglue/shared/services/git/GitService.js';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { requireProjectRole } from '@enterpriseglue/shared/middleware/projectAuth.js';
import { validateBody } from '@enterpriseglue/shared/middleware/validate.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { GitRepository } from '@enterpriseglue/shared/db/entities/GitRepository.js';
import { Project } from '@enterpriseglue/shared/db/entities/Project.js';
import { ProjectMember } from '@enterpriseglue/shared/db/entities/ProjectMember.js';
import { projectMemberService } from '@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js';
import { EDIT_ROLES } from '@enterpriseglue/shared/constants/roles.js';

// Validation schemas
const initRepoBodySchema = z.object({
  projectId: z.string().uuid(),
  providerId: z.string().uuid(),
  remoteUrl: z.string().url(),
  namespace: z.string().optional(),
});

const router = Router();
const gitService = new GitService();

/**
 * POST /git-api/repositories/init
 * Initialize a new Git repository for a project
 */
router.post('/git-api/repositories/init', apiLimiter, requireAuth, validateBody(initRepoBodySchema), requireProjectRole(EDIT_ROLES, { projectIdFrom: 'body', errorStatus: 403, errorMessage: 'Forbidden: Cannot manage Git for this project' }), asyncHandler(async (req: Request, res: Response) => {
  const { projectId, providerId, remoteUrl, namespace } = req.body;
  const userId = req.user!.userId;

  const repo = await gitService.initRepository(projectId, providerId, remoteUrl, userId, namespace);
  
  res.status(201).json(repo);
}));

/**
 * POST /git-api/repositories/clone
 * Clone an existing Git repository
 */
router.post('/git-api/repositories/clone', apiLimiter, requireAuth, validateBody(initRepoBodySchema), requireProjectRole(EDIT_ROLES, { projectIdFrom: 'body', errorStatus: 403, errorMessage: 'Forbidden: Cannot manage Git for this project' }), asyncHandler(async (req: Request, res: Response) => {
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
router.get('/git-api/repositories', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { projectId } = req.query;
  const dataSource = await getDataSource();
  const gitRepoRepo = dataSource.getRepository(GitRepository);

  if (projectId && typeof projectId === 'string') {
    const hasAccess = await projectMemberService.hasAccess(projectId, userId);
    if (!hasAccess) {
      throw Errors.notFound('Project');
    }
  }

  const qb = gitRepoRepo.createQueryBuilder('r')
    .innerJoin(Project, 'p', 'r.projectId = p.id')
    .leftJoin(ProjectMember, 'pm', 'pm.projectId = p.id AND pm.userId = :userId', { userId })
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
    .where('(p.ownerId = :userId OR pm.userId = :userId)', { userId })
    .orderBy('r.createdAt', 'DESC');

  if (projectId && typeof projectId === 'string') {
    qb.andWhere('r.projectId = :projectId', { projectId });
  }

  const repositories = await qb.getRawMany();

  res.json(repositories);
}));

/**
 * GET /git-api/repositories/:id
 * Get repository details
 * ✨ Migrated to TypeORM
 */
router.get('/git-api/repositories/:id', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = req.user!.userId;
  const dataSource = await getDataSource();
  const gitRepoRepo = dataSource.getRepository(GitRepository);

  const result = await gitRepoRepo.createQueryBuilder('r')
    .innerJoin(Project, 'p', 'r.projectId = p.id')
    .leftJoin(ProjectMember, 'pm', 'pm.projectId = p.id AND pm.userId = :userId', { userId })
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
    .andWhere('(p.ownerId = :userId OR pm.userId = :userId)', { userId })
    .getRawOne();
  
  if (!result) {
    throw Errors.notFound('Repository');
  }

  res.json(result);
}));

/**
 * DELETE /git-api/repositories/:id
 * Delete a repository (removes from database, keeps remote)
 */
router.delete('/git-api/repositories/:id', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const userId = req.user!.userId;
  const dataSource = await getDataSource();
  const gitRepoRepo = dataSource.getRepository(GitRepository);

  const repoRow = await gitRepoRepo.createQueryBuilder('r')
    .innerJoin(Project, 'p', 'r.projectId = p.id')
    .leftJoin(ProjectMember, 'pm', 'pm.projectId = p.id AND pm.userId = :userId', { userId })
    .select(['r.projectId AS "projectId"'])
    .where('r.id = :id', { id })
    .andWhere('(p.ownerId = :userId OR pm.userId = :userId)', { userId })
    .getRawOne();

  if (!repoRow) {
    throw Errors.notFound('Repository');
  }

  const canManageGit = await projectMemberService.hasRole(
    repoRow.projectId,
    userId,
    EDIT_ROLES
  );
  if (!canManageGit) {
    throw Errors.forbidden('Cannot manage Git for this project');
  }

  // Delete repository record
  await gitRepoRepo.delete({ id });

  res.status(204).send();
}));

export default router;

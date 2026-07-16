import { Router, Request, Response } from 'express';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { GitService } from '@enterpriseglue/shared/services/git/GitService.js';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { validateBody } from '@enterpriseglue/shared/middleware/validate.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { requireAction, requireCompositeAction } from '@enterpriseglue/shared/middleware/requireAction.js';
import { DeployRequestSchema, RollbackRequestSchema } from '@enterpriseglue/shared/schemas/git/index.js';
import { ProjectPermissions, permissionService, type Permission } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { GitDeployment } from '@enterpriseglue/shared/infrastructure/persistence/entities/GitDeployment.js';
import { EnvironmentTag } from '@enterpriseglue/shared/infrastructure/persistence/entities/EnvironmentTag.js';

const router = Router();
const gitService = new GitService();

async function hasProjectPermission(req: Request, projectId: string, permission: Permission): Promise<boolean> {
  return permissionService.hasPermission(permission, {
    userId: req.user!.userId,
    tenantId: req.tenant?.tenantId || null,
    resourceType: 'project',
    resourceId: projectId,
  });
}

async function canViewProjectDeployments(req: Request, projectId: string): Promise<boolean> {
  return hasProjectPermission(req, projectId, ProjectPermissions.FILES_VIEW);
}

/**
 * POST /git-api/deploy
 * Deploy a project (commit + push + tag)
 */
router.post('/git-api/deploy', apiLimiter, requireAuth, validateBody(DeployRequestSchema), requireAction('project.deploy.create', { resourceIdFrom: 'body' }), requireCompositeAction('project.deploy.create', {
  kind: 'deployment',
  mode: 'ci',
  projectIdFrom: 'body',
  engineIdFrom: 'body',
  optionalWhenMissingEngineId: true,
  legacyAutoGrant: false,
  attachDeployContext: false,
  hideUnauthorizedEngine: false,
}), asyncHandler(async (req: Request, res: Response) => {
  const validated = req.body;
  const userId = req.user!.userId;
  const engineId = typeof validated.engineId === 'string' ? validated.engineId.trim() : '';

  if (!engineId && validated.environment) {
    // Legacy callers without an engine target still use the environment's manual policy.
    const dataSource = await getDataSource();
    const envTagRepo = dataSource.getRepository(EnvironmentTag);
    // Try to find by ID first, then by name (case-insensitive)
    let envTag = await envTagRepo.findOneBy({ id: validated.environment });
    if (!envTag) {
      const allTags = await envTagRepo.find();
      envTag = allTags.find(t => t.name.toLowerCase() === validated.environment.toLowerCase()) || null;
    }
    if (envTag && !envTag.manualDeployAllowed) {
      return res.status(403).json({
        error: 'Manual deployment not allowed for this environment',
        environment: envTag.name,
        hint: 'Use CI/CD pipeline for this environment',
      });
    }
  }

  try {
    const result = await gitService.deployProject({
      projectId: validated.projectId,
      message: validated.message,
      userId,
      environment: validated.environment,
      createTag: validated.createTag,
      tagName: validated.tagName,
    });

    res.status(201).json(result);
  } catch (e: any) {
    const msg = String(e?.message || '')

    if (msg.includes('Project is not connected to Git')) {
      return res.status(400).json({
        error: 'Project is not connected to Git',
        hint: 'Open the project → (⋯) → Git Settings to connect a repository and provide a service token.',
      })
    }

    if (msg.includes('No Git credentials found')) {
      return res.status(403).json({
        error: 'No Git credentials found for this provider',
        hint: 'Ask a project admin to update the service token in Project → (⋯) → Git Settings.',
      })
    }

    if (msg.includes('No files to push')) {
      return res.status(400).json({
        error: 'No files to push',
        hint: 'Add at least one BPMN or DMN file to the project before pushing to Git',
      })
    }

    if (msg.includes('not accessible by personal access token') || msg.includes('Resource not accessible')) {
      return res.status(403).json({
        error: 'The service token does not have sufficient permissions to push to this repository',
        hint: 'Update the token in Project → (⋯) → Git Settings. For fine-grained tokens enable "Contents: Read and write", for classic tokens enable the "repo" scope.',
      })
    }

    if (msg.includes('Bad credentials') || msg.includes('401') || msg.includes('Unauthorized')) {
      return res.status(401).json({
        error: 'Git authentication failed — the service token may be expired or revoked',
        hint: 'Ask a project admin to generate a new token and update it in Project → (⋯) → Git Settings.',
      })
    }

    if (msg.includes('rate limit') || msg.includes('API rate limit')) {
      return res.status(429).json({
        error: 'Git provider API rate limit exceeded',
        hint: 'Wait a few minutes and try again, or use a token with higher rate limits.',
      })
    }

    if (msg.includes('Not Found') && (msg.includes('repository') || msg.includes('404'))) {
      return res.status(404).json({
        error: 'The linked Git repository was not found — it may have been deleted or renamed',
        hint: 'Check that the repository still exists on your Git provider, then reconnect if needed.',
      })
    }

    if (msg.includes('fetch') || msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT') || msg.includes('network')) {
      return res.status(502).json({
        error: 'Could not reach the Git provider — network or service issue',
        hint: 'Check your internet connection and that the Git provider is available, then try again.',
      })
    }

    // Fallback: return the message without stack traces
    return res.status(500).json({
      error: msg || 'Deployment failed due to an unexpected error',
      hint: 'Check your Git connection settings and token permissions, then try again.',
    })
  }
}));

/**
 * Shared helper for listing deployments
 */
async function listDeployments(projectId: string, limit: number) {
  const dataSource = await getDataSource();
  const deploymentRepo = dataSource.getRepository(GitDeployment);
  return deploymentRepo.find({
    where: { projectId },
    order: { deployedAt: 'DESC' },
    take: limit,
  });
}

/**
 * GET /git-api/deployments
 * List deployments for a project (query param style)
 */
router.get('/git-api/deployments', apiLimiter, requireAuth, requireAction('project.deployments.read', { resourceIdFrom: 'query' }), asyncHandler(async (req: Request, res: Response) => {
  const projectId = req.query.projectId as string;
  const limit = parseInt(req.query.limit as string) || 50;

  if (!projectId) {
    throw Errors.validation('projectId query parameter is required');
  }

  if (!(await canViewProjectDeployments(req, projectId))) {
    throw Errors.projectNotFound();
  }

  res.json(await listDeployments(projectId, limit));
}));

/**
 * GET /git-api/projects/:projectId/deployments
 * List deployments for a project (REST style)
 */
router.get('/git-api/projects/:projectId/deployments', apiLimiter, requireAuth, requireAction('project.deployments.read', { resourceIdFrom: 'params' }), asyncHandler(async (req: Request, res: Response) => {
  const projectId = String(req.params.projectId);
  const limit = parseInt(req.query.limit as string) || 50;

  if (!(await canViewProjectDeployments(req, projectId))) {
    throw Errors.projectNotFound();
  }

  res.json(await listDeployments(projectId, limit));
}));

/**
 * GET /git-api/deployments/:id
 * Get deployment details
 */
router.get('/git-api/deployments/:id', apiLimiter, requireAuth, requireAction('project.deployments.read', {
  resourceResolver: 'project.byGitDeploymentId',
  resourceIdFrom: 'params',
  resourceIdKey: 'id',
}), asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);

  const dataSource = await getDataSource();
  const deploymentRepo = dataSource.getRepository(GitDeployment);
  const deployment = await deploymentRepo.findOneBy({ id });

  if (!deployment) {
    throw Errors.notFound('Deployment');
  }

  if (!(await canViewProjectDeployments(req, String(deployment.projectId)))) {
    throw Errors.notFound('Deployment');
  }

  res.json(deployment);
}));

/**
 * POST /git-api/rollback
 * Rollback project to a specific commit
 */
router.post('/git-api/rollback', apiLimiter, requireAuth, validateBody(RollbackRequestSchema), requireAction('project.git.rollback', { resourceIdFrom: 'body' }), asyncHandler(async (req: Request, res: Response) => {
  const validated = req.body;
  const userId = req.user!.userId;

  await gitService.rollbackToCommit(validated.projectId, validated.commitSha, userId);

  res.json({
    success: true,
    message: `Rolled back to commit ${validated.commitSha}`,
  });
}));

/**
 * GET /git-api/commits
 * Get commit history for a project
 */
router.get('/git-api/commits', apiLimiter, requireAuth, requireAction('project.deployments.read', { resourceIdFrom: 'query' }), asyncHandler(async (req: Request, res: Response) => {
  const projectId = req.query.projectId as string;
  const limit = parseInt(req.query.limit as string) || 100;

  if (!projectId) {
    throw Errors.validation('projectId query parameter is required');
  }

  if (!(await canViewProjectDeployments(req, projectId))) {
    throw Errors.projectNotFound();
  }

  const commits = await gitService.getCommitHistory(projectId, req.user!.userId, limit);
  res.json(commits);
}));

export default router;

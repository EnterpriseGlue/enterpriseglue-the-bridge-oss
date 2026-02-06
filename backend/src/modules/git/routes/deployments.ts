import { Router, Request, Response } from 'express';
import { apiLimiter } from '@shared/middleware/rateLimiter.js';
import { GitService } from '@shared/services/git/GitService.js';
import { asyncHandler, Errors } from '@shared/middleware/errorHandler.js';
import { validateBody } from '@shared/middleware/validate.js';
import { requireAuth } from '@shared/middleware/auth.js';
import { requireProjectRole } from '@shared/middleware/projectAuth.js';
import { DeployRequestSchema, RollbackRequestSchema } from '@shared/schemas/git/index.js';
import { projectMemberService } from '@shared/services/platform-admin/ProjectMemberService.js';
import { getDataSource } from '@shared/db/data-source.js';
import { GitDeployment } from '@shared/db/entities/GitDeployment.js';
import { EnvironmentTag } from '@shared/db/entities/EnvironmentTag.js';
import { PlatformSettings } from '@shared/db/entities/PlatformSettings.js';
import { DEPLOY_ROLES, EDIT_ROLES } from '@shared/constants/roles.js';

const router = Router();
const gitService = new GitService();

/**
 * POST /git-api/deploy
 * Deploy a project (commit + push + tag)
 */
router.post('/git-api/deploy', apiLimiter, requireAuth, validateBody(DeployRequestSchema), requireProjectRole(DEPLOY_ROLES, { projectIdFrom: 'body' }), asyncHandler(async (req: Request, res: Response) => {
  const validated = req.body;
  const userId = req.user!.userId;

  // Check manualDeployAllowed if an environment is specified
  if (validated.environment) {
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
        hint: 'Connect Git from Starbase → Project Overview (⋯) → Connect to Git',
      })
    }

    if (msg.includes('No Git credentials found')) {
      return res.status(403).json({
        error: 'No Git credentials found for this provider',
        hint: 'Go to your Git connections and re-save your access token. The stored token may have been encrypted with a different key.',
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
        error: 'Your personal access token does not have sufficient permissions to push to this repository',
        hint: 'Update your token permissions: for fine-grained tokens enable "Contents: Read and write", for classic tokens enable the "repo" scope. Then update the token in Settings → Git Connections.',
      })
    }

    if (msg.includes('Bad credentials') || msg.includes('401') || msg.includes('Unauthorized')) {
      return res.status(401).json({
        error: 'Git authentication failed — your access token may be expired or revoked',
        hint: 'Generate a new token from your Git provider and update it in Settings → Git Connections.',
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
router.get('/git-api/deployments', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const projectId = req.query.projectId as string;
  const limit = parseInt(req.query.limit as string) || 50;

  if (!projectId) {
    throw Errors.validation('projectId query parameter is required');
  }

  const canRead = await projectMemberService.hasAccess(projectId, req.user!.userId);
  if (!canRead) {
    throw Errors.projectNotFound();
  }

  res.json(await listDeployments(projectId, limit));
}));

/**
 * GET /git-api/projects/:projectId/deployments
 * List deployments for a project (REST style)
 */
router.get('/git-api/projects/:projectId/deployments', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const limit = parseInt(req.query.limit as string) || 50;

  const canRead = await projectMemberService.hasAccess(projectId, req.user!.userId);
  if (!canRead) {
    throw Errors.projectNotFound();
  }

  res.json(await listDeployments(projectId, limit));
}));

/**
 * GET /git-api/deployments/:id
 * Get deployment details
 */
router.get('/git-api/deployments/:id', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const dataSource = await getDataSource();
  const deploymentRepo = dataSource.getRepository(GitDeployment);
  const deployment = await deploymentRepo.findOneBy({ id });

  if (!deployment) {
    throw Errors.notFound('Deployment');
  }

  const canRead = await projectMemberService.hasAccess(String(deployment.projectId), req.user!.userId);
  if (!canRead) {
    throw Errors.notFound('Deployment');
  }

  res.json(deployment);
}));

/**
 * POST /git-api/rollback
 * Rollback project to a specific commit
 */
router.post('/git-api/rollback', apiLimiter, requireAuth, validateBody(RollbackRequestSchema), requireProjectRole(EDIT_ROLES, { projectIdFrom: 'body' }), asyncHandler(async (req: Request, res: Response) => {
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
router.get('/git-api/commits', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const projectId = req.query.projectId as string;
  const limit = parseInt(req.query.limit as string) || 100;

  if (!projectId) {
    throw Errors.validation('projectId query parameter is required');
  }

  const canRead = await projectMemberService.hasAccess(projectId, req.user!.userId);
  if (!canRead) {
    throw Errors.projectNotFound();
  }

  const commits = await gitService.getCommitHistory(projectId, req.user!.userId, limit);
  res.json(commits);
}));

export default router;

/**
 * Git Sync Routes
 * Handles push/pull operations with remote repositories
 */

import { Router, Request, Response } from 'express';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { requireAction } from '@enterpriseglue/shared/middleware/requireAction.js';
import { validateBody, validateQuery } from '@enterpriseglue/shared/middleware/validate.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { GitRepository } from '@enterpriseglue/shared/infrastructure/persistence/entities/GitRepository.js';
import { GitDeployment } from '@enterpriseglue/shared/infrastructure/persistence/entities/GitDeployment.js';
import { Project } from '@enterpriseglue/shared/infrastructure/persistence/entities/Project.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { credentialService } from '@enterpriseglue/shared/services/git/CredentialService.js';
import { GitService } from '@enterpriseglue/shared/services/git/GitService.js';
import { remoteGitService } from '@enterpriseglue/shared/services/git/RemoteGitService.js';
import { vcsService } from '@enterpriseglue/shared/services/versioning/index.js';
import { ProjectPermissions, permissionService, type Permission } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import {
  GitSyncRequestSchema,
  GitSyncResponseSchema,
  GitSyncStatusQuerySchema,
  GitSyncStatusResponseSchema,
  type GitSyncRequest,
} from '@enterpriseglue/shared/schemas/git/repository.js';

const router = Router();

async function hasProjectPermission(req: Request, projectId: string, permission: Permission): Promise<boolean> {
  return permissionService.hasPermission(permission, {
    userId: req.user!.userId,
    tenantId: req.tenant?.tenantId || null,
    resourceType: 'project',
    resourceId: projectId,
  });
}

async function canViewProjectRepository(req: Request, projectId: string): Promise<boolean> {
  return hasProjectPermission(req, projectId, ProjectPermissions.FILES_VIEW);
}

async function canUseGitSync(req: Request, projectId: string, direction: 'push' | 'pull' | 'both' | 'status'): Promise<boolean> {
  const needsPull = direction === 'pull' || direction === 'both' || direction === 'status';
  const needsPush = direction === 'push' || direction === 'both' || direction === 'status';
  const hasPull = !needsPull || await hasProjectPermission(req, projectId, ProjectPermissions.GIT_PULL);
  const hasPush = !needsPush || await hasProjectPermission(req, projectId, ProjectPermissions.GIT_PUSH);

  return direction === 'status'
    ? hasPull || hasPush
    : hasPull && hasPush;
}

/**
 * GET /git-api/sync/status
 * Get sync status for a project
 */
router.get('/git-api/sync/status', apiLimiter, requireAuth, validateQuery(GitSyncStatusQuerySchema), requireAction('project.git.sync.status', {
  resourceIdFrom: 'query',
  acceptedPermissions: [ProjectPermissions.GIT_PULL, ProjectPermissions.GIT_PUSH],
}), asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const projectId = req.query.projectId as string;

  if (!(await canUseGitSync(req, projectId, 'status'))) {
    throw Errors.notFound('Repository');
  }

  const dataSource = await getDataSource();
  const gitRepoRepo = dataSource.getRepository(GitRepository);

  // Get repository
  const repo = await gitRepoRepo.findOne({
    where: { projectId },
    order: { createdAt: 'DESC' },
  });

  if (!repo) {
    throw Errors.notFound('Repository');
  }

  // Get local VCS status - count commits since last sync timestamp
  let localCommitCount = 0;
  let hasLocalChanges = false;

  try {
    const draftBranch = await vcsService.getUserBranch(projectId, userId);
    if (draftBranch) {
      const commits = await vcsService.getCommits(draftBranch.id, 100);
      // Count commits created after last sync timestamp
      const lastSyncTime = repo.lastSyncAt ? Number(repo.lastSyncAt) : 0;
      localCommitCount = commits.filter(c => c.createdAt > lastSyncTime).length;
      hasLocalChanges = localCommitCount > 0;
    }
  } catch (error) {
    logger.warn('Failed to get VCS status', { projectId, error });
  }

  // TODO: Check remote for changes (would require API call)
  // For now, we'll just report local status
  const hasRemoteChanges = false;
  const remoteCommitCount = 0;

  res.json(GitSyncStatusResponseSchema.parse({
    hasLocalChanges,
    hasRemoteChanges,
    lastSyncAt: repo.lastSyncAt ? Number(repo.lastSyncAt) : null,
    localCommitCount,
    remoteCommitCount,
  }));
}));

/**
 * POST /git-api/sync
 * Sync project with remote repository
 */
router.post('/git-api/sync', apiLimiter, requireAuth, validateBody(GitSyncRequestSchema), requireAction('project.git.sync.run', {
  resourceIdFrom: 'body',
  acceptedPermissions: [ProjectPermissions.GIT_PULL, ProjectPermissions.GIT_PUSH],
}), asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { projectId, direction, message } = req.body as GitSyncRequest;
  const commitMessage = message.trim();

  if (!(await canUseGitSync(req, projectId, direction))) {
    throw Errors.notFound('Repository');
  }

  const dataSource = await getDataSource();
  const gitRepoRepo = dataSource.getRepository(GitRepository);
  const gitDeploymentRepo = dataSource.getRepository(GitDeployment);

  // Get repository
  const repo = await gitRepoRepo.findOne({
    where: { projectId },
    order: { createdAt: 'DESC' },
  });

  if (!repo) {
    throw Errors.notFound('Repository');
  }
  const providerId = repo.providerId;

  // Get access token (project-level first, legacy fallback)
  const accessToken = await GitService.getProjectAccessToken(repo, userId);

  if (!accessToken) {
    return res.status(401).json({ 
      error: 'No credentials available for this provider',
      code: 'NO_CREDENTIALS'
    });
  }

  const results: {
    pushed: boolean;
    pulled: boolean;
    filesChanged: number;
    commitSha?: string;
    error?: string;
    isFirstSync?: boolean;
  } = {
    pushed: false,
    pulled: false,
    filesChanged: 0,
  };

  try {
    // Parse repo name from URL
    const repoFullName = repo.namespace 
      ? `${repo.namespace}/${repo.repositoryName}`
      : repo.repositoryName;

    // Pull first if direction is 'pull' or 'both'
    if (direction === 'pull' || direction === 'both') {
      logger.info('Pulling from remote', { projectId, repo: repoFullName });
      
      const pullResult = await remoteGitService.pullFromRemote(
        projectId,
        userId,
        providerId,
        accessToken,
        {
          repo: repoFullName,
          branch: repo.defaultBranch,
          patterns: ['**/*.bpmn', '**/*.dmn'],
        }
      );

      results.pulled = pullResult.filesCount > 0;
      results.filesChanged += pullResult.filesCount;
      
      // Update last sync timestamp after pull (but keep existing lastCommitSha)
      await gitRepoRepo.update({ id: repo.id }, {
        lastSyncAt: Date.now(),
        updatedAt: Date.now(),
      });

      logger.info('Pull complete', { projectId, filesCount: pullResult.filesCount });
    }

    // Push if direction is 'push' or 'both'
    if (direction === 'push' || direction === 'both') {
      const pushStart = Date.now();

      // Pre-flight: verify write permission before expensive VCS work
      const preflightStart = Date.now();
      const preflightClient = await remoteGitService.getClient(providerId, accessToken);
      await preflightClient.testWriteAccess(repoFullName);
      logger.info('Sync push preflight passed', { projectId, ms: Date.now() - preflightStart });

      // Update lastValidatedAt — token is confirmed working
      await gitRepoRepo.update({ id: repo.id }, { lastValidatedAt: Date.now() });

      // Sync main DB files to VCS and create a commit
      // This ensures VCS snapshots match what we push to GitHub
      // Also ensures draft branch is updated so UI shows files as synced
      try {
        const publishStart = Date.now();

        const draftBranch = await vcsService.getUserBranch(projectId, userId);
        if (draftBranch) {
          // Always sync and commit to draft to ensure draft headCommitId is current
          // This is needed because UI checks uncommitted status against draft branch
          await vcsService.syncFromMainDb(projectId, userId, draftBranch.id);
          
          // Commit on draft so the draft headCommitId matches current files
          await vcsService.commit(draftBranch.id, userId, `Pushed to Git: ${commitMessage}`, { source: 'sync-push' });
          
          // Check if main needs updating
          const hasChangesVsMain = await vcsService.hasUncommittedChanges(projectId);
          if (hasChangesVsMain) {
            // Merge draft to main (creates snapshots from synced content)
            const mergeResult = await vcsService.mergeToMain(draftBranch.id, projectId, userId);
            logger.info('Auto-published before push', { projectId, filesChanged: mergeResult.filesChanged });
          }
          
          logger.info('Draft branch synced for push', { projectId });
        } else {
          // No user branch - create a direct commit on main to capture current state
          logger.info('No user branch, creating direct VCS commit', { projectId });
          await vcsService.commitCurrentState(projectId, userId, `Pushed to Git: ${commitMessage}`, 'sync-push');
        }

        logger.info('Auto-publish timing', { projectId, ms: Date.now() - publishStart });
      } catch (publishError) {
        // Log but don't fail - might have no draft changes
        logger.debug('VCS sync error', { projectId, error: publishError });
      }

      logger.info('Pushing to remote', { projectId, repo: repoFullName });
      
      const pushResult = await remoteGitService.pushToRemote(
        projectId,
        providerId,
        accessToken,
        {
          repo: repoFullName,
          branch: repo.defaultBranch,
          message: commitMessage,
          patterns: ['*.bpmn', '*.dmn'], // Only push BPMN and DMN files
        }
      );

      const didPush = (pushResult.pushedFilesCount + pushResult.deletionsCount) > 0;
      const commitSha = pushResult.commit?.sha || repo.lastCommitSha || '';

      results.pushed = didPush;
      results.commitSha = commitSha;
      results.isFirstSync = pushResult.isFirstSync;
      results.filesChanged += pushResult.pushedFilesCount + pushResult.deletionsCount;
      
      // Update last sync info
      await gitRepoRepo.update({ id: repo.id }, {
        lastCommitSha: didPush ? commitSha : repo.lastCommitSha,
        lastSyncAt: Date.now(),
        updatedAt: Date.now(),
      });

      // Update VCS sync state so getSyncStatus shows 0 (in sync)
      if (didPush) {
        const mainBranch = await vcsService.getMainBranch(projectId);
        if (mainBranch?.headCommitId) {
          await vcsService.updateLastPushCommit(projectId, mainBranch.headCommitId);
        }
      }

      if (didPush) {
        try {
          await gitDeploymentRepo.insert({
            id: generateId(),
            projectId,
            repositoryId: repo.id,
            commitSha,
            commitMessage: commitMessage,
            tag: null,
            deployedBy: userId,
            deployedAt: Date.now(),
            environment: 'sync',
            status: 'success',
            errorMessage: null,
            filesChanged: pushResult.pushedFilesCount + pushResult.deletionsCount,
            metadata: JSON.stringify({
              source: 'sync',
              providerId,
              repo: repoFullName,
              branch: repo.defaultBranch,
              pushedFilesCount: pushResult.pushedFilesCount,
              deletionsCount: pushResult.deletionsCount,
              skippedFilesCount: pushResult.skippedFilesCount,
              totalFilesCount: pushResult.totalFilesCount,
              usedRemoteTree: pushResult.usedRemoteTree,
            }),
          } as any);
        } catch (e) {
          logger.warn('Failed to record git deployment for sync push', { projectId, error: e });
        }
      }

      logger.info('Sync push timing', { projectId, ms: Date.now() - pushStart, didPush });

      logger.info('Push complete', { projectId, commitSha, didPush });
    }

    res.json(GitSyncResponseSchema.parse({
      success: true,
      ...results,
    }));

  } catch (error: any) {
    logger.error('Sync failed', { projectId, direction, error });
    
    const msg = String(error?.message || '');

    if (msg.includes('not accessible by personal access token') || msg.includes('Resource not accessible')) {
      return res.status(403).json({
        error: 'Your personal access token does not have sufficient permissions',
        hint: 'Update your token permissions: for fine-grained tokens enable "Contents: Read and write", for classic tokens enable the "repo" scope. Then update the token in Settings → Git Connections.',
      });
    }

    if (msg.includes('Bad credentials') || msg.includes('Unauthorized')) {
      return res.status(401).json({
        error: 'Git authentication failed — your access token may be expired or revoked',
        hint: 'Generate a new token from your Git provider and update it in Settings → Git Connections.',
      });
    }

    if (msg.includes('rate limit') || msg.includes('API rate limit')) {
      return res.status(429).json({
        error: 'Git provider API rate limit exceeded',
        hint: 'Wait a few minutes and try again.',
      });
    }

    if (msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT') || msg.includes('network')) {
      return res.status(502).json({
        error: 'Could not reach the Git provider — network or service issue',
        hint: 'Check your internet connection and try again.',
      });
    }

    return res.status(500).json({
      error: msg || 'Sync failed due to an unexpected error',
      hint: 'Check your Git connection settings and token permissions, then try again.',
    });
  }
}));

/**
 * GET /git-api/repositories
 * List repositories for user's projects
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
      throw Errors.validation('Project not found');
    }
  }

  const qb = gitRepoRepo.createQueryBuilder('r')
    .innerJoin(Project, 'p', 'r.projectId = p.id')
    .select([
      'r.id AS id',
      'r.projectId AS "projectId"',
      'r.providerId AS "providerId"',
      'r.remoteUrl AS "remoteUrl"',
      'r.namespace AS namespace',
      'r.repositoryName AS "repositoryName"',
      'r.defaultBranch AS "defaultBranch"',
      'r.lastCommitSha AS "lastCommitSha"',
      'r.lastSyncAt AS "lastSyncAt"',
    ])

  if (projectId && typeof projectId === 'string') {
    qb.where('r.projectId = :projectId', { projectId });
  }

  const rows = await qb.getRawMany();
  const repos = [];
  for (const row of rows) {
    if (await canViewProjectRepository(req, String(row.projectId))) {
      repos.push(row);
    }
  }

  res.json(repos);
}));

export default router;

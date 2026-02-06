/**
 * Git Sync Routes
 * Handles push/pull operations with remote repositories
 */

import { Router, Request, Response } from 'express';
import { apiLimiter } from '@shared/middleware/rateLimiter.js';
import { z } from 'zod';
import { asyncHandler, Errors } from '@shared/middleware/errorHandler.js';
import { requireAuth } from '@shared/middleware/auth.js';
import { requireProjectRole } from '@shared/middleware/projectAuth.js';
import { validateBody, validateQuery } from '@shared/middleware/validate.js';
import { getDataSource } from '@shared/db/data-source.js';
import { GitRepository } from '@shared/db/entities/GitRepository.js';
import { GitDeployment } from '@shared/db/entities/GitDeployment.js';
import { Project } from '@shared/db/entities/Project.js';
import { ProjectMember } from '@shared/db/entities/ProjectMember.js';
import { logger } from '@shared/utils/logger.js';
import { generateId } from '@shared/utils/id.js';
import { credentialService } from '@shared/services/git/CredentialService.js';
import { remoteGitService } from '@shared/services/git/RemoteGitService.js';
import { vcsService } from '@shared/services/versioning/index.js';
import { projectMemberService } from '@shared/services/platform-admin/ProjectMemberService.js';
import { platformSettingsService } from '@shared/services/platform-admin/PlatformSettingsService.js';
import { EDIT_ROLES } from '@shared/constants/roles.js';

// Validation schemas
const syncStatusQuerySchema = z.object({
  projectId: z.string().uuid(),
});

const syncBodySchema = z.object({
  projectId: z.string().uuid(),
  direction: z.enum(['push', 'pull', 'both']).default('push'),
  message: z.string().min(1).max(500),
});

const router = Router();

/**
 * GET /git-api/sync/status
 * Get sync status for a project
 */
router.get('/git-api/sync/status', apiLimiter, requireAuth, validateQuery(syncStatusQuerySchema), requireProjectRole(EDIT_ROLES, { projectIdFrom: 'query' }), asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const projectId = req.query.projectId as string;

  const dataSource = await getDataSource();
  const gitRepoRepo = dataSource.getRepository(GitRepository);

  // Get repository
  const repo = await gitRepoRepo.createQueryBuilder('r')
    .innerJoin(Project, 'p', 'r.projectId = p.id')
    .leftJoin(ProjectMember, 'pm', 'pm.projectId = p.id AND pm.userId = :userId', { userId })
    .where('r.projectId = :projectId', { projectId })
    .andWhere('(p.ownerId = :userId OR pm.userId = :userId)', { userId })
    .getOne();

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

  res.json({
    hasLocalChanges,
    hasRemoteChanges,
    lastSyncAt: repo.lastSyncAt ? Number(repo.lastSyncAt) : null,
    localCommitCount,
    remoteCommitCount,
  });
}));

/**
 * POST /git-api/sync
 * Sync project with remote repository
 */
router.post('/git-api/sync', apiLimiter, requireAuth, validateBody(syncBodySchema), requireProjectRole(EDIT_ROLES, { projectIdFrom: 'body' }), asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { projectId, direction, message } = req.body;
  const commitMessage = message.trim();

  const dataSource = await getDataSource();
  const gitRepoRepo = dataSource.getRepository(GitRepository);
  const gitDeploymentRepo = dataSource.getRepository(GitDeployment);

  // Get repository
  const repo = await gitRepoRepo.createQueryBuilder('r')
    .innerJoin(Project, 'p', 'r.projectId = p.id')
    .leftJoin(ProjectMember, 'pm', 'pm.projectId = p.id AND pm.userId = :userId', { userId })
    .where('r.projectId = :projectId', { projectId })
    .andWhere('(p.ownerId = :userId OR pm.userId = :userId)', { userId })
    .getOne();

  if (!repo) {
    throw Errors.notFound('Repository');
  }
  const providerId = repo.providerId;

  // Get access token
  const platformSettings = await platformSettingsService.get();
  let accessToken = await credentialService.getAccessToken(userId, providerId);

  if (!accessToken && platformSettings.gitProjectTokenSharingEnabled && repo.connectedByUserId) {
    const connectedByUserId = String(repo.connectedByUserId);
    if (connectedByUserId && connectedByUserId !== userId) {
      accessToken = await credentialService.getAccessToken(connectedByUserId, providerId);
    }
  }

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
          await vcsService.commit(draftBranch.id, userId, commitMessage, { source: 'sync-push' });
          
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
          await vcsService.commitCurrentState(projectId, userId, commitMessage, 'sync-push');
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

    res.json({
      success: true,
      ...results,
    });

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
router.get('/git-api/repositories', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { projectId } = req.query;
  const dataSource = await getDataSource();
  const gitRepoRepo = dataSource.getRepository(GitRepository);

  if (projectId && typeof projectId === 'string') {
    const hasAccess = await projectMemberService.hasAccess(projectId, userId);
    if (!hasAccess) {
      throw Errors.validation('Project not found');
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
      'r.namespace AS namespace',
      'r.repositoryName AS "repositoryName"',
      'r.defaultBranch AS "defaultBranch"',
      'r.lastCommitSha AS "lastCommitSha"',
      'r.lastSyncAt AS "lastSyncAt"',
    ])
    .where('(p.ownerId = :userId OR pm.userId = :userId)', { userId });

  if (projectId && typeof projectId === 'string') {
    qb.andWhere('r.projectId = :projectId', { projectId });
  }

  const repos = await qb.getRawMany();

  res.json(repos);
}));

export default router;

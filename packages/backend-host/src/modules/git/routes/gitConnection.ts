/**
 * Project-level Git Connection Routes
 * Manages the Git connection (token, repo, provider) at the project level.
 */

import { Router, Request, Response } from 'express';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { z } from 'zod';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { requireProjectRole } from '@enterpriseglue/shared/middleware/projectAuth.js';
import { validateBody } from '@enterpriseglue/shared/middleware/validate.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { GitRepository } from '@enterpriseglue/shared/db/entities/GitRepository.js';
import { GitAuditLog } from '@enterpriseglue/shared/db/entities/GitAuditLog.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { encrypt } from '@enterpriseglue/shared/services/encryption.js';
import { remoteGitService } from '@enterpriseglue/shared/services/git/RemoteGitService.js';
import { MANAGE_ROLES } from '@enterpriseglue/shared/constants/roles.js';

const router = Router();

// --- Schemas ---

const connectSchema = z.object({
  projectId: z.string().uuid(),
  providerId: z.string().min(1),
  repositoryName: z.string().min(1),
  namespace: z.string().optional(),
  defaultBranch: z.string().default('main'),
  token: z.string().min(1),
});

const updateTokenSchema = z.object({
  projectId: z.string().uuid(),
  token: z.string().min(1),
});

const disconnectSchema = z.object({
  projectId: z.string().uuid(),
});

// --- GET /git-api/project-connection?projectId=... ---

router.get('/git-api/project-connection', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const projectId = req.query.projectId as string;
  if (!projectId) {
    throw Errors.validation('projectId query parameter is required');
  }

  const dataSource = await getDataSource();
  const gitRepoRepo = dataSource.getRepository(GitRepository);

  const repo = await gitRepoRepo.findOne({
    where: { projectId },
    order: { createdAt: 'DESC' },
  });

  if (!repo) {
    return res.json({ connected: false });
  }

  res.json({
    connected: true,
    providerId: repo.providerId,
    repositoryName: repo.repositoryName,
    namespace: repo.namespace,
    defaultBranch: repo.defaultBranch,
    remoteUrl: repo.remoteUrl,
    hasToken: !!repo.encryptedToken,
    lastValidatedAt: repo.lastValidatedAt ? Number(repo.lastValidatedAt) : null,
    tokenScopeHint: repo.tokenScopeHint,
    connectedByUserId: repo.connectedByUserId,
    lastSyncAt: repo.lastSyncAt ? Number(repo.lastSyncAt) : null,
  });
}));

// --- POST /git-api/project-connection ---

router.post('/git-api/project-connection', apiLimiter, requireAuth, validateBody(connectSchema), requireProjectRole(MANAGE_ROLES, { projectIdFrom: 'body' }), asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { projectId, providerId, repositoryName, namespace, defaultBranch, token } = req.body;

  // Validate token by testing write access
  const repoFullName = namespace ? `${namespace}/${repositoryName}` : repositoryName;
  try {
    const client = await remoteGitService.getClient(providerId, token);
    await client.testWriteAccess(repoFullName);
  } catch (err: any) {
    logger.warn('Git connection test failed', { projectId, repoFullName, error: err?.message });
    return res.status(403).json({
      error: 'Token validation failed — cannot write to this repository',
      hint: 'Ensure the token has Contents read/write permission for this repository.',
      detail: err?.message,
    });
  }

  const dataSource = await getDataSource();
  const gitRepoRepo = dataSource.getRepository(GitRepository);
  const now = Date.now();

  // Check if connection already exists
  const existing = await gitRepoRepo.findOne({ where: { projectId }, order: { createdAt: 'DESC' } });

  if (existing) {
    // Update existing connection
    await gitRepoRepo.update({ id: existing.id }, {
      providerId,
      repositoryName,
      namespace: namespace || null,
      defaultBranch,
      encryptedToken: encrypt(token),
      lastValidatedAt: now,
      connectedByUserId: userId,
      updatedAt: now,
    });
    logger.info('Updated project Git connection', { projectId, repoFullName, userId });
  } else {
    // Create new connection
    await gitRepoRepo.insert({
      id: generateId(),
      projectId,
      providerId,
      connectedByUserId: userId,
      remoteUrl: `https://github.com/${repoFullName}`, // Will be overwritten by provider-specific URL
      namespace: namespace || null,
      repositoryName,
      defaultBranch,
      encryptedToken: encrypt(token),
      lastValidatedAt: now,
      lastCommitSha: null,
      lastSyncAt: null,
      clonePath: `vcs://${projectId}`,
      createdAt: now,
      updatedAt: now,
    });
    logger.info('Created project Git connection', { projectId, repoFullName, userId });
  }

  // Audit log
  try {
    const auditRepo = dataSource.getRepository(GitAuditLog);
    await auditRepo.insert({
      id: generateId(),
      repositoryId: existing?.id || null,
      userId,
      operation: existing ? 'update-connection' : 'create-connection',
      details: JSON.stringify({ projectId, repoFullName, providerId }),
      status: 'success',
      errorMessage: null,
      duration: null,
      createdAt: Date.now(),
    });
  } catch (e) {
    logger.warn('Failed to write audit log for git connection', { projectId, error: e });
  }

  res.status(200).json({ success: true, repoFullName });
}));

// --- PUT /git-api/project-connection/token ---

router.put('/git-api/project-connection/token', apiLimiter, requireAuth, validateBody(updateTokenSchema), requireProjectRole(MANAGE_ROLES, { projectIdFrom: 'body' }), asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { projectId, token } = req.body;

  const dataSource = await getDataSource();
  const gitRepoRepo = dataSource.getRepository(GitRepository);

  const repo = await gitRepoRepo.findOne({ where: { projectId }, order: { createdAt: 'DESC' } });
  if (!repo) {
    throw Errors.notFound('Git connection');
  }

  // Validate new token
  const repoFullName = repo.namespace ? `${repo.namespace}/${repo.repositoryName}` : repo.repositoryName;
  try {
    const client = await remoteGitService.getClient(repo.providerId, token);
    await client.testWriteAccess(repoFullName);
  } catch (err: any) {
    return res.status(403).json({
      error: 'Token validation failed — cannot write to this repository',
      hint: 'Ensure the token has Contents read/write permission for this repository.',
      detail: err?.message,
    });
  }

  const now = Date.now();
  await gitRepoRepo.update({ id: repo.id }, {
    encryptedToken: encrypt(token),
    lastValidatedAt: now,
    connectedByUserId: userId,
    updatedAt: now,
  });

  // Audit log
  try {
    const auditRepo = dataSource.getRepository(GitAuditLog);
    await auditRepo.insert({
      id: generateId(),
      repositoryId: repo.id,
      userId,
      operation: 'update-token',
      details: JSON.stringify({ projectId, repoFullName }),
      status: 'success',
      errorMessage: null,
      duration: null,
      createdAt: Date.now(),
    });
  } catch (e) {
    logger.warn('Failed to write audit log for token update', { projectId, error: e });
  }

  logger.info('Updated project Git token', { projectId, repoFullName, userId });
  res.json({ success: true });
}));

// --- DELETE /git-api/project-connection ---

router.delete('/git-api/project-connection', apiLimiter, requireAuth, validateBody(disconnectSchema), requireProjectRole(MANAGE_ROLES, { projectIdFrom: 'body' }), asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { projectId } = req.body;

  const dataSource = await getDataSource();
  const gitRepoRepo = dataSource.getRepository(GitRepository);

  const deleted = await gitRepoRepo.delete({ projectId });
  logger.info('Disconnected project from Git', { projectId, userId, affected: deleted.affected });

  // Audit log
  try {
    const auditRepo = dataSource.getRepository(GitAuditLog);
    await auditRepo.insert({
      id: generateId(),
      repositoryId: null,
      userId,
      operation: 'disconnect',
      details: JSON.stringify({ projectId }),
      status: 'success',
      errorMessage: null,
      duration: null,
      createdAt: Date.now(),
    });
  } catch (e) {
    logger.warn('Failed to write audit log for disconnect', { projectId, error: e });
  }

  res.json({ success: true });
}));

export default router;

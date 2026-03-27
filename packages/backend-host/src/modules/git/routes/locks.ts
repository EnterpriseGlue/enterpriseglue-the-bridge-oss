import { Router, Request, Response } from 'express';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { LockManager } from '@enterpriseglue/shared/services/git/LockManager.js';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { validateBody } from '@enterpriseglue/shared/middleware/validate.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { requireFileEditAccess } from '@enterpriseglue/shared/middleware/projectAuth.js';
import { AcquireLockRequestSchema, LockHeartbeatRequestSchema, ReleaseLockRequestSchema } from '@enterpriseglue/shared/schemas/git/index.js';
import { subscribeLockEvents, emitLockEvent } from '../lockEvents.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { File } from '@enterpriseglue/shared/db/entities/File.js';
import { projectMemberService } from '@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js';
import { EDIT_ROLES, MANAGE_ROLES } from '@enterpriseglue/shared/constants/roles.js';

const router = Router();
const lockManager = new LockManager();

/**
 * POST /git-api/locks
 * Acquire a lock on a file
 */
router.post('/git-api/locks', apiLimiter, requireAuth, validateBody(AcquireLockRequestSchema), asyncHandler(async (req: Request, res: Response) => {
  const validated = req.body;
  const userId = req.user!.userId;

  const dataSource = await getDataSource();
  const fileRepo = dataSource.getRepository(File);
  const file = await fileRepo.findOne({
    where: { id: validated.fileId },
    select: ['projectId'],
  });
  if (!file) {
    throw Errors.fileNotFound();
  }
  const projectId = String(file.projectId);
  const canEditProject = await projectMemberService.hasRole(
    projectId,
    userId,
    EDIT_ROLES
  );
  if (!canEditProject) {
    throw Errors.fileNotFound();
  }

  const lock = await lockManager.acquireLock(validated.fileId, userId, {
    force: Boolean(validated.force),
    visibilityState: validated.visibilityState,
    hasInteraction: validated.hasInteraction,
  });

  if (!lock) {
    const holder = await lockManager.getLockHolder(validated.fileId);
    return res.status(409).json({
      error: 'File is locked by another user',
      lockHolder: holder,
    });
  }

  // If this was a force-takeover, notify the previous owner via SSE
  if (validated.force) {
    // Look up the taker's display name
    const { User } = await import('@enterpriseglue/shared/db/entities/User.js');
    const userRepo = dataSource.getRepository(User);
    const taker = await userRepo.findOne({ where: { id: userId }, select: ['id', 'firstName', 'lastName', 'email'] });
    let takerName = req.user!.email || userId;
    if (taker?.firstName || taker?.lastName) {
      takerName = [taker.firstName, taker.lastName].filter(Boolean).join(' ');
    }
    emitLockEvent(validated.fileId, {
      type: 'lock-revoked',
      fileId: validated.fileId,
      newOwnerId: userId,
      newOwnerName: takerName,
      previousLockId: lock.id,
    });
  }

  res.status(201).json(lock);
}));

/**
 * DELETE /git-api/locks/:lockId
 * Release a lock
 */
router.delete('/git-api/locks/:lockId', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const lockId = String(req.params.lockId);
  const userId = req.user!.userId;

  const lock = await lockManager.getLockRecord(lockId);
  if (!lock || lock.released) {
    throw Errors.validation('Lock not found');
  }

  const dataSource = await getDataSource();
  const fileRepo = dataSource.getRepository(File);
  const file = await fileRepo.findOne({
    where: { id: String(lock.fileId) },
    select: ['projectId'],
  });
  if (!file) {
    throw Errors.validation('Lock not found');
  }
  const projectId = String(file.projectId);

  const canManageLocks = await projectMemberService.hasRole(
    projectId,
    userId,
    MANAGE_ROLES
  );
  const isHolder = String(lock.userId) === String(userId);
  if (!isHolder && !canManageLocks) {
    throw Errors.validation('Lock not found');
  }

  await lockManager.releaseLock(lockId);

  res.status(204).send();
}));

/**
 * GET /git-api/locks
 * List active locks for a project
 */
router.get('/git-api/locks', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const projectId = req.query.projectId as string;
  const userId = req.user!.userId;

  if (!projectId) {
    throw Errors.validation('projectId is required');
  }

  const canRead = await projectMemberService.hasAccess(String(projectId), userId);
  if (!canRead) {
    throw Errors.projectNotFound();
  }

  const locks = await lockManager.getProjectLocks(projectId);

  res.json({ locks });
}));

/**
 * PUT /git-api/locks/:lockId/heartbeat
 * Send heartbeat to extend lock
 */
router.put('/git-api/locks/:lockId/heartbeat', apiLimiter, requireAuth, validateBody(LockHeartbeatRequestSchema), asyncHandler(async (req: Request, res: Response) => {
  const lockId = String(req.params.lockId);
  const validated = req.body;

  const userId = req.user!.userId;
  const lock = await lockManager.getLockRecord(lockId);
  if (!lock || lock.released) {
    throw Errors.validation('Lock not found');
  }

  if (String(lock.userId) !== String(userId)) {
    throw Errors.validation('Lock not found');
  }

  const updated = await lockManager.touchLock(lockId, {
    visibilityState: validated.visibilityState,
    hasInteraction: validated.hasInteraction,
  });

  res.json({ success: true, lock: updated ?? undefined });
}));

/**
 * GET /git-api/locks/:fileId/events
 * SSE stream for lock events on a file
 */
router.get('/git-api/locks/:fileId/events', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const fileId = String(req.params.fileId);
  const userId = req.user!.userId;

  // Verify user has access to this file's project
  const dataSource = await getDataSource();
  const fileRepo = dataSource.getRepository(File);
  const file = await fileRepo.findOne({
    where: { id: fileId },
    select: ['projectId'],
  });
  if (!file) {
    throw Errors.fileNotFound();
  }
  const canRead = await projectMemberService.hasAccess(String(file.projectId), userId);
  if (!canRead) {
    throw Errors.fileNotFound();
  }

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  // Send initial keepalive comment
  res.write(': connected\n\n');

  // Register this connection for lock events
  subscribeLockEvents(fileId, res);

  // Send periodic keepalive to prevent proxy/browser timeouts
  const keepalive = setInterval(() => {
    try {
      res.write(': keepalive\n\n');
    } catch {
      clearInterval(keepalive);
    }
  }, 30_000);

  req.on('close', () => {
    clearInterval(keepalive);
  });
}));

export default router;

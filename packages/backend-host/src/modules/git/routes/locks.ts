import { Router, Request, Response } from 'express';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { LockManager } from '@enterpriseglue/shared/services/git/LockManager.js';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { validateBody } from '@enterpriseglue/shared/middleware/validate.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { requireFileEditAccess } from '@enterpriseglue/shared/middleware/projectAuth.js';
import { AcquireLockRequestSchema, ReleaseLockRequestSchema } from '@enterpriseglue/shared/schemas/git/index.js';
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

  const lock = await lockManager.acquireLock(validated.fileId, userId);

  if (!lock) {
    const holder = await lockManager.getLockHolder(validated.fileId);
    return res.status(409).json({
      error: 'File is locked by another user',
      lockHolder: holder,
    });
  }

  // Start heartbeat to keep lock alive
  lockManager.startHeartbeat(lock.id);

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
router.put('/git-api/locks/:lockId/heartbeat', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const lockId = String(req.params.lockId);

  const userId = req.user!.userId;
  const lock = await lockManager.getLockRecord(lockId);
  if (!lock || lock.released) {
    throw Errors.validation('Lock not found');
  }

  if (String(lock.userId) !== String(userId)) {
    throw Errors.validation('Lock not found');
  }

  await lockManager.touchLock(lockId);

  // Heartbeat is handled automatically by lockManager.startHeartbeat()
  // This endpoint is for manual heartbeat if needed

  res.json({ success: true, message: 'Heartbeat sent' });
}));

export default router;

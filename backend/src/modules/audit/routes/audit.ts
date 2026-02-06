import { Router } from 'express';
import { MoreThan } from 'typeorm';
import { asyncHandler } from '@shared/middleware/errorHandler.js';
import { requireAuth } from '@shared/middleware/auth.js';
import { requirePermission } from '@shared/middleware/requirePermission.js';
import { auditLimiter } from '@shared/middleware/rateLimiter.js';
import { getUserAuditLogs, getResourceAuditLogs } from '@shared/services/audit.js';
import { getDataSource } from '@shared/db/data-source.js';
import { AuditLog } from '@shared/db/entities/AuditLog.js';
import { PlatformPermissions } from '@shared/services/platform-admin/permissions.js';

const router = Router();

router.use(auditLimiter);

/**
 * GET /api/audit/logs
 * Get all audit logs (admin only)
 * Query params: limit, offset, action, userId, resourceType
 */
router.get('/api/audit/logs', requireAuth, requirePermission({ permission: PlatformPermissions.AUDIT_VIEW }), asyncHandler(async (req, res) => {
  const limitNum = parseInt(req.query.limit as string) || 100;
  const offsetNum = parseInt(req.query.offset as string) || 0;
  const action = req.query.action as string;
  const userId = req.query.userId as string;
  const resourceType = req.query.resourceType as string;
  const resourceId = req.query.resourceId as string;
  const dataSource = await getDataSource();
  const auditRepo = dataSource.getRepository(AuditLog);

  // Get logs (no tenant join since relation was removed)
  const qb = auditRepo.createQueryBuilder('audit')
    .orderBy('audit.createdAt', 'DESC')
    .skip(offsetNum)
    .take(limitNum);

  if (action) qb.andWhere('audit.action = :action', { action });
  if (userId) qb.andWhere('audit.userId = :userId', { userId });
  if (resourceType) qb.andWhere('audit.resourceType = :resourceType', { resourceType });
  if (resourceId) qb.andWhere('audit.resourceId = :resourceId', { resourceId });

  const [result, total] = await qb.getManyAndCount();

  // Get tenant info for logs that have tenantId
  const logs = result.map((row) => ({
    id: row.id,
    tenantId: row.tenantId || null,
    tenantSlug: null,
    tenantName: null,
    userId: row.userId,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    details: row.details ? JSON.parse(row.details) : null,
    createdAt: row.createdAt,
  }));

  res.json({
    logs,
    pagination: {
      limit: limitNum,
      offset: offsetNum,
      total,
      hasMore: offsetNum + limitNum < total,
    },
  });
}));


/**
 * GET /api/audit/logs/user/:userId
 * Get audit logs for specific user
 */
router.get('/api/audit/logs/user/:userId', requireAuth, requirePermission({ permission: PlatformPermissions.AUDIT_VIEW }), asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const limit = parseInt(req.query.limit as string) || 100;

  const logs = await getUserAuditLogs(userId, limit);
  res.json({ logs });
}));

/**
 * GET /api/audit/logs/resource/:resourceType/:resourceId
 * Get audit logs for specific resource
 */
router.get('/api/audit/logs/resource/:resourceType/:resourceId', requireAuth, requirePermission({ permission: PlatformPermissions.AUDIT_VIEW }), asyncHandler(async (req, res) => {
  const { resourceType, resourceId } = req.params;
  const limit = parseInt(req.query.limit as string) || 50;

  const logs = await getResourceAuditLogs(resourceType, resourceId, limit);
  res.json({ logs });
}));

/**
 * GET /api/audit/stats
 * Get audit log statistics (admin only)
 */
router.get('/api/audit/stats', requireAuth, requirePermission({ permission: PlatformPermissions.AUDIT_VIEW }), asyncHandler(async (req, res) => {
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const dataSource = await getDataSource();
  const auditRepo = dataSource.getRepository(AuditLog);

  // Total logs count
  const total = await auditRepo.count();

  // Logs by action (top 10)
  const byActionQb = auditRepo.createQueryBuilder('audit')
    .select('audit.action', 'action')
    .addSelect('COUNT(*)', 'count')
    .groupBy('audit.action')
    .orderBy('count', 'DESC')
    .limit(10);
  const byAction = await byActionQb.getRawMany();

  // Logs by user (top 10 most active)
  const byUserQb = auditRepo.createQueryBuilder('audit')
    .select('audit.userId', 'user_id')
    .addSelect('COUNT(*)', 'count')
    .where('audit.userId IS NOT NULL')
    .groupBy('audit.userId')
    .orderBy('count', 'DESC')
    .limit(10);
  const byUser = await byUserQb.getRawMany();

  // Recent activity (last 24 hours)
  const last24Hours = await auditRepo.count({
    where: { createdAt: MoreThan(oneDayAgo) },
  });

  // Failed login attempts (last 24 hours)
  const failedLogins = await auditRepo.count({
    where: { action: 'auth.login.failed', createdAt: MoreThan(oneDayAgo) },
  });

  res.json({
    total,
    last24Hours,
    failedLogins,
    byAction,
    byUser,
  });
}));

/**
 * GET /api/audit/actions
 * Get list of all available audit actions
 */
router.get('/api/audit/actions', requireAuth, requirePermission({ permission: PlatformPermissions.AUDIT_VIEW }), asyncHandler(async (req, res) => {
  const dataSource = await getDataSource();
  const auditRepo = dataSource.getRepository(AuditLog);

  const qb = auditRepo.createQueryBuilder('audit')
    .select('DISTINCT audit.action', 'action')
    .orderBy('audit.action', 'ASC');

  const result = await qb.getRawMany();
  const actions = result.map((row: any) => row.action);

  res.json({ actions });
}));

export default router;

import { Router, type Request } from 'express';
import { MoreThan } from 'typeorm';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { requireAction } from '@enterpriseglue/shared/middleware/requireAction.js';
import { auditLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { getUserAuditLogs, getResourceAuditLogs } from '@enterpriseglue/shared/services/audit.js';
import { piiRedactionService } from '@enterpriseglue/shared/services/pii/PiiRedactionService.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuditLog } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuditLog.js';
import { permissionService, PlatformPermissions } from '@enterpriseglue/shared/services/platform-admin/permissions.js';

const router = Router();

router.use(auditLimiter);

function truthyQueryValue(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(truthyQueryValue);
  }
  return ['1', 'true', 'yes'].includes(String(value ?? '').toLowerCase());
}

function wantsUnredactedAudit(req: Request): boolean {
  return truthyQueryValue(req.query.includePii) ||
    truthyQueryValue(req.query.unredacted) ||
    String(req.query.redaction ?? '').toLowerCase() === 'none';
}

async function shouldRedactAuditPayload(req: Request): Promise<boolean> {
  if (!wantsUnredactedAudit(req)) return true;

  const user = req.user;
  if (!user?.userId) {
    throw Errors.unauthorized('Authentication required');
  }

  const hasPermission = await permissionService.hasPermission(PlatformPermissions.AUDIT_UNREDACTED_VIEW, {
    userId: user.userId,
    platformRole: user.platformRole || (user as any).role,
    resourceType: 'platform',
  });

  if (!hasPermission) {
    throw Errors.forbidden(`You do not have the required permission: ${PlatformPermissions.AUDIT_UNREDACTED_VIEW}`);
  }

  return false;
}

async function formatAuditPayload(req: Request, payload: unknown, redact: boolean): Promise<unknown> {
  if (!redact) return payload;
  return piiRedactionService.redactPayload(req, payload, 'audit');
}

/**
 * GET /api/audit/logs
 * Get all audit logs (admin only)
 * Query params: limit, offset, action, userId, resourceType
 */
router.get('/api/audit/logs', requireAuth, requireAction('platform.audit.read'), asyncHandler(async (req, res) => {
  const redactAuditPayload = await shouldRedactAuditPayload(req);
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

  const payload = await formatAuditPayload(req, {
    logs,
    pagination: {
      limit: limitNum,
      offset: offsetNum,
      total,
      hasMore: offsetNum + limitNum < total,
    },
  }, redactAuditPayload);

  res.json(payload);
}));


/**
 * GET /api/audit/logs/user/:userId
 * Get audit logs for specific user
 */
router.get('/api/audit/logs/user/:userId', requireAuth, requireAction('platform.audit.read'), asyncHandler(async (req, res) => {
  const redactAuditPayload = await shouldRedactAuditPayload(req);
  const userId = String(req.params.userId);
  const limit = parseInt(req.query.limit as string) || 100;

  const logs = await getUserAuditLogs(userId, limit);
  const payload = await formatAuditPayload(req, { logs }, redactAuditPayload);
  res.json(payload);
}));

/**
 * GET /api/audit/logs/resource/:resourceType/:resourceId
 * Get audit logs for specific resource
 */
router.get('/api/audit/logs/resource/:resourceType/:resourceId', requireAuth, requireAction('platform.audit.read'), asyncHandler(async (req, res) => {
  const redactAuditPayload = await shouldRedactAuditPayload(req);
  const resourceType = String(req.params.resourceType);
  const resourceId = String(req.params.resourceId);
  const limit = parseInt(req.query.limit as string) || 50;

  const logs = await getResourceAuditLogs(resourceType, resourceId, limit);
  const payload = await formatAuditPayload(req, { logs }, redactAuditPayload);
  res.json(payload);
}));

/**
 * GET /api/audit/stats
 * Get audit log statistics (admin only)
 */
router.get('/api/audit/stats', requireAuth, requireAction('platform.audit.read'), asyncHandler(async (req, res) => {
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
router.get('/api/audit/actions', requireAuth, requireAction('platform.audit.read'), asyncHandler(async (req, res) => {
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

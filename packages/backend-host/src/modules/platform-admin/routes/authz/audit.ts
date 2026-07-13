import type { Request, RequestHandler, Response, Router } from 'express';
import { z } from 'zod';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { validateQuery } from '@enterpriseglue/shared/middleware/validate.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { policyService } from '@enterpriseglue/shared/services/platform-admin/index.js';

const authzAuditQuerySchema = z.object({
  userId: z.string().optional(),
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
  decision: z.enum(['allow', 'deny']).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export interface AuditRouteDependencies {
  requirePlatformAction: (actionId: string) => RequestHandler;
}

export function registerAuditRoutes(router: Router, { requirePlatformAction }: AuditRouteDependencies): void {
  router.get('/api/authz/audit', apiLimiter, requireAuth, requirePlatformAction('platform.audit.read'), validateQuery(authzAuditQuerySchema), asyncHandler(async (req: Request, res: Response) => {
    try {
      const userId = typeof req.query.userId === 'string' ? req.query.userId : undefined;
      const resourceType = typeof req.query.resourceType === 'string' ? req.query.resourceType : undefined;
      const resourceId = typeof req.query.resourceId === 'string' ? req.query.resourceId : undefined;
      const decision = req.query.decision === 'allow' || req.query.decision === 'deny' ? req.query.decision : undefined;
      const limit = typeof req.query.limit === 'number' ? req.query.limit : undefined;
      const offset = typeof req.query.offset === 'number' ? req.query.offset : undefined;
      res.json(await policyService.getAuditLog({
        tenantId: req.tenant?.tenantId || null,
        userId,
        resourceType,
        resourceId,
        decision,
        limit,
        offset,
      }));
    } catch (error: any) {
      logger.error('Get audit log error:', error);
      throw Errors.internal('Failed to get audit log');
    }
  }));
}

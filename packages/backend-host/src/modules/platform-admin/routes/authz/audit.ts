import type { Request, RequestHandler, Response, Router } from 'express';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { validateQuery } from '@enterpriseglue/shared/middleware/validate.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { policyService } from '@enterpriseglue/shared/services/platform-admin/index.js';
import {
  AuthzAuditLogResponseSchema,
  AuthzAuditQuerySchema,
} from '@enterpriseglue/shared/schemas/platform-admin/authz.js';

export interface AuditRouteDependencies {
  requirePlatformAction: (actionId: string) => RequestHandler;
}

export function registerAuditRoutes(router: Router, { requirePlatformAction }: AuditRouteDependencies): void {
  router.get('/api/authz/audit', apiLimiter, requireAuth, requirePlatformAction('platform.audit.read'), validateQuery(AuthzAuditQuerySchema), asyncHandler(async (req: Request, res: Response) => {
    try {
      const userId = typeof req.query.userId === 'string' ? req.query.userId : undefined;
      const resourceType = typeof req.query.resourceType === 'string' ? req.query.resourceType : undefined;
      const resourceId = typeof req.query.resourceId === 'string' ? req.query.resourceId : undefined;
      const decision = req.query.decision === 'allow' || req.query.decision === 'deny' ? req.query.decision : undefined;
      const limit = typeof req.query.limit === 'number' ? req.query.limit : undefined;
      const offset = typeof req.query.offset === 'number' ? req.query.offset : undefined;
      const entries = await policyService.getAuditLog({
        tenantId: req.tenant?.tenantId || null,
        userId,
        resourceType,
        resourceId,
        decision,
        limit,
        offset,
      });
      res.json(AuthzAuditLogResponseSchema.array().parse(entries));
    } catch (error: any) {
      logger.error('Get audit log error:', error);
      throw Errors.internal('Failed to get audit log');
    }
  }));
}

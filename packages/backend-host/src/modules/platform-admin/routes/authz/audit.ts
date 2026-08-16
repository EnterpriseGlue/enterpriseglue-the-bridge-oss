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

const sensitiveAuditContextKey = /(?:authorization|cookie|credential|password|secret|token)/i;

function redactAuditContextValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactAuditContextValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [
    key,
    sensitiveAuditContextKey.test(key) ? '[REDACTED]' : redactAuditContextValue(child),
  ]));
}

function redactAuditContext(context: string): string {
  if (!context) return context;
  try {
    return JSON.stringify(redactAuditContextValue(JSON.parse(context)));
  } catch {
    return context.replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, '$1[REDACTED]');
  }
}

export function registerAuditRoutes(router: Router, { requirePlatformAction }: AuditRouteDependencies): void {
  router.get('/api/authz/audit', apiLimiter, requireAuth, requirePlatformAction('platform.audit.read'), validateQuery(AuthzAuditQuerySchema), asyncHandler(async (req: Request, res: Response) => {
    try {
      const userId = typeof req.query.userId === 'string' ? req.query.userId : undefined;
      const action = typeof req.query.action === 'string' ? req.query.action : undefined;
      const resourceType = typeof req.query.resourceType === 'string' ? req.query.resourceType : undefined;
      const resourceId = typeof req.query.resourceId === 'string' ? req.query.resourceId : undefined;
      const decision = req.query.decision === 'allow' || req.query.decision === 'deny' ? req.query.decision : undefined;
      const limit = typeof req.query.limit === 'number' ? req.query.limit : undefined;
      const offset = typeof req.query.offset === 'number' ? req.query.offset : undefined;
      const entries = await policyService.getAuditLog({
        tenantId: req.tenant?.tenantId || null,
        userId,
        action,
        resourceType,
        resourceId,
        decision,
        limit,
        offset,
      });
      res.json(entries.map((entry) => AuthzAuditLogResponseSchema.parse({
        id: entry.id,
        tenantId: entry.tenantId,
        userId: entry.userId,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        decision: entry.decision,
        reason: entry.reason,
        policyId: entry.policyId,
        context: redactAuditContext(entry.context),
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        timestamp: Number(entry.timestamp),
      })));
    } catch (error: any) {
      logger.error('Get audit log error:', error);
      throw Errors.internal('Failed to get audit log');
    }
  }));
}

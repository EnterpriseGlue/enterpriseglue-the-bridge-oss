import type { Request, RequestHandler, Response, Router } from 'express';
import { z } from 'zod';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { validateBody, validateParams, validateQuery } from '@enterpriseglue/shared/middleware/validate.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { ssoSyncDiagnosticsService } from '@enterpriseglue/shared/services/platform-admin/index.js';

const idParamSchema = z.object({ id: z.string().uuid() });
const ssoSyncRunsQuerySchema = z.object({
  providerId: z.string().min(1).optional(), userId: z.string().uuid().optional(),
  status: z.enum(['running', 'success', 'failed']).optional(),
  trigger: z.enum(['login', 'scheduled', 'manual', 'mapping_change', 'engine_change']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
const ssoSyncEventsQuerySchema = z.object({
  providerId: z.string().min(1).optional(), severity: z.enum(['info', 'warning', 'error']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
const ssoSyncDiagnosticsRunSchema = z.object({
  providerId: z.string().min(1).optional(), trigger: z.enum(['manual', 'scheduled', 'mapping_change', 'engine_change']).optional(),
  includeProviderChecks: z.boolean().optional(), includeSnapshotReplay: z.boolean().optional(),
  refreshProviderClaims: z.boolean().optional(), includeCleanup: z.boolean().optional(),
});

export interface SsoSyncDiagnosticsRouteDependencies { requirePlatformAction: (actionId: string) => RequestHandler; }

export function registerSsoSyncDiagnosticsRoutes(router: Router, { requirePlatformAction }: SsoSyncDiagnosticsRouteDependencies): void {
  router.get('/api/authz/sso-sync-runs', apiLimiter, requireAuth, requirePlatformAction('platform.sso.engine-assignments.read'), validateQuery(ssoSyncRunsQuerySchema), asyncHandler(async (req: Request, res: Response) => {
    try {
      const runs = await ssoSyncDiagnosticsService.listRuns({
        tenantId: req.tenant?.tenantId || null,
        providerId: typeof req.query.providerId === 'string' ? req.query.providerId : undefined,
        userId: typeof req.query.userId === 'string' ? req.query.userId : undefined,
        status: typeof req.query.status === 'string' ? req.query.status as any : undefined,
        trigger: typeof req.query.trigger === 'string' ? req.query.trigger as any : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      });
      res.json(runs);
    } catch (error: any) {
      if (error.statusCode) throw error;
      logger.error('Get SSO sync runs error:', error);
      throw Errors.internal('Failed to get SSO sync runs');
    }
  }));

  router.post('/api/authz/sso-sync-runs/reconcile', apiLimiter, requireAuth, requirePlatformAction('platform.sso.engine-assignments.manage'), validateBody(ssoSyncDiagnosticsRunSchema), asyncHandler(async (req: Request, res: Response) => {
    try {
      const baseInput = {
        tenantId: req.tenant?.tenantId || null, providerId: req.body.providerId || null, trigger: req.body.trigger || 'manual',
        details: { actorUserId: req.user!.userId, source: 'admin_access_control' },
      };
      const result: any = await ssoSyncDiagnosticsService.runReconciliationDiagnostics(baseInput);
      if (req.body.includeProviderChecks) result.providerIdentityCheck = await ssoSyncDiagnosticsService.runProviderIdentityCheck(baseInput);
      if (req.body.includeSnapshotReplay) result.snapshotReconciliation = await ssoSyncDiagnosticsService.runSnapshotReconciliation({ ...baseInput, refreshProviderClaims: req.body.refreshProviderClaims === true });
      if (req.body.includeCleanup) result.cleanup = await ssoSyncDiagnosticsService.runReconciliationCleanup(baseInput);
      res.json(result);
    } catch (error: any) {
      if (error.statusCode) throw error;
      logger.error('Run SSO sync diagnostics error:', error);
      throw Errors.internal('Failed to run SSO sync diagnostics');
    }
  }));

  router.get('/api/authz/sso-sync-runs/:id/events', apiLimiter, requireAuth, requirePlatformAction('platform.sso.engine-assignments.read'), validateParams(idParamSchema), validateQuery(ssoSyncEventsQuerySchema), asyncHandler(async (req: Request, res: Response) => {
    try {
      const events = await ssoSyncDiagnosticsService.listEvents({
        tenantId: req.tenant?.tenantId || null,
        providerId: typeof req.query.providerId === 'string' ? req.query.providerId : undefined,
        runId: String(req.params.id), severity: typeof req.query.severity === 'string' ? req.query.severity as any : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      });
      res.json(events);
    } catch (error: any) {
      if (error.statusCode) throw error;
      logger.error('Get SSO sync events error:', error);
      throw Errors.internal('Failed to get SSO sync events');
    }
  }));
}

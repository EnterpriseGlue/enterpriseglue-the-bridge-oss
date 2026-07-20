import type { Request, RequestHandler, Response, Router } from 'express';
import { z } from 'zod';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { validateBody, validateParams, validateQuery } from '@enterpriseglue/shared/middleware/validate.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { ssoEngineAccessSnapshotService } from '@enterpriseglue/shared/services/platform-admin/index.js';
import {
  EngineAccessTransitionCleanupApplyRequestSchema,
  SsoEngineAccessSnapshotQuerySchema,
} from '@enterpriseglue/shared/schemas/platform-admin/authz.js';

const engineIdParamSchema = z.object({ engineId: z.string().min(1) });

export interface SsoEngineAssignmentRouteDependencies { requirePlatformAction: (actionId: string) => RequestHandler; }

export function registerSsoEngineAssignmentRoutes(router: Router, { requirePlatformAction }: SsoEngineAssignmentRouteDependencies): void {
  router.get('/api/authz/sso-engine-access-snapshots', apiLimiter, requireAuth, requirePlatformAction('platform.sso.engine-assignments.read'), validateQuery(SsoEngineAccessSnapshotQuerySchema), asyncHandler(async (req, res) => {
    try { res.json(await ssoEngineAccessSnapshotService.listSnapshots({ tenantId: req.tenant?.tenantId || null, providerId: req.query.providerId as string | undefined, mappingId: req.query.mappingId as string | undefined, principalType: req.query.principalType as string | undefined, principalId: req.query.principalId as string | undefined, engineId: req.query.engineId as string | undefined, status: req.query.status as any, limit: req.query.limit ? Number(req.query.limit) : undefined })); }
    catch (error: any) { if (error.statusCode) throw error; logger.error('List SSO engine access snapshots error:', error); throw Errors.internal('Failed to list SSO engine access snapshots'); }
  }));
  router.get('/api/authz/sso-engine-access-snapshots/:engineId', apiLimiter, requireAuth, requirePlatformAction('platform.sso.engine-assignments.read'), validateParams(engineIdParamSchema), asyncHandler(async (req, res) => {
    try { res.json(await ssoEngineAccessSnapshotService.listSnapshotsForEngine(String(req.params.engineId), req.tenant?.tenantId || null)); }
    catch (error: any) { if (error.statusCode) throw error; logger.error('List engine SSO access snapshots error:', error); throw Errors.internal('Failed to list engine SSO access snapshots'); }
  }));
  router.post('/api/engines/:engineId/access/transition-cleanup-preview', apiLimiter, requireAuth, requirePlatformAction('platform.sso.engine-assignments.manage'), validateParams(engineIdParamSchema), asyncHandler(async (req, res) => {
    try { res.json(await ssoEngineAccessSnapshotService.previewTransitionCleanup(String(req.params.engineId), req.tenant?.tenantId || null)); }
    catch (error: any) { if (error.statusCode) throw error; logger.error('Preview engine access transition cleanup error:', error); throw Errors.badRequest(error.message || 'Failed to preview engine access transition cleanup'); }
  }));
  router.post('/api/engines/:engineId/access/transition-cleanup', apiLimiter, requireAuth, requirePlatformAction('platform.sso.engine-assignments.manage'), validateParams(engineIdParamSchema), validateBody(EngineAccessTransitionCleanupApplyRequestSchema), asyncHandler(async (req, res) => {
    try { res.json(await ssoEngineAccessSnapshotService.applyTransitionCleanup(String(req.params.engineId), req.body.assignmentIds, req.user!.userId, req.tenant?.tenantId || null, req.body.previewCorrelationId)); }
    catch (error: any) { if (error.statusCode) throw error; logger.error('Apply engine access transition cleanup error:', error); throw Errors.badRequest(error.message || 'Failed to apply engine access transition cleanup'); }
  }));
}

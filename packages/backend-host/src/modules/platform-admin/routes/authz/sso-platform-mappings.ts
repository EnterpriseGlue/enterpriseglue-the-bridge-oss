import type { Request, RequestHandler, Response, Router } from 'express';
import { z } from 'zod';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { validateBody, validateParams } from '@enterpriseglue/shared/middleware/validate.js';
import { logAudit } from '@enterpriseglue/shared/services/audit.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { ssoClaimsMappingService } from '@enterpriseglue/shared/services/platform-admin/index.js';
import {
  LegacySsoMappingMigrationRequestSchema,
  LegacySsoPlatformMappingCreateRequestSchema,
  LegacySsoPlatformMappingUpdateRequestSchema,
  SsoMappingTestRequestSchema,
} from '@enterpriseglue/shared/schemas/platform-admin/authz.js';

const idParamSchema = z.object({ id: z.string().uuid() });

export interface SsoPlatformMappingRouteDependencies { requirePlatformAction: (actionId: string) => RequestHandler; }

export function registerSsoPlatformMappingRoutes(router: Router, { requirePlatformAction }: SsoPlatformMappingRouteDependencies): void {
  router.get('/api/authz/sso-mappings', apiLimiter, requireAuth, requirePlatformAction('platform.sso.platform-role-mappings.read'), asyncHandler(async (_req: Request, res: Response) => {
    try { res.json(await ssoClaimsMappingService.getAllMappings()); }
    catch (error: any) { logger.error('Get SSO mappings error:', error); throw Errors.internal('Failed to get SSO mappings'); }
  }));
  router.post('/api/authz/sso-mappings', apiLimiter, requireAuth, requirePlatformAction('platform.sso.platform-role-mappings.manage'), validateBody(LegacySsoPlatformMappingCreateRequestSchema), asyncHandler(async (req: Request, res: Response) => {
    try { res.status(201).json(await ssoClaimsMappingService.createMapping(req.body)); }
    catch (error: any) { logger.error('Create SSO mapping error:', error); throw Errors.internal('Failed to create SSO mapping'); }
  }));
  router.post('/api/authz/sso-mappings/:id/migrate-provider-neutral', apiLimiter, requireAuth, requirePlatformAction('platform.sso.platform-role-mappings.manage'), validateParams(idParamSchema), validateBody(LegacySsoMappingMigrationRequestSchema), asyncHandler(async (req: Request, res: Response) => {
    const result = await ssoClaimsMappingService.migrateToProviderNeutral(String(req.params.id), { ...req.body, createdById: req.user!.userId });
    await logAudit({ action: 'authz.sso_platform_mapping.provider_neutral_migration', userId: req.user!.userId, resourceType: 'sso_mapping', resourceId: result.legacyMappingId, details: { providerKey: req.body.providerKey, identityMappingId: result.mapping.id, assignmentId: result.assignment.id, created: result.created } });
    res.status(result.created ? 201 : 200).json(result);
  }));
  router.put('/api/authz/sso-mappings/:id', apiLimiter, requireAuth, requirePlatformAction('platform.sso.platform-role-mappings.manage'), validateParams(idParamSchema), validateBody(LegacySsoPlatformMappingUpdateRequestSchema), asyncHandler(async (req: Request, res: Response) => {
    try { await ssoClaimsMappingService.updateMapping(String(req.params.id), req.body); res.json({ success: true }); }
    catch (error: any) { logger.error('Update SSO mapping error:', error); throw Errors.internal('Failed to update SSO mapping'); }
  }));
  router.delete('/api/authz/sso-mappings/:id', apiLimiter, requireAuth, requirePlatformAction('platform.sso.platform-role-mappings.manage'), validateParams(idParamSchema), asyncHandler(async (req: Request, res: Response) => {
    try { await ssoClaimsMappingService.deleteMapping(String(req.params.id)); res.status(204).send(); }
    catch (error: any) { logger.error('Delete SSO mapping error:', error); throw Errors.internal('Failed to delete SSO mapping'); }
  }));
  router.post('/api/authz/sso-mappings/test', apiLimiter, requireAuth, requirePlatformAction('platform.sso.platform-role-mappings.manage'), validateBody(SsoMappingTestRequestSchema), asyncHandler(async (req: Request, res: Response) => {
    try { res.json(await ssoClaimsMappingService.testClaims(req.body.claims, req.body.providerId)); }
    catch (error: any) { logger.error('Test SSO mapping error:', error); throw Errors.internal('Failed to test SSO mapping'); }
  }));
}

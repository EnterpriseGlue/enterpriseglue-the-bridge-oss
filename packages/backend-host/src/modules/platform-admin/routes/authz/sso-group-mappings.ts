import type { RequestHandler, Router } from 'express';
import { z } from 'zod';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { validateBody, validateParams } from '@enterpriseglue/shared/middleware/validate.js';
import { logAudit } from '@enterpriseglue/shared/services/audit.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { ssoGroupMappingService } from '@enterpriseglue/shared/services/platform-admin/index.js';
import {
  LegacySsoGroupMappingMigrationRequestSchema,
  SsoGroupMappingInsertSchema,
  SsoGroupMappingUpdateSchema,
  SsoMappingTestRequestSchema,
} from '@enterpriseglue/shared/schemas/platform-admin/authz.js';

const idParamSchema = z.object({ id: z.string().uuid() });

export interface SsoGroupMappingRouteDependencies { requirePlatformAction: (actionId: string) => RequestHandler; }

export function registerSsoGroupMappingRoutes(router: Router, { requirePlatformAction }: SsoGroupMappingRouteDependencies): void {
  router.get('/api/authz/sso-group-mappings', apiLimiter, requireAuth, requirePlatformAction('platform.sso.group-mappings.read'), asyncHandler(async (req, res) => {
    try { res.json(await ssoGroupMappingService.getAllMappings(req.tenant?.tenantId || null)); }
    catch (error: any) { if (error.statusCode) throw error; logger.error('Get SSO group mappings error:', error); throw Errors.internal('Failed to get SSO group mappings'); }
  }));
  router.post('/api/authz/sso-group-mappings', apiLimiter, requireAuth, requirePlatformAction('platform.sso.group-mappings.manage'), validateBody(SsoGroupMappingInsertSchema), asyncHandler(async (req, res) => {
    try { res.status(201).json(await ssoGroupMappingService.createMapping({ ...req.body, tenantId: req.tenant?.tenantId || null })); }
    catch (error: any) { if (error.statusCode) throw error; logger.error('Create SSO group mapping error:', error); throw Errors.badRequest(error.message || 'Failed to create SSO group mapping'); }
  }));
  router.post('/api/authz/sso-group-mappings/:id/migrate-provider-neutral', apiLimiter, requireAuth, requirePlatformAction('platform.sso.group-mappings.manage'), validateParams(idParamSchema), validateBody(LegacySsoGroupMappingMigrationRequestSchema), asyncHandler(async (req, res) => {
    const result = await ssoGroupMappingService.migrateToProviderNeutral(String(req.params.id), req.body.providerKey, req.tenant?.tenantId || null);
    await logAudit({ action: 'authz.sso_group_mapping.provider_neutral_migration', userId: req.user!.userId, resourceType: 'sso_group_mapping', resourceId: result.legacyMappingId, details: { providerKey: result.providerKey, identityMappingId: result.identityMapping.id, created: result.created } });
    res.status(result.created ? 201 : 200).json(result);
  }));
  router.put('/api/authz/sso-group-mappings/:id', apiLimiter, requireAuth, requirePlatformAction('platform.sso.group-mappings.manage'), validateParams(idParamSchema), validateBody(SsoGroupMappingUpdateSchema), asyncHandler(async (req, res) => {
    try { await ssoGroupMappingService.updateMapping(String(req.params.id), { ...req.body, tenantId: req.tenant?.tenantId || null }); res.json({ success: true }); }
    catch (error: any) { if (error.statusCode) throw error; logger.error('Update SSO group mapping error:', error); throw Errors.badRequest(error.message || 'Failed to update SSO group mapping'); }
  }));
  router.delete('/api/authz/sso-group-mappings/:id', apiLimiter, requireAuth, requirePlatformAction('platform.sso.group-mappings.manage'), validateParams(idParamSchema), asyncHandler(async (req, res) => {
    try { await ssoGroupMappingService.deleteMapping(String(req.params.id)); res.status(204).send(); }
    catch (error: any) { if (error.statusCode) throw error; logger.error('Delete SSO group mapping error:', error); throw Errors.internal('Failed to delete SSO group mapping'); }
  }));
  router.post('/api/authz/sso-group-mappings/test', apiLimiter, requireAuth, requirePlatformAction('platform.sso.group-mappings.manage'), validateBody(SsoMappingTestRequestSchema), asyncHandler(async (req, res) => {
    try { res.json(await ssoGroupMappingService.testClaims(req.body.claims, req.body.providerId, req.tenant?.tenantId || null)); }
    catch (error: any) { if (error.statusCode) throw error; logger.error('Test SSO group mapping error:', error); throw Errors.internal('Failed to test SSO group mapping'); }
  }));
}

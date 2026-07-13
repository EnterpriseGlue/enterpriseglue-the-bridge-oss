import type { Request, RequestHandler, Response, Router } from 'express';
import { z } from 'zod';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { validateBody, validateParams, validateQuery } from '@enterpriseglue/shared/middleware/validate.js';
import { logAudit } from '@enterpriseglue/shared/services/audit.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { legacyMappingCoverageService, ssoAssignmentMappingService, ssoEngineAccessSnapshotService } from '@enterpriseglue/shared/services/platform-admin/index.js';

const idParamSchema = z.object({ id: z.string().uuid() });
const engineIdParamSchema = z.object({ engineId: z.string().min(1) });
const mappingSchema = z.object({
  providerId: z.string().min(1).nullable().optional(), claimType: z.enum(['group', 'role', 'email_domain', 'custom']),
  claimKey: z.string().min(1), claimValue: z.string().optional().default(''),
  claimOperator: z.enum(['equals', 'not_equals', 'contains', 'not_contains', 'contains_any', 'not_contains_any', 'contains_all', 'not_contains_all', 'matches_regex', 'not_matches_regex', 'exists', 'not_exists']).nullable().optional(),
  targetSelectorType: z.enum(['engine_id', 'all_engines', 'external_engine_id', 'engine_label']),
  targetEngineId: z.string().min(1).nullable().optional(), targetExternalEngineId: z.string().min(1).nullable().optional(),
  targetLabelKey: z.string().min(1).nullable().optional(), targetLabelValue: z.string().min(1).nullable().optional(),
  targetRoleId: z.string().min(1), syncMode: z.enum(['authoritative', 'additive']).optional(), priority: z.number().int().optional(),
  isActive: z.boolean().optional(), riskAcknowledged: z.boolean().optional(),
});
const mappingUpdateSchema = mappingSchema.partial();
const mappingTestSchema = z.object({ claims: z.record(z.string(), z.unknown()), providerId: z.string().min(1).optional() });
const providerNeutralMigrationSchema = z.object({
  providerKey: z.string().min(1).max(128), targetGroupKey: z.string().min(1).max(160).optional(),
  newGroup: z.object({ key: z.string().min(1).max(255), name: z.string().min(1).max(255), description: z.string().max(2000).nullable().optional() }).optional(),
}).refine((value) => Boolean(value.targetGroupKey) !== Boolean(value.newGroup), { message: 'Provide exactly one of targetGroupKey or newGroup' });
const snapshotQuerySchema = z.object({
  providerId: z.string().min(1).optional(), mappingId: z.string().min(1).optional(), principalType: z.string().min(1).optional(),
  principalId: z.string().min(1).optional(), engineId: z.string().min(1).optional(),
  status: z.enum(['active', 'stale', 'removed_by_sso', 'removed_by_admin', 'mapping_disabled', 'provider_identity_missing', 'provider_group_missing', 'engine_no_longer_matches_selector']).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});
const cleanupSchema = z.object({ previewCorrelationId: z.string().min(1).optional(), assignmentIds: z.array(z.string().min(1)).min(1) });
const coverageSchema = z.object({ family: z.enum(['platform_role', 'group', 'engine_assignment']), candidateIdentityMappingId: z.string().min(1), note: z.string().min(3).max(2000) });
const retirementSchema = z.object({ confirmation: z.literal('RETIRE_LEGACY_MAPPINGS') });
const globalRetirementSchema = z.object({ confirmation: z.literal('RETIRE_GLOBAL_LEGACY_MAPPINGS') });

export interface SsoEngineAssignmentRouteDependencies { requirePlatformAction: (actionId: string) => RequestHandler; }

export function registerSsoEngineAssignmentRoutes(router: Router, { requirePlatformAction }: SsoEngineAssignmentRouteDependencies): void {
  router.get('/api/authz/sso-assignment-mappings', apiLimiter, requireAuth, requirePlatformAction('platform.sso.engine-assignments.read'), asyncHandler(async (req, res) => {
    try { res.json(await ssoAssignmentMappingService.getAllMappings(req.tenant?.tenantId || null)); }
    catch (error: any) { logger.error('Get SSO assignment mappings error:', error); throw Errors.internal('Failed to get SSO assignment mappings'); }
  }));
  router.get('/api/authz/legacy-mapping-coverage', apiLimiter, requireAuth, requirePlatformAction('platform.sso.group-mappings.read'), asyncHandler(async (req, res) => { res.json(await legacyMappingCoverageService.getCoverage(req.tenant?.tenantId || null)); }));
  router.get('/api/authz/legacy-mapping-retirement-readiness', apiLimiter, requireAuth, requirePlatformAction('platform.sso.group-mappings.read'), asyncHandler(async (req, res) => { res.json(await legacyMappingCoverageService.getRetirementReadiness(req.tenant?.tenantId || null)); }));
  router.post('/api/authz/legacy-mapping-coverage/:id/verify', apiLimiter, requireAuth, requirePlatformAction('platform.sso.group-mappings.manage'), validateParams(idParamSchema), validateBody(coverageSchema), asyncHandler(async (req, res) => { await legacyMappingCoverageService.verifyReplacement({ tenantId: req.tenant?.tenantId || null, legacyMappingId: String(req.params.id), actorId: req.user!.userId, ...req.body }); res.status(204).send(); }));
  router.post('/api/authz/legacy-mapping-retirement/disable', apiLimiter, requireAuth, requirePlatformAction('platform.sso.group-mappings.manage'), validateBody(retirementSchema), asyncHandler(async (req, res) => { res.json(await legacyMappingCoverageService.retireLegacyMappings(req.tenant?.tenantId || null, req.user!.userId)); }));
  router.post('/api/authz/legacy-mapping-retirement/disable-global', apiLimiter, requireAuth, requirePlatformAction('platform.sso.group-mappings.manage'), requirePlatformAction('platform.sso.platform-role-mappings.manage'), validateBody(globalRetirementSchema), asyncHandler(async (req, res) => { res.json(await legacyMappingCoverageService.retireLegacyMappings(null, req.user!.userId)); }));
  router.post('/api/authz/sso-assignment-mappings', apiLimiter, requireAuth, requirePlatformAction('platform.sso.engine-assignments.manage'), validateBody(mappingSchema), asyncHandler(async (req, res) => {
    try { res.status(201).json(await ssoAssignmentMappingService.createMapping({ ...req.body, tenantId: req.tenant?.tenantId || null, actorUserId: req.user!.userId })); }
    catch (error: any) { if (error.statusCode) throw error; logger.error('Create SSO assignment mapping error:', error); throw Errors.badRequest(error.message || 'Failed to create SSO assignment mapping'); }
  }));
  router.post('/api/authz/sso-assignment-mappings/:id/migrate-provider-neutral', apiLimiter, requireAuth, requirePlatformAction('platform.sso.engine-assignments.manage'), validateParams(idParamSchema), validateBody(providerNeutralMigrationSchema), asyncHandler(async (req, res) => {
    const result = await ssoAssignmentMappingService.migrateToProviderNeutral(String(req.params.id), { ...req.body, createdById: req.user!.userId });
    await logAudit({ action: 'authz.sso_engine_assignment_mapping.provider_neutral_migration', userId: req.user!.userId, resourceType: 'sso_assignment_mapping', resourceId: result.legacyMappingId, details: { providerKey: result.providerKey, identityMappingId: result.identityMapping.id, assignmentId: result.assignment.id, created: result.created } });
    res.status(result.created ? 201 : 200).json(result);
  }));
  router.put('/api/authz/sso-assignment-mappings/:id', apiLimiter, requireAuth, requirePlatformAction('platform.sso.engine-assignments.manage'), validateParams(idParamSchema), validateBody(mappingUpdateSchema), asyncHandler(async (req, res) => {
    try { await ssoAssignmentMappingService.updateMapping(String(req.params.id), { ...req.body, tenantId: req.tenant?.tenantId || null, actorUserId: req.user!.userId }); res.json({ success: true }); }
    catch (error: any) { if (error.statusCode) throw error; logger.error('Update SSO assignment mapping error:', error); throw Errors.badRequest(error.message || 'Failed to update SSO assignment mapping'); }
  }));
  router.delete('/api/authz/sso-assignment-mappings/:id', apiLimiter, requireAuth, requirePlatformAction('platform.sso.engine-assignments.manage'), validateParams(idParamSchema), asyncHandler(async (req, res) => {
    try { await ssoAssignmentMappingService.deleteMapping(String(req.params.id), req.user!.userId); res.status(204).send(); }
    catch (error: any) { if (error.statusCode) throw error; logger.error('Delete SSO assignment mapping error:', error); throw Errors.internal('Failed to delete SSO assignment mapping'); }
  }));
  router.post('/api/authz/sso-assignment-mappings/test', apiLimiter, requireAuth, requirePlatformAction('platform.sso.engine-assignments.manage'), validateBody(mappingTestSchema), asyncHandler(async (req, res) => {
    try { res.json(await ssoAssignmentMappingService.testClaims(req.body.claims, req.body.providerId, req.tenant?.tenantId || null)); }
    catch (error: any) { if (error.statusCode) throw error; logger.error('Test SSO assignment mapping error:', error); throw Errors.internal('Failed to test SSO assignment mapping'); }
  }));
  router.get('/api/authz/sso-engine-access-snapshots', apiLimiter, requireAuth, requirePlatformAction('platform.sso.engine-assignments.read'), validateQuery(snapshotQuerySchema), asyncHandler(async (req, res) => {
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
  router.post('/api/engines/:engineId/access/transition-cleanup', apiLimiter, requireAuth, requirePlatformAction('platform.sso.engine-assignments.manage'), validateParams(engineIdParamSchema), validateBody(cleanupSchema), asyncHandler(async (req, res) => {
    try { res.json(await ssoEngineAccessSnapshotService.applyTransitionCleanup(String(req.params.engineId), req.body.assignmentIds, req.user!.userId, req.tenant?.tenantId || null, req.body.previewCorrelationId)); }
    catch (error: any) { if (error.statusCode) throw error; logger.error('Apply engine access transition cleanup error:', error); throw Errors.badRequest(error.message || 'Failed to apply engine access transition cleanup'); }
  }));
}

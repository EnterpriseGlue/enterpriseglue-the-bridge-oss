/**
 * Platform Authorization API Routes
 *
 * Provides authorization check endpoint and policy management for admins.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { z } from 'zod';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { RuntimeResource } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResource.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { requireAction } from '@enterpriseglue/shared/middleware/requireAction.js';
import { requireApiClientAction } from '@enterpriseglue/shared/middleware/apiClientAuth.js';
import { validateBody, validateParams, validateQuery } from '@enterpriseglue/shared/middleware/validate.js';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import {
  policyService,
  ssoAssignmentMappingService,
  ssoEngineAccessSnapshotService,
  ssoGroupMappingService,
  legacyMappingCoverageService,
  permissionService,
  API_CLIENT_TOKEN_PREFIX,
  ApiClientScopes,
  AllPermissions,
  Permission,
  EvaluationContext,
} from '@enterpriseglue/shared/services/platform-admin/index.js';
import { AUTHZ_RESOURCE_TYPES } from '@enterpriseglue/shared/authz/permission-actions.js';
import { logAudit } from '@enterpriseglue/shared/services/audit.js';
import { registerConfigBundleRoutes } from './authz/config-bundles.js';
import { registerEngineSetRoutes } from './authz/engine-sets.js';
import { registerMachineRoutes } from './authz/machines.js';
import { registerPolicyRoutes } from './authz/policies.js';
import { registerRoleRoutes } from './authz/roles.js';
import { registerAssignmentRoutes } from './authz/assignments.js';
import { registerProjectEngineTargetRoutes } from './authz/project-engine-targets.js';
import { registerAuditRoutes } from './authz/audit.js';
import { registerExternalEngineRoutes } from './authz/external-engines.js';
import { registerExternalEngineSystemRoutes } from './authz/external-engine-systems.js';
import { registerSsoSyncDiagnosticsRoutes } from './authz/sso-sync-diagnostics.js';
import { registerSsoPlatformMappingRoutes } from './authz/sso-platform-mappings.js';

// Validation schemas
const authzResourceTypeSchema = z.enum(AUTHZ_RESOURCE_TYPES);

const authzCheckSchema = z.object({
  action: z.string().min(1),
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
  userAttributes: z.record(z.string(), z.unknown()).optional(),
  resourceAttributes: z.record(z.string(), z.unknown()).optional(),
});

const authzCheckBatchSchema = z.object({
  checks: z.array(authzCheckSchema).min(1),
});
const legacyMappingCoverageVerificationSchema = z.object({ family: z.enum(['platform_role', 'group', 'engine_assignment']), candidateIdentityMappingId: z.string().min(1), note: z.string().min(3).max(2000) });
const legacyMappingRetirementSchema = z.object({ confirmation: z.literal('RETIRE_LEGACY_MAPPINGS') });
const globalLegacyMappingRetirementSchema = z.object({ confirmation: z.literal('RETIRE_GLOBAL_LEGACY_MAPPINGS') });
const idParamSchema = z.object({ id: z.string().uuid() });

const authzEvaluateSchema = z.object({
  userId: z.string().uuid(),
  permission: z.string().min(1),
  resourceType: authzResourceTypeSchema.optional(),
  resourceId: z.string().optional(),
  runtimeResource: z.object({
    engineId: z.string().min(1),
    resourceKind: z.enum(['process_definition', 'decision_definition']),
    resourceKey: z.string().min(1),
    runtimeTenantId: z.string().max(255).optional(),
  }).optional(),
}).superRefine((value, ctx) => {
  if (value.runtimeResource && value.resourceType !== 'engine_runtime_resource') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['runtimeResource'], message: 'Runtime resource selector requires resourceType engine_runtime_resource' });
  }
  if (value.resourceType === 'engine_runtime_resource' && !value.resourceId && !value.runtimeResource) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['runtimeResource'], message: 'Runtime resource ID or selector is required' });
  }
});

const ssoAssignmentMappingCreateSchema = z.object({
  providerId: z.string().min(1).nullable().optional(),
  claimType: z.enum(['group', 'role', 'email_domain', 'custom']),
  claimKey: z.string().min(1),
  claimValue: z.string().optional().default(''),
  claimOperator: z.enum([
    'equals',
    'not_equals',
    'contains',
    'not_contains',
    'contains_any',
    'not_contains_any',
    'contains_all',
    'not_contains_all',
    'matches_regex',
    'not_matches_regex',
    'exists',
    'not_exists',
  ]).nullable().optional(),
  targetSelectorType: z.enum(['engine_id', 'all_engines', 'external_engine_id', 'engine_label']),
  targetEngineId: z.string().min(1).nullable().optional(),
  targetExternalEngineId: z.string().min(1).nullable().optional(),
  targetLabelKey: z.string().min(1).nullable().optional(),
  targetLabelValue: z.string().min(1).nullable().optional(),
  targetRoleId: z.string().min(1),
  syncMode: z.enum(['authoritative', 'additive']).optional(),
  priority: z.number().int().optional(),
  isActive: z.boolean().optional(),
  riskAcknowledged: z.boolean().optional(),
});

const ssoAssignmentMappingUpdateSchema = ssoAssignmentMappingCreateSchema.partial();
const ssoAssignmentMappingProviderNeutralMigrationSchema = z.object({
  providerKey: z.string().min(1).max(128),
  targetGroupKey: z.string().min(1).max(160).optional(),
  newGroup: z.object({ key: z.string().min(1).max(255), name: z.string().min(1).max(255), description: z.string().max(2000).nullable().optional() }).optional(),
}).refine((value) => Boolean(value.targetGroupKey) !== Boolean(value.newGroup), { message: 'Provide exactly one of targetGroupKey or newGroup' });

const ssoAssignmentMappingTestSchema = z.object({
  claims: z.record(z.string(), z.unknown()),
  providerId: z.string().min(1).optional(),
});

const ssoGroupMappingCreateSchema = z.object({
  providerId: z.string().min(1).nullable().optional(),
  claimType: z.enum(['group', 'role', 'email_domain', 'custom']),
  claimKey: z.string().min(1),
  claimValue: z.string().optional().default(''),
  claimOperator: z.enum([
    'equals',
    'not_equals',
    'contains',
    'not_contains',
    'contains_any',
    'not_contains_any',
    'contains_all',
    'not_contains_all',
    'matches_regex',
    'not_matches_regex',
    'exists',
    'not_exists',
  ]).nullable().optional(),
  targetGroupId: z.string().min(1),
  syncMode: z.enum(['authoritative', 'additive']).optional(),
  priority: z.number().int().optional(),
  isActive: z.boolean().optional(),
  riskAcknowledged: z.boolean().optional(),
});

const ssoGroupMappingUpdateSchema = ssoGroupMappingCreateSchema.partial();

const ssoGroupMappingTestSchema = z.object({
  claims: z.record(z.string(), z.unknown()),
  providerId: z.string().min(1).optional(),
});
const ssoGroupMappingProviderNeutralMigrationSchema = z.object({ providerKey: z.string().min(1).max(128) });

const ssoEngineAccessSnapshotQuerySchema = z.object({
  providerId: z.string().min(1).optional(),
  mappingId: z.string().min(1).optional(),
  principalType: z.string().min(1).optional(),
  principalId: z.string().min(1).optional(),
  engineId: z.string().min(1).optional(),
  status: z.enum([
    'active',
    'stale',
    'removed_by_sso',
    'removed_by_admin',
    'mapping_disabled',
    'provider_identity_missing',
    'provider_group_missing',
    'engine_no_longer_matches_selector',
  ]).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const engineIdParamSchema = z.object({ engineId: z.string().min(1) });

const transitionCleanupApplySchema = z.object({
  previewCorrelationId: z.string().min(1).optional(),
  assignmentIds: z.array(z.string().min(1)).min(1),
});

const router = Router();

function requirePlatformAction(actionId: string) {
  return requireAction(actionId, { resourceResolver: 'platform.self' });
}

function hasApiClientBearerToken(req: Request): boolean {
  const authorization = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  return authorization.startsWith(`Bearer ${API_CLIENT_TOKEN_PREFIX}_`);
}

/**
 * Config bundles can be changed by an interactive platform administrator or
 * by an explicitly scoped API client that also holds the matching RBAC action.
 */
function requireConfigBundleAccess(req: Request, res: Response, next: NextFunction) {
  if (hasApiClientBearerToken(req)) {
    return requireApiClientAction(
      ApiClientScopes.CONFIG_BUNDLE_MANAGE,
      'platform.authz.roles.manage',
    )(req, res, next);
  }

  return requireAuth(req, res, (error?: unknown) => {
    if (error) return next(error);
    return requirePlatformAction('platform.authz.roles.manage')(req, res, next);
  });
}

function bundleRequestsTargetOwnershipTransfer(value: unknown): boolean {
  const files = (value as { files?: unknown } | null)?.files;
  const targets = files && typeof files === 'object'
    ? (files as Record<string, { projectEngineTargets?: unknown }> )['./project-engine-targets.json']?.projectEngineTargets
    : null;
  return Array.isArray(targets) && targets.some((target) => Boolean((target as { transferOwnership?: unknown } | null)?.transferOwnership));
}

/** A config apply may manage many object types, but target ownership transfer
 * additionally changes the deployment authority boundary for an existing pair. */
function requireTargetTransferAccess(req: Request, res: Response, next: NextFunction) {
  if (!bundleRequestsTargetOwnershipTransfer(req.body)) return next();
  if (hasApiClientBearerToken(req)) {
    return requireApiClientAction(
      ApiClientScopes.CONFIG_BUNDLE_MANAGE,
      'platform.project-engine-targets.manage',
    )(req, res, next);
  }
  return requirePlatformAction('platform.project-engine-targets.manage')(req, res, next);
}

// ============================================================================
// Authorization Check Endpoint
// ============================================================================

/**
 * POST /api/platform-admin/authz/check
 * Check if a user has permission to perform an action on a resource.
 * Returns the decision and the reason.
 */
router.post('/api/authz/check', apiLimiter, requireAuth, validateBody(authzCheckSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const { action, resourceType, resourceId, userAttributes, resourceAttributes } = req.body;

    const context: EvaluationContext = {
      userId: req.user!.userId,
      tenantId: req.tenant?.tenantId || null,
      resourceType,
      resourceId,
      userAttributes,
      resourceAttributes,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      timestamp: Date.now(),
    };

    const result = await policyService.evaluateAndLog(action as Permission, context);

    res.json({
      allowed: result.decision === 'allow',
      decision: result.decision,
      reason: result.reason,
      policyId: result.policyId,
      policyName: result.policyName,
    });
  } catch (error: any) {
    logger.error('Authorization check error:', error);
    throw Errors.internal('Authorization check failed');
  }
}));

/**
 * POST /api/platform-admin/authz/check-batch
 * Check multiple permissions at once.
 */
router.post('/api/authz/check-batch', apiLimiter, requireAuth, validateBody(authzCheckBatchSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const { checks } = req.body;

    const results = await Promise.all(
      checks.map(async (check: any) => {
        const context: EvaluationContext = {
          userId: req.user!.userId,
          tenantId: req.tenant?.tenantId || null,
          resourceType: check.resourceType,
          resourceId: check.resourceId,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          timestamp: Date.now(),
        };

        const result = await policyService.evaluate(check.action as Permission, context);

        return {
          action: check.action,
          resourceType: check.resourceType,
          resourceId: check.resourceId,
          allowed: result.decision === 'allow',
          reason: result.reason,
        };
      })
    );

    res.json({ results });
  } catch (error: any) {
    logger.error('Batch authorization check error:', error);
    throw Errors.internal('Authorization check failed');
  }
}));

/**
 * GET /api/platform-admin/authz/me/permissions
 * Return the current user's effective platform, project, and engine permissions.
 */
router.get('/api/authz/me/permissions', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  try {
    const snapshot = await permissionService.getCurrentUserPermissions(req.user!.userId, req.tenant?.tenantId || null);
    res.json(snapshot);
  } catch (error: any) {
    logger.error('Get current user permissions error:', error);
    throw Errors.internal('Failed to get current user permissions');
  }
}));

/**
 * POST /api/platform-admin/authz/evaluate
 * Explain effective access for a user/resource/permission.
 */
router.post('/api/authz/evaluate', apiLimiter, requireAuth, requirePlatformAction('platform.authz.evaluate'), validateBody(authzEvaluateSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const { userId, permission, resourceType, resourceId, runtimeResource } = req.body;
    if (!new Set<string>(Object.values(AllPermissions)).has(permission)) {
      throw Errors.validation('Unknown permission');
    }

    let resolvedResourceId = resourceId;
    let resolvedRuntimeResource: Record<string, string> | undefined;
    if (runtimeResource) {
      const runtime = await (await getDataSource()).getRepository(RuntimeResource).findOne({
        where: {
          engineId: runtimeResource.engineId,
          resourceKind: runtimeResource.resourceKind,
          resourceKey: runtimeResource.resourceKey,
          runtimeTenantId: runtimeResource.runtimeTenantId || '',
          isActive: true,
        },
      });
      if (!runtime || (runtime.tenantId || null) !== (req.tenant?.tenantId || null)) {
        throw Errors.notFound('Runtime resource');
      }
      resolvedResourceId = runtime.id;
      resolvedRuntimeResource = {
        id: runtime.id,
        engineId: runtime.engineId,
        resourceKind: runtime.resourceKind,
        resourceKey: runtime.resourceKey,
        runtimeTenantId: runtime.runtimeTenantId,
      };
    }

    const context: EvaluationContext = {
      userId,
      tenantId: req.tenant?.tenantId || null,
      resourceType,
      resourceId: resolvedResourceId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      timestamp: Date.now(),
    };

    const base = await permissionService.evaluatePermission(permission as Permission, context);
    const policy = await policyService.evaluate(permission as Permission, context);

    res.json({
      allowed: policy.decision === 'allow',
      decision: policy.decision,
      reason: policy.reason,
      policyId: policy.policyId,
      policyName: policy.policyName,
      baseAllowed: base.allowed,
      baseReason: base.reason,
      resolvedRuntimeResource,
      sources: base.sources,
    });
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Evaluate effective access error:', error);
    throw Errors.internal('Failed to evaluate access');
  }
}));

registerConfigBundleRoutes(router, { requireConfigBundleAccess, requireTargetTransferAccess });

registerMachineRoutes(router, { requirePlatformAction });

registerRoleRoutes(router, { requirePlatformAction });

registerAssignmentRoutes(router, { requirePlatformAction });

// ============================================================================
// External Engine Registration Inventory (Admin Only)
// ============================================================================

registerExternalEngineSystemRoutes(router, { requirePlatformAction });

registerExternalEngineRoutes(router, { requirePlatformAction });

registerEngineSetRoutes(router, { requirePlatformAction });

registerProjectEngineTargetRoutes(router, { requirePlatformAction });

registerPolicyRoutes(router, { requirePlatformAction });

// ============================================================================
// SSO Claims Mapping Management (Admin Only)
// ============================================================================

/**
 * GET /api/platform-admin/authz/sso-mappings
 * List all SSO claims mappings.
 */
registerSsoPlatformMappingRoutes(router, { requirePlatformAction });

// ============================================================================
// SSO Engine Assignment Mapping Management (Admin Only)
// ============================================================================

router.get('/api/authz/sso-assignment-mappings', apiLimiter, requireAuth, requirePlatformAction('platform.sso.engine-assignments.read'), asyncHandler(async (req: Request, res: Response) => {
  try {
    const mappings = await ssoAssignmentMappingService.getAllMappings(req.tenant?.tenantId || null);
    res.json(mappings);
  } catch (error: any) {
    logger.error('Get SSO assignment mappings error:', error);
    throw Errors.internal('Failed to get SSO assignment mappings');
  }
}));

router.get('/api/authz/legacy-mapping-coverage', apiLimiter, requireAuth, requirePlatformAction('platform.sso.group-mappings.read'), asyncHandler(async (req: Request, res: Response) => {
  res.json(await legacyMappingCoverageService.getCoverage(req.tenant?.tenantId || null));
}));

router.get('/api/authz/legacy-mapping-retirement-readiness', apiLimiter, requireAuth, requirePlatformAction('platform.sso.group-mappings.read'), asyncHandler(async (req: Request, res: Response) => {
  res.json(await legacyMappingCoverageService.getRetirementReadiness(req.tenant?.tenantId || null));
}));

router.post('/api/authz/legacy-mapping-coverage/:id/verify', apiLimiter, requireAuth, requirePlatformAction('platform.sso.group-mappings.manage'), validateParams(idParamSchema), validateBody(legacyMappingCoverageVerificationSchema), asyncHandler(async (req: Request, res: Response) => {
  await legacyMappingCoverageService.verifyReplacement({ tenantId: req.tenant?.tenantId || null, legacyMappingId: String(req.params.id), actorId: req.user!.userId, ...req.body });
  res.status(204).send();
}));

router.post('/api/authz/legacy-mapping-retirement/disable', apiLimiter, requireAuth, requirePlatformAction('platform.sso.group-mappings.manage'), validateBody(legacyMappingRetirementSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json(await legacyMappingCoverageService.retireLegacyMappings(req.tenant?.tenantId || null, req.user!.userId));
}));

router.post('/api/authz/legacy-mapping-retirement/disable-global', apiLimiter, requireAuth, requirePlatformAction('platform.sso.group-mappings.manage'), requirePlatformAction('platform.sso.platform-role-mappings.manage'), validateBody(globalLegacyMappingRetirementSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json(await legacyMappingCoverageService.retireLegacyMappings(null, req.user!.userId));
}));

router.post('/api/authz/sso-assignment-mappings', apiLimiter, requireAuth, requirePlatformAction('platform.sso.engine-assignments.manage'), validateBody(ssoAssignmentMappingCreateSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const result = await ssoAssignmentMappingService.createMapping({
      ...req.body,
      tenantId: req.tenant?.tenantId || null,
      actorUserId: req.user!.userId,
    });
    res.status(201).json(result);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Create SSO assignment mapping error:', error);
    throw Errors.badRequest(error.message || 'Failed to create SSO assignment mapping');
  }
}));

router.post('/api/authz/sso-assignment-mappings/:id/migrate-provider-neutral', apiLimiter, requireAuth, requirePlatformAction('platform.sso.engine-assignments.manage'), validateParams(idParamSchema), validateBody(ssoAssignmentMappingProviderNeutralMigrationSchema), asyncHandler(async (req: Request, res: Response) => {
  const result = await ssoAssignmentMappingService.migrateToProviderNeutral(String(req.params.id), { ...req.body, createdById: req.user!.userId });
  await logAudit({ action: 'authz.sso_engine_assignment_mapping.provider_neutral_migration', userId: req.user!.userId, resourceType: 'sso_assignment_mapping', resourceId: result.legacyMappingId, details: { providerKey: result.providerKey, identityMappingId: result.identityMapping.id, assignmentId: result.assignment.id, created: result.created } });
  res.status(result.created ? 201 : 200).json(result);
}));

router.put('/api/authz/sso-assignment-mappings/:id', apiLimiter, requireAuth, requirePlatformAction('platform.sso.engine-assignments.manage'), validateParams(idParamSchema), validateBody(ssoAssignmentMappingUpdateSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    await ssoAssignmentMappingService.updateMapping(String(req.params.id), {
      ...req.body,
      tenantId: req.tenant?.tenantId || null,
      actorUserId: req.user!.userId,
    });
    res.json({ success: true });
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Update SSO assignment mapping error:', error);
    throw Errors.badRequest(error.message || 'Failed to update SSO assignment mapping');
  }
}));

router.delete('/api/authz/sso-assignment-mappings/:id', apiLimiter, requireAuth, requirePlatformAction('platform.sso.engine-assignments.manage'), validateParams(idParamSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    await ssoAssignmentMappingService.deleteMapping(String(req.params.id), req.user!.userId);
    res.status(204).send();
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Delete SSO assignment mapping error:', error);
    throw Errors.internal('Failed to delete SSO assignment mapping');
  }
}));

router.post('/api/authz/sso-assignment-mappings/test', apiLimiter, requireAuth, requirePlatformAction('platform.sso.engine-assignments.manage'), validateBody(ssoAssignmentMappingTestSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const { claims, providerId } = req.body;
    const result = await ssoAssignmentMappingService.testClaims(claims, providerId, req.tenant?.tenantId || null);
    res.json(result);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Test SSO assignment mapping error:', error);
    throw Errors.internal('Failed to test SSO assignment mapping');
  }
}));

router.get('/api/authz/sso-engine-access-snapshots', apiLimiter, requireAuth, requirePlatformAction('platform.sso.engine-assignments.read'), validateQuery(ssoEngineAccessSnapshotQuerySchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const snapshots = await ssoEngineAccessSnapshotService.listSnapshots({
      tenantId: req.tenant?.tenantId || null,
      providerId: req.query.providerId as string | undefined,
      mappingId: req.query.mappingId as string | undefined,
      principalType: req.query.principalType as string | undefined,
      principalId: req.query.principalId as string | undefined,
      engineId: req.query.engineId as string | undefined,
      status: req.query.status as any,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json(snapshots);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('List SSO engine access snapshots error:', error);
    throw Errors.internal('Failed to list SSO engine access snapshots');
  }
}));

router.get('/api/authz/sso-engine-access-snapshots/:engineId', apiLimiter, requireAuth, requirePlatformAction('platform.sso.engine-assignments.read'), validateParams(engineIdParamSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const snapshots = await ssoEngineAccessSnapshotService.listSnapshotsForEngine(String(req.params.engineId), req.tenant?.tenantId || null);
    res.json(snapshots);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('List engine SSO access snapshots error:', error);
    throw Errors.internal('Failed to list engine SSO access snapshots');
  }
}));

router.post('/api/engines/:engineId/access/transition-cleanup-preview', apiLimiter, requireAuth, requirePlatformAction('platform.sso.engine-assignments.manage'), validateParams(engineIdParamSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const preview = await ssoEngineAccessSnapshotService.previewTransitionCleanup(String(req.params.engineId), req.tenant?.tenantId || null);
    res.json(preview);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Preview engine access transition cleanup error:', error);
    throw Errors.badRequest(error.message || 'Failed to preview engine access transition cleanup');
  }
}));

router.post('/api/engines/:engineId/access/transition-cleanup', apiLimiter, requireAuth, requirePlatformAction('platform.sso.engine-assignments.manage'), validateParams(engineIdParamSchema), validateBody(transitionCleanupApplySchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const result = await ssoEngineAccessSnapshotService.applyTransitionCleanup(
      String(req.params.engineId),
      req.body.assignmentIds,
      req.user!.userId,
      req.tenant?.tenantId || null,
      req.body.previewCorrelationId
    );
    res.json(result);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Apply engine access transition cleanup error:', error);
    throw Errors.badRequest(error.message || 'Failed to apply engine access transition cleanup');
  }
}));

// ============================================================================
// SSO Group Mapping Management (Admin Only)
// ============================================================================

router.get('/api/authz/sso-group-mappings', apiLimiter, requireAuth, requirePlatformAction('platform.sso.group-mappings.read'), asyncHandler(async (req: Request, res: Response) => {
  try {
    const mappings = await ssoGroupMappingService.getAllMappings(req.tenant?.tenantId || null);
    res.json(mappings);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Get SSO group mappings error:', error);
    throw Errors.internal('Failed to get SSO group mappings');
  }
}));

router.post('/api/authz/sso-group-mappings', apiLimiter, requireAuth, requirePlatformAction('platform.sso.group-mappings.manage'), validateBody(ssoGroupMappingCreateSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const result = await ssoGroupMappingService.createMapping({
      ...req.body,
      tenantId: req.tenant?.tenantId || null,
    });
    res.status(201).json(result);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Create SSO group mapping error:', error);
    throw Errors.badRequest(error.message || 'Failed to create SSO group mapping');
  }
}));

router.post('/api/authz/sso-group-mappings/:id/migrate-provider-neutral', apiLimiter, requireAuth, requirePlatformAction('platform.sso.group-mappings.manage'), validateParams(idParamSchema), validateBody(ssoGroupMappingProviderNeutralMigrationSchema), asyncHandler(async (req: Request, res: Response) => {
  const result = await ssoGroupMappingService.migrateToProviderNeutral(String(req.params.id), req.body.providerKey, req.tenant?.tenantId || null);
  await logAudit({
    action: 'authz.sso_group_mapping.provider_neutral_migration',
    userId: req.user!.userId,
    resourceType: 'sso_group_mapping',
    resourceId: result.legacyMappingId,
    details: { providerKey: result.providerKey, identityMappingId: result.identityMapping.id, created: result.created },
  });
  res.status(result.created ? 201 : 200).json(result);
}));

router.put('/api/authz/sso-group-mappings/:id', apiLimiter, requireAuth, requirePlatformAction('platform.sso.group-mappings.manage'), validateParams(idParamSchema), validateBody(ssoGroupMappingUpdateSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    await ssoGroupMappingService.updateMapping(String(req.params.id), {
      ...req.body,
      tenantId: req.tenant?.tenantId || null,
    });
    res.json({ success: true });
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Update SSO group mapping error:', error);
    throw Errors.badRequest(error.message || 'Failed to update SSO group mapping');
  }
}));

router.delete('/api/authz/sso-group-mappings/:id', apiLimiter, requireAuth, requirePlatformAction('platform.sso.group-mappings.manage'), validateParams(idParamSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    await ssoGroupMappingService.deleteMapping(String(req.params.id));
    res.status(204).send();
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Delete SSO group mapping error:', error);
    throw Errors.internal('Failed to delete SSO group mapping');
  }
}));

router.post('/api/authz/sso-group-mappings/test', apiLimiter, requireAuth, requirePlatformAction('platform.sso.group-mappings.manage'), validateBody(ssoGroupMappingTestSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const { claims, providerId } = req.body;
    const result = await ssoGroupMappingService.testClaims(claims, providerId, req.tenant?.tenantId || null);
    res.json(result);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Test SSO group mapping error:', error);
    throw Errors.internal('Failed to test SSO group mapping');
  }
}));

// ============================================================================
// SSO Sync Diagnostics (Admin Only)
// ============================================================================

registerSsoSyncDiagnosticsRoutes(router, { requirePlatformAction });

registerAuditRoutes(router, { requirePlatformAction });

export default router;

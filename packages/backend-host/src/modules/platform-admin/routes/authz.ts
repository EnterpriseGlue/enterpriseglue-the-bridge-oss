/**
 * Platform Authorization API Routes
 *
 * Provides authorization check endpoint and policy management for admins.
 */

import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { z } from 'zod';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { RuntimeResource } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResource.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { In } from 'typeorm';
import {
  OSS_DEFAULT_TENANT_ID,
  normalizeTenantIdForPersistence,
  tenantIdsForAuthz,
} from '@enterpriseglue/shared/authz/tenant-scope.js';
import { isPermissionCompatibleWithResourceType } from '@enterpriseglue/shared/authz/permission-actions.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { requireAction } from '@enterpriseglue/shared/middleware/requireAction.js';
import { requireApiClientAction } from '@enterpriseglue/shared/middleware/apiClientAuth.js';
import { validateBody, validateParams, validateQuery } from '@enterpriseglue/shared/middleware/validate.js';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import {
  policyService,
  permissionService,
  API_CLIENT_TOKEN_PREFIX,
  ApiClientScopes,
  Permission,
  EvaluationContext,
} from '@enterpriseglue/shared/services/platform-admin/index.js';
import { platformSettingsService } from '@enterpriseglue/shared/services/platform-admin/PlatformSettingsService.js';
import { calculateCurrentUserActionAvailability } from '@enterpriseglue/shared/services/platform-admin/ActionAvailabilityService.js';
import {
  AuthzCheckBatchRequestSchema,
  AuthzCheckRequestSchema,
  CurrentUserPermissionsSchema,
  EffectiveAccessEvaluateRequestSchema,
} from '@enterpriseglue/shared/schemas/platform-admin/authz.js';
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

// Validation schemas
const idParamSchema = z.object({ id: z.string().uuid() });

const router = Router();

function effectiveTenantId(req: Request): string {
  return normalizeTenantIdForPersistence(req.tenant?.tenantId) || OSS_DEFAULT_TENANT_ID;
}

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
function requireConfigBundleAccess(actionId: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (hasApiClientBearerToken(req)) {
      return requireApiClientAction(ApiClientScopes.CONFIG_BUNDLE_MANAGE, actionId)(req, res, next);
    }

    return requireAuth(req, res, (error?: unknown) => {
      if (error) return next(error);
      return requirePlatformAction(actionId)(req, res, next);
    });
  };
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
router.post('/api/authz/check', apiLimiter, requireAuth, validateBody(AuthzCheckRequestSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const { action, resourceType, resourceId, userAttributes, resourceAttributes } = req.body;
    const tenantId = effectiveTenantId(req);

    const context: EvaluationContext = {
      userId: req.user!.userId,
      tenantId,
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
router.post('/api/authz/check-batch', apiLimiter, requireAuth, validateBody(AuthzCheckBatchRequestSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const { checks } = req.body;
    const tenantId = effectiveTenantId(req);

    const results = await Promise.all(
      checks.map(async (check: any) => {
        const context: EvaluationContext = {
          userId: req.user!.userId,
          tenantId,
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
    const tenantId = effectiveTenantId(req);
    const snapshot = await permissionService.getCurrentUserPermissions(req.user!.userId, tenantId);
    const [settings, engines] = await Promise.all([
      platformSettingsService.get(),
      snapshot.engines.length > 0
        ? (await getDataSource()).getRepository(Engine).find({
            where: { id: In(snapshot.engines.map(({ resourceId }) => resourceId)) },
            select: {
              id: true,
              registrationSource: true,
              sourceRef: true,
              ownershipMode: true,
              lifecycleStatus: true,
            },
          })
        : Promise.resolve([]),
    ]);
    const availability = calculateCurrentUserActionAvailability(snapshot, settings, engines);
    const projectAvailability = new Map(availability.projects.map((item) => [item.resourceId, item.actionAvailability]));
    const engineAvailability = new Map(availability.engines.map((item) => [item.resourceId, item.actionAvailability]));
    // Runtime-resource visibility is resolved server-side per request. Keep
    // this client snapshot deliberately coarse so process/decision keys and
    // tenant lineage cannot become a second authorization authority.
    res.json(CurrentUserPermissionsSchema.parse({
      userId: snapshot.userId,
      // Preserve the request-derived session context in the browser contract.
      // OSS may evaluate an unscoped API request against its implicit default
      // tenant, but that must not rewrite the session from null to an explicit
      // tenant and invalidate the principal-bound frontend snapshot.
      tenantId: req.tenant?.tenantId || null,
      platform: snapshot.platform,
      platformActionAvailability: availability.platformActionAvailability,
      projects: snapshot.projects.map(({ resourceId, permissions }) => ({
        resourceId,
        permissions,
        actionAvailability: projectAvailability.get(resourceId),
      })),
      engines: snapshot.engines.map(({ resourceId, permissions, runtimePermissions }) => ({
        resourceId,
        permissions,
        runtimePermissions,
        actionAvailability: engineAvailability.get(resourceId),
      })),
      authorizationVersion: `${snapshot.authorizationVersion}:actions:${availability.version}`,
      generatedAt: snapshot.generatedAt,
    }));
  } catch (error: any) {
    logger.error('Get current user permissions error:', error);
    throw Errors.internal('Failed to get current user permissions');
  }
}));

/**
 * POST /api/platform-admin/authz/evaluate
 * Explain effective access for a user/resource/permission.
 */
router.post('/api/authz/evaluate', apiLimiter, requireAuth, requirePlatformAction('platform.authz.evaluate'), validateBody(EffectiveAccessEvaluateRequestSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const { userId, permission, resourceType, resourceId, runtimeResource } = req.body;
    const tenantId = effectiveTenantId(req);
    const permissionDefinition = (await permissionService.getPermissionCatalog())
      .find((candidate) => candidate.key === permission);
    if (!permissionDefinition) {
      throw Errors.validation('Unknown permission');
    }
    if (!isPermissionCompatibleWithResourceType(permissionDefinition, resourceType)) {
      throw Errors.validation(`Permission ${permission} is not compatible with resource type ${resourceType}`);
    }

    let resolvedResourceId = resourceId;
    let resolvedRuntimeResource: Record<string, unknown> | undefined;
    if (resourceType === 'engine_runtime_resource') {
      if (!runtimeResource && !resourceId) {
        throw Errors.validation('Runtime resource ID or selector is required');
      }
      const visibleTenantIds = tenantIdsForAuthz(tenantId);
      const where = runtimeResource
        ? visibleTenantIds.map((visibleTenantId) => ({
            engineId: runtimeResource.engineId,
            resourceKind: runtimeResource.resourceKind,
            resourceKey: runtimeResource.resourceKey,
            runtimeTenantId: runtimeResource.runtimeTenantId || '',
            isActive: true,
            tenantId: visibleTenantId,
            tenantResolutionStatus: 'resolved' as const,
          }))
        : visibleTenantIds.map((visibleTenantId) => ({
            id: resourceId!,
            isActive: true,
            tenantId: visibleTenantId,
            tenantResolutionStatus: 'resolved' as const,
          }));
      const runtime = await (await getDataSource()).getRepository(RuntimeResource).findOne({
        where,
      });
      if (!runtime) {
        throw Errors.notFound('Runtime resource');
      }
      resolvedResourceId = runtime.id;
      resolvedRuntimeResource = {
        id: runtime.id,
        engineId: runtime.engineId,
        resourceKind: runtime.resourceKind,
        resourceKey: runtime.resourceKey,
        runtimeTenantId: runtime.runtimeTenantId,
        tenantId: runtime.tenantId!,
        tenantResolutionStatus: 'resolved',
        tenantMappingId: runtime.tenantMappingId,
        tenantMappingVersion: Number(runtime.tenantMappingVersion || 0),
      };
    }

    const context: EvaluationContext = {
      userId,
      tenantId,
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

registerEngineSetRoutes(router, { requirePlatformAction, effectiveTenantId });

registerProjectEngineTargetRoutes(router, { requirePlatformAction });

registerPolicyRoutes(router, { requirePlatformAction });


// ============================================================================
// SSO Sync Diagnostics (Admin Only)
// ============================================================================

registerSsoSyncDiagnosticsRoutes(router, { requirePlatformAction });

registerAuditRoutes(router, { requirePlatformAction });

export default router;

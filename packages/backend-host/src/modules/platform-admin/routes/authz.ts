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
  AllPermissions,
  Permission,
  EvaluationContext,
} from '@enterpriseglue/shared/services/platform-admin/index.js';
import { EffectiveAccessEvaluateRequestSchema } from '@enterpriseglue/shared/schemas/platform-admin/authz.js';
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
import { registerSsoEngineAssignmentRoutes } from './authz/sso-engine-assignments.js';
import { registerSsoGroupMappingRoutes } from './authz/sso-group-mappings.js';

// Validation schemas
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
const idParamSchema = z.object({ id: z.string().uuid() });

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
    // Runtime-resource visibility is resolved server-side per request. Keep
    // this client snapshot deliberately coarse so process/decision keys and
    // tenant lineage cannot become a second authorization authority.
    res.json({
      userId: snapshot.userId,
      platform: snapshot.platform,
      projects: snapshot.projects.map(({ resourceId, permissions }) => ({ resourceId, permissions })),
      engines: snapshot.engines.map(({ resourceId, permissions }) => ({ resourceId, permissions })),
      authorizationVersion: snapshot.authorizationVersion,
      generatedAt: snapshot.generatedAt,
    });
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

registerSsoEngineAssignmentRoutes(router, { requirePlatformAction });

// ============================================================================
// SSO Group Mapping Management (Admin Only)
// ============================================================================

registerSsoGroupMappingRoutes(router, { requirePlatformAction });

// ============================================================================
// SSO Sync Diagnostics (Admin Only)
// ============================================================================

registerSsoSyncDiagnosticsRoutes(router, { requirePlatformAction });

registerAuditRoutes(router, { requirePlatformAction });

export default router;

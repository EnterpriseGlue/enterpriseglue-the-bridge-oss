/**
 * Platform Authorization API Routes
 * 
 * Provides authorization check endpoint and policy management for admins.
 */

import { Router, Request, Response } from 'express';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { z } from 'zod';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { validateBody, validateParams, validateQuery } from '@enterpriseglue/shared/middleware/validate.js';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { 
  policyService, 
  ssoClaimsMappingService,
  Permission,
  EvaluationContext,
} from '@enterpriseglue/shared/services/platform-admin/index.js';
import { isPlatformAdmin } from '@enterpriseglue/shared/middleware/platformAuth.js';

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

const policyCreateSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  effect: z.enum(['allow', 'deny']),
  resourceType: z.string().optional(),
  action: z.string().optional(),
  conditions: z.record(z.string(), z.unknown()).optional(),
  priority: z.number().int().min(0).optional(),
});

const policyUpdateSchema = policyCreateSchema.partial();

const ssoMappingCreateSchema = z.object({
  providerId: z.string().min(1).optional(),
  claimType: z.enum(['group', 'role', 'email_domain', 'custom']),
  claimKey: z.string().min(1),
  claimValue: z.string().min(1),
  targetRole: z.enum(['admin', 'developer', 'user']),
  priority: z.number().int().optional(),
});

const ssoMappingUpdateSchema = ssoMappingCreateSchema.partial();

const ssoMappingTestSchema = z.object({
  claims: z.record(z.string(), z.unknown()),
  providerId: z.string().min(1).optional(),
});

const authzAuditQuerySchema = z.object({
  userId: z.string().optional(),
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
  decision: z.enum(['allow', 'deny']).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const router = Router();

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
      platformRole: req.user!.platformRole || (req.user as { role?: string }).role,
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
          platformRole: req.user!.platformRole || (req.user as { role?: string }).role,
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

// ============================================================================
// Policy Management (Admin Only)
// ============================================================================

/**
 * GET /api/platform-admin/authz/policies
 * List all authorization policies.
 */
router.get('/api/authz/policies', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  try {
    if (!isPlatformAdmin(req)) {
      throw Errors.adminRequired();
    }

    const policies = await policyService.getAllPolicies();
    res.json(policies);
  } catch (error: any) {
    logger.error('Get policies error:', error);
    throw Errors.internal('Failed to get policies');
  }
}));

/**
 * POST /api/platform-admin/authz/policies
 * Create a new authorization policy.
 */
router.post('/api/authz/policies', apiLimiter, requireAuth, validateBody(policyCreateSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    if (!isPlatformAdmin(req)) {
      throw Errors.adminRequired();
    }

    const { name, description, effect, priority, resourceType, action, conditions } = req.body;

    const result = await policyService.createPolicy({
      name,
      description,
      effect,
      priority,
      resourceType,
      action,
      conditions,
      createdById: req.user!.userId,
    });

    res.status(201).json(result);
  } catch (error: any) {
    logger.error('Create policy error:', error);
    throw Errors.internal('Failed to create policy');
  }
}));

/**
 * PUT /api/platform-admin/authz/policies/:id
 * Update an authorization policy.
 */
router.put('/api/authz/policies/:id', apiLimiter, requireAuth, validateParams(idParamSchema), validateBody(policyUpdateSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    if (!isPlatformAdmin(req)) {
      throw Errors.adminRequired();
    }

    const policyId = String(req.params.id);
    await policyService.updatePolicy(policyId, req.body);
    res.json({ success: true });
  } catch (error: any) {
    logger.error('Update policy error:', error);
    throw Errors.internal('Failed to update policy');
  }
}));

/**
 * DELETE /api/platform-admin/authz/policies/:id
 * Delete an authorization policy.
 */
router.delete('/api/authz/policies/:id', apiLimiter, requireAuth, validateParams(idParamSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    if (!isPlatformAdmin(req)) {
      throw Errors.adminRequired();
    }

    const policyId = String(req.params.id);
    await policyService.deletePolicy(policyId);
    res.status(204).send();
  } catch (error: any) {
    logger.error('Delete policy error:', error);
    throw Errors.internal('Failed to delete policy');
  }
}));

// ============================================================================
// SSO Claims Mapping Management (Admin Only)
// ============================================================================

/**
 * GET /api/platform-admin/authz/sso-mappings
 * List all SSO claims mappings.
 */
router.get('/api/authz/sso-mappings', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  try {
    if (!isPlatformAdmin(req)) {
      throw Errors.adminRequired();
    }

    const mappings = await ssoClaimsMappingService.getAllMappings();
    res.json(mappings);
  } catch (error: any) {
    logger.error('Get SSO mappings error:', error);
    throw Errors.internal('Failed to get SSO mappings');
  }
}));

/**
 * POST /api/platform-admin/authz/sso-mappings
 * Create a new SSO claims mapping.
 */
router.post('/api/authz/sso-mappings', apiLimiter, requireAuth, validateBody(ssoMappingCreateSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    if (!isPlatformAdmin(req)) {
      throw Errors.adminRequired();
    }

    const { providerId, claimType, claimKey, claimValue, targetRole, priority } = req.body;

    const result = await ssoClaimsMappingService.createMapping({
      providerId,
      claimType,
      claimKey,
      claimValue,
      targetRole,
      priority,
    });

    res.status(201).json(result);
  } catch (error: any) {
    logger.error('Create SSO mapping error:', error);
    throw Errors.internal('Failed to create SSO mapping');
  }
}));

/**
 * PUT /api/platform-admin/authz/sso-mappings/:id
 * Update an SSO claims mapping.
 */
router.put('/api/authz/sso-mappings/:id', apiLimiter, requireAuth, validateParams(idParamSchema), validateBody(ssoMappingUpdateSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    if (!isPlatformAdmin(req)) {
      throw Errors.adminRequired();
    }

    const mappingId = String(req.params.id);
    await ssoClaimsMappingService.updateMapping(mappingId, req.body);
    res.json({ success: true });
  } catch (error: any) {
    logger.error('Update SSO mapping error:', error);
    throw Errors.internal('Failed to update SSO mapping');
  }
}));

/**
 * DELETE /api/platform-admin/authz/sso-mappings/:id
 * Delete an SSO claims mapping.
 */
router.delete('/api/authz/sso-mappings/:id', apiLimiter, requireAuth, validateParams(idParamSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    if (!isPlatformAdmin(req)) {
      throw Errors.adminRequired();
    }

    const mappingId = String(req.params.id);
    await ssoClaimsMappingService.deleteMapping(mappingId);
    res.status(204).send();
  } catch (error: any) {
    logger.error('Delete SSO mapping error:', error);
    throw Errors.internal('Failed to delete SSO mapping');
  }
}));

/**
 * POST /api/platform-admin/authz/sso-mappings/test
 * Test SSO claims against mappings (admin preview).
 */
router.post('/api/authz/sso-mappings/test', apiLimiter, requireAuth, validateBody(ssoMappingTestSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    if (!isPlatformAdmin(req)) {
      throw Errors.adminRequired();
    }

    const { claims, providerId } = req.body;

    const result = await ssoClaimsMappingService.testClaims(claims, providerId);
    res.json(result);
  } catch (error: any) {
    logger.error('Test SSO mapping error:', error);
    throw Errors.internal('Failed to test SSO mapping');
  }
}));

// ============================================================================
// Audit Log (Admin Only)
// ============================================================================

/**
 * GET /api/platform-admin/authz/audit
 * Query authorization audit log.
 */
router.get('/api/authz/audit', apiLimiter, requireAuth, validateQuery(authzAuditQuerySchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    if (!isPlatformAdmin(req)) {
      throw Errors.adminRequired();
    }

    const userId = typeof req.query.userId === 'string' ? req.query.userId : undefined;
    const resourceType = typeof req.query.resourceType === 'string' ? req.query.resourceType : undefined;
    const resourceId = typeof req.query.resourceId === 'string' ? req.query.resourceId : undefined;
    const decision = req.query.decision === 'allow' || req.query.decision === 'deny'
      ? req.query.decision
      : undefined;
    const limit = typeof req.query.limit === 'number' ? req.query.limit : undefined;
    const offset = typeof req.query.offset === 'number' ? req.query.offset : undefined;

    const entries = await policyService.getAuditLog({
      userId,
      resourceType,
      resourceId,
      decision,
      limit,
      offset,
    });

    res.json(entries);
  } catch (error: any) {
    logger.error('Get audit log error:', error);
    throw Errors.internal('Failed to get audit log');
  }
}));

export default router;

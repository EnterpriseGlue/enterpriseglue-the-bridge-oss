import type { Request, RequestHandler, Response, Router } from 'express';
import { z } from 'zod';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { asyncHandler, AppError, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { validateBody, validateParams } from '@enterpriseglue/shared/middleware/validate.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { policyService } from '@enterpriseglue/shared/services/platform-admin/index.js';
import { AuthzPolicyCreateSchema, AuthzPolicyResponseSchema, AuthzPolicyUpdateSchema } from '@enterpriseglue/shared/schemas/platform-admin/authz.js';

const idParamSchema = z.object({ id: z.string().uuid() });

export interface PolicyRouteDependencies {
  requirePlatformAction: (actionId: string) => RequestHandler;
}

export function registerPolicyRoutes(router: Router, { requirePlatformAction }: PolicyRouteDependencies): void {
  router.get('/api/authz/policies', apiLimiter, requireAuth, requirePlatformAction('platform.authz.policies.read'), asyncHandler(async (req: Request, res: Response) => {
    try {
      const policies = await policyService.getAllPolicies(req.tenant?.tenantId || null);
      res.json(AuthzPolicyResponseSchema.array().parse(policies));
    } catch (error: any) {
      logger.error('Get policies error:', error);
      throw Errors.internal('Failed to get policies');
    }
  }));

  router.post('/api/authz/policies', apiLimiter, requireAuth, requirePlatformAction('platform.authz.policies.manage'), validateBody(AuthzPolicyCreateSchema), asyncHandler(async (req: Request, res: Response) => {
    try {
      const { name, description, effect, priority, resourceType, action, conditions } = req.body;
      const result = await policyService.createPolicy({
        name,
        description,
        effect,
        priority,
        resourceType,
        action,
        conditions,
        tenantId: req.tenant?.tenantId || null,
        createdById: req.user!.userId,
      });
      res.status(201).json(result);
    } catch (error: any) {
      logger.error('Create policy error:', error);
      throw Errors.internal('Failed to create policy');
    }
  }));

  router.put('/api/authz/policies/:id', apiLimiter, requireAuth, requirePlatformAction('platform.authz.policies.manage'), validateParams(idParamSchema), validateBody(AuthzPolicyUpdateSchema), asyncHandler(async (req: Request, res: Response) => {
    try {
      const policyId = String(req.params.id);
      await policyService.updatePolicy(policyId, {
        ...req.body,
        tenantId: req.tenant?.tenantId || null,
        updatedById: req.user!.userId,
      });
      res.json({ success: true });
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Update policy error:', error);
      throw Errors.internal('Failed to update policy');
    }
  }));

  router.delete('/api/authz/policies/:id', apiLimiter, requireAuth, requirePlatformAction('platform.authz.policies.manage'), validateParams(idParamSchema), asyncHandler(async (req: Request, res: Response) => {
    try {
      const policyId = String(req.params.id);
      await policyService.deletePolicy(policyId, req.user!.userId);
      res.status(204).send();
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Delete policy error:', error);
      throw Errors.internal('Failed to delete policy');
    }
  }));
}

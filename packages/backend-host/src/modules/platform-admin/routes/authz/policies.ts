import type { Request, RequestHandler, Response, Router } from 'express';
import { z } from 'zod';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { validateBody, validateParams } from '@enterpriseglue/shared/middleware/validate.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { policyService } from '@enterpriseglue/shared/services/platform-admin/index.js';

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

export interface PolicyRouteDependencies {
  requirePlatformAction: (actionId: string) => RequestHandler;
}

export function registerPolicyRoutes(router: Router, { requirePlatformAction }: PolicyRouteDependencies): void {
  router.get('/api/authz/policies', apiLimiter, requireAuth, requirePlatformAction('platform.authz.policies.read'), asyncHandler(async (req: Request, res: Response) => {
    try {
      const policies = await policyService.getAllPolicies(req.tenant?.tenantId || null);
      res.json(policies);
    } catch (error: any) {
      logger.error('Get policies error:', error);
      throw Errors.internal('Failed to get policies');
    }
  }));

  router.post('/api/authz/policies', apiLimiter, requireAuth, requirePlatformAction('platform.authz.policies.manage'), validateBody(policyCreateSchema), asyncHandler(async (req: Request, res: Response) => {
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

  router.put('/api/authz/policies/:id', apiLimiter, requireAuth, requirePlatformAction('platform.authz.policies.manage'), validateParams(idParamSchema), validateBody(policyUpdateSchema), asyncHandler(async (req: Request, res: Response) => {
    try {
      const policyId = String(req.params.id);
      await policyService.updatePolicy(policyId, {
        ...req.body,
        tenantId: req.tenant?.tenantId || null,
        updatedById: req.user!.userId,
      });
      res.json({ success: true });
    } catch (error: any) {
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
      logger.error('Delete policy error:', error);
      throw Errors.internal('Failed to delete policy');
    }
  }));
}

import type { Request, RequestHandler, Response, Router } from 'express';
import { z } from 'zod';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { validateBody, validateParams } from '@enterpriseglue/shared/middleware/validate.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import {
  apiClientService,
  serviceAccountService,
} from '@enterpriseglue/shared/services/platform-admin/index.js';
import {
  ApiClientCreateSchema,
  ServiceAccountCreateSchema,
} from '@enterpriseglue/shared/schemas/platform-admin/authz.js';

const idParamSchema = z.object({ id: z.string().uuid() });

export interface MachineRouteDependencies {
  requirePlatformAction: (actionId: string) => RequestHandler;
}

/** API clients and service accounts are reveal-once machine credentials. */
export function registerMachineRoutes(router: Router, { requirePlatformAction }: MachineRouteDependencies): void {
  router.get('/api/authz/api-clients', apiLimiter, requireAuth, requirePlatformAction('platform.api-clients.read'), asyncHandler(async (_req: Request, res: Response) => {
    try {
      res.json(await apiClientService.listClients());
    } catch (error: any) {
      if (error.statusCode) throw error;
      logger.error('List API clients error:', error);
      throw Errors.internal('Failed to list API clients');
    }
  }));

  router.post('/api/authz/api-clients', apiLimiter, requireAuth, requirePlatformAction('platform.api-clients.manage'), validateBody(ApiClientCreateSchema), asyncHandler(async (req: Request, res: Response) => {
    try {
      const result = await apiClientService.createClient({ name: req.body.name, scopes: req.body.scopes, createdById: req.user!.userId });
      res.status(201).json(result);
    } catch (error: any) {
      if (error.statusCode) throw error;
      logger.error('Create API client error:', error);
      throw Errors.badRequest(error.message || 'Failed to create API client');
    }
  }));

  router.post('/api/authz/api-clients/:id/rotate', apiLimiter, requireAuth, requirePlatformAction('platform.api-clients.manage'), validateParams(idParamSchema), asyncHandler(async (req: Request, res: Response) => {
    try {
      res.json(await apiClientService.rotateClient(String(req.params.id)));
    } catch (error: any) {
      if (error.statusCode) throw error;
      logger.error('Rotate API client error:', error);
      throw Errors.badRequest(error.message || 'Failed to rotate API client');
    }
  }));

  router.delete('/api/authz/api-clients/:id', apiLimiter, requireAuth, requirePlatformAction('platform.api-clients.manage'), validateParams(idParamSchema), asyncHandler(async (req: Request, res: Response) => {
    try {
      await apiClientService.revokeClient(String(req.params.id));
      res.status(204).send();
    } catch (error: any) {
      if (error.statusCode) throw error;
      logger.error('Revoke API client error:', error);
      throw Errors.badRequest(error.message || 'Failed to revoke API client');
    }
  }));

  router.get('/api/authz/service-accounts', apiLimiter, requireAuth, requirePlatformAction('platform.service-accounts.read'), asyncHandler(async (req: Request, res: Response) => {
    try {
      res.json(await serviceAccountService.listServiceAccounts({ includeInactive: req.query.includeInactive === 'true' }));
    } catch (error: any) {
      if (error.statusCode) throw error;
      logger.error('List service accounts error:', error);
      throw Errors.internal('Failed to list service accounts');
    }
  }));

  router.post('/api/authz/service-accounts', apiLimiter, requireAuth, requirePlatformAction('platform.service-accounts.manage'), validateBody(ServiceAccountCreateSchema), asyncHandler(async (req: Request, res: Response) => {
    try {
      const result = await serviceAccountService.createServiceAccount({
        name: req.body.name,
        description: req.body.description,
        scopes: req.body.scopes,
        createdById: req.user!.userId,
      });
      res.status(201).json(result);
    } catch (error: any) {
      if (error.statusCode) throw error;
      logger.error('Create service account error:', error);
      throw Errors.badRequest(error.message || 'Failed to create service account');
    }
  }));

  router.post('/api/authz/service-accounts/:id/rotate', apiLimiter, requireAuth, requirePlatformAction('platform.service-accounts.manage'), validateParams(idParamSchema), asyncHandler(async (req: Request, res: Response) => {
    try {
      res.json(await serviceAccountService.rotateServiceAccountToken(String(req.params.id)));
    } catch (error: any) {
      if (error.statusCode) throw error;
      logger.error('Rotate service account token error:', error);
      throw Errors.badRequest(error.message || 'Failed to rotate service account token');
    }
  }));

  router.delete('/api/authz/service-accounts/:id', apiLimiter, requireAuth, requirePlatformAction('platform.service-accounts.manage'), validateParams(idParamSchema), asyncHandler(async (req: Request, res: Response) => {
    try {
      await serviceAccountService.revokeServiceAccount(String(req.params.id));
      res.status(204).send();
    } catch (error: any) {
      if (error.statusCode) throw error;
      logger.error('Revoke service account error:', error);
      throw Errors.badRequest(error.message || 'Failed to revoke service account');
    }
  }));
}

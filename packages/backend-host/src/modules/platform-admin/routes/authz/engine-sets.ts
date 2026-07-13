import type { Request, RequestHandler, Response, Router } from 'express';
import { z } from 'zod';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { validateBody, validateParams, validateQuery } from '@enterpriseglue/shared/middleware/validate.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { RuntimeResource } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResource.js';
import { RuntimeResourceSet } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResourceSet.js';
import { engineSetService } from '@enterpriseglue/shared/services/platform-admin/index.js';
import { runtimeResourceInventoryService } from '@enterpriseglue/shared/services/platform-admin/RuntimeResourceInventoryService.js';
import { deploymentDiscoveryService } from '@enterpriseglue/shared/services/platform-admin/DeploymentDiscoveryService.js';

const resourceIdParamSchema = z.object({ id: z.string().min(1) });
const runtimeResourceQuerySchema = z.object({
  engineId: z.string().min(1),
  resourceKind: z.enum(['process_definition', 'decision_definition']).optional(),
  includeInactive: z.enum(['true', 'false']).optional(),
});
const engineSetSelectorSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('all') }),
  z.object({ mode: z.literal('engine_ids'), engineIds: z.array(z.string().min(1)).min(1) }),
  z.object({
    mode: z.literal('labels'),
    labels: z.record(z.string().min(1), z.string().min(1)).refine((labels) => Object.keys(labels).length > 0, { message: 'At least one label is required' }),
    labelMatch: z.enum(['all', 'any']).optional(),
  }),
]);
const engineSetCreateSchema = z.object({
  key: z.string().min(1).max(255).optional(),
  name: z.string().min(1).max(255),
  description: z.string().max(2000).nullable().optional(),
  selector: engineSetSelectorSchema,
  riskAcknowledged: z.boolean().optional(),
});
const engineSetUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).nullable().optional(),
  selector: engineSetSelectorSchema.optional(),
  isArchived: z.boolean().optional(),
  riskAcknowledged: z.boolean().optional(),
});
const engineSetPreviewSchema = z.object({ selector: engineSetSelectorSchema });

export interface EngineSetRouteDependencies {
  requirePlatformAction: (actionId: string) => RequestHandler;
}

export function registerEngineSetRoutes(router: Router, { requirePlatformAction }: EngineSetRouteDependencies): void {
  router.get('/api/authz/engine-sets', apiLimiter, requireAuth, requirePlatformAction('platform.engine-sets.read'), validateQuery(z.object({ includeArchived: z.enum(['true', 'false']).optional() })), asyncHandler(async (req: Request, res: Response) => {
    try {
      res.json(await engineSetService.listEngineSets({ tenantId: req.tenant?.tenantId || null, includeArchived: req.query.includeArchived === 'true' }));
    } catch (error: any) {
      if (error.statusCode) throw error;
      logger.error('List Engine Sets error:', error);
      throw Errors.internal('Failed to list Engine Sets');
    }
  }));

  router.post('/api/authz/engine-sets/preview', apiLimiter, requireAuth, requirePlatformAction('platform.engine-sets.manage'), validateBody(engineSetPreviewSchema), asyncHandler(async (req: Request, res: Response) => {
    try {
      res.json(await engineSetService.previewSelector(req.body.selector, req.tenant?.tenantId || null));
    } catch (error: any) {
      if (error.statusCode) throw error;
      logger.error('Preview Engine Set selector error:', error);
      throw Errors.badRequest(error.message || 'Failed to preview Engine Set selector');
    }
  }));

  router.post('/api/authz/engine-sets', apiLimiter, requireAuth, requirePlatformAction('platform.engine-sets.manage'), validateBody(engineSetCreateSchema), asyncHandler(async (req: Request, res: Response) => {
    try {
      const result = await engineSetService.createEngineSet({ ...req.body, tenantId: req.tenant?.tenantId || null, createdById: req.user!.userId });
      res.status(201).json(result);
    } catch (error: any) {
      if (error.statusCode) throw error;
      logger.error('Create Engine Set error:', error);
      throw Errors.badRequest(error.message || 'Failed to create Engine Set');
    }
  }));

  router.get('/api/authz/engine-sets/:id', apiLimiter, requireAuth, requirePlatformAction('platform.engine-sets.read'), validateParams(resourceIdParamSchema), asyncHandler(async (req: Request, res: Response) => {
    try {
      const engineSet = await engineSetService.getEngineSet(String(req.params.id), req.tenant?.tenantId || null);
      if (!engineSet) throw Errors.notFound('Engine Set');
      res.json(engineSet);
    } catch (error: any) {
      if (error.statusCode) throw error;
      logger.error('Get Engine Set error:', error);
      throw Errors.internal('Failed to get Engine Set');
    }
  }));

  router.put('/api/authz/engine-sets/:id', apiLimiter, requireAuth, requirePlatformAction('platform.engine-sets.manage'), validateParams(resourceIdParamSchema), validateBody(engineSetUpdateSchema), asyncHandler(async (req: Request, res: Response) => {
    try {
      await engineSetService.updateEngineSet(String(req.params.id), { ...req.body, tenantId: req.tenant?.tenantId || null, updatedById: req.user!.userId });
      res.json({ success: true });
    } catch (error: any) {
      if (error.statusCode) throw error;
      logger.error('Update Engine Set error:', error);
      throw Errors.badRequest(error.message || 'Failed to update Engine Set');
    }
  }));

  router.delete('/api/authz/engine-sets/:id', apiLimiter, requireAuth, requirePlatformAction('platform.engine-sets.manage'), validateParams(resourceIdParamSchema), asyncHandler(async (req: Request, res: Response) => {
    try {
      await engineSetService.archiveEngineSet(String(req.params.id), req.tenant?.tenantId || null);
      res.status(204).send();
    } catch (error: any) {
      if (error.statusCode) throw error;
      logger.error('Archive Engine Set error:', error);
      throw Errors.badRequest(error.message || 'Failed to archive Engine Set');
    }
  }));

  router.post('/api/authz/engine-sets/:id/materialize', apiLimiter, requireAuth, requirePlatformAction('platform.engine-sets.manage'), validateParams(resourceIdParamSchema), asyncHandler(async (req: Request, res: Response) => {
    try {
      res.json(await engineSetService.materializeEngineSet(String(req.params.id), req.tenant?.tenantId || null));
    } catch (error: any) {
      if (error.statusCode) throw error;
      logger.error('Materialize Engine Set error:', error);
      throw Errors.badRequest(error.message || 'Failed to materialize Engine Set');
    }
  }));

  router.get('/api/authz/runtime-resources', apiLimiter, requireAuth, requirePlatformAction('platform.engine-sets.read'), validateQuery(runtimeResourceQuerySchema), asyncHandler(async (req: Request, res: Response) => {
    const tenantId = req.tenant?.tenantId || null;
    const resources = await (await getDataSource()).getRepository(RuntimeResource).find({
      where: { engineId: String(req.query.engineId), ...(req.query.resourceKind ? { resourceKind: String(req.query.resourceKind) } : {}), ...(req.query.includeInactive === 'true' ? {} : { isActive: true }) },
      order: { resourceKind: 'ASC', resourceKey: 'ASC', id: 'ASC' },
    });
    res.json(resources.filter((resource) => (resource.tenantId || null) === tenantId));
  }));

  router.get('/api/authz/runtime-resource-sets', apiLimiter, requireAuth, requirePlatformAction('platform.engine-sets.read'), validateQuery(z.object({ engineId: z.string().min(1).optional(), includeArchived: z.enum(['true', 'false']).optional() })), asyncHandler(async (req: Request, res: Response) => {
    const tenantId = req.tenant?.tenantId || null;
    const sets = await (await getDataSource()).getRepository(RuntimeResourceSet).find({
      where: { ...(req.query.engineId ? { engineId: String(req.query.engineId) } : {}), ...(req.query.includeArchived === 'true' ? {} : { isArchived: false }) },
      order: { key: 'ASC' },
    });
    res.json(sets.filter((set) => (set.tenantId || null) === tenantId));
  }));

  router.post('/api/authz/runtime-resource-sets/:id/materialize', apiLimiter, requireAuth, requirePlatformAction('platform.engine-sets.manage'), validateParams(resourceIdParamSchema), asyncHandler(async (req: Request, res: Response) => {
    res.json(await runtimeResourceInventoryService.materialize(String(req.params.id), req.tenant?.tenantId || null));
  }));

  router.post('/api/authz/runtime-resources/:id/reconcile', apiLimiter, requireAuth, requirePlatformAction('platform.engine-sets.manage'), validateParams(resourceIdParamSchema), asyncHandler(async (req: Request, res: Response) => {
    const engineId = String(req.params.id);
    const tenantId = req.tenant?.tenantId || null;
    const result = await runtimeResourceInventoryService.reconcileEngine(engineId, tenantId);
    const deployments = await deploymentDiscoveryService.reconcileEngine(engineId, tenantId);
    res.json({ ...result, deployments });
  }));
}

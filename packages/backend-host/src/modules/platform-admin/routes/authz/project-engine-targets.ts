import type { Request, RequestHandler, Response, Router } from 'express';
import { z } from 'zod';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { requireAction } from '@enterpriseglue/shared/middleware/requireAction.js';
import { validateBody, validateParams, validateQuery } from '@enterpriseglue/shared/middleware/validate.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { deploymentEligibilityService, projectEngineTargetService } from '@enterpriseglue/shared/services/platform-admin/index.js';
import { evaluateMissionControlStarbaseBridge, evaluateStarbaseMissionControlBridge } from '../../services/bridgeDecisionService.js';

const resourceIdParamSchema = z.object({ id: z.string().min(1) });
const projectEngineTargetStatusSchema = z.enum(['active', 'disabled', 'archived']);
const projectEngineTargetSourceSchema = z.enum(['manual', 'legacy', 'ci', 'api', 'import', 'deployment_history', 'external', 'system', 'automation']);
const projectEngineTargetModeSchema = z.enum(['manual', 'ci', 'api', 'import']);
const projectEngineTargetApprovalStatusSchema = z.enum(['not_required', 'pending', 'approved', 'rejected']);
const projectEngineTargetDiagnosticsSchema = z.record(z.string(), z.unknown());
const projectEngineTargetQuerySchema = z.object({
  projectId: z.string().min(1).optional(), engineId: z.string().min(1).optional(),
  status: z.enum(['active', 'disabled', 'archived', 'all']).optional(), source: projectEngineTargetSourceSchema.optional(),
});
const projectEngineTargetCreateSchema = z.object({
  projectId: z.string().min(1), engineId: z.string().min(1), status: projectEngineTargetStatusSchema.optional(), source: projectEngineTargetSourceSchema.optional(), sourceRef: z.string().nullable().optional(),
  externalSystemId: z.string().nullable().optional(), externalProjectId: z.string().nullable().optional(), externalEngineId: z.string().nullable().optional(), externalTargetId: z.string().nullable().optional(),
  allowManualDeploy: z.boolean().optional(), allowCiDeploy: z.boolean().optional(), allowApiDeploy: z.boolean().optional(), allowImport: z.boolean().optional(),
  approvedById: z.string().nullable().optional(), approvalStatus: projectEngineTargetApprovalStatusSchema.optional(), approvedAt: z.number().nullable().optional(), policyTags: z.array(z.string()).optional(), diagnostics: projectEngineTargetDiagnosticsSchema.nullable().optional(),
});
const projectEngineTargetUpdateSchema = projectEngineTargetCreateSchema.omit({ projectId: true, engineId: true }).partial();
const projectEngineTargetSyncLegacySchema = z.object({ projectId: z.string().min(1) });
const deploymentEligibilityEvaluateSchema = z.object({ userId: z.string().min(1), projectId: z.string().min(1), engineId: z.string().min(1), mode: projectEngineTargetModeSchema.optional() });
const bridgeDecisionSchema = z.object({
  engineId: z.string().min(1).optional(), projectId: z.string().min(1).optional(), fileId: z.string().min(1).optional(), targetId: z.string().min(1).optional(),
  definitionId: z.string().min(1).optional(), definitionKey: z.string().min(1).optional(), decisionDefinitionId: z.string().min(1).optional(), decisionDefinitionKey: z.string().min(1).optional(), kind: z.enum(['process', 'decision', 'bpmn', 'dmn']).optional(),
}).passthrough();

export interface ProjectEngineTargetRouteDependencies { requirePlatformAction: (actionId: string) => RequestHandler; }

export function registerProjectEngineTargetRoutes(router: Router, { requirePlatformAction }: ProjectEngineTargetRouteDependencies): void {
  router.get('/api/authz/project-engine-targets', apiLimiter, requireAuth, requirePlatformAction('platform.project-engine-targets.read'), validateQuery(projectEngineTargetQuerySchema), asyncHandler(async (req: Request, res: Response) => {
    try {
      res.json(await projectEngineTargetService.listTargets({ tenantId: req.tenant?.tenantId || null, projectId: req.query.projectId as string | undefined, engineId: req.query.engineId as string | undefined, status: req.query.status as any, source: req.query.source as any }));
    } catch (error: any) { if (error.statusCode) throw error; logger.error('List project-engine targets error:', error); throw Errors.internal('Failed to list project-engine targets'); }
  }));
  router.post('/api/authz/project-engine-targets/evaluate', apiLimiter, requireAuth, requirePlatformAction('project.deployment-eligibility.evaluate'), validateBody(deploymentEligibilityEvaluateSchema), asyncHandler(async (req: Request, res: Response) => {
    try { res.json(await deploymentEligibilityService.evaluate({ ...req.body, tenantId: req.tenant?.tenantId || null })); }
    catch (error: any) { if (error.statusCode) throw error; logger.error('Evaluate deployment eligibility error:', error); throw Errors.internal('Failed to evaluate deployment eligibility'); }
  }));
  router.post('/api/mission-control/bridge/starbase-edit/evaluate', apiLimiter, requireAuth, requireAction('mission-control.bridge.starbase-edit.evaluate', { resourceResolver: 'engine.byId', resourceIdFrom: 'body', resourceIdKey: 'engineId' }), validateBody(bridgeDecisionSchema), asyncHandler(async (req: Request, res: Response) => {
    try { res.json(await evaluateMissionControlStarbaseBridge(req.body, req.user!.userId, req.tenant?.tenantId || null)); }
    catch (error: any) { if (error.statusCode) throw error; logger.error('Evaluate Mission Control to Starbase bridge error:', error); throw Errors.internal('Failed to evaluate Mission Control to Starbase bridge'); }
  }));
  router.post('/api/starbase/bridge/mission-control/evaluate', apiLimiter, requireAuth, requireAction('starbase.bridge.mission-control.evaluate', { resourceResolver: 'project.byId', resourceIdFrom: 'body', resourceIdKey: 'projectId' }), validateBody(bridgeDecisionSchema), asyncHandler(async (req: Request, res: Response) => {
    try { res.json(await evaluateStarbaseMissionControlBridge(req.body, req.user!.userId, req.tenant?.tenantId || null)); }
    catch (error: any) { if (error.statusCode) throw error; logger.error('Evaluate Starbase to Mission Control bridge error:', error); throw Errors.internal('Failed to evaluate Starbase to Mission Control bridge'); }
  }));
  router.post('/api/authz/project-engine-targets/sync-legacy', apiLimiter, requireAuth, requirePlatformAction('platform.project-engine-targets.manage'), validateBody(projectEngineTargetSyncLegacySchema), asyncHandler(async (req: Request, res: Response) => {
    try { res.json(await projectEngineTargetService.syncLegacyAccessForProject(req.body.projectId, req.tenant?.tenantId || null)); }
    catch (error: any) { if (error.statusCode) throw error; logger.error('Sync legacy project-engine targets error:', error); throw Errors.badRequest(error.message || 'Failed to sync legacy project-engine targets'); }
  }));
  router.post('/api/authz/project-engine-targets', apiLimiter, requireAuth, requirePlatformAction('platform.project-engine-targets.manage'), validateBody(projectEngineTargetCreateSchema), asyncHandler(async (req: Request, res: Response) => {
    try { res.status(201).json(await projectEngineTargetService.createTarget({ ...req.body, tenantId: req.tenant?.tenantId || null, createdById: req.user!.userId })); }
    catch (error: any) { if (error.statusCode) throw error; logger.error('Create project-engine target error:', error); throw Errors.badRequest(error.message || 'Failed to create project-engine target'); }
  }));
  router.get('/api/authz/project-engine-targets/:id', apiLimiter, requireAuth, requirePlatformAction('platform.project-engine-targets.read'), validateParams(resourceIdParamSchema), asyncHandler(async (req: Request, res: Response) => {
    try { const target = await projectEngineTargetService.getTarget(String(req.params.id), req.tenant?.tenantId || null); if (!target) throw Errors.notFound('Project Engine Target'); res.json(target); }
    catch (error: any) { if (error.statusCode) throw error; logger.error('Get project-engine target error:', error); throw Errors.internal('Failed to get project-engine target'); }
  }));
  router.put('/api/authz/project-engine-targets/:id', apiLimiter, requireAuth, requirePlatformAction('platform.project-engine-targets.manage'), validateParams(resourceIdParamSchema), validateBody(projectEngineTargetUpdateSchema), asyncHandler(async (req: Request, res: Response) => {
    try { await projectEngineTargetService.updateTarget(String(req.params.id), { ...req.body, tenantId: req.tenant?.tenantId || null }); res.json({ success: true }); }
    catch (error: any) { if (error.statusCode) throw error; logger.error('Update project-engine target error:', error); throw Errors.badRequest(error.message || 'Failed to update project-engine target'); }
  }));
  router.delete('/api/authz/project-engine-targets/:id', apiLimiter, requireAuth, requirePlatformAction('platform.project-engine-targets.manage'), validateParams(resourceIdParamSchema), asyncHandler(async (req: Request, res: Response) => {
    try { await projectEngineTargetService.archiveTarget(String(req.params.id), req.tenant?.tenantId || null); res.status(204).send(); }
    catch (error: any) { if (error.statusCode) throw error; logger.error('Archive project-engine target error:', error); throw Errors.badRequest(error.message || 'Failed to archive project-engine target'); }
  }));
}

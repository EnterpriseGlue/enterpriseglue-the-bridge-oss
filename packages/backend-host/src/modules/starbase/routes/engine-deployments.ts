import { Router, Request, Response } from 'express';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { requireAction } from '@enterpriseglue/shared/middleware/requireAction.js';
import { asyncHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { engineService } from '@enterpriseglue/shared/services/platform-admin/index.js';
import { engineDeploymentQueryService } from '@enterpriseglue/shared/services/starbase/EngineDeploymentQueryService.js';

const r = Router();

function boundedQueryLimit(value: unknown, fallback: number, max: number): number {
  return Math.min(max, Math.max(1, parseInt(String(value || fallback), 10) || fallback));
}

async function visibleEngineIds(req: Request): Promise<string[]> {
  const engines = await engineService.getUserEngines(req.user!.userId, req.tenant?.tenantId || null);
  return engines.map(({ engine }) => String(engine.id));
}

r.get('/starbase-api/projects/:projectId/engine-deployments', apiLimiter, requireAuth, requireAction('project.deployments.read', { resourceIdFrom: 'params' }), asyncHandler(async (req: Request, res: Response) => {
  const rows = await engineDeploymentQueryService.listProjectDeployments(
    String(req.params.projectId),
    await visibleEngineIds(req),
    boundedQueryLimit(req.query.limit, 50, 200),
  );
  res.json(rows);
}));

r.get('/starbase-api/projects/:projectId/files/:fileId/deployments', apiLimiter, requireAuth, requireAction('project.deployments.read', { resourceIdFrom: 'params' }), asyncHandler(async (req: Request, res: Response) => {
  const rows = await engineDeploymentQueryService.listLatestFileDeployments(
    String(req.params.projectId),
    String(req.params.fileId),
    await visibleEngineIds(req),
    boundedQueryLimit(req.query.limit, 50, 500),
    boundedQueryLimit(req.query.scanLimit, 1000, 5000),
  );
  res.json(rows);
}));

r.get('/starbase-api/projects/:projectId/files/:fileId/deployments/history', apiLimiter, requireAuth, requireAction('project.deployments.read', { resourceIdFrom: 'params' }), asyncHandler(async (req: Request, res: Response) => {
  const rows = await engineDeploymentQueryService.listFileDeploymentHistory(
    String(req.params.projectId),
    String(req.params.fileId),
    await visibleEngineIds(req),
    boundedQueryLimit(req.query.limit, 200, 1000),
    boundedQueryLimit(req.query.scanLimit, 5000, 20000),
  );
  res.json(rows);
}));

r.get('/starbase-api/projects/:projectId/engine-deployments/latest', apiLimiter, requireAuth, requireAction('project.deployments.read', { resourceIdFrom: 'params' }), asyncHandler(async (req: Request, res: Response) => {
  const rows = await engineDeploymentQueryService.listLatestProjectDeploymentArtifacts(
    String(req.params.projectId),
    await visibleEngineIds(req),
    boundedQueryLimit(req.query.limit, 5000, 20000),
  );
  res.json(rows);
}));

export default r;

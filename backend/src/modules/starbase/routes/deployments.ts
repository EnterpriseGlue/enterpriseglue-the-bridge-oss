import { Router, Request, Response } from 'express';
import { apiLimiter } from '@shared/middleware/rateLimiter.js';
import { asyncHandler } from '@shared/middleware/errorHandler.js';
import { validateQuery } from '@shared/middleware/validate.js';
import { requireAuth } from '@shared/middleware/auth.js';
import { requireEngineAccess, requireEngineDeployer } from '@shared/middleware/engineAuth.js';
import {
  listDeployments,
  fetchDeploymentById,
  removeDeployment,
  fetchProcessDefinitionDiagram,
} from '../services/deployments-service.js';
import { DeploymentQueryParams } from '@shared/schemas/mission-control/deployment.js';

const r = Router();

// List deployments
r.get('/starbase-api/deployments', apiLimiter, requireAuth, requireEngineAccess({ engineIdFrom: 'query' }), validateQuery(DeploymentQueryParams.partial()), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const data = await listDeployments(engineId, req.query);
  res.json(data);
}));

// Get deployment by ID
r.get('/starbase-api/deployments/:id', apiLimiter, requireAuth, requireEngineAccess({ engineIdFrom: 'query' }), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const data = await fetchDeploymentById(engineId, req.params.id);
  res.json(data);
}));

// Delete deployment
r.delete('/starbase-api/deployments/:id', apiLimiter, requireAuth, requireEngineDeployer({ engineIdFrom: 'query' }), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const cascade = req.query.cascade === 'true';
  await removeDeployment(engineId, req.params.id, cascade);
  res.status(204).end();
}));

// Get process definition diagram
r.get('/starbase-api/process-definitions/:id/diagram', apiLimiter, requireAuth, requireEngineAccess({ engineIdFrom: 'query' }), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const data = await fetchProcessDefinitionDiagram(engineId, req.params.id);
  res.json(data);
}));

// Create deployment (multipart/form-data)
// Note: This requires multer middleware for file uploads
// Implementation deferred until multer is configured
r.post('/starbase-api/deployments', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  res.status(501).json({ 
    message: 'Deployment creation requires multipart/form-data support and must go through the backend. Configure multer middleware to enable this endpoint.' 
  });
}));

export default r;

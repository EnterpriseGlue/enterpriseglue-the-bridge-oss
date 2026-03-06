import { Router, Request, Response } from 'express';
import { asyncHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { validateQuery } from '@enterpriseglue/shared/middleware/validate.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { requireEngineReadOrWrite } from '@enterpriseglue/shared/middleware/engineAuth.js';
import { listMetrics, getMetric } from './metrics-service.js';
import { MetricsQueryParams } from '@enterpriseglue/shared/schemas/mission-control/metrics.js';

const r = Router();

// Apply auth middleware only to /mission-control-api routes (not globally)
r.use('/mission-control-api', requireAuth, requireEngineReadOrWrite({ engineIdFrom: 'query' }));

// Query metrics
r.get('/mission-control-api/metrics', validateQuery(MetricsQueryParams.partial()), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const data = await listMetrics(engineId, req.query);
  res.json(data);
}));

// Get specific metric by name
r.get('/mission-control-api/metrics/:name', validateQuery(MetricsQueryParams.partial()), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const metricName = String(req.params.name);
  const data = await getMetric(engineId, metricName, req.query);
  res.json(data);
}));

export default r;

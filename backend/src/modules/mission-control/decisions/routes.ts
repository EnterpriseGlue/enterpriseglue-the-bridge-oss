import { Router, Request, Response } from 'express';
import { asyncHandler } from '@shared/middleware/errorHandler.js';
import { validateBody, validateQuery } from '@shared/middleware/validate.js';
import { requireAuth } from '@shared/middleware/auth.js';
import { requireEngineReadOrWrite } from '@shared/middleware/engineAuth.js';
import {
  listDecisionDefinitions,
  fetchDecisionDefinition,
  fetchDecisionDefinitionXml,
  evaluateDecisionById,
  evaluateDecisionByKey,
} from './service.js';
import {
  DecisionDefinitionQueryParams,
  EvaluateDecisionRequest,
} from '@shared/schemas/mission-control/decision.js';

const r = Router();

r.use(requireAuth);

// List decision definitions
r.get('/mission-control-api/decision-definitions', requireEngineReadOrWrite({ engineIdFrom: 'query' }), validateQuery(DecisionDefinitionQueryParams.partial()), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const data = await listDecisionDefinitions(engineId, req.query);
  res.json(data);
}));

// Get decision definition by ID
r.get('/mission-control-api/decision-definitions/:id', requireEngineReadOrWrite({ engineIdFrom: 'query' }), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const data = await fetchDecisionDefinition(engineId, req.params.id);
  res.json(data);
}));

// Get decision definition XML
r.get('/mission-control-api/decision-definitions/:id/xml', requireEngineReadOrWrite({ engineIdFrom: 'query' }), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const data = await fetchDecisionDefinitionXml(engineId, req.params.id);
  res.json(data);
}));

// Evaluate decision
r.post('/mission-control-api/decision-definitions/:id/evaluate', requireEngineReadOrWrite({ engineIdFrom: 'body' }), validateBody(EvaluateDecisionRequest), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const data = await evaluateDecisionById(engineId, req.params.id, req.body);
  res.json(data);
}));

// Evaluate decision by key
r.post('/mission-control-api/decision-definitions/key/:key/evaluate', requireEngineReadOrWrite({ engineIdFrom: 'body' }), validateBody(EvaluateDecisionRequest), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const data = await evaluateDecisionByKey(engineId, req.params.key, req.body);
  res.json(data);
}));

export default r;

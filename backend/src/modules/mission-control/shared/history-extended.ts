import { Router, Request, Response } from 'express';
import { asyncHandler } from '@shared/middleware/errorHandler.js';
import { validateQuery } from '@shared/middleware/validate.js';
import { requireAuth } from '@shared/middleware/auth.js';
import { requireEngineReadOrWrite } from '@shared/middleware/engineAuth.js';
import {
  listHistoricTasks,
  listHistoricVariables,
  listHistoricDecisions,
  listHistoricDecisionInputs,
  listHistoricDecisionOutputs,
  listUserOperations,
} from './history-extended-service.js';
import {
  HistoricTaskQueryParams,
  HistoricVariableQueryParams,
  HistoricDecisionQueryParams,
  UserOperationLogQueryParams,
} from '@shared/schemas/mission-control/history.js';

const r = Router();

r.use(requireAuth, requireEngineReadOrWrite({ engineIdFrom: 'query' }));

// Get historic task instances
r.get('/mission-control-api/history/tasks', validateQuery(HistoricTaskQueryParams.partial()), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const data = await listHistoricTasks(engineId, req.query);
  res.json(data);
}));

// Get historic variable instances
r.get('/mission-control-api/history/variables', validateQuery(HistoricVariableQueryParams.partial()), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const data = await listHistoricVariables(engineId, req.query);
  res.json(data);
}));

// Get historic decision instances
r.get('/mission-control-api/history/decisions', validateQuery(HistoricDecisionQueryParams.partial()), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const data = await listHistoricDecisions(engineId, req.query);
  res.json(data);
}));

// Get historic decision instance inputs
r.get('/mission-control-api/history/decisions/:id/inputs', asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const data = await listHistoricDecisionInputs(engineId, req.params.id);
  res.json(data);
}));

// Get historic decision instance outputs
r.get('/mission-control-api/history/decisions/:id/outputs', asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const data = await listHistoricDecisionOutputs(engineId, req.params.id);
  res.json(data);
}));

// Get user operation log
r.get('/mission-control-api/history/user-operations', validateQuery(UserOperationLogQueryParams.partial()), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const data = await listUserOperations(engineId, req.query);
  res.json(data);
}));

export default r;

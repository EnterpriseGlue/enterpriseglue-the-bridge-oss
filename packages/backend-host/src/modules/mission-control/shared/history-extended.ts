import { Router, Request, Response } from 'express';
import { asyncHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { validateQuery } from '@enterpriseglue/shared/middleware/validate.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { requireEngineReadOrWrite } from '@enterpriseglue/shared/middleware/engineAuth.js';
import {
  listHistoricTasks,
  listHistoricVariables,
  listHistoricDecisions,
  listHistoricDecisionInputs,
  listHistoricDecisionOutputs,
  listUserOperations,
} from './history-extended-service.js';
import { piiRedactionService } from '@enterpriseglue/shared/services/pii/PiiRedactionService.js';
import {
  HistoricTaskQueryParams,
  HistoricVariableQueryParams,
  HistoricDecisionQueryParams,
  UserOperationLogQueryParams,
} from '@enterpriseglue/shared/schemas/mission-control/history.js';

const r = Router();

// Apply auth middleware only to /mission-control-api routes (not globally)
r.use('/mission-control-api', requireAuth, requireEngineReadOrWrite({ engineIdFrom: 'query' }));

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
  const redacted = await piiRedactionService.redactPayload(req, data, 'history');
  res.json(redacted);
}));

// Get historic decision instances
r.get('/mission-control-api/history/decisions', validateQuery(HistoricDecisionQueryParams.partial()), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const data = await listHistoricDecisions(engineId, req.query);
  const redacted = await piiRedactionService.redactPayload(req, data, 'history');
  res.json(redacted);
}));

// Get historic decision instance inputs
r.get('/mission-control-api/history/decisions/:id/inputs', asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const decisionId = String(req.params.id);
  const data = await listHistoricDecisionInputs(engineId, decisionId);
  const redacted = await piiRedactionService.redactPayload(req, data, 'history');
  res.json(redacted);
}));

// Get historic decision instance outputs
r.get('/mission-control-api/history/decisions/:id/outputs', asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const decisionId = String(req.params.id);
  const data = await listHistoricDecisionOutputs(engineId, decisionId);
  const redacted = await piiRedactionService.redactPayload(req, data, 'history');
  res.json(redacted);
}));

// Get user operation log
r.get('/mission-control-api/history/user-operations', validateQuery(UserOperationLogQueryParams.partial()), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const data = await listUserOperations(engineId, req.query);
  const redacted = await piiRedactionService.redactPayload(req, data, 'history');
  res.json(redacted);
}));

export default r;

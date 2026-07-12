import { Router, Request, Response } from 'express';
import { asyncHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { validateQuery } from '@enterpriseglue/shared/middleware/validate.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { requireAction } from '@enterpriseglue/shared/middleware/requireAction.js';
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
r.use('/mission-control-api', requireAuth);

// Get historic task instances
r.get('/mission-control-api/history/tasks', requireAction('engine.runtime.history.tasks.read', { resourceIdFrom: 'query' }), validateQuery(HistoricTaskQueryParams.partial()), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const data = await listHistoricTasks(engineId, req.query);
  res.json(data);
}));

// Get historic variable instances
r.get('/mission-control-api/history/variables', requireAction('engine.runtime.history.variables.read', { resourceIdFrom: 'query' }), validateQuery(HistoricVariableQueryParams.partial()), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const data = await listHistoricVariables(engineId, req.query);
  const redacted = await piiRedactionService.redactPayload(req, data, 'history');
  res.json(redacted);
}));

// Get historic decision instances
r.get('/mission-control-api/history/decisions', requireAction('engine.runtime.history.decisions.read', { resourceIdFrom: 'query' }), validateQuery(HistoricDecisionQueryParams.partial()), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const data = await listHistoricDecisions(engineId, req.query);
  const redacted = await piiRedactionService.redactPayload(req, data, 'history');
  res.json(redacted);
}));

// Get historic decision instance inputs
r.get('/mission-control-api/history/decisions/:id/inputs', requireAction('engine.runtime.history.decisions.inputs.read', { resourceIdFrom: 'query' }), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const decisionId = String(req.params.id);
  const data = await listHistoricDecisionInputs(engineId, decisionId);
  const redacted = await piiRedactionService.redactPayload(req, data, 'history');
  res.json(redacted);
}));

// Get historic decision instance outputs
r.get('/mission-control-api/history/decisions/:id/outputs', requireAction('engine.runtime.history.decisions.outputs.read', { resourceIdFrom: 'query' }), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const decisionId = String(req.params.id);
  const data = await listHistoricDecisionOutputs(engineId, decisionId);
  const redacted = await piiRedactionService.redactPayload(req, data, 'history');
  res.json(redacted);
}));

// Get user operation log
r.get('/mission-control-api/history/user-operations', requireAction('engine.runtime.history.user-operations.read', { resourceIdFrom: 'query' }), validateQuery(UserOperationLogQueryParams.partial()), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const data = await listUserOperations(engineId, req.query);
  const redacted = await piiRedactionService.redactPayload(req, data, 'history');
  res.json(redacted);
}));

export default r;

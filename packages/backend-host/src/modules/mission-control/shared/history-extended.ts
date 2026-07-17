import { Router, Request, Response } from 'express';
import { asyncHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { validateQuery } from '@enterpriseglue/shared/middleware/validate.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { requireRuntimeCollectionAction, requireRuntimeDefinitionAction } from '@enterpriseglue/shared/middleware/requireAction.js';
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
  HistoricTaskInstanceListSchema,
  HistoricVariableInstanceListSchema,
  HistoricDecisionInstanceListSchema,
  HistoricDecisionIoListSchema,
  UserOperationLogEntryListSchema,
  UserOperationLogQueryParams,
} from '@enterpriseglue/shared/schemas/mission-control/history.js';
import { filterRuntimeItemsByResourceKey, getBoundedRuntimeResourceQuery, withAuthorizedRuntimeTenantQuery } from './runtime-resource-filter.js';

const r = Router();

// Apply auth middleware only to /mission-control-api routes (not globally)
r.use('/mission-control-api', requireAuth);

// Get historic task instances
r.get('/mission-control-api/history/tasks', requireRuntimeCollectionAction('engine.runtime.history.tasks.read', { resourceKind: 'process_definition' }), validateQuery(HistoricTaskQueryParams.partial()), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const keys = req.authorizedRuntimeResourceKeys;
  const scopes = req.authorizedRuntimeResourceScopes;
  const requestedKey = typeof req.query.processDefinitionKey === 'string' ? req.query.processDefinitionKey : null;
  const visibleKeys = keys ? keys.filter((key) => !requestedKey || key === requestedKey) : null;
  const query = visibleKeys ? getBoundedRuntimeResourceQuery(req.query) : req.query;
  const data = visibleKeys
    ? (await Promise.all(visibleKeys.map(async (processDefinitionKey) => filterRuntimeItemsByResourceKey(
      await listHistoricTasks(engineId, { ...withAuthorizedRuntimeTenantQuery(query, scopes, processDefinitionKey), processDefinitionKey }), [processDefinitionKey], 'processDefinitionKey', scopes,
    )))).flat()
    : await listHistoricTasks(engineId, query);
  res.json(HistoricTaskInstanceListSchema.parse(data));
}));

// Get historic variable instances
r.get('/mission-control-api/history/variables', requireRuntimeCollectionAction('engine.runtime.history.variables.read', { resourceKind: 'process_definition' }), validateQuery(HistoricVariableQueryParams.partial()), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const keys = req.authorizedRuntimeResourceKeys;
  const scopes = req.authorizedRuntimeResourceScopes;
  const requestedKey = typeof req.query.processDefinitionKey === 'string' ? req.query.processDefinitionKey : null;
  const visibleKeys = keys ? keys.filter((key) => !requestedKey || key === requestedKey) : null;
  const query = visibleKeys ? getBoundedRuntimeResourceQuery(req.query) : req.query;
  const data = visibleKeys
    ? (await Promise.all(visibleKeys.map(async (processDefinitionKey) => filterRuntimeItemsByResourceKey(
      await listHistoricVariables(engineId, { ...withAuthorizedRuntimeTenantQuery(query, scopes, processDefinitionKey), processDefinitionKey }), [processDefinitionKey], 'processDefinitionKey', scopes,
    )))).flat()
    : await listHistoricVariables(engineId, query);
  const redacted = await piiRedactionService.redactPayload(req, data, 'history');
  res.json(HistoricVariableInstanceListSchema.parse(redacted));
}));

// Get historic decision instances
r.get('/mission-control-api/history/decisions', requireRuntimeCollectionAction('engine.runtime.history.decisions.read', { resourceKind: 'decision_definition' }), validateQuery(HistoricDecisionQueryParams.partial()), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const keys = req.authorizedRuntimeResourceKeys;
  const scopes = req.authorizedRuntimeResourceScopes;
  const requestedKey = typeof req.query.decisionDefinitionKey === 'string' ? req.query.decisionDefinitionKey : null;
  const visibleKeys = keys ? keys.filter((key) => !requestedKey || key === requestedKey) : null;
  const query = visibleKeys ? getBoundedRuntimeResourceQuery(req.query) : req.query;
  const data = visibleKeys
    ? (await Promise.all(visibleKeys.map(async (decisionDefinitionKey) => filterRuntimeItemsByResourceKey(
      await listHistoricDecisions(engineId, { ...withAuthorizedRuntimeTenantQuery(query, scopes, decisionDefinitionKey), decisionDefinitionKey }), [decisionDefinitionKey], 'decisionDefinitionKey', scopes,
    )))).flat()
    : await listHistoricDecisions(engineId, query);
  const redacted = await piiRedactionService.redactPayload(req, data, 'history');
  res.json(HistoricDecisionInstanceListSchema.parse(redacted));
}));

// Get historic decision instance inputs
r.get('/mission-control-api/history/decisions/:id/inputs', requireRuntimeDefinitionAction('engine.runtime.history.decisions.inputs.read', {
  resourceKind: 'decision_definition',
  definitionPath: 'history/decision-instance',
  resourceKeyFields: ['decisionDefinitionKey'],
}), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const decisionId = String(req.params.id);
  const data = await listHistoricDecisionInputs(engineId, decisionId);
  const redacted = await piiRedactionService.redactPayload(req, data, 'history');
  res.json(HistoricDecisionIoListSchema.parse(redacted));
}));

// Get historic decision instance outputs
r.get('/mission-control-api/history/decisions/:id/outputs', requireRuntimeDefinitionAction('engine.runtime.history.decisions.outputs.read', {
  resourceKind: 'decision_definition',
  definitionPath: 'history/decision-instance',
  resourceKeyFields: ['decisionDefinitionKey'],
}), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const decisionId = String(req.params.id);
  const data = await listHistoricDecisionOutputs(engineId, decisionId);
  const redacted = await piiRedactionService.redactPayload(req, data, 'history');
  res.json(HistoricDecisionIoListSchema.parse(redacted));
}));

// Get user operation log
r.get('/mission-control-api/history/user-operations', requireRuntimeCollectionAction('engine.runtime.history.user-operations.read', { resourceKind: 'process_definition' }), validateQuery(UserOperationLogQueryParams.partial()), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const keys = req.authorizedRuntimeResourceKeys;
  const scopes = req.authorizedRuntimeResourceScopes;
  const requestedKey = typeof req.query.processDefinitionKey === 'string' ? req.query.processDefinitionKey : null;
  const visibleKeys = keys ? keys.filter((key) => !requestedKey || key === requestedKey) : null;
  const query = visibleKeys ? getBoundedRuntimeResourceQuery(req.query) : req.query;
  const data = visibleKeys
    ? (await Promise.all(visibleKeys.map(async (processDefinitionKey) => filterRuntimeItemsByResourceKey(
      await listUserOperations(engineId, { ...withAuthorizedRuntimeTenantQuery(query, scopes, processDefinitionKey), processDefinitionKey }), [processDefinitionKey], 'processDefinitionKey', scopes,
    )))).flat()
    : await listUserOperations(engineId, query);
  const redacted = await piiRedactionService.redactPayload(req, data, 'history');
  res.json(UserOperationLogEntryListSchema.parse(redacted));
}));

export default r;

import { Router, Request, Response } from 'express';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { validateBody, validateQuery } from '@enterpriseglue/shared/middleware/validate.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { missionControlLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { requireRuntimeCollectionAction, requireRuntimeDefinitionAction } from '@enterpriseglue/shared/middleware/requireAction.js';
import {
  listTasks,
  getTaskById,
  getTaskCountByQuery,
  claimTaskById,
  unclaimTaskById,
  setTaskAssigneeById,
  completeTaskById,
  getTaskVariablesById,
  updateTaskVariablesById,
  getTaskFormById,
} from './tasks-service.js';
import {
  TaskQueryParams,
  ClaimTaskRequest,
  SetAssigneeRequest,
  CompleteTaskRequest,
  TaskVariablesRequest,
} from '@enterpriseglue/shared/schemas/mission-control/task.js';
import { filterRuntimeItemsByProcessDefinitionKeys, getBoundedRuntimeResourceQuery, withAuthorizedRuntimeTenantQuery } from './runtime-resource-filter.js';

const r = Router();

// Tasks inherit access from the process definition that created them.
const requireTaskAction = (actionId: string, engineIdFrom: 'query' | 'body' = 'query') => requireRuntimeDefinitionAction(actionId, {
  resourceKind: 'process_definition',
  definitionPath: 'task',
  definitionReferenceField: 'processDefinitionId',
  definitionReferencePath: 'process-definition',
  engineIdFrom,
});

// Apply auth middleware only to /mission-control-api routes (not globally)
r.use('/mission-control-api', requireAuth, missionControlLimiter);

// Query tasks
r.get('/mission-control-api/tasks', requireRuntimeCollectionAction('engine.runtime.tasks.read', { resourceKind: 'process_definition' }), validateQuery(TaskQueryParams.partial()), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const keys = req.authorizedRuntimeResourceKeys;
  const scopes = req.authorizedRuntimeResourceScopes;
  const requestedKey = typeof req.query.processDefinitionKey === 'string' ? req.query.processDefinitionKey : null;
  const visibleKeys = keys ? keys.filter((key) => !requestedKey || key === requestedKey) : null;
  const query = visibleKeys ? getBoundedRuntimeResourceQuery(req.query) : req.query;
  if (!visibleKeys) return res.json(await listTasks(engineId, query));
  const collections = await Promise.all(visibleKeys.map(async (processDefinitionKey) => {
    const data = await listTasks(engineId, { ...withAuthorizedRuntimeTenantQuery(query, scopes, processDefinitionKey), processDefinitionKey });
    return filterRuntimeItemsByProcessDefinitionKeys(engineId, data, [processDefinitionKey], scopes);
  }));
  res.json(collections.flat());
}));

// Get task count
r.get('/mission-control-api/tasks/count', requireRuntimeCollectionAction('engine.runtime.tasks.read', { resourceKind: 'process_definition' }), validateQuery(TaskQueryParams.partial()), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const keys = req.authorizedRuntimeResourceKeys;
  if (!keys) return res.json(await getTaskCountByQuery(engineId, req.query));

  // Camunda's count response cannot be post-filtered. A non-conforming engine
  // could return a whole-engine count despite the definition-key query, so do
  // not turn that unverified aggregate into a resource-aware visibility leak.
  throw Errors.forbidden('Resource-aware task counts are not supported');
}));

// Get task by ID
r.get('/mission-control-api/tasks/:id', requireTaskAction('engine.runtime.tasks.read'), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const taskId = String(req.params.id);
  const data = await getTaskById(engineId, taskId);
  res.json(data);
}));

// Get task variables
r.get('/mission-control-api/tasks/:id/variables', requireTaskAction('engine.runtime.tasks.variables.read'), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const taskId = String(req.params.id);
  const data = await getTaskVariablesById(engineId, taskId);
  res.json(data);
}));

// Update task variables
r.put('/mission-control-api/tasks/:id/variables', requireTaskAction('engine.runtime.tasks.variables.update', 'body'), validateBody(TaskVariablesRequest), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const taskId = String(req.params.id);
  const data = await updateTaskVariablesById(engineId, taskId, req.body);
  res.json(data);
}));

// Get task form
r.get('/mission-control-api/tasks/:id/form', requireTaskAction('engine.runtime.tasks.read'), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const taskId = String(req.params.id);
  const data = await getTaskFormById(engineId, taskId);
  res.json(data);
}));

// Claim task
r.post('/mission-control-api/tasks/:id/claim', requireTaskAction('engine.runtime.tasks.assignment.update', 'body'), validateBody(ClaimTaskRequest), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const taskId = String(req.params.id);
  await claimTaskById(engineId, taskId, req.body);
  res.status(204).end();
}));

// Unclaim task
r.post('/mission-control-api/tasks/:id/unclaim', requireTaskAction('engine.runtime.tasks.assignment.update', 'body'), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const taskId = String(req.params.id);
  await unclaimTaskById(engineId, taskId);
  res.status(204).end();
}));

// Set task assignee
r.post('/mission-control-api/tasks/:id/assignee', requireTaskAction('engine.runtime.tasks.assignment.update', 'body'), validateBody(SetAssigneeRequest), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const taskId = String(req.params.id);
  await setTaskAssigneeById(engineId, taskId, req.body);
  res.status(204).end();
}));

// Complete task
r.post('/mission-control-api/tasks/:id/complete', requireTaskAction('engine.runtime.tasks.complete', 'body'), validateBody(CompleteTaskRequest.partial()), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const taskId = String(req.params.id);
  const data = await completeTaskById(engineId, taskId, req.body);
  res.json(data || {});
}));

export default r;

import { Router, Request, Response } from 'express';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { validateBody, validateQuery } from '@enterpriseglue/shared/middleware/validate.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { requireRuntimeCollectionAction, requireRuntimeDefinitionAction } from '@enterpriseglue/shared/middleware/requireAction.js';
import {
  fetchAndLockTasks,
  listExternalTasks,
  completeTask,
  failTask,
  bpmnErrorTask,
  extendTaskLock,
  unlockTask,
} from './external-tasks-service.js';
import {
  FetchAndLockRequest,
  CompleteExternalTaskRequest,
  ExternalTaskFailureRequest,
  ExternalTaskBpmnErrorRequest,
  ExtendLockRequest,
  ExternalTaskQueryParams,
} from '@enterpriseglue/shared/schemas/mission-control/external-task.js';
import {
  filterRuntimeItemsByProcessDefinitionKeys,
  getBoundedRuntimeFetchAndLockRequest,
  getBoundedRuntimeResourceQuery,
} from './runtime-resource-filter.js';

const r = Router();

const requireExternalTaskAction = (actionId: string) => requireRuntimeDefinitionAction(actionId, {
  resourceKind: 'process_definition',
  definitionPath: 'external-task',
  definitionReferenceField: 'processDefinitionId',
  definitionReferencePath: 'process-definition',
  engineIdFrom: 'body',
});

// Apply auth middleware only to /mission-control-api routes (not globally)
r.use('/mission-control-api', requireAuth);

// Fetch and lock external tasks
r.post('/mission-control-api/external-tasks/fetchAndLock', requireRuntimeCollectionAction('engine.runtime.external-tasks.fetch-and-lock', {
  resourceKind: 'process_definition',
  engineIdFrom: 'body',
}), validateBody(FetchAndLockRequest), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const keys = req.authorizedRuntimeResourceKeys;
  if (!keys) return res.json(await fetchAndLockTasks(engineId, req.body));
  const body = getBoundedRuntimeFetchAndLockRequest(req.body);
  const topics = body.topics.flatMap((topic: Record<string, unknown>) => {
    if (typeof topic.processDefinitionId === 'string' || Array.isArray(topic.processDefinitionIdIn)) {
      throw Errors.validation('Resource-aware external task fetch requires processDefinitionKey filters');
    }
    if (typeof topic.processDefinitionKey === 'string') {
      return keys.includes(topic.processDefinitionKey) ? [topic] : [];
    }
    if (Array.isArray(topic.processDefinitionKeyIn)) {
      return topic.processDefinitionKeyIn
        .filter((key): key is string => typeof key === 'string' && keys.includes(key))
        .map((processDefinitionKey) => ({ ...topic, processDefinitionKey, processDefinitionKeyIn: undefined }));
    }
    return keys.map((processDefinitionKey) => ({ ...topic, processDefinitionKey }));
  });
  if (!topics.length) throw Errors.forbidden('No authorized runtime resources match the requested external task topics');
  const data = await fetchAndLockTasks(engineId, { ...body, topics });
  res.json(await filterRuntimeItemsByProcessDefinitionKeys(engineId, data, keys));
}));

// Query external tasks
r.get('/mission-control-api/external-tasks', requireRuntimeCollectionAction('engine.runtime.external-tasks.read', { resourceKind: 'process_definition' }), validateQuery(ExternalTaskQueryParams.partial()), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const keys = req.authorizedRuntimeResourceKeys;
  const requestedKey = typeof req.query.processDefinitionKey === 'string' ? req.query.processDefinitionKey : null;
  const visibleKeys = keys ? keys.filter((key) => !requestedKey || key === requestedKey) : null;
  const query = keys ? getBoundedRuntimeResourceQuery(req.query) : req.query;
  if (!visibleKeys) return res.json(await listExternalTasks(engineId, query));

  const collections = await Promise.all(visibleKeys.map(async (processDefinitionKey) => {
    const data = await listExternalTasks(engineId, { ...query, processDefinitionKey });
    return filterRuntimeItemsByProcessDefinitionKeys(engineId, data, [processDefinitionKey]);
  }));
  res.json(collections.flat());
}));

// Complete external task
r.post('/mission-control-api/external-tasks/:id/complete', requireExternalTaskAction('engine.runtime.external-tasks.complete'), validateBody(CompleteExternalTaskRequest), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const taskId = String(req.params.id);
  await completeTask(engineId, taskId, req.body);
  res.status(204).end();
}));

// Handle external task failure
r.post('/mission-control-api/external-tasks/:id/failure', requireExternalTaskAction('engine.runtime.external-tasks.failure'), validateBody(ExternalTaskFailureRequest), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const taskId = String(req.params.id);
  await failTask(engineId, taskId, req.body);
  res.status(204).end();
}));

// Handle external task BPMN error
r.post('/mission-control-api/external-tasks/:id/bpmnError', requireExternalTaskAction('engine.runtime.external-tasks.bpmn-error'), validateBody(ExternalTaskBpmnErrorRequest), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const taskId = String(req.params.id);
  await bpmnErrorTask(engineId, taskId, req.body);
  res.status(204).end();
}));

// Extend external task lock
r.post('/mission-control-api/external-tasks/:id/extendLock', requireExternalTaskAction('engine.runtime.external-tasks.extend-lock'), validateBody(ExtendLockRequest), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const taskId = String(req.params.id);
  await extendTaskLock(engineId, taskId, req.body);
  res.status(204).end();
}));

// Unlock external task
r.post('/mission-control-api/external-tasks/:id/unlock', requireExternalTaskAction('engine.runtime.external-tasks.unlock'), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const taskId = String(req.params.id);
  await unlockTask(engineId, taskId);
  res.status(204).end();
}));

export default r;

import { Router, Request, Response } from 'express';
import { asyncHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { validateBody, validateQuery } from '@enterpriseglue/shared/middleware/validate.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { requireAction } from '@enterpriseglue/shared/middleware/requireAction.js';
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

const r = Router();

// Apply auth middleware only to /mission-control-api routes (not globally)
r.use('/mission-control-api', requireAuth);

// Fetch and lock external tasks
r.post('/mission-control-api/external-tasks/fetchAndLock', requireAction('engine.runtime.external-tasks.fetch-and-lock', { resourceIdFrom: 'body' }), validateBody(FetchAndLockRequest), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const data = await fetchAndLockTasks(engineId, req.body);
  res.json(data);
}));

// Query external tasks
r.get('/mission-control-api/external-tasks', requireAction('engine.runtime.external-tasks.read', { resourceIdFrom: 'query' }), validateQuery(ExternalTaskQueryParams.partial()), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const data = await listExternalTasks(engineId, req.query);
  res.json(data);
}));

// Complete external task
r.post('/mission-control-api/external-tasks/:id/complete', requireAction('engine.runtime.external-tasks.complete', { resourceIdFrom: 'body' }), validateBody(CompleteExternalTaskRequest), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const taskId = String(req.params.id);
  await completeTask(engineId, taskId, req.body);
  res.status(204).end();
}));

// Handle external task failure
r.post('/mission-control-api/external-tasks/:id/failure', requireAction('engine.runtime.external-tasks.failure', { resourceIdFrom: 'body' }), validateBody(ExternalTaskFailureRequest), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const taskId = String(req.params.id);
  await failTask(engineId, taskId, req.body);
  res.status(204).end();
}));

// Handle external task BPMN error
r.post('/mission-control-api/external-tasks/:id/bpmnError', requireAction('engine.runtime.external-tasks.bpmn-error', { resourceIdFrom: 'body' }), validateBody(ExternalTaskBpmnErrorRequest), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const taskId = String(req.params.id);
  await bpmnErrorTask(engineId, taskId, req.body);
  res.status(204).end();
}));

// Extend external task lock
r.post('/mission-control-api/external-tasks/:id/extendLock', requireAction('engine.runtime.external-tasks.extend-lock', { resourceIdFrom: 'body' }), validateBody(ExtendLockRequest), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const taskId = String(req.params.id);
  await extendTaskLock(engineId, taskId, req.body);
  res.status(204).end();
}));

// Unlock external task
r.post('/mission-control-api/external-tasks/:id/unlock', requireAction('engine.runtime.external-tasks.unlock', { resourceIdFrom: 'body' }), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const taskId = String(req.params.id);
  await unlockTask(engineId, taskId);
  res.status(204).end();
}));

export default r;

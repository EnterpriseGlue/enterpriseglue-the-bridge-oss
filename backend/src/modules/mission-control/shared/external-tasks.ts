import { Router, Request, Response } from 'express';
import { asyncHandler } from '@shared/middleware/errorHandler.js';
import { validateBody, validateQuery } from '@shared/middleware/validate.js';
import { requireAuth } from '@shared/middleware/auth.js';
import { requireEngineReadOrWrite } from '@shared/middleware/engineAuth.js';
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
} from '@shared/schemas/mission-control/external-task.js';

const r = Router();

r.use(requireAuth, requireEngineReadOrWrite());

// Fetch and lock external tasks
r.post('/mission-control-api/external-tasks/fetchAndLock', validateBody(FetchAndLockRequest), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const data = await fetchAndLockTasks(engineId, req.body);
  res.json(data);
}));

// Query external tasks
r.get('/mission-control-api/external-tasks', validateQuery(ExternalTaskQueryParams.partial()), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const data = await listExternalTasks(engineId, req.query);
  res.json(data);
}));

// Complete external task
r.post('/mission-control-api/external-tasks/:id/complete', validateBody(CompleteExternalTaskRequest), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  await completeTask(engineId, req.params.id, req.body);
  res.status(204).end();
}));

// Handle external task failure
r.post('/mission-control-api/external-tasks/:id/failure', validateBody(ExternalTaskFailureRequest), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  await failTask(engineId, req.params.id, req.body);
  res.status(204).end();
}));

// Handle external task BPMN error
r.post('/mission-control-api/external-tasks/:id/bpmnError', validateBody(ExternalTaskBpmnErrorRequest), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  await bpmnErrorTask(engineId, req.params.id, req.body);
  res.status(204).end();
}));

// Extend external task lock
r.post('/mission-control-api/external-tasks/:id/extendLock', validateBody(ExtendLockRequest), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  await extendTaskLock(engineId, req.params.id, req.body);
  res.status(204).end();
}));

// Unlock external task
r.post('/mission-control-api/external-tasks/:id/unlock', asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  await unlockTask(engineId, req.params.id);
  res.status(204).end();
}));

export default r;

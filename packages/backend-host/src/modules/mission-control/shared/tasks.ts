import { Router, Request, Response } from 'express';
import { asyncHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { validateBody, validateQuery } from '@enterpriseglue/shared/middleware/validate.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { missionControlLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { requireEngineReadOrWrite } from '@enterpriseglue/shared/middleware/engineAuth.js';
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

const r = Router();

// Apply auth middleware only to /mission-control-api routes (not globally)
r.use('/mission-control-api', requireAuth, requireEngineReadOrWrite(), missionControlLimiter);

// Query tasks
r.get('/mission-control-api/tasks', validateQuery(TaskQueryParams.partial()), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const data = await listTasks(engineId, req.query);
  res.json(data);
}));

// Get task count
r.get('/mission-control-api/tasks/count', validateQuery(TaskQueryParams.partial()), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const data = await getTaskCountByQuery(engineId, req.query);
  res.json(data);
}));

// Get task by ID
r.get('/mission-control-api/tasks/:id', asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const taskId = String(req.params.id);
  const data = await getTaskById(engineId, taskId);
  res.json(data);
}));

// Get task variables
r.get('/mission-control-api/tasks/:id/variables', asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const taskId = String(req.params.id);
  const data = await getTaskVariablesById(engineId, taskId);
  res.json(data);
}));

// Update task variables
r.put('/mission-control-api/tasks/:id/variables', validateBody(TaskVariablesRequest), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const taskId = String(req.params.id);
  const data = await updateTaskVariablesById(engineId, taskId, req.body);
  res.json(data);
}));

// Get task form
r.get('/mission-control-api/tasks/:id/form', asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const taskId = String(req.params.id);
  const data = await getTaskFormById(engineId, taskId);
  res.json(data);
}));

// Claim task
r.post('/mission-control-api/tasks/:id/claim', validateBody(ClaimTaskRequest), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const taskId = String(req.params.id);
  await claimTaskById(engineId, taskId, req.body);
  res.status(204).end();
}));

// Unclaim task
r.post('/mission-control-api/tasks/:id/unclaim', asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const taskId = String(req.params.id);
  await unclaimTaskById(engineId, taskId);
  res.status(204).end();
}));

// Set task assignee
r.post('/mission-control-api/tasks/:id/assignee', validateBody(SetAssigneeRequest), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const taskId = String(req.params.id);
  await setTaskAssigneeById(engineId, taskId, req.body);
  res.status(204).end();
}));

// Complete task
r.post('/mission-control-api/tasks/:id/complete', validateBody(CompleteTaskRequest.partial()), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const taskId = String(req.params.id);
  const data = await completeTaskById(engineId, taskId, req.body);
  res.json(data || {});
}));

export default r;

import { Router, Request, Response } from 'express';
import { asyncHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { validateBody, validateQuery } from '@enterpriseglue/shared/middleware/validate.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { requireEngineReadOrWrite } from '@enterpriseglue/shared/middleware/engineAuth.js';
import {
  listJobs,
  getJobById,
  executeJobById,
  setJobRetriesById,
  setJobSuspensionStateById,
  listJobDefinitions,
  setJobDefinitionRetriesById,
  setJobDefinitionSuspensionStateById,
} from './jobs-service.js';
import {
  JobQueryParams,
  JobDefinitionQueryParams,
  SetJobRetriesRequest,
  SetJobSuspensionStateRequest,
  SetJobDefinitionRetriesRequest,
  SetJobDefinitionSuspensionStateRequest,
} from '@enterpriseglue/shared/schemas/mission-control/job.js';

const r = Router();

// Apply auth middleware only to /mission-control-api routes (not globally)
r.use('/mission-control-api', requireAuth, requireEngineReadOrWrite());

// Query jobs
r.get('/mission-control-api/jobs', validateQuery(JobQueryParams.partial()), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const data = await listJobs(engineId, req.query);
  res.json(data);
}));

// Get job by ID
r.get('/mission-control-api/jobs/:id', asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const jobId = String(req.params.id);
  const data = await getJobById(engineId, jobId);
  res.json(data);
}));

// Execute job
r.post('/mission-control-api/jobs/:id/execute', asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const jobId = String(req.params.id);
  await executeJobById(engineId, jobId);
  res.status(204).end();
}));

// Set job retries
r.put('/mission-control-api/jobs/:id/retries', validateBody(SetJobRetriesRequest), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const jobId = String(req.params.id);
  await setJobRetriesById(engineId, jobId, req.body);
  res.status(204).end();
}));

// Set job suspension state
r.put('/mission-control-api/jobs/:id/suspended', validateBody(SetJobSuspensionStateRequest), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const jobId = String(req.params.id);
  await setJobSuspensionStateById(engineId, jobId, req.body);
  res.status(204).end();
}));

// Query job definitions
r.get('/mission-control-api/job-definitions', validateQuery(JobDefinitionQueryParams.partial()), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const data = await listJobDefinitions(engineId, req.query);
  res.json(data);
}));

// Set job definition retries
r.put('/mission-control-api/job-definitions/:id/retries', validateBody(SetJobDefinitionRetriesRequest), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const jobDefinitionId = String(req.params.id);
  await setJobDefinitionRetriesById(engineId, jobDefinitionId, req.body);
  res.status(204).end();
}));

// Set job definition suspension state
r.put('/mission-control-api/job-definitions/:id/suspended', validateBody(SetJobDefinitionSuspensionStateRequest), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const jobDefinitionId = String(req.params.id);
  await setJobDefinitionSuspensionStateById(engineId, jobDefinitionId, req.body);
  res.status(204).end();
}));

export default r;

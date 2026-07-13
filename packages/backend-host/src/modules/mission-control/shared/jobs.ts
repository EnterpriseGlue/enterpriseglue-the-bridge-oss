import { Router, Request, Response } from 'express';
import { asyncHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { validateBody, validateQuery } from '@enterpriseglue/shared/middleware/validate.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { requireRuntimeCollectionAction, requireRuntimeDefinitionAction } from '@enterpriseglue/shared/middleware/requireAction.js';
import {
  listJobs,
  getJobById,
  executeJobById,
  setJobRetriesById,
  setJobSuspensionStateById,
  listJobDefinitions,
  setJobDefinitionRetriesById,
  setJobDefinitionSuspensionStateById,
  filterRuntimeItemsByProcessDefinitionKeys,
} from './jobs-service.js';
import {
  JobQueryParams,
  JobDefinitionQueryParams,
  SetJobRetriesRequest,
  SetJobSuspensionStateRequest,
  SetJobDefinitionRetriesRequest,
  SetJobDefinitionSuspensionStateRequest,
} from '@enterpriseglue/shared/schemas/mission-control/job.js';
import { getBoundedRuntimeResourceQuery } from './runtime-resource-filter.js';

const r = Router();

// Apply auth middleware only to /mission-control-api routes (not globally)
r.use('/mission-control-api', requireAuth);

// Query jobs
r.get('/mission-control-api/jobs', requireRuntimeCollectionAction('engine.runtime.jobs.read', { resourceKind: 'process_definition' }), validateQuery(JobQueryParams.partial()), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const keys = req.authorizedRuntimeResourceKeys;
  if (!keys) {
    return res.json(await listJobs(engineId, req.query));
  }

  const requestedKey = typeof req.query.processDefinitionKey === 'string' ? req.query.processDefinitionKey : null;
  const visibleKeys = keys.filter((key) => !requestedKey || key === requestedKey);
  const query = getBoundedRuntimeResourceQuery(req.query);
  const collections = await Promise.all(visibleKeys.map(async (processDefinitionKey) => {
    const data = await listJobs(engineId, { ...query, processDefinitionKey });
    return filterRuntimeItemsByProcessDefinitionKeys(engineId, data, [processDefinitionKey]);
  }));
  res.json(collections.flat());
}));

// Get job by ID
r.get('/mission-control-api/jobs/:id', requireRuntimeDefinitionAction('engine.runtime.jobs.read', {
  resourceKind: 'process_definition',
  definitionPath: 'job',
  definitionReferenceField: 'processDefinitionId',
  definitionReferencePath: 'process-definition',
}), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const jobId = String(req.params.id);
  const data = await getJobById(engineId, jobId);
  res.json(data);
}));

// Execute job
r.post('/mission-control-api/jobs/:id/execute', requireRuntimeDefinitionAction('engine.runtime.jobs.execute', {
  resourceKind: 'process_definition',
  definitionPath: 'job',
  definitionReferenceField: 'processDefinitionId',
  definitionReferencePath: 'process-definition',
  engineIdFrom: 'body',
}), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const jobId = String(req.params.id);
  await executeJobById(engineId, jobId);
  res.status(204).end();
}));

// Set job retries
r.put('/mission-control-api/jobs/:id/retries', requireRuntimeDefinitionAction('engine.runtime.jobs.retries.update', {
  resourceKind: 'process_definition',
  definitionPath: 'job',
  definitionReferenceField: 'processDefinitionId',
  definitionReferencePath: 'process-definition',
  engineIdFrom: 'body',
}), validateBody(SetJobRetriesRequest), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const jobId = String(req.params.id);
  await setJobRetriesById(engineId, jobId, req.body);
  res.status(204).end();
}));

// Set job suspension state
r.put('/mission-control-api/jobs/:id/suspended', requireRuntimeDefinitionAction('engine.runtime.jobs.suspension.update', {
  resourceKind: 'process_definition',
  definitionPath: 'job',
  definitionReferenceField: 'processDefinitionId',
  definitionReferencePath: 'process-definition',
  engineIdFrom: 'body',
}), validateBody(SetJobSuspensionStateRequest), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const jobId = String(req.params.id);
  await setJobSuspensionStateById(engineId, jobId, req.body);
  res.status(204).end();
}));

// Query job definitions
r.get('/mission-control-api/job-definitions', requireRuntimeCollectionAction('engine.runtime.job-definitions.read', { resourceKind: 'process_definition' }), validateQuery(JobDefinitionQueryParams.partial()), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const keys = req.authorizedRuntimeResourceKeys;
  if (!keys) {
    return res.json(await listJobDefinitions(engineId, req.query));
  }

  const requestedKey = typeof req.query.processDefinitionKey === 'string' ? req.query.processDefinitionKey : null;
  const visibleKeys = keys.filter((key) => !requestedKey || key === requestedKey);
  const query = getBoundedRuntimeResourceQuery(req.query);
  const collections = await Promise.all(visibleKeys.map(async (processDefinitionKey) => {
    const data = await listJobDefinitions(engineId, { ...query, processDefinitionKey });
    return filterRuntimeItemsByProcessDefinitionKeys(engineId, data, [processDefinitionKey]);
  }));
  res.json(collections.flat());
}));

// Set job definition retries
r.put('/mission-control-api/job-definitions/:id/retries', requireRuntimeDefinitionAction('engine.runtime.job-definitions.retries.update', {
  resourceKind: 'process_definition',
  definitionPath: 'job-definition',
  definitionReferenceField: 'processDefinitionId',
  definitionReferencePath: 'process-definition',
  engineIdFrom: 'body',
}), validateBody(SetJobDefinitionRetriesRequest), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const jobDefinitionId = String(req.params.id);
  await setJobDefinitionRetriesById(engineId, jobDefinitionId, req.body);
  res.status(204).end();
}));

// Set job definition suspension state
r.put('/mission-control-api/job-definitions/:id/suspended', requireRuntimeDefinitionAction('engine.runtime.job-definitions.suspension.update', {
  resourceKind: 'process_definition',
  definitionPath: 'job-definition',
  definitionReferenceField: 'processDefinitionId',
  definitionReferencePath: 'process-definition',
  engineIdFrom: 'body',
}), validateBody(SetJobDefinitionSuspensionStateRequest), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const jobDefinitionId = String(req.params.id);
  await setJobDefinitionSuspensionStateById(engineId, jobDefinitionId, req.body);
  res.status(204).end();
}));

export default r;

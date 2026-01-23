import { Router, Request, Response } from 'express'
import { z } from 'zod'
import {
  listProcessDefinitions,
  getProcessDefinitionById,
  getProcessDefinitionXmlById,
  resolveProcessDefinition,
  getActiveActivityCounts,
  getActivityCountsByState,
  previewProcessInstanceCount,
  listProcessInstancesDetailed,
  getProcessInstanceById,
  getProcessInstanceVariables,
  listProcessInstanceActivityHistory,
  listProcessInstanceJobs,
  getHistoricProcessInstanceById,
  listHistoricProcessInstances,
  listHistoricVariableInstances,
  listProcessInstanceIncidents,
  suspendProcessInstanceById,
  activateProcessInstanceById,
  deleteProcessInstanceById,
  listFailedExternalTasks,
  retryProcessInstanceFailures,
} from './mission-control-service.js'
import { asyncHandler, Errors } from '@shared/middleware/errorHandler.js'
import { validateBody } from '@shared/middleware/validate.js'
import { requireAuth } from '@shared/middleware/auth.js'
import { requireEngineReadOrWrite } from '@shared/middleware/engineAuth.js'

// Validation schemas
const previewCountSchema = z.object({}).passthrough()

const retrySchema = z.object({
  jobIds: z.array(z.string()).optional(),
  externalTaskIds: z.array(z.string()).optional(),
  dueDate: z.string().optional(),
  retries: z.number().int().min(0).optional(),
})

const r = Router()

// Type for process instance output
interface ProcessInstanceOutput {
  id: string;
  processDefinitionKey: string | undefined;
  version: number | undefined;
  superProcessInstanceId: string | null;
  rootProcessInstanceId: string | null;
  startTime: string | null;
  endTime: string | null;
  state: 'ACTIVE' | 'SUSPENDED' | 'COMPLETED' | 'CANCELED' | 'INCIDENT';
  hasIncident?: boolean;
}

r.use(requireAuth, requireEngineReadOrWrite())

// -----------------------------
// Process Definitions
// -----------------------------
r.get('/mission-control-api/process-definitions', asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const data = await listProcessDefinitions(engineId, req.query as { key?: string; nameLike?: string; latest?: string })
    res.json(data)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to load process definitions')
  }
}))

r.get('/mission-control-api/process-definitions/:id', asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const data = await getProcessDefinitionById(engineId, req.params.id)
    res.json(data)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to load process definition')
  }
}))

r.get('/mission-control-api/process-definitions/:id/xml', asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const data = await getProcessDefinitionXmlById(engineId, req.params.id)
    res.json(data)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to load process definition XML')
  }
}))

// Resolve a process definition by key + version
r.get('/mission-control-api/process-definitions/resolve', asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const data = await resolveProcessDefinition(engineId, req.query as { key?: string; version?: string })
    res.json(data)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to resolve process definition')
  }
}))

// Active activity counts for a specific process definition (version-specific)
r.get('/mission-control-api/process-definitions/:id/active-activity-counts', asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const counts = await getActiveActivityCounts(engineId, req.params.id)
    res.json(counts)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to load active activity counts')
  }
}))

// Activity counts by state for a specific process definition
// Returns: { active: { actId: count }, incidents: { actId: count }, suspended: { actId: count }, canceled: { actId: count }, completed: { actId: count } }
r.get('/mission-control-api/process-definitions/:id/activity-counts-by-state', asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const result = await getActivityCountsByState(engineId, req.params.id)
    res.json(result)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to load activity counts by state')
  }
}))

// -----------------------------
// Process Instances
// -----------------------------
r.post('/mission-control-api/process-instances/preview-count', validateBody(previewCountSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const data = await previewProcessInstanceCount(engineId, req.body || {})
    res.json(data)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to preview count')
  }
}))
r.get('/mission-control-api/process-instances', asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const data = await listProcessInstancesDetailed(engineId, req.query as any)
    res.json(data)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to load process instances')
  }
}))

r.get('/mission-control-api/process-instances/:id', asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const data = await getProcessInstanceById(engineId, req.params.id)
    res.json(data)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to load process instance')
  }
}))

r.get('/mission-control-api/process-instances/:id/variables', asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const data = await getProcessInstanceVariables(engineId, req.params.id)
    res.json(data)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to load instance variables')
  }
}))

r.get('/mission-control-api/process-instances/:id/history/activity-instances', asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const data = await listProcessInstanceActivityHistory(engineId, req.params.id)
    res.json(data)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to load activity instances history')
  }
}))

r.get('/mission-control-api/process-instances/:id/jobs', asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const data = await listProcessInstanceJobs(engineId, req.params.id)
    res.json(data)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to load jobs')
  }
}))

// History: process instance details (works for finished instances)
r.get('/mission-control-api/history/process-instances/:id', asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const data = await getHistoricProcessInstanceById(engineId, req.params.id)
    res.json(data)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to load historic process instance')
  }
}))

// History: list with arbitrary filters (e.g., superProcessInstanceId)
r.get('/mission-control-api/history/process-instances', asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const data = await listHistoricProcessInstances(engineId, req.query as any)
    res.json(data)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to load historic process instances')
  }
}))

r.get('/mission-control-api/process-instances/:id/incidents', asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const data = await listProcessInstanceIncidents(engineId, req.params.id)
    res.json(data)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to load incidents')
  }
}))

// History: variable instances
r.get('/mission-control-api/history/variable-instances', asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const data = await listHistoricVariableInstances(engineId, req.query as any)
    res.json(data)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to load historic variables')
  }
}))

// -----------------------------
// Instance actions
// -----------------------------
r.put('/mission-control-api/process-instances/:id/suspend', asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    await suspendProcessInstanceById(engineId, req.params.id)
    res.status(204).end()
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to suspend instance')
  }
}))

r.put('/mission-control-api/process-instances/:id/activate', asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    await activateProcessInstanceById(engineId, req.params.id)
    res.status(204).end()
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to activate instance')
  }
}))

r.delete('/mission-control-api/process-instances/:id', asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    await deleteProcessInstanceById(engineId, req.params.id)
    res.status(204).end()
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to delete instance')
  }
}))

// Preview count
// Get failed external tasks for a process instance
r.get('/mission-control-api/process-instances/:id/failed-external-tasks', asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const data = await listFailedExternalTasks(engineId, req.params.id)
    res.json(data)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to load external tasks')
  }
}))

// Retry failed jobs and external tasks for a process instance
r.post('/mission-control-api/process-instances/:id/retry', validateBody(retrySchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    await retryProcessInstanceFailures(engineId, req.params.id, req.body || {})
    res.status(204).end()
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to retry')
  }
}))

export default r

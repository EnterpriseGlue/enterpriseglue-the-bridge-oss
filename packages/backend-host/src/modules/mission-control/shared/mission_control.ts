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
  getProcessInstanceExecutionDetails,
  listProcessInstanceJobs,
  getHistoricProcessInstanceById,
  listHistoricProcessInstances,
  getProcessInstanceVariableHistory,
  listHistoricVariableInstances,
  listProcessInstanceIncidents,
  suspendProcessInstanceById,
  activateProcessInstanceById,
  deleteProcessInstanceById,
  listFailedExternalTasks,
  retryProcessInstanceFailures,
} from './mission-control-service.js'
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js'
import { validateBody, validateQuery } from '@enterpriseglue/shared/middleware/validate.js'
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js'
import { requireEngineReadOrWrite } from '@enterpriseglue/shared/middleware/engineAuth.js'
import { piiRedactionService } from '@enterpriseglue/shared/services/pii/PiiRedactionService.js'

// Validation schemas
const previewCountSchema = z.object({}).passthrough()
const variableHistoryQuerySchema = z.object({
  variableInstanceId: z.string().min(1),
}).passthrough()

const retrySchema = z.object({
  jobIds: z.array(z.string()).optional(),
  externalTaskIds: z.array(z.string()).optional(),
  dueDate: z.string().optional(),
  retries: z.number().int().min(0).optional(),
})

const executionDetailsQuerySchema = z.object({
  activityInstanceId: z.string().min(1),
  executionId: z.string().optional(),
  taskId: z.string().optional(),
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

// Apply auth middleware only to /mission-control-api routes (not globally)
r.use('/mission-control-api', requireAuth, requireEngineReadOrWrite())

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
    const definitionId = String(req.params.id)
    const data = await getProcessDefinitionById(engineId, definitionId)
    res.json(data)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to load process definition')
  }
}))

r.get('/mission-control-api/process-definitions/:id/xml', asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const definitionId = String(req.params.id)
    const data = await getProcessDefinitionXmlById(engineId, definitionId)
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
    const definitionId = String(req.params.id)
    const counts = await getActiveActivityCounts(engineId, definitionId)
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
    const definitionId = String(req.params.id)
    const result = await getActivityCountsByState(engineId, definitionId)
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
    const redacted = await piiRedactionService.redactPayload(req, data, 'processDetails')
    res.json(redacted)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to load process instances')
  }
}))

r.get('/mission-control-api/process-instances/:id', asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const instanceId = String(req.params.id)
    const data = await getProcessInstanceById(engineId, instanceId)
    const redacted = await piiRedactionService.redactPayload(req, data, 'processDetails')
    res.json(redacted)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to load process instance')
  }
}))

r.get('/mission-control-api/process-instances/:id/variables', asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const instanceId = String(req.params.id)
    const data = await getProcessInstanceVariables(engineId, instanceId)
    const redacted = await piiRedactionService.redactPayload(req, data, 'processDetails')
    res.json(redacted)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to load instance variables')
  }
}))

r.get('/mission-control-api/process-instances/:id/history/activity-instances', asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const instanceId = String(req.params.id)
    const data = await listProcessInstanceActivityHistory(engineId, instanceId)
    const redacted = await piiRedactionService.redactPayload(req, data, 'processDetails')
    res.json(redacted)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to load activity instances history')
  }
}))

r.get('/mission-control-api/process-instances/:id/execution-details', validateQuery(executionDetailsQuerySchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const instanceId = String(req.params.id)
    const query = req.query as z.infer<typeof executionDetailsQuerySchema>
    const data = await getProcessInstanceExecutionDetails(engineId, instanceId, query)
    const redacted = await piiRedactionService.redactPayload(req, data, 'history')
    res.json(redacted)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to load execution details')
  }
}))

r.get('/mission-control-api/process-instances/:id/jobs', asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const instanceId = String(req.params.id)
    const data = await listProcessInstanceJobs(engineId, instanceId)
    const redacted = await piiRedactionService.redactPayload(req, data, 'errors')
    res.json(redacted)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to load jobs')
  }
}))

// History: process instance details (works for finished instances)
r.get('/mission-control-api/history/process-instances/:id', asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const instanceId = String(req.params.id)
    const data = await getHistoricProcessInstanceById(engineId, instanceId)
    const redacted = await piiRedactionService.redactPayload(req, data, 'history')
    res.json(redacted)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to load historic process instance')
  }
}))

// History: list with arbitrary filters (e.g., superProcessInstanceId)
r.get('/mission-control-api/history/process-instances', asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const data = await listHistoricProcessInstances(engineId, req.query as any)
    const redacted = await piiRedactionService.redactPayload(req, data, 'history')
    res.json(redacted)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to load historic process instances')
  }
}))

r.get('/mission-control-api/process-instances/:id/variable-history', validateQuery(variableHistoryQuerySchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const instanceId = String(req.params.id)
    const { variableInstanceId } = req.query as { variableInstanceId: string }
    const data = await getProcessInstanceVariableHistory(engineId, instanceId, variableInstanceId)
    const redacted = await piiRedactionService.redactPayload(req, data, 'history')
    res.json(redacted)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to load variable history')
  }
}))

r.get('/mission-control-api/process-instances/:id/incidents', asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const instanceId = String(req.params.id)
    const data = await listProcessInstanceIncidents(engineId, instanceId)
    const redacted = await piiRedactionService.redactPayload(req, data, 'errors')
    res.json(redacted)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to load incidents')
  }
}))

// History: variable instances
r.get('/mission-control-api/history/variable-instances', asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const data = await listHistoricVariableInstances(engineId, req.query as any)
    const redacted = await piiRedactionService.redactPayload(req, data, 'history')
    res.json(redacted)
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
    const instanceId = String(req.params.id)
    await suspendProcessInstanceById(engineId, instanceId)
    res.status(204).end()
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to suspend instance')
  }
}))

r.put('/mission-control-api/process-instances/:id/activate', asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const instanceId = String(req.params.id)
    await activateProcessInstanceById(engineId, instanceId)
    res.status(204).end()
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to activate instance')
  }
}))

r.delete('/mission-control-api/process-instances/:id', asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const instanceId = String(req.params.id)
    await deleteProcessInstanceById(engineId, instanceId)
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
    const instanceId = String(req.params.id)
    const data = await listFailedExternalTasks(engineId, instanceId)
    res.json(data)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to load external tasks')
  }
}))

// Retry failed jobs and external tasks for a process instance
r.post('/mission-control-api/process-instances/:id/retry', validateBody(retrySchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const instanceId = String(req.params.id)
    await retryProcessInstanceFailures(engineId, instanceId, req.body || {})
    res.status(204).end()
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to retry')
  }
}))

export default r

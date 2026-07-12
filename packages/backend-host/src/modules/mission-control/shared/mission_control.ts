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
import { requireAction, requireRuntimeCollectionAction, requireRuntimeDefinitionAction } from '@enterpriseglue/shared/middleware/requireAction.js'
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

// Apply auth middleware only to /mission-control-api routes (not globally).
// Engine authorization is route-specific so scoped RBAC grants can stay granular.
r.use('/mission-control-api', requireAuth)

// -----------------------------
// Process Definitions
// -----------------------------
r.get('/mission-control-api/process-definitions', requireRuntimeCollectionAction('engine.runtime.process-definitions.read', { resourceKind: 'process_definition' }), asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const data = await listProcessDefinitions(engineId, req.query as { key?: string; nameLike?: string; latest?: string })
    const keys = req.authorizedRuntimeResourceKeys
    res.json(keys ? data.filter((definition) => keys.includes(String(definition?.key || ''))) : data)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to load process definitions')
  }
}))

// Resolve a process definition by key + version. This must precede `:id`.
r.get('/mission-control-api/process-definitions/resolve', requireRuntimeDefinitionAction('engine.runtime.process-definitions.read', {
  resourceKind: 'process_definition',
  definitionPath: 'process-definition',
  definitionLookup: 'key',
  definitionIdFrom: 'query',
  definitionIdKey: 'key',
  definitionVersionFrom: 'query',
}), asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const data = await resolveProcessDefinition(engineId, req.query as { key?: string; version?: string })
    res.json(data)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to resolve process definition')
  }
}))

r.get('/mission-control-api/process-definitions/:id', requireRuntimeDefinitionAction('engine.runtime.process-definitions.read', { resourceKind: 'process_definition', definitionPath: 'process-definition' }), asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const definitionId = String(req.params.id)
    const data = await getProcessDefinitionById(engineId, definitionId)
    res.json(data)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to load process definition')
  }
}))

r.get('/mission-control-api/process-definitions/:id/xml', requireRuntimeDefinitionAction('engine.runtime.process-definitions.read', { resourceKind: 'process_definition', definitionPath: 'process-definition' }), asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const definitionId = String(req.params.id)
    const data = await getProcessDefinitionXmlById(engineId, definitionId)
    res.json(data)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to load process definition XML')
  }
}))

// Active activity counts for a specific process definition (version-specific)
r.get('/mission-control-api/process-definitions/:id/active-activity-counts', requireRuntimeDefinitionAction('engine.runtime.process-definitions.read', { resourceKind: 'process_definition', definitionPath: 'process-definition' }), asyncHandler(async (req: Request, res: Response) => {
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
r.get('/mission-control-api/process-definitions/:id/activity-counts-by-state', requireRuntimeDefinitionAction('engine.runtime.process-definitions.read', { resourceKind: 'process_definition', definitionPath: 'process-definition' }), asyncHandler(async (req: Request, res: Response) => {
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
r.post('/mission-control-api/process-instances/preview-count', requireAction('engine.runtime.process-instances.read', { resourceIdFrom: 'body' }), validateBody(previewCountSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const data = await previewProcessInstanceCount(engineId, req.body || {})
    res.json(data)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to preview count')
  }
}))
r.get('/mission-control-api/process-instances', requireAction('engine.runtime.process-instances.read', { resourceIdFrom: 'query' }), asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const data = await listProcessInstancesDetailed(engineId, req.query as any)
    const redacted = await piiRedactionService.redactPayload(req, data, 'processDetails')
    res.json(redacted)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to load process instances')
  }
}))

r.get('/mission-control-api/process-instances/:id', requireAction('engine.runtime.process-instances.read', { resourceIdFrom: 'query' }), asyncHandler(async (req: Request, res: Response) => {
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

r.get('/mission-control-api/process-instances/:id/variables', requireAction('engine.runtime.process-instances.variables.read', { resourceIdFrom: 'query' }), asyncHandler(async (req: Request, res: Response) => {
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

r.get('/mission-control-api/process-instances/:id/history/activity-instances', requireAction('engine.runtime.process-instances.activity-history.read', { resourceIdFrom: 'query' }), asyncHandler(async (req: Request, res: Response) => {
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

r.get('/mission-control-api/process-instances/:id/execution-details', requireAction('engine.runtime.process-instances.execution-details.read', { resourceIdFrom: 'query' }), validateQuery(executionDetailsQuerySchema), asyncHandler(async (req: Request, res: Response) => {
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

r.get('/mission-control-api/process-instances/:id/jobs', requireAction('engine.runtime.jobs.read', { resourceIdFrom: 'query' }), asyncHandler(async (req: Request, res: Response) => {
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
r.get('/mission-control-api/history/process-instances/:id', requireAction('engine.runtime.history.process-instances.read', { resourceIdFrom: 'query' }), asyncHandler(async (req: Request, res: Response) => {
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
r.get('/mission-control-api/history/process-instances', requireAction('engine.runtime.history.process-instances.read', { resourceIdFrom: 'query' }), asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const data = await listHistoricProcessInstances(engineId, req.query as any)
    const redacted = await piiRedactionService.redactPayload(req, data, 'history')
    res.json(redacted)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to load historic process instances')
  }
}))

r.get('/mission-control-api/process-instances/:id/variable-history', requireAction('engine.runtime.process-instances.variable-history.read', { resourceIdFrom: 'query' }), validateQuery(variableHistoryQuerySchema), asyncHandler(async (req: Request, res: Response) => {
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

r.get('/mission-control-api/process-instances/:id/incidents', requireAction('engine.runtime.process-instances.incidents.read', { resourceIdFrom: 'query' }), asyncHandler(async (req: Request, res: Response) => {
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
r.get('/mission-control-api/history/variable-instances', requireAction('engine.runtime.history.variables.read', { resourceIdFrom: 'query' }), asyncHandler(async (req: Request, res: Response) => {
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
r.put('/mission-control-api/process-instances/:id/suspend', requireAction('engine.runtime.process-instances.suspension.update', { resourceIdFrom: 'body' }), asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const instanceId = String(req.params.id)
    await suspendProcessInstanceById(engineId, instanceId)
    res.status(204).end()
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to suspend instance')
  }
}))

r.put('/mission-control-api/process-instances/:id/activate', requireAction('engine.runtime.process-instances.suspension.update', { resourceIdFrom: 'body' }), asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const instanceId = String(req.params.id)
    await activateProcessInstanceById(engineId, instanceId)
    res.status(204).end()
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to activate instance')
  }
}))

r.delete('/mission-control-api/process-instances/:id', requireAction('engine.runtime.process-instances.delete', { resourceIdFrom: 'query' }), asyncHandler(async (req: Request, res: Response) => {
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
r.get('/mission-control-api/process-instances/:id/failed-external-tasks', requireAction('engine.runtime.external-tasks.read', { resourceIdFrom: 'query' }), asyncHandler(async (req: Request, res: Response) => {
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
r.post('/mission-control-api/process-instances/:id/retry', requireAction('engine.runtime.process-instances.retry', { resourceIdFrom: 'body' }), validateBody(retrySchema), asyncHandler(async (req: Request, res: Response) => {
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

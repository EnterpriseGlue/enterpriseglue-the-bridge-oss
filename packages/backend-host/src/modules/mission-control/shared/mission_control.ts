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
import { filterRuntimeItemsByProcessDefinitionKeys, filterRuntimeItemsByResourceKey, getBoundedRuntimeResourceQuery, withAuthorizedRuntimeTenantQuery } from './runtime-resource-filter.js'
import { addRuntimeProcessInstanceActionDecisions } from './runtime-row-action-decisions.js'
import {
  ActivityCountByActivityIdSchema,
  ActivityCountsByStateSchema,
  ActivityInstanceListSchema,
  ProcessDefinitionSchema,
  ProcessInstanceIncidentListSchema,
  ProcessInstanceJobListSchema,
  ProcessInstanceExternalTaskListSchema,
  ProcessInstanceDetailSchema,
  ProcessInstanceSchema,
  ProcessDefXmlSchema,
  PreviewCountResponseSchema,
  VariablesSchema,
} from '@enterpriseglue/shared/schemas/mission-control/process.js'
import { HistoricVariableInstanceListSchema, ProcessInstanceExecutionDetailsSchema, VariableHistoryEntrySchema } from '@enterpriseglue/shared/schemas/mission-control/history.js'

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

// Process instances inherit authorization from their process definition key.
// The guard resolves the instance from the engine before it evaluates access.
const requireProcessInstanceAction = (actionId: string) => requireRuntimeDefinitionAction(actionId, {
  resourceKind: 'process_definition',
  definitionPath: 'process-instance',
  resourceKeyFields: ['definitionKey', 'processDefinitionKey'],
  engineIdFrom: 'any',
})

const requireHistoricProcessInstanceAction = (actionId: string) => requireRuntimeDefinitionAction(actionId, {
  resourceKind: 'process_definition',
  definitionPath: 'history/process-instance',
  resourceKeyFields: ['processDefinitionKey', 'definitionKey'],
})

// Apply auth middleware only to /mission-control-api routes (not globally).
// Engine authorization is route-specific so scoped RBAC grants can stay granular.
r.use('/mission-control-api', requireAuth)

// -----------------------------
// Process Definitions
// -----------------------------
r.get('/mission-control-api/process-definitions', requireRuntimeCollectionAction('engine.runtime.process-definitions.read', { resourceKind: 'process_definition' }), asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const keys = req.authorizedRuntimeResourceKeys
    const scopes = req.authorizedRuntimeResourceScopes
    if (!keys) {
      return res.json(z.array(ProcessDefinitionSchema).parse(await listProcessDefinitions(engineId, req.query as { key?: string; nameLike?: string; latest?: string; maxResults?: number })))
    }

    const requestedKey = typeof req.query.key === 'string' ? req.query.key : null
    const visibleKeys = keys.filter((candidate) => !requestedKey || candidate === requestedKey)
    const query = getBoundedRuntimeResourceQuery(req.query)
    const collections = await Promise.all(visibleKeys.map(async (processDefinitionKey) => {
      const definitions = await listProcessDefinitions(engineId, { ...withAuthorizedRuntimeTenantQuery(query, scopes, processDefinitionKey), key: processDefinitionKey })
      return filterRuntimeItemsByResourceKey(definitions, [processDefinitionKey], 'key', scopes)
    }))
    res.json(z.array(ProcessDefinitionSchema).parse(collections.flat()))
  } catch (e: any) {
    if (e?.statusCode) throw e
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
    res.json(ProcessDefinitionSchema.parse(data))
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to resolve process definition')
  }
}))

r.get('/mission-control-api/process-definitions/:id', requireRuntimeDefinitionAction('engine.runtime.process-definitions.read', { resourceKind: 'process_definition', definitionPath: 'process-definition' }), asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const definitionId = String(req.params.id)
    const data = await getProcessDefinitionById(engineId, definitionId)
    res.json(ProcessDefinitionSchema.parse(data))
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to load process definition')
  }
}))

r.get('/mission-control-api/process-definitions/:id/xml', requireRuntimeDefinitionAction('engine.runtime.process-definitions.read', { resourceKind: 'process_definition', definitionPath: 'process-definition' }), asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const definitionId = String(req.params.id)
    const data = await getProcessDefinitionXmlById(engineId, definitionId)
    res.json(ProcessDefXmlSchema.parse(data))
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
    res.json(ActivityCountByActivityIdSchema.parse(counts))
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
    res.json(ActivityCountsByStateSchema.parse(result))
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to load activity counts by state')
  }
}))

// -----------------------------
// Process Instances
// -----------------------------
r.post('/mission-control-api/process-instances/preview-count', requireRuntimeCollectionAction('engine.runtime.process-instances.read', {
  resourceKind: 'process_definition',
  engineIdFrom: 'body',
}), validateBody(previewCountSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const keys = req.authorizedRuntimeResourceKeys
    const scopes = req.authorizedRuntimeResourceScopes
    if (!keys) {
      return res.json(PreviewCountResponseSchema.parse(await previewProcessInstanceCount(engineId, req.body || {})))
    }
    throw Errors.forbidden('Resource-aware process-instance preview counts are not supported')
  } catch (e: any) {
    if (e?.statusCode) throw e
    throw Errors.internal(e?.message || 'Failed to preview count')
  }
}))
r.get('/mission-control-api/process-instances', requireRuntimeCollectionAction('engine.runtime.process-instances.read', { resourceKind: 'process_definition' }), asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const keys = req.authorizedRuntimeResourceKeys
    const scopes = req.authorizedRuntimeResourceScopes
    const requestedKey = typeof req.query.processDefinitionKey === 'string' ? req.query.processDefinitionKey : null
    const visibleKeys = keys ? keys.filter((key) => !requestedKey || key === requestedKey) : null
    const query = visibleKeys ? getBoundedRuntimeResourceQuery(req.query) : req.query
    const data = visibleKeys
      ? (await Promise.all(visibleKeys.map(async (processDefinitionKey) => filterRuntimeItemsByProcessDefinitionKeys(
        engineId,
        await listProcessInstancesDetailed(engineId, { ...withAuthorizedRuntimeTenantQuery(query, scopes, processDefinitionKey), processDefinitionKey }),
        [processDefinitionKey],
        scopes,
      )))).flat()
      : await listProcessInstancesDetailed(engineId, query as any)
    const redacted = await piiRedactionService.redactPayload(req, data, 'processDetails')
    if (req.query.includeActionDecisions !== 'true') return res.json(z.array(ProcessInstanceSchema).parse(redacted))
    res.json(z.array(ProcessInstanceSchema).parse(await addRuntimeProcessInstanceActionDecisions({
      userId: req.user!.userId,
      tenantId: req.tenant?.tenantId || null,
      engineId,
      runtimeAccessScope: (req as Request & { runtimeAccessScope?: 'engine_wide' | 'resource_aware' }).runtimeAccessScope || 'engine_wide',
      rows: redacted,
    })))
  } catch (e: any) {
    if (e?.statusCode) throw e
    throw Errors.internal(e?.message || 'Failed to load process instances')
  }
}))

r.get('/mission-control-api/process-instances/:id', requireProcessInstanceAction('engine.runtime.process-instances.read'), asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const instanceId = String(req.params.id)
    const data = await getProcessInstanceById(engineId, instanceId)
    const redacted = await piiRedactionService.redactPayload(req, data, 'processDetails')
    if (req.query.includeActionDecisions !== 'true') return res.json(ProcessInstanceDetailSchema.parse(redacted))
    const [withDecisions] = await addRuntimeProcessInstanceActionDecisions({
      userId: req.user!.userId,
      tenantId: req.tenant?.tenantId || null,
      engineId,
      runtimeAccessScope: (req as Request & { runtimeAccessScope?: 'engine_wide' | 'resource_aware' }).runtimeAccessScope || 'engine_wide',
      rows: [redacted],
      includeDetailActions: true,
    })
    res.json(ProcessInstanceDetailSchema.parse(withDecisions))
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to load process instance')
  }
}))

r.get('/mission-control-api/process-instances/:id/variables', requireProcessInstanceAction('engine.runtime.process-instances.variables.read'), asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const instanceId = String(req.params.id)
    const data = await getProcessInstanceVariables(engineId, instanceId)
    const redacted = await piiRedactionService.redactPayload(req, data, 'processDetails')
    res.json(VariablesSchema.parse(redacted))
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to load instance variables')
  }
}))

r.get('/mission-control-api/process-instances/:id/history/activity-instances', requireProcessInstanceAction('engine.runtime.process-instances.activity-history.read'), asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const instanceId = String(req.params.id)
    const data = await listProcessInstanceActivityHistory(engineId, instanceId)
    const redacted = await piiRedactionService.redactPayload(req, data, 'processDetails')
    res.json(ActivityInstanceListSchema.parse(redacted))
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to load activity instances history')
  }
}))

r.get('/mission-control-api/process-instances/:id/execution-details', requireProcessInstanceAction('engine.runtime.process-instances.execution-details.read'), validateQuery(executionDetailsQuerySchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const instanceId = String(req.params.id)
    const query = req.query as z.infer<typeof executionDetailsQuerySchema>
    const data = await getProcessInstanceExecutionDetails(engineId, instanceId, query)
    const redacted = await piiRedactionService.redactPayload(req, data, 'history')
    res.json(ProcessInstanceExecutionDetailsSchema.parse(redacted))
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to load execution details')
  }
}))

r.get('/mission-control-api/process-instances/:id/jobs', requireProcessInstanceAction('engine.runtime.jobs.read'), asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const instanceId = String(req.params.id)
    const data = await listProcessInstanceJobs(engineId, instanceId)
    const redacted = await piiRedactionService.redactPayload(req, data, 'errors')
    res.json(ProcessInstanceJobListSchema.parse(redacted))
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to load jobs')
  }
}))

// History: process instance details (works for finished instances)
r.get('/mission-control-api/history/process-instances/:id', requireHistoricProcessInstanceAction('engine.runtime.history.process-instances.read'), asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const instanceId = String(req.params.id)
    const data = await getHistoricProcessInstanceById(engineId, instanceId)
    const redacted = await piiRedactionService.redactPayload(req, data, 'history')
    res.json(ProcessInstanceDetailSchema.parse(redacted))
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to load historic process instance')
  }
}))

// History: list with arbitrary filters (e.g., superProcessInstanceId)
r.get('/mission-control-api/history/process-instances', requireRuntimeCollectionAction('engine.runtime.history.process-instances.read', { resourceKind: 'process_definition' }), asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const keys = req.authorizedRuntimeResourceKeys
    const scopes = req.authorizedRuntimeResourceScopes
    const requestedKey = typeof req.query.processDefinitionKey === 'string' ? req.query.processDefinitionKey : null
    const visibleKeys = keys ? keys.filter((key) => !requestedKey || key === requestedKey) : null
    const query = visibleKeys ? getBoundedRuntimeResourceQuery(req.query) : req.query
    const data = visibleKeys
      ? (await Promise.all(visibleKeys.map(async (processDefinitionKey) => filterRuntimeItemsByResourceKey(
        await listHistoricProcessInstances(engineId, { ...withAuthorizedRuntimeTenantQuery(query, scopes, processDefinitionKey), processDefinitionKey }),
        [processDefinitionKey],
        'processDefinitionKey',
        scopes,
      )))).flat()
      : await listHistoricProcessInstances(engineId, query as any)
    const redacted = await piiRedactionService.redactPayload(req, data, 'history')
    res.json(z.array(ProcessInstanceDetailSchema).parse(redacted))
  } catch (e: any) {
    if (e?.statusCode) throw e
    throw Errors.internal(e?.message || 'Failed to load historic process instances')
  }
}))

r.get('/mission-control-api/process-instances/:id/variable-history', requireProcessInstanceAction('engine.runtime.process-instances.variable-history.read'), validateQuery(variableHistoryQuerySchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const instanceId = String(req.params.id)
    const { variableInstanceId } = req.query as { variableInstanceId: string }
    const data = await getProcessInstanceVariableHistory(engineId, instanceId, variableInstanceId)
    const redacted = await piiRedactionService.redactPayload(req, data, 'history')
    res.json(z.array(VariableHistoryEntrySchema).parse(redacted))
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to load variable history')
  }
}))

r.get('/mission-control-api/process-instances/:id/incidents', requireProcessInstanceAction('engine.runtime.process-instances.incidents.read'), asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const instanceId = String(req.params.id)
    const data = await listProcessInstanceIncidents(engineId, instanceId)
    const redacted = await piiRedactionService.redactPayload(req, data, 'errors')
    res.json(ProcessInstanceIncidentListSchema.parse(redacted))
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to load incidents')
  }
}))

// History: variable instances
r.get('/mission-control-api/history/variable-instances', requireRuntimeCollectionAction('engine.runtime.history.variables.read', { resourceKind: 'process_definition' }), asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const keys = req.authorizedRuntimeResourceKeys
    const scopes = req.authorizedRuntimeResourceScopes
    const requestedKey = typeof req.query.processDefinitionKey === 'string' ? req.query.processDefinitionKey : null
    const visibleKeys = keys ? keys.filter((key) => !requestedKey || key === requestedKey) : null
    const query = visibleKeys ? getBoundedRuntimeResourceQuery(req.query) : req.query
    const data = visibleKeys
      ? (await Promise.all(visibleKeys.map(async (processDefinitionKey) => filterRuntimeItemsByResourceKey(
        await listHistoricVariableInstances(engineId, { ...withAuthorizedRuntimeTenantQuery(query, scopes, processDefinitionKey), processDefinitionKey }),
        [processDefinitionKey],
        'processDefinitionKey',
        scopes,
      )))).flat()
      : await listHistoricVariableInstances(engineId, query as any)
    const redacted = await piiRedactionService.redactPayload(req, data, 'history')
    res.json(HistoricVariableInstanceListSchema.parse(redacted))
  } catch (e: any) {
    if (e?.statusCode) throw e
    throw Errors.internal(e?.message || 'Failed to load historic variables')
  }
}))

// -----------------------------
// Instance actions
// -----------------------------
r.put('/mission-control-api/process-instances/:id/suspend', requireProcessInstanceAction('engine.runtime.process-instances.suspension.update'), asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const instanceId = String(req.params.id)
    await suspendProcessInstanceById(engineId, instanceId)
    res.status(204).end()
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to suspend instance')
  }
}))

r.put('/mission-control-api/process-instances/:id/activate', requireProcessInstanceAction('engine.runtime.process-instances.suspension.update'), asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const instanceId = String(req.params.id)
    await activateProcessInstanceById(engineId, instanceId)
    res.status(204).end()
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to activate instance')
  }
}))

r.delete('/mission-control-api/process-instances/:id', requireProcessInstanceAction('engine.runtime.process-instances.delete'), asyncHandler(async (req: Request, res: Response) => {
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
r.get('/mission-control-api/process-instances/:id/failed-external-tasks', requireProcessInstanceAction('engine.runtime.external-tasks.read'), asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const instanceId = String(req.params.id)
    const data = await listFailedExternalTasks(engineId, instanceId)
    res.json(ProcessInstanceExternalTaskListSchema.parse(data))
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to load external tasks')
  }
}))

// Retry failed jobs and external tasks for a process instance
r.post('/mission-control-api/process-instances/:id/retry', requireProcessInstanceAction('engine.runtime.process-instances.retry'), validateBody(retrySchema), asyncHandler(async (req: Request, res: Response) => {
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

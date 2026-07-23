import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js'
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js'
import { requireRuntimeCollectionAction, requireRuntimeDefinitionAction } from '@enterpriseglue/shared/middleware/requireAction.js'
import { validateBody, validateQuery } from '@enterpriseglue/shared/middleware/validate.js'
import {
  listProcessInstances,
  getProcessInstance,
  getProcessInstanceVariables,
  getActivityInstances,
  deleteProcessInstance,
  modifyProcessInstanceVariables,
} from './service.js'
import { filterRuntimeItemsByProcessDefinitionKeys, getBoundedRuntimeResourceQuery, withAuthorizedRuntimeTenantQuery } from '../shared/runtime-resource-filter.js'
import { addRuntimeProcessInstanceActionDecisions } from '../shared/runtime-row-action-decisions.js'
import { ProcessInstanceDetailSchema, ProcessInstanceSchema, ProcessInstanceVariablesModifyRequestSchema, RuntimeActivityInstanceTreeSchema, VariablesSchema } from '@enterpriseglue/shared/schemas/mission-control/process.js'

const r = Router()

const processInstanceListQuerySchema = z.object({
  processDefinitionKey: z.string().min(1).optional(),
  includeActionDecisions: z.enum(['true']).optional(),
  active: z.enum(['true', 'false', '1', '0']).optional(),
  suspended: z.enum(['true', 'false', '1', '0']).optional(),
  maxResults: z.coerce.number().int().positive().optional(),
})

const requireProcessInstanceAction = (actionId: string) => requireRuntimeDefinitionAction(actionId, {
  resourceKind: 'process_definition',
  definitionPath: 'process-instance',
  resourceKeyFields: ['definitionKey', 'processDefinitionKey'],
  engineIdFrom: 'any',
})

// List process instances
r.get('/mission-control-api/process-instances', requireAuth, requireRuntimeCollectionAction('engine.runtime.process-instances.read', { resourceKind: 'process_definition' }), validateQuery(processInstanceListQuerySchema), asyncHandler(async (req: Request, res: Response) => {
  const { processDefinitionKey, active, suspended, maxResults } = req.query as { processDefinitionKey?: string; active?: string; suspended?: string; maxResults?: number }
  const engineId = (req as any).engineId as string
  const keys = req.authorizedRuntimeResourceKeys
  const scopes = req.authorizedRuntimeResourceScopes
  const visibleKeys = keys ? keys.filter((key) => !processDefinitionKey || key === processDefinitionKey) : null
  const baseQuery = {
    active: active === 'true' || active === '1',
    suspended: suspended === 'true' || suspended === '1',
    maxResults,
  }
  const data = visibleKeys
    ? (await Promise.all(visibleKeys.map(async (key) => filterRuntimeItemsByProcessDefinitionKeys(
      engineId,
      await listProcessInstances(engineId, {
        ...withAuthorizedRuntimeTenantQuery(getBoundedRuntimeResourceQuery(baseQuery), scopes, key),
        processDefinitionKey: key,
      }),
      [key],
      scopes,
    )))).flat()
    : await listProcessInstances(engineId, {
      processDefinitionKey,
      ...baseQuery,
    })
  if (req.query.includeActionDecisions !== 'true') return res.json(z.array(ProcessInstanceSchema).parse(data))
  res.json(z.array(ProcessInstanceSchema).parse(await addRuntimeProcessInstanceActionDecisions({
    userId: req.user!.userId,
    tenantId: req.tenant?.tenantId || null,
    engineId,
    runtimeAccessScope: (req as Request & { runtimeAccessScope?: 'engine_wide' | 'resource_aware' }).runtimeAccessScope || 'engine_wide',
    rows: data,
  })))
}))

// Get process instance by ID
r.get('/mission-control-api/process-instances/:id', requireAuth, requireProcessInstanceAction('engine.runtime.process-instances.read'), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string
  const instanceId = String(req.params.id)
  const data = await getProcessInstance(engineId, instanceId)
  if (req.query.includeActionDecisions !== 'true') return res.json(ProcessInstanceDetailSchema.parse(data))
  const [withDecisions] = await addRuntimeProcessInstanceActionDecisions({
    userId: req.user!.userId,
    tenantId: req.tenant?.tenantId || null,
    engineId,
    runtimeAccessScope: (req as Request & { runtimeAccessScope?: 'engine_wide' | 'resource_aware' }).runtimeAccessScope || 'engine_wide',
    rows: [data],
    includeDetailActions: true,
  })
  res.json(ProcessInstanceDetailSchema.parse(withDecisions))
}))

// Get process instance variables
r.get('/mission-control-api/process-instances/:id/variables', requireAuth, requireProcessInstanceAction('engine.runtime.process-instances.variables.read'), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string
  const instanceId = String(req.params.id)
  const data = await getProcessInstanceVariables(engineId, instanceId)
  res.json(VariablesSchema.parse(data))
}))

// Get activity instances for a process instance
r.get('/mission-control-api/process-instances/:id/activity-instances', requireAuth, requireProcessInstanceAction('engine.runtime.process-instances.activity-tree.read'), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string
  const instanceId = String(req.params.id)
  const data = await getActivityInstances(engineId, instanceId)
  res.json(RuntimeActivityInstanceTreeSchema.parse(data))
}))

// Delete process instance
r.delete('/mission-control-api/process-instances/:id', requireAuth, requireProcessInstanceAction('engine.runtime.process-instances.delete'), asyncHandler(async (req: Request, res: Response) => {
  const { skipCustomListeners, skipIoMappings, deleteReason } = req.query as { skipCustomListeners?: string; skipIoMappings?: string; deleteReason?: string }
  const engineId = (req as any).engineId as string
  const instanceId = String(req.params.id)
  await deleteProcessInstance(engineId, instanceId, {
    skipCustomListeners: skipCustomListeners === 'true',
    skipIoMappings: skipIoMappings === 'true',
    deleteReason: deleteReason?.trim() || undefined,
  })
  res.status(204).end()
}))

// Modify process instance variables
r.post('/mission-control-api/process-instances/:id/variables', requireAuth, requireProcessInstanceAction('engine.runtime.process-instances.variables.update'), validateBody(ProcessInstanceVariablesModifyRequestSchema), asyncHandler(async (req: Request, res: Response) => {
  const { modifications } = req.body
  const engineId = (req as any).engineId as string
  const instanceId = String(req.params.id)
  await modifyProcessInstanceVariables(engineId, instanceId, modifications)
  res.status(204).end()
}))

export default r

import { Router, Request, Response } from 'express'
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js'
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js'
import { requireRuntimeCollectionAction, requireRuntimeDefinitionAction } from '@enterpriseglue/shared/middleware/requireAction.js'
import {
  listProcessInstances,
  getProcessInstance,
  getProcessInstanceVariables,
  getActivityInstances,
  deleteProcessInstance,
  modifyProcessInstanceVariables,
} from './service.js'

const r = Router()

r.use(requireAuth)

const requireProcessInstanceAction = (actionId: string) => requireRuntimeDefinitionAction(actionId, {
  resourceKind: 'process_definition',
  definitionPath: 'process-instance',
  resourceKeyFields: ['definitionKey', 'processDefinitionKey'],
  engineIdFrom: 'any',
})

// List process instances
r.get('/mission-control-api/process-instances', requireRuntimeCollectionAction('engine.runtime.process-instances.read', { resourceKind: 'process_definition' }), asyncHandler(async (req: Request, res: Response) => {
  const { processDefinitionKey, active, suspended } = req.query as { processDefinitionKey?: string; active?: string; suspended?: string }
  const engineId = (req as any).engineId as string
  const keys = req.authorizedRuntimeResourceKeys
  const visibleKeys = keys ? keys.filter((key) => !processDefinitionKey || key === processDefinitionKey) : null
  const data = visibleKeys
    ? (await Promise.all(visibleKeys.map((key) => listProcessInstances(engineId, {
      processDefinitionKey: key,
      active: active === 'true' || active === '1',
      suspended: suspended === 'true' || suspended === '1',
    })))).flat()
    : await listProcessInstances(engineId, {
      processDefinitionKey,
      active: active === 'true' || active === '1',
      suspended: suspended === 'true' || suspended === '1',
    })
  res.json(data)
}))

// Get process instance by ID
r.get('/mission-control-api/process-instances/:id', requireProcessInstanceAction('engine.runtime.process-instances.read'), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string
  const instanceId = String(req.params.id)
  const data = await getProcessInstance(engineId, instanceId)
  res.json(data)
}))

// Get process instance variables
r.get('/mission-control-api/process-instances/:id/variables', requireProcessInstanceAction('engine.runtime.process-instances.variables.read'), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string
  const instanceId = String(req.params.id)
  const data = await getProcessInstanceVariables(engineId, instanceId)
  res.json(data)
}))

// Get activity instances for a process instance
r.get('/mission-control-api/process-instances/:id/activity-instances', requireProcessInstanceAction('engine.runtime.process-instances.activity-tree.read'), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string
  const instanceId = String(req.params.id)
  const data = await getActivityInstances(engineId, instanceId)
  res.json(data)
}))

// Delete process instance
r.delete('/mission-control-api/process-instances/:id', requireProcessInstanceAction('engine.runtime.process-instances.delete'), asyncHandler(async (req: Request, res: Response) => {
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
r.post('/mission-control-api/process-instances/:id/variables', requireProcessInstanceAction('engine.runtime.process-instances.variables.update'), asyncHandler(async (req: Request, res: Response) => {
  const { modifications } = req.body || {}
  if (!modifications) throw Errors.validation('modifications required')
  const engineId = (req as any).engineId as string
  const instanceId = String(req.params.id)
  await modifyProcessInstanceVariables(engineId, instanceId, modifications)
  res.status(204).end()
}))

export default r

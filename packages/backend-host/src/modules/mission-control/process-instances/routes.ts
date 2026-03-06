import { Router, Request, Response } from 'express'
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js'
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js'
import { requireEngineReadOrWrite } from '@enterpriseglue/shared/middleware/engineAuth.js'
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

// List process instances
r.get('/mission-control-api/process-instances', requireEngineReadOrWrite({ engineIdFrom: 'query' }), asyncHandler(async (req: Request, res: Response) => {
  const { processDefinitionKey, active, suspended } = req.query as { processDefinitionKey?: string; active?: string; suspended?: string }
  const engineId = (req as any).engineId as string
  const data = await listProcessInstances(engineId, {
    processDefinitionKey,
    active: active === 'true' || active === '1',
    suspended: suspended === 'true' || suspended === '1',
  })
  res.json(data)
}))

// Get process instance by ID
r.get('/mission-control-api/process-instances/:id', requireEngineReadOrWrite({ engineIdFrom: 'query' }), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string
  const instanceId = String(req.params.id)
  const data = await getProcessInstance(engineId, instanceId)
  res.json(data)
}))

// Get process instance variables
r.get('/mission-control-api/process-instances/:id/variables', requireEngineReadOrWrite({ engineIdFrom: 'query' }), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string
  const instanceId = String(req.params.id)
  const data = await getProcessInstanceVariables(engineId, instanceId)
  res.json(data)
}))

// Get activity instances for a process instance
r.get('/mission-control-api/process-instances/:id/activity-instances', requireEngineReadOrWrite({ engineIdFrom: 'query' }), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string
  const instanceId = String(req.params.id)
  const data = await getActivityInstances(engineId, instanceId)
  res.json(data)
}))

// Delete process instance
r.delete('/mission-control-api/process-instances/:id', requireEngineReadOrWrite({ engineIdFrom: 'query' }), asyncHandler(async (req: Request, res: Response) => {
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
r.post('/mission-control-api/process-instances/:id/variables', requireEngineReadOrWrite({ engineIdFrom: 'body' }), asyncHandler(async (req: Request, res: Response) => {
  const { modifications } = req.body || {}
  if (!modifications) throw Errors.validation('modifications required')
  const engineId = (req as any).engineId as string
  const instanceId = String(req.params.id)
  await modifyProcessInstanceVariables(engineId, instanceId, modifications)
  res.status(204).end()
}))

export default r

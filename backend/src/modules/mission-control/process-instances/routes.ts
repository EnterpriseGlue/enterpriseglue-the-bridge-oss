import { Router, Request, Response } from 'express'
import { asyncHandler, Errors } from '@shared/middleware/errorHandler.js'
import { requireAuth } from '@shared/middleware/auth.js'
import { requireEngineReadOrWrite } from '@shared/middleware/engineAuth.js'
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
  const data = await getProcessInstance(engineId, req.params.id)
  res.json(data)
}))

// Get process instance variables
r.get('/mission-control-api/process-instances/:id/variables', requireEngineReadOrWrite({ engineIdFrom: 'query' }), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string
  const data = await getProcessInstanceVariables(engineId, req.params.id)
  res.json(data)
}))

// Get activity instances for a process instance
r.get('/mission-control-api/process-instances/:id/activity-instances', requireEngineReadOrWrite({ engineIdFrom: 'query' }), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string
  const data = await getActivityInstances(engineId, req.params.id)
  res.json(data)
}))

// Delete process instance
r.delete('/mission-control-api/process-instances/:id', requireEngineReadOrWrite({ engineIdFrom: 'query' }), asyncHandler(async (req: Request, res: Response) => {
  const { skipCustomListeners, skipIoMappings, deleteReason } = req.query as { skipCustomListeners?: string; skipIoMappings?: string; deleteReason?: string }
  const engineId = (req as any).engineId as string
  await deleteProcessInstance(engineId, req.params.id, {
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
  await modifyProcessInstanceVariables(engineId, req.params.id, modifications)
  res.status(204).end()
}))

export default r

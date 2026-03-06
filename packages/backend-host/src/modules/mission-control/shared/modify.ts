import { Router, Request, Response } from 'express'
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js'
import { validateBody } from '@enterpriseglue/shared/middleware/validate.js'
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js'
import { requireEngineDeployer } from '@enterpriseglue/shared/middleware/engineAuth.js'
import {
  modifyProcessInstance,
  modifyProcessDefinitionAsync,
  restartProcessDefinitionAsync,
} from './modify-service.js'
import {
  ProcessInstanceModificationRequest,
  ProcessDefinitionModificationAsyncRequest,
  ProcessDefinitionRestartAsyncRequest,
} from '@enterpriseglue/shared/schemas/mission-control/modify.js'

const r = Router()

// Apply auth middleware only to /mission-control-api routes (not globally)
r.use('/mission-control-api', requireAuth, requireEngineDeployer({ engineIdFrom: 'body' }))

// POST /mission-control-api/process-instances/:id/modify (sync)
r.post('/mission-control-api/process-instances/:id/modify', validateBody(ProcessInstanceModificationRequest), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string
  const instanceId = String(req.params.id)
  await modifyProcessInstance(engineId, instanceId, req.body)
  res.status(204).end()
}))

// POST /mission-control-api/process-definitions/:id/modification/execute-async (batch)
r.post('/mission-control-api/process-definitions/:id/modification/execute-async', validateBody(ProcessDefinitionModificationAsyncRequest), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string
  const definitionId = String(req.params.id)
  const { batchId, camundaBatchId } = await modifyProcessDefinitionAsync(engineId, definitionId, req.body)
  res.status(201).json({ id: batchId, camundaBatchId, type: 'MODIFY_INSTANCES' })
}))

// POST /mission-control-api/process-definitions/:id/restart/execute-async (batch)
r.post('/mission-control-api/process-definitions/:id/restart/execute-async', validateBody(ProcessDefinitionRestartAsyncRequest), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string
  const definitionId = String(req.params.id)
  const { batchId, camundaBatchId } = await restartProcessDefinitionAsync(engineId, definitionId, req.body)
  res.status(201).json({ id: batchId, camundaBatchId, type: 'RESTART_INSTANCES' })
}))

export default r

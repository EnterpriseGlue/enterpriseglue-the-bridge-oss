import { Router, Request, Response } from 'express'
import { asyncHandler, Errors } from '@shared/middleware/errorHandler.js'
import { validateBody } from '@shared/middleware/validate.js'
import { requireAuth } from '@shared/middleware/auth.js'
import { requireEngineDeployer } from '@shared/middleware/engineAuth.js'
import {
  modifyProcessInstance,
  modifyProcessDefinitionAsync,
  restartProcessDefinitionAsync,
} from './modify-service.js'
import {
  ProcessInstanceModificationRequest,
  ProcessDefinitionModificationAsyncRequest,
  ProcessDefinitionRestartAsyncRequest,
} from '@shared/schemas/mission-control/modify.js'

const r = Router()

r.use(requireAuth, requireEngineDeployer({ engineIdFrom: 'body' }))

// POST /mission-control-api/process-instances/:id/modify (sync)
r.post('/mission-control-api/process-instances/:id/modify', validateBody(ProcessInstanceModificationRequest), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string
  await modifyProcessInstance(engineId, req.params.id, req.body)
  res.status(204).end()
}))

// POST /mission-control-api/process-definitions/:id/modification/execute-async (batch)
r.post('/mission-control-api/process-definitions/:id/modification/execute-async', validateBody(ProcessDefinitionModificationAsyncRequest), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string
  const { batchId, camundaBatchId } = await modifyProcessDefinitionAsync(engineId, req.params.id, req.body)
  res.status(201).json({ id: batchId, camundaBatchId, type: 'MODIFY_INSTANCES' })
}))

// POST /mission-control-api/process-definitions/:id/restart/execute-async (batch)
r.post('/mission-control-api/process-definitions/:id/restart/execute-async', validateBody(ProcessDefinitionRestartAsyncRequest), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string
  const { batchId, camundaBatchId } = await restartProcessDefinitionAsync(engineId, req.params.id, req.body)
  res.status(201).json({ id: batchId, camundaBatchId, type: 'RESTART_INSTANCES' })
}))

export default r

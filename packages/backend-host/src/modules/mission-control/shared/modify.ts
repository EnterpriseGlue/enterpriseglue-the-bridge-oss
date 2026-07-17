import { Router, Request, Response } from 'express'
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js'
import { validateBody } from '@enterpriseglue/shared/middleware/validate.js'
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js'
import { requireRuntimeDefinitionAction } from '@enterpriseglue/shared/middleware/requireAction.js'
import {
  modifyProcessInstance,
  modifyProcessDefinitionAsync,
  restartProcessDefinitionAsync,
} from './modify-service.js'
import {
  ProcessInstanceModificationRequest,
  ProcessDefinitionModificationAsyncRequest,
  ProcessDefinitionRestartAsyncRequest,
  ProcessDefinitionModificationAsyncResponseSchema,
  ProcessDefinitionRestartAsyncResponseSchema,
} from '@enterpriseglue/shared/schemas/mission-control/modify.js'

const r = Router()

const requireProcessInstanceAction = (actionId: string) => requireRuntimeDefinitionAction(actionId, {
  resourceKind: 'process_definition',
  definitionPath: 'process-instance',
  engineIdFrom: 'body',
  resourceKeyFields: ['definitionKey', 'processDefinitionKey'],
})

const requireProcessDefinitionAction = (actionId: string) => requireRuntimeDefinitionAction(actionId, {
  resourceKind: 'process_definition',
  definitionPath: 'process-definition',
  engineIdFrom: 'body',
})

// Apply auth middleware only to /mission-control-api routes (not globally)
r.use('/mission-control-api', requireAuth)

// POST /mission-control-api/process-instances/:id/modify (sync)
r.post('/mission-control-api/process-instances/:id/modify', requireProcessInstanceAction('engine.runtime.process-instances.modify'), validateBody(ProcessInstanceModificationRequest), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string
  const instanceId = String(req.params.id)
  const { engineId: _requestEngineId, ...enginePayload } = req.body
  await modifyProcessInstance(engineId, instanceId, enginePayload)
  res.status(204).end()
}))

// POST /mission-control-api/process-definitions/:id/modification/execute-async (batch)
r.post('/mission-control-api/process-definitions/:id/modification/execute-async', requireProcessDefinitionAction('engine.runtime.process-definitions.modification.execute-async'), validateBody(ProcessDefinitionModificationAsyncRequest), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string
  const definitionId = String(req.params.id)
  const { engineId: _requestEngineId, ...enginePayload } = req.body
  const { batchId, camundaBatchId } = await modifyProcessDefinitionAsync(engineId, definitionId, enginePayload)
  res.status(201).json(ProcessDefinitionModificationAsyncResponseSchema.parse({ id: batchId, camundaBatchId, type: 'MODIFY_INSTANCES' }))
}))

// POST /mission-control-api/process-definitions/:id/restart/execute-async (batch)
r.post('/mission-control-api/process-definitions/:id/restart/execute-async', requireProcessDefinitionAction('engine.runtime.process-definitions.restart.execute-async'), validateBody(ProcessDefinitionRestartAsyncRequest), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string
  const definitionId = String(req.params.id)
  const { engineId: _requestEngineId, ...enginePayload } = req.body
  const { batchId, camundaBatchId } = await restartProcessDefinitionAsync(engineId, definitionId, enginePayload)
  res.status(201).json(ProcessDefinitionRestartAsyncResponseSchema.parse({ id: batchId, camundaBatchId, type: 'RESTART_INSTANCES' }))
}))

export default r

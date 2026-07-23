import { Router, Request, Response } from 'express'
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js'
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js'
import { requireRuntimeProcessInstanceSelectionAction } from '@enterpriseglue/shared/middleware/requireAction.js'
import { validateBody } from '@enterpriseglue/shared/middleware/validate.js'
import {
  DirectJobRetriesRequestSchema,
  DirectOperationResultSchema,
  DirectProcessInstanceDeleteRequestSchema,
  DirectProcessInstanceSuspensionRequestSchema,
} from '@enterpriseglue/shared/schemas/mission-control/direct.js'
import {
  deleteProcessInstancesDirect,
  suspendActivateProcessInstancesDirect,
  setJobRetriesDirect,
} from './direct-service.js'

const r = Router()

// Delete instances directly (no batch)
r.post('/mission-control-api/direct/process-instances/delete', requireAuth, requireRuntimeProcessInstanceSelectionAction('engine.runtime.direct.process-instances.delete', { resourceKind: 'process_definition' }), validateBody(DirectProcessInstanceDeleteRequestSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const {
      processInstanceIds = [],
      skipCustomListeners,
      skipIoMappings,
      failIfNotExists,
      skipSubprocesses,
      deleteReason,
    } = req.body || {}
    const engineId = (req as any).engineId as string
    const results = await deleteProcessInstancesDirect(engineId, {
      processInstanceIds,
      skipCustomListeners,
      skipIoMappings,
      failIfNotExists,
      skipSubprocesses,
      deleteReason,
    })
    res.json(DirectOperationResultSchema.parse({ total: results.length, succeeded: results.filter(r => r.ok).map(r => r.id), failed: results.filter(r => !r.ok) }))
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Direct delete failed')
  }
}))

// Suspend/Activate directly
r.post('/mission-control-api/direct/process-instances/suspend', requireAuth, requireRuntimeProcessInstanceSelectionAction('engine.runtime.direct.process-instances.suspend', { resourceKind: 'process_definition' }), validateBody(DirectProcessInstanceSuspensionRequestSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const ids: string[] = (req.body?.processInstanceIds || []) as string[]
    const engineId = (req as any).engineId as string
    const results = await suspendActivateProcessInstancesDirect(engineId, ids, true)
    res.json(DirectOperationResultSchema.parse({ total: results.length, succeeded: results.filter(r => r.ok).map(r => r.id), failed: results.filter(r => !r.ok) }))
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Direct suspend failed')
  }
}))

r.post('/mission-control-api/direct/process-instances/activate', requireAuth, requireRuntimeProcessInstanceSelectionAction('engine.runtime.direct.process-instances.activate', { resourceKind: 'process_definition' }), validateBody(DirectProcessInstanceSuspensionRequestSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const ids: string[] = (req.body?.processInstanceIds || []) as string[]
    const engineId = (req as any).engineId as string
    const results = await suspendActivateProcessInstancesDirect(engineId, ids, false)
    res.json(DirectOperationResultSchema.parse({ total: results.length, succeeded: results.filter(r => r.ok).map(r => r.id), failed: results.filter(r => !r.ok) }))
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Direct activate failed')
  }
}))

// Set retries directly
r.post('/mission-control-api/direct/jobs/retries', requireAuth, requireRuntimeProcessInstanceSelectionAction('engine.runtime.direct.jobs.retry', { resourceKind: 'process_definition' }), validateBody(DirectJobRetriesRequestSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const { processInstanceIds = [], retries = 1, onlyFailed = true } = req.body || {}
    const engineId = (req as any).engineId as string
    const results = await setJobRetriesDirect(engineId, { processInstanceIds, retries, onlyFailed })
    res.json(DirectOperationResultSchema.parse({ total: results.length, succeeded: results.filter(r => r.ok).map(r => r.id), failed: results.filter(r => !r.ok) }))
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Direct retries failed')
  }
}))

export default r

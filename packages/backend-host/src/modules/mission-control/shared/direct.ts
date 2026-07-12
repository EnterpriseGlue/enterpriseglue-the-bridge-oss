import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js'
import { validateBody } from '@enterpriseglue/shared/middleware/validate.js'
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js'
import { requireAction } from '@enterpriseglue/shared/middleware/requireAction.js'
import {
  deleteProcessInstancesDirect,
  suspendActivateProcessInstancesDirect,
  setJobRetriesDirect,
  executeMigrationDirect,
} from './direct-service.js'

const r = Router()

r.use(requireAuth)

// Delete instances directly (no batch)
r.post('/mission-control-api/direct/process-instances/delete', requireAction('engine.runtime.direct.process-instances.delete', { resourceIdFrom: 'body' }), asyncHandler(async (req: Request, res: Response) => {
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
    res.json({ total: results.length, succeeded: results.filter(r => r.ok).map(r => r.id), failed: results.filter(r => !r.ok) })
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Direct delete failed')
  }
}))

// Suspend/Activate directly
r.post('/mission-control-api/direct/process-instances/suspend', requireAction('engine.runtime.direct.process-instances.suspend', { resourceIdFrom: 'body' }), asyncHandler(async (req: Request, res: Response) => {
  try {
    const ids: string[] = (req.body?.processInstanceIds || []) as string[]
    const engineId = (req as any).engineId as string
    const results = await suspendActivateProcessInstancesDirect(engineId, ids, true)
    res.json({ total: results.length, succeeded: results.filter(r => r.ok).map(r => r.id), failed: results.filter(r => !r.ok) })
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Direct suspend failed')
  }
}))

r.post('/mission-control-api/direct/process-instances/activate', requireAction('engine.runtime.direct.process-instances.activate', { resourceIdFrom: 'body' }), asyncHandler(async (req: Request, res: Response) => {
  try {
    const ids: string[] = (req.body?.processInstanceIds || []) as string[]
    const engineId = (req as any).engineId as string
    const results = await suspendActivateProcessInstancesDirect(engineId, ids, false)
    res.json({ total: results.length, succeeded: results.filter(r => r.ok).map(r => r.id), failed: results.filter(r => !r.ok) })
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Direct activate failed')
  }
}))

// Set retries directly
r.post('/mission-control-api/direct/jobs/retries', requireAction('engine.runtime.direct.jobs.retry', { resourceIdFrom: 'body' }), asyncHandler(async (req: Request, res: Response) => {
  try {
    const { processInstanceIds = [], retries = 1, onlyFailed = true } = req.body || {}
    const engineId = (req as any).engineId as string
    const results = await setJobRetriesDirect(engineId, { processInstanceIds, retries, onlyFailed })
    res.json({ total: results.length, succeeded: results.filter(r => r.ok).map(r => r.id), failed: results.filter(r => !r.ok) })
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Direct retries failed')
  }
}))

// Migration execute (sync)
r.post('/mission-control-api/migration/execute-direct', requireAction('engine.runtime.migrations.execute-direct', { resourceIdFrom: 'body' }), asyncHandler(async (req: Request, res: Response) => {
  try {
    const { plan, processInstanceIds, skipCustomListeners, skipIoMappings } = req.body || {}
    const engineId = (req as any).engineId as string
    const result = await executeMigrationDirect(engineId, {
      plan,
      processInstanceIds,
      skipCustomListeners,
      skipIoMappings,
    })
    res.json({ ok: true, engine: result })
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Direct migration failed')
  }
})) 

export default r

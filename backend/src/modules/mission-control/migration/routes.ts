import { Router, Request, Response } from 'express'
import { asyncHandler, Errors } from '@shared/middleware/errorHandler.js'
import { requireAuth } from '@shared/middleware/auth.js'
import { requireEngineReadOrWrite } from '@shared/middleware/engineAuth.js'
import {
  toEnginePlan,
  previewMigrationCount,
  generateMigrationPlan,
  validateMigrationPlan,
  executeMigrationAsync,
  executeMigrationDirect,
  aggregateActiveSources,
} from './service.js'

const r = Router()

r.use(requireAuth, requireEngineReadOrWrite({ engineIdFrom: 'body' }))

// Preview affected instances count
r.post('/mission-control-api/migration/preview', asyncHandler(async (req: Request, res: Response) => {
  try {
    const { plan, processInstanceIds } = req.body || {}
    if (Array.isArray(processInstanceIds) && processInstanceIds.length > 0) {
      return res.status(200).json({ count: processInstanceIds.length })
    }
    const engineId = (req as any).engineId as string
    const count = await previewMigrationCount(engineId, plan, processInstanceIds)
    res.status(200).json({ count })
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to preview affected instances')
  }
}))

// Generate migration plan (engine auto-mapping)
r.post('/mission-control-api/migration/generate', asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const enginePlan = await generateMigrationPlan(engineId, req.body)
    res.status(200).json(enginePlan)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to generate migration plan')
  }
}))

// Validate migration plan
r.post('/mission-control-api/migration/plan/validate', asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const result = await validateMigrationPlan(engineId, req.body)
    res.status(200).json(result)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to validate migration plan')
  }
}))

// Execute migration as async batch
r.post('/mission-control-api/migration/execute-async', asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const result = await executeMigrationAsync(engineId, req.body)
    res.status(201).json(result)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to start migration batch')
  }
}))

// Execute migration directly (synchronous)
r.post('/mission-control-api/migration/execute-direct', asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    await executeMigrationDirect(engineId, req.body)
    res.status(200).json({ ok: true })
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to execute migration')
  }
}))

// Aggregate active source activities across selected instances
r.post('/mission-control-api/migration/active-sources', asyncHandler(async (req: Request, res: Response) => {
  try {
    const ids: string[] = Array.isArray(req.body?.processInstanceIds) ? req.body.processInstanceIds : []
    const engineId = (req as any).engineId as string
    const counts = await aggregateActiveSources(engineId, ids)
    res.status(200).json(counts)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to load active sources')
  }
}))

export default r

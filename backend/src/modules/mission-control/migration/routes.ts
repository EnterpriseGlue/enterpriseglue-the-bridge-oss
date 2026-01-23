import { Router, Request, Response } from 'express'
import { asyncHandler, Errors } from '@shared/middleware/errorHandler.js'
import { requireAuth } from '@shared/middleware/auth.js'
import { requireActiveEngineReadOrWrite } from '@shared/middleware/activeEngineAuth.js'
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

r.use(requireAuth, requireActiveEngineReadOrWrite())

// Preview affected instances count
r.post('/mission-control-api/migration/preview', asyncHandler(async (req: Request, res: Response) => {
  try {
    const { plan, processInstanceIds } = req.body || {}
    if (Array.isArray(processInstanceIds) && processInstanceIds.length > 0) {
      return res.status(200).json({ count: processInstanceIds.length })
    }
    const count = await previewMigrationCount(plan, processInstanceIds)
    res.status(200).json({ count })
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to preview affected instances')
  }
}))

// Generate migration plan (engine auto-mapping)
r.post('/mission-control-api/migration/generate', asyncHandler(async (req: Request, res: Response) => {
  try {
    const enginePlan = await generateMigrationPlan(req.body)
    res.status(200).json(enginePlan)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to generate migration plan')
  }
}))

// Newer endpoint
r.post('/mission-control-api/migration/plan/generate', asyncHandler(async (req: Request, res: Response) => {
  try {
    const enginePlan = await generateMigrationPlan(req.body)
    res.status(200).json(enginePlan)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to generate migration plan')
  }
}))

// Validate migration plan
r.post('/mission-control-api/migration/plan/validate', asyncHandler(async (req: Request, res: Response) => {
  try {
    const result = await validateMigrationPlan(req.body)
    res.status(200).json(result)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to validate migration plan')
  }
}))

// Execute migration as async batch
r.post('/mission-control-api/migration/execute-async', asyncHandler(async (req: Request, res: Response) => {
  try {
    const result = await executeMigrationAsync(req.body)
    res.status(201).json(result)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to start migration batch')
  }
}))

// Execute migration directly (synchronous)
r.post('/mission-control-api/migration/execute-direct', asyncHandler(async (req: Request, res: Response) => {
  try {
    await executeMigrationDirect(req.body)
    res.status(200).json({ ok: true })
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to execute migration')
  }
}))

// Aggregate active source activities across selected instances
r.post('/mission-control-api/migration/active-sources', asyncHandler(async (req: Request, res: Response) => {
  try {
    const ids: string[] = Array.isArray(req.body?.processInstanceIds) ? req.body.processInstanceIds : []
    const counts = await aggregateActiveSources(ids)
    res.status(200).json(counts)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to load active sources')
  }
}))

export default r

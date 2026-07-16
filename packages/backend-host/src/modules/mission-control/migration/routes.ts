import { Router, Request, Response } from 'express'
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js'
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js'
import { requireRuntimeMigrationAction, requireRuntimeProcessInstanceSelectionAction } from '@enterpriseglue/shared/middleware/requireAction.js'
import {
  MigrationActiveSourcesResponseSchema,
  MigrationPreviewResponseSchema,
} from '@enterpriseglue/shared/schemas/mission-control/migration.js'
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

// Apply auth middleware only to /mission-control-api routes (not globally)
r.use('/mission-control-api', requireAuth)

// Preview affected instances count
r.post('/mission-control-api/migration/preview', requireRuntimeMigrationAction('engine.runtime.migrations.preview', { resourceKind: 'process_definition' }), asyncHandler(async (req: Request, res: Response) => {
  try {
    const { plan, processInstanceIds } = req.body || {}
    if (Array.isArray(processInstanceIds) && processInstanceIds.length > 0) {
      return res.status(200).json(MigrationPreviewResponseSchema.parse({ count: processInstanceIds.length }))
    }
    if (req.authorizedRuntimeResourceKeys) {
      throw Errors.forbidden('Resource-aware migration preview counts are not supported')
    }
    const engineId = (req as any).engineId as string
    const count = await previewMigrationCount(engineId, plan, processInstanceIds)
    res.status(200).json(MigrationPreviewResponseSchema.parse({ count }))
  } catch (e: any) {
    if (e?.statusCode) throw e
    throw Errors.internal(e?.message || 'Failed to preview affected instances')
  }
}))

// Generate migration plan (engine auto-mapping)
r.post('/mission-control-api/migration/generate', requireRuntimeMigrationAction('engine.runtime.migrations.plan.generate', { resourceKind: 'process_definition' }), asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const enginePlan = await generateMigrationPlan(engineId, req.body)
    res.status(200).json(enginePlan)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to generate migration plan')
  }
}))

// Validate migration plan
r.post('/mission-control-api/migration/plan/validate', requireRuntimeMigrationAction('engine.runtime.migrations.plan.validate', { resourceKind: 'process_definition' }), asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const result = await validateMigrationPlan(engineId, req.body)
    res.status(200).json(result)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to validate migration plan')
  }
}))

// Execute migration as async batch
r.post('/mission-control-api/migration/execute-async', requireRuntimeMigrationAction('engine.runtime.migrations.execute-async', { resourceKind: 'process_definition' }), asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    const result = await executeMigrationAsync(engineId, req.body)
    res.status(201).json(result)
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to start migration batch')
  }
}))

// Execute migration directly (synchronous)
r.post('/mission-control-api/migration/execute-direct', requireRuntimeMigrationAction('engine.runtime.migrations.execute-direct', { resourceKind: 'process_definition' }), asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineId = (req as any).engineId as string
    await executeMigrationDirect(engineId, req.body)
    res.status(200).json({ ok: true })
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to execute migration')
  }
}))

// Aggregate active source activities across selected instances
r.post('/mission-control-api/migration/active-sources', requireRuntimeProcessInstanceSelectionAction('engine.runtime.migrations.active-sources.read', { resourceKind: 'process_definition' }), asyncHandler(async (req: Request, res: Response) => {
  try {
    const ids: string[] = Array.isArray(req.body?.processInstanceIds) ? req.body.processInstanceIds : []
    const engineId = (req as any).engineId as string
    const counts = await aggregateActiveSources(engineId, ids)
    res.status(200).json(MigrationActiveSourcesResponseSchema.parse(counts))
  } catch (e: any) {
    throw Errors.internal(e?.message || 'Failed to load active sources')
  }
}))

export default r

import { Router, Request, Response } from 'express'
import { asyncHandler, Errors } from '@shared/middleware/errorHandler.js'
import { logger } from '@shared/utils/logger.js';
import { generateId } from '@shared/utils/id.js'
import { requireAuth } from '@shared/middleware/auth.js'
import { requireEngineReadOrWrite } from '@shared/middleware/engineAuth.js'
import {
  processRetries,
  fetchBatchInfo,
  fetchBatchStatistics,
  fetchJobsByDefinitionIds,
  fetchJobStacktrace,
  deleteBatch,
  suspendProcessInstancesBatch,
  deleteProcessInstancesBatch,
  setBatchSuspended,
} from './service.js'
import { getDataSource } from '@shared/db/data-source.js'
import { Batch } from '@shared/db/entities/Batch.js'

const r = Router()

r.use(requireAuth)

async function insertLocalBatch(type: string, camundaBatchId: string, payload: any, engineDto: any, engineId: string) {
  const dataSource = await getDataSource()
  const batchRepo = dataSource.getRepository(Batch)
  const now = Date.now()
  const id = generateId()
  const toNumberOrNull = (v: any) => {
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(v)
      if (Number.isFinite(n)) return n
    }
    return null
  }
  const totalJobs = toNumberOrNull(engineDto?.totalJobs)
  const jobsCreated = toNumberOrNull(engineDto?.jobsCreated)
  const invocationsPerBatchJob = toNumberOrNull(engineDto?.invocationsPerBatchJob)
  const seedJobDefinitionId = engineDto?.seedJobDefinitionId || null
  const monitorJobDefinitionId = engineDto?.monitorJobDefinitionId || null
  const batchJobDefinitionId = engineDto?.batchJobDefinitionId || null
  await batchRepo.insert({
    id,
    engineId,
    camundaBatchId,
    type,
    payload: JSON.stringify(payload ?? {}),
    totalJobs,
    jobsCreated,
    invocationsPerBatchJob,
    seedJobDefinitionId,
    monitorJobDefinitionId,
    batchJobDefinitionId,
    status: 'RUNNING',
    progress: 0,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    lastError: null,
  })
  return { id }
}

r.post('/mission-control-api/batches/process-instances/delete', requireEngineReadOrWrite({ engineIdFrom: 'body' }), asyncHandler(async (req: Request, res: Response) => {
  const body = { ...(req.body || {}) }
  if (typeof body.deleteReason !== 'string' || !body.deleteReason.trim()) {
    body.deleteReason = 'Canceled via Mission Control'
  }
  if (typeof body.skipCustomListeners !== 'boolean') {
    body.skipCustomListeners = true
  }
  if (typeof body.skipIoMappings !== 'boolean') {
    body.skipIoMappings = true
  }
  const engineId = (req as any).engineId as string
  const engineDto: any = await deleteProcessInstancesBatch(engineId, body)
  const { id } = await insertLocalBatch('DELETE_INSTANCES', engineDto?.id, body, engineDto, engineId)
  res.status(201).json({ id, camundaBatchId: engineDto?.id, type: 'DELETE_INSTANCES' })
}))

r.post('/mission-control-api/batches/process-instances/suspend', requireEngineReadOrWrite({ engineIdFrom: 'body' }), asyncHandler(async (req: Request, res: Response) => {
  const body = { ...req.body, suspended: true }
  logger.info('[BATCH SUSPEND] Sending to Camunda:', JSON.stringify(body, null, 2))
  const engineId = (req as any).engineId as string
  const engineDto: any = await suspendProcessInstancesBatch(engineId, body)
  logger.info('[BATCH SUSPEND] Camunda response:', JSON.stringify(engineDto, null, 2))
  const { id } = await insertLocalBatch('SUSPEND_INSTANCES', engineDto?.id, body, engineDto, engineId)
  res.status(201).json({ id, camundaBatchId: engineDto?.id, type: 'SUSPEND_INSTANCES' })
}))

r.post('/mission-control-api/batches/process-instances/activate', requireEngineReadOrWrite({ engineIdFrom: 'body' }), asyncHandler(async (req: Request, res: Response) => {
  const body = { ...req.body, suspended: false }
  const engineId = (req as any).engineId as string
  const engineDto: any = await suspendProcessInstancesBatch(engineId, body)
  const { id } = await insertLocalBatch('ACTIVATE_INSTANCES', engineDto?.id, body, engineDto, engineId)
  res.status(201).json({ id, camundaBatchId: engineDto?.id, type: 'ACTIVATE_INSTANCES' })
}))

r.post('/mission-control-api/batches/jobs/retries', requireEngineReadOrWrite({ engineIdFrom: 'body' }), asyncHandler(async (req: Request, res: Response) => {
  const { processInstanceIds } = req.body
  
  if (!Array.isArray(processInstanceIds) || processInstanceIds.length === 0) {
    throw Errors.validation('processInstanceIds array is required')
  }

  // Create a local batch for tracking (no Camunda batch - we'll handle retries directly)
  const engineId = (req as any).engineId as string
  const { id } = await insertLocalBatch('SET_JOB_RETRIES', 'local-retry-' + Date.now(), req.body, {
    totalJobs: processInstanceIds.length,
    jobsCreated: processInstanceIds.length
  }, engineId)

  // Start async processing in background
  processRetries(engineId, id, processInstanceIds).catch((err: any) => {
    logger.error('[BATCH RETRY] Background processing failed:', err)
  })

  res.status(201).json({ id, type: 'SET_JOB_RETRIES' })
}))

r.get('/mission-control-api/batches', requireEngineReadOrWrite({ engineIdFrom: 'query' }), asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource()
  const batchRepo = dataSource.getRepository(Batch)
  const engineId = (req as any).engineId as string
  const rows = await batchRepo.find({ where: { engineId } })
  const sorted = rows.sort((a: any, b: any) => b.createdAt - a.createdAt)
  const withSuspended = sorted.map((row: any) => {
    let suspended: boolean | undefined
    if (typeof row?.metadata === 'string' && row.metadata.trim()) {
      try {
        const meta = JSON.parse(row.metadata)
        if (typeof meta?.suspended === 'boolean') suspended = meta.suspended
      } catch (e) { logger.debug('Failed to parse batch metadata', { batchId: row.id, error: e }) }
    }
    return suspended === undefined ? row : { ...row, suspended }
  })
  res.json(withSuspended)
}))

r.put('/mission-control-api/batches/:id/suspended', requireEngineReadOrWrite({ engineIdFrom: 'body' }), asyncHandler(async (req: Request, res: Response) => {
  const suspended = (req.body as { suspended?: boolean })?.suspended
  if (typeof suspended !== 'boolean') {
    throw Errors.validation('suspended (boolean) is required')
  }

  const dataSource = await getDataSource()
  const batchRepo = dataSource.getRepository(Batch)
  const engineId = (req as any).engineId as string
  const row = await batchRepo.findOne({ where: { id: req.params.id, engineId } })
  if (!row) throw Errors.notFound('Batch', req.params.id)
  if (!row.camundaBatchId) throw Errors.validation('Batch has no camundaBatchId')
  if (String(row.camundaBatchId).startsWith('local-')) {
    throw Errors.validation('Batch does not support suspension control')
  }

  await setBatchSuspended(engineId, row.camundaBatchId, suspended)

  // Persist for list rendering without calling Camunda per-row.
  let meta: any = {}
  if (typeof row.metadata === 'string' && row.metadata.trim()) {
    try {
      meta = JSON.parse(row.metadata)
    } catch (e) { logger.debug('Failed to parse batch metadata', { batchId: row.id, error: e }) }
  }
  meta = { ...(meta || {}), suspended }

  const nextStatus = suspended && (String(row.status || '').toUpperCase() === 'RUNNING' || String(row.status || '').toUpperCase() === 'PENDING')
    ? 'SUSPENDED'
    : (!suspended && String(row.status || '').toUpperCase() === 'SUSPENDED')
      ? 'RUNNING'
      : row.status

  await batchRepo.update({ id: req.params.id }, {
    metadata: JSON.stringify(meta),
    status: nextStatus,
    updatedAt: Date.now(),
  })

  res.status(204).end()
}))

r.get('/mission-control-api/batches/:id', requireEngineReadOrWrite({ engineIdFrom: 'query' }), asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource()
  const batchRepo = dataSource.getRepository(Batch)
  const engineId = (req as any).engineId as string
  let row = await batchRepo.findOne({ where: { id: req.params.id, engineId } })
  if (!row) throw Errors.notFound('Batch', req.params.id)
  let engine: any = null
  let stats: any = null
  let failedJobs: any[] = []
  if (row.camundaBatchId) {
    try { engine = await fetchBatchInfo(engineId, row.camundaBatchId) } catch (e) { logger.debug('Failed to fetch batch info from engine', { batchId: req.params.id, error: e }) }
    try {
      stats = await fetchBatchStatistics(engineId, row.camundaBatchId)
    } catch (e) { logger.debug('Failed to fetch batch statistics from engine', { batchId: req.params.id, error: e }) }

    const seedDefId = (engine?.seedJobDefinitionId ?? row.seedJobDefinitionId) as string | undefined
    const monitorDefId = (engine?.monitorJobDefinitionId ?? row.monitorJobDefinitionId) as string | undefined
    const batchDefId = (engine?.batchJobDefinitionId ?? row.batchJobDefinitionId) as string | undefined
    const batchJobDefIds = new Set([seedDefId, monitorDefId, batchDefId].filter(Boolean) as string[])

    const fetchFailedBatchJobs = async () => {
      const all = await fetchJobsByDefinitionIds(engineId, Array.from(batchJobDefIds))
      // De-dupe by id
      const byId = new Map<string, any>()
      for (const j of all) {
        if (j?.id) byId.set(String(j.id), j)
      }
      return Array.from(byId.values()).filter((j: any) => j?.exceptionMessage)
    }

    // If statistics API failed or returned nothing, query jobs directly to detect failures
    if (!stats || typeof stats !== 'object' || Object.keys(stats).length === 0) {
      try {
        failedJobs = await fetchFailedBatchJobs()
        const failedCount = failedJobs.length
        const totalJobs = engine?.totalJobs || row.totalJobs || undefined
        stats = {
          failedJobs: failedCount,
          remainingJobs: 0,
          completedJobs: typeof totalJobs === 'number' ? Math.max(0, totalJobs - failedCount) : undefined,
        }
      } catch (e) { logger.debug('Failed to fetch failed batch jobs', { batchId: req.params.id, error: e }) }
    } else {
      // Even when stats exist, we still want failed job details (but only for the batch job definitions)
      try {
        failedJobs = await fetchFailedBatchJobs()
      } catch (e) { logger.debug('Failed to fetch failed batch jobs', { batchId: req.params.id, error: e }) }
    }
  }
  // Synthesize statistics for completed batches if engine has already GC'd stats
  let outStats: any = stats && typeof stats === 'object' ? { ...stats } : {}
  const total = (typeof engine?.totalJobs === 'number' ? engine.totalJobs : undefined) ?? (typeof row.totalJobs === 'number' ? row.totalJobs : undefined)
  const failed = (typeof outStats.failedJobs === 'number' ? outStats.failedJobs : undefined) ?? (typeof row.failedJobs === 'number' ? row.failedJobs : undefined) ?? 0
  let remaining = (typeof outStats.remainingJobs === 'number' ? outStats.remainingJobs : undefined) ?? (typeof row.remainingJobs === 'number' ? row.remainingJobs : undefined)
  if (row.status === 'COMPLETED') {
    // On completion, remaining is effectively zero
    if (typeof remaining !== 'number') remaining = 0
  }
  let completed = (typeof outStats.completedJobs === 'number' ? outStats.completedJobs : undefined) ?? (typeof row.completedJobs === 'number' ? row.completedJobs : undefined)
  if (row.status === 'COMPLETED' && typeof completed !== 'number' && typeof total === 'number') {
    completed = Math.max(0, total - (failed || 0) - (remaining || 0))
  }
  if (Object.keys(outStats).length === 0 || row.status === 'COMPLETED') {
    outStats = {
      completedJobs: typeof completed === 'number' ? completed : undefined,
      failedJobs: typeof failed === 'number' ? failed : undefined,
      remainingJobs: typeof remaining === 'number' ? remaining : undefined,
    }
  }

  // Heal incorrect FAILED status when we have explicit stats and they indicate success.
  // This can happen if earlier logic accidentally attributed unrelated failing jobs to the batch.
  const hasExplicitStats =
    typeof outStats.failedJobs === 'number' ||
    typeof outStats.remainingJobs === 'number' ||
    typeof outStats.completedJobs === 'number'
  if (
    row.status === 'FAILED' &&
    hasExplicitStats &&
    (outStats.failedJobs ?? 0) === 0 &&
    (outStats.remainingJobs ?? 0) === 0
  ) {
    await batchRepo.update({ id: req.params.id }, {
      status: 'COMPLETED',
      failedJobs: 0,
      remainingJobs: 0,
      lastError: null,
      updatedAt: Date.now(),
    })
    const refreshed = await batchRepo.findOne({ where: { id: req.params.id } })
    row = refreshed || row
  }
  
  // Mark RUNNING as COMPLETED when all jobs are done with no failures
  if (
    row.status === 'RUNNING' &&
    hasExplicitStats &&
    (outStats.failedJobs ?? 0) === 0 &&
    (outStats.remainingJobs ?? 0) === 0 &&
    typeof outStats.completedJobs === 'number' &&
    outStats.completedJobs > 0
  ) {
    await batchRepo.update({ id: req.params.id }, {
      status: 'COMPLETED',
      completedJobs: outStats.completedJobs,
      failedJobs: 0,
      remainingJobs: 0,
      progress: 100,
      completedAt: Date.now(),
      updatedAt: Date.now(),
    })
    const refreshed = await batchRepo.findOne({ where: { id: req.params.id } })
    row = refreshed || row
  }
  
  // Update local batch status if we detected failures and there are no remaining jobs
  let batchError: string | null = null
  if ((row!.status === 'RUNNING' || row!.status === 'COMPLETED') && failed > 0 && remaining === 0) {
    // All jobs processed, some failed - mark as FAILED
    const errorMsg = failedJobs.length > 0
      ? failedJobs[0].exceptionMessage
      : (typeof total === 'number' ? `${failed} of ${total} jobs failed` : `${failed} job(s) failed`)
    await batchRepo.update({ id: req.params.id }, { 
      status: 'FAILED', 
      failedJobs: failed,
      completedJobs: completed || 0,
      lastError: errorMsg,
      updatedAt: Date.now() 
    })
    // Refresh row
    const updatedRow = await batchRepo.findOne({ where: { id: req.params.id } })
    row = updatedRow || row
    batchError = errorMsg
  } else if (failedJobs.length > 0 && !row!.lastError) {
    // Store the error message for display even if batch is still running
    batchError = failedJobs[0].exceptionMessage
  }
  
  const failedJobDetails = await Promise.all(
    failedJobs.slice(0, 5).map(async (j: any) => {
      let stacktrace: string | undefined
      try {
        if (j?.id) {
          const trace = await fetchJobStacktrace(engineId, j.id)
          if (typeof trace === 'string') stacktrace = trace
        }
      } catch (e) { logger.debug('Failed to fetch job stacktrace', { jobId: j?.id, error: e }) }
      return {
        id: j.id,
        exceptionMessage: j.exceptionMessage,
        retries: j.retries,
        jobDefinitionId: j.jobDefinitionId,
        processInstanceId: j.processInstanceId,
        executionId: j.executionId,
        stacktrace,
      }
    })
  )

  let suspended: boolean | undefined
  if (typeof row?.metadata === 'string' && row.metadata.trim()) {
    try {
      const meta = JSON.parse(row.metadata)
      if (typeof meta?.suspended === 'boolean') suspended = meta.suspended
    } catch (e) { logger.debug('Failed to parse batch metadata', { batchId: req.params.id, error: e }) }
  }

  res.json({
    batch: { ...row, lastError: batchError || row.lastError, ...(suspended === undefined ? {} : { suspended }) },
    engine,
    statistics: outStats,
    failedJobDetails,
  })
}))

r.delete('/mission-control-api/batches/:id', requireEngineReadOrWrite({ engineIdFrom: 'query' }), asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource()
  const batchRepo = dataSource.getRepository(Batch)
  const engineId = (req as any).engineId as string
  const row = await batchRepo.findOne({ where: { id: req.params.id, engineId } })
  if (!row) throw Errors.notFound('Batch', req.params.id)
  if (row.camundaBatchId) {
    try { await deleteBatch(engineId, row.camundaBatchId) } catch (e) { logger.debug('Failed to delete batch from engine (best-effort)', { batchId: req.params.id, error: e }) }
  }
  const now = Date.now()
  await batchRepo.update({ id: req.params.id }, { status: 'CANCELED', updatedAt: now })
  res.status(204).end()
}))

/**
 * Delete batch record from database (for completed/failed/canceled batches only)
 */
r.delete('/mission-control-api/batches/:id/record', requireEngineReadOrWrite({ engineIdFrom: 'query' }), asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource()
  const batchRepo = dataSource.getRepository(Batch)
  const engineId = (req as any).engineId as string
  const row = await batchRepo.findOne({ where: { id: req.params.id, engineId } })
  if (!row) throw Errors.notFound('Batch', req.params.id)
  
  const st = String(row.status || '').toUpperCase()
  if (!['COMPLETED', 'FAILED', 'CANCELED'].includes(st)) {
    throw Errors.validation('Can only delete completed, failed, or canceled batches')
  }
  
  await batchRepo.delete({ id: req.params.id })
  res.status(204).end()
}))

export default r

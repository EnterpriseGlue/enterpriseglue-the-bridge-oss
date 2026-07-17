import { Router, Request, Response } from 'express'
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js'
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js'
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js'
import { getRuntimeResourceActionDecision, requireRuntimeCollectionAction, requireRuntimeProcessInstanceSelectionAction } from '@enterpriseglue/shared/middleware/requireAction.js'
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
import { markBatchPollerViewer } from '../../../poller/batchPoller.js'
import { piiRedactionService } from '@enterpriseglue/shared/services/pii/PiiRedactionService.js'
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js'
import { Batch } from '@enterpriseglue/shared/infrastructure/persistence/entities/Batch.js'
import { BatchDetailSchema } from '@enterpriseglue/shared/schemas/mission-control/batch.js'
import { BatchOperationCreateResponseSchema } from '@enterpriseglue/shared/schemas/mission-control/batch.js'
import { getBoundedRuntimeResourceQuery } from '../shared/runtime-resource-filter.js'

const r = Router()

r.use(requireAuth)

async function insertLocalBatch(type: string, camundaBatchId: string, payload: any, engineDto: any, engineId: string, processDefinitionKeys?: string[]) {
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
    metadata: processDefinitionKeys?.length ? JSON.stringify({ authz: { processDefinitionKeys } }) : null,
  })
  return { id }
}

function batchRuntimeResourceKeys(row: Batch): string[] {
  if (!row.metadata) return []
  try {
    const keys = JSON.parse(row.metadata)?.authz?.processDefinitionKeys
    return Array.isArray(keys) ? keys.filter((key): key is string => typeof key === 'string' && key.length > 0) : []
  } catch {
    return []
  }
}

function requireVisibleBatch(row: Batch, authorizedKeys?: string[]) {
  if (!authorizedKeys) return
  const batchKeys = batchRuntimeResourceKeys(row)
  if (!batchKeys.length || !batchKeys.every((key) => authorizedKeys.includes(key))) {
    throw Errors.forbidden('Batch is not available for the authorized runtime resources')
  }
}

async function batchRuntimeActionDecisions(req: Request, row: Batch) {
  const input = {
    userId: req.user!.userId,
    tenantId: req.tenant?.tenantId || null,
    engineId: row.engineId,
    resourceKind: 'process_definition' as const,
    resourceKeys: batchRuntimeResourceKeys(row),
  }
  const [suspension, cancel, recordDelete] = await Promise.all([
    getRuntimeResourceActionDecision({ ...input, actionId: 'engine.runtime.batches.suspension.update' }),
    getRuntimeResourceActionDecision({ ...input, actionId: 'engine.runtime.batches.cancel' }),
    getRuntimeResourceActionDecision({ ...input, actionId: 'engine.runtime.batches.record.delete' }),
  ])
  return { suspension, cancel, recordDelete }
}

function stripLocalAuditFields<T extends Record<string, any>>(body: T): Omit<T, 'auditReason'> {
  const { auditReason: _auditReason, ...engineBody } = body || {}
  return engineBody
}

r.post('/mission-control-api/batches/process-instances/delete', requireRuntimeProcessInstanceSelectionAction('engine.runtime.batches.process-instances.delete', { resourceKind: 'process_definition' }), asyncHandler(async (req: Request, res: Response) => {
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
  const engineDto: any = await deleteProcessInstancesBatch(engineId, stripLocalAuditFields(body))
  const { id } = await insertLocalBatch('DELETE_INSTANCES', engineDto?.id, body, engineDto, engineId, req.authorizedRuntimeResourceKeys)
  res.status(201).json(BatchOperationCreateResponseSchema.parse({ id, camundaBatchId: engineDto?.id, type: 'DELETE_INSTANCES' }))
}))

r.post('/mission-control-api/batches/process-instances/suspend', requireRuntimeProcessInstanceSelectionAction('engine.runtime.batches.process-instances.suspend', { resourceKind: 'process_definition' }), asyncHandler(async (req: Request, res: Response) => {
  const body = { ...req.body, suspended: true }
  const engineBody = stripLocalAuditFields(body)
  const engineId = (req as any).engineId as string
  const engineDto: any = await suspendProcessInstancesBatch(engineId, engineBody)
  const { id } = await insertLocalBatch('SUSPEND_INSTANCES', engineDto?.id, body, engineDto, engineId, req.authorizedRuntimeResourceKeys)
  res.status(201).json(BatchOperationCreateResponseSchema.parse({ id, camundaBatchId: engineDto?.id, type: 'SUSPEND_INSTANCES' }))
}))

r.post('/mission-control-api/batches/process-instances/activate', requireRuntimeProcessInstanceSelectionAction('engine.runtime.batches.process-instances.activate', { resourceKind: 'process_definition' }), asyncHandler(async (req: Request, res: Response) => {
  const body = { ...req.body, suspended: false }
  const engineId = (req as any).engineId as string
  const engineDto: any = await suspendProcessInstancesBatch(engineId, stripLocalAuditFields(body))
  const { id } = await insertLocalBatch('ACTIVATE_INSTANCES', engineDto?.id, body, engineDto, engineId, req.authorizedRuntimeResourceKeys)
  res.status(201).json(BatchOperationCreateResponseSchema.parse({ id, camundaBatchId: engineDto?.id, type: 'ACTIVATE_INSTANCES' }))
}))

r.post('/mission-control-api/batches/jobs/retries', requireRuntimeProcessInstanceSelectionAction('engine.runtime.batches.jobs.retry', { resourceKind: 'process_definition' }), asyncHandler(async (req: Request, res: Response) => {
  const { processInstanceIds } = req.body
  
  if (!Array.isArray(processInstanceIds) || processInstanceIds.length === 0) {
    throw Errors.validation('processInstanceIds array is required')
  }

  // Create a local batch for tracking (no Camunda batch - we'll handle retries directly)
  const engineId = (req as any).engineId as string
  const { id } = await insertLocalBatch('SET_JOB_RETRIES', 'local-retry-' + Date.now(), req.body, {
    totalJobs: processInstanceIds.length,
    jobsCreated: processInstanceIds.length
  }, engineId, req.authorizedRuntimeResourceKeys)

  // Start async processing in background
  processRetries(engineId, id, processInstanceIds).catch((err: any) => {
    logger.error('[BATCH RETRY] Background processing failed:', err)
  })

  res.status(201).json(BatchOperationCreateResponseSchema.parse({ id, type: 'SET_JOB_RETRIES' }))
}))

r.get('/mission-control-api/batches', requireRuntimeCollectionAction('engine.runtime.batches.read', { resourceKind: 'process_definition' }), asyncHandler(async (req: Request, res: Response) => {
  await markBatchPollerViewer()
  const dataSource = await getDataSource()
  const batchRepo = dataSource.getRepository(Batch)
  const engineId = (req as any).engineId as string
  const rows = await batchRepo.find({ where: { engineId } })
  const firstResult = typeof req.query.firstResult === 'string' && /^\d+$/.test(req.query.firstResult)
    ? Number(req.query.firstResult)
    : req.query.firstResult
  if (firstResult !== undefined && (typeof firstResult !== 'number' || !Number.isInteger(firstResult) || firstResult < 0)) {
    throw Errors.validation('firstResult must be a non-negative integer')
  }
  const { maxResults } = getBoundedRuntimeResourceQuery({ maxResults: req.query.maxResults })
  const sorted = rows
    .filter((row: Batch) => !req.authorizedRuntimeResourceKeys || batchRuntimeResourceKeys(row).some((key) => req.authorizedRuntimeResourceKeys!.includes(key)))
    .sort((a: any, b: any) => b.createdAt - a.createdAt)
    .slice(firstResult || 0, (firstResult || 0) + maxResults)
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
  res.json(req.query.includeActionDecisions === 'true'
    ? await Promise.all(withSuspended.map(async (row) => ({ ...row, runtimeActionDecisions: await batchRuntimeActionDecisions(req, row) })))
    : withSuspended)
}))

r.put('/mission-control-api/batches/:id/suspended', requireRuntimeCollectionAction('engine.runtime.batches.suspension.update', { resourceKind: 'process_definition', engineIdFrom: 'body' }), asyncHandler(async (req: Request, res: Response) => {
  const suspended = (req.body as { suspended?: boolean })?.suspended
  if (typeof suspended !== 'boolean') {
    throw Errors.validation('suspended (boolean) is required')
  }

  const dataSource = await getDataSource()
  const batchRepo = dataSource.getRepository(Batch)
  const engineId = (req as any).engineId as string
  const batchId = String(req.params.id)
  const row = await batchRepo.findOne({ where: { id: batchId, engineId } })
  if (!row) throw Errors.notFound('Batch', batchId)
  requireVisibleBatch(row, req.authorizedRuntimeResourceKeys)
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

  await batchRepo.update({ id: batchId }, {
    metadata: JSON.stringify(meta),
    status: nextStatus,
    updatedAt: Date.now(),
  })

  res.status(204).end()
}))

r.get('/mission-control-api/batches/:id', requireRuntimeCollectionAction('engine.runtime.batches.read', { resourceKind: 'process_definition' }), asyncHandler(async (req: Request, res: Response) => {
  await markBatchPollerViewer()
  const dataSource = await getDataSource()
  const batchRepo = dataSource.getRepository(Batch)
  const engineId = (req as any).engineId as string
  const batchId = String(req.params.id)
  let row = await batchRepo.findOne({ where: { id: batchId, engineId } })
  if (!row) throw Errors.notFound('Batch', batchId)
  requireVisibleBatch(row, req.authorizedRuntimeResourceKeys)
  let engine: any = null
  let stats: any = null
  let failedJobs: any[] = []
  if (row.camundaBatchId) {
    try { engine = await fetchBatchInfo(engineId, row.camundaBatchId) } catch (e) { logger.debug('Failed to fetch batch info from engine', { batchId, error: e }) }
    try {
      stats = await fetchBatchStatistics(engineId, row.camundaBatchId)
    } catch (e) { logger.debug('Failed to fetch batch statistics from engine', { batchId, error: e }) }

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
      } catch (e) { logger.debug('Failed to fetch failed batch jobs', { batchId, error: e }) }
    } else {
      // Even when stats exist, we still want failed job details (but only for the batch job definitions)
      try {
        failedJobs = await fetchFailedBatchJobs()
      } catch (e) { logger.debug('Failed to fetch failed batch jobs', { batchId, error: e }) }
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
    await batchRepo.update({ id: batchId }, {
      status: 'COMPLETED',
      failedJobs: 0,
      remainingJobs: 0,
      lastError: null,
      updatedAt: Date.now(),
    })
    const refreshed = await batchRepo.findOne({ where: { id: batchId } })
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
    await batchRepo.update({ id: batchId }, {
      status: 'COMPLETED',
      completedJobs: outStats.completedJobs,
      failedJobs: 0,
      remainingJobs: 0,
      progress: 100,
      completedAt: Date.now(),
      updatedAt: Date.now(),
    })
    const refreshed = await batchRepo.findOne({ where: { id: batchId } })
    row = refreshed || row
  }
  
  // Update local batch status if we detected failures and there are no remaining jobs
  let batchError: string | null = null
  if ((row!.status === 'RUNNING' || row!.status === 'COMPLETED') && failed > 0 && remaining === 0) {
    // All jobs processed, some failed - mark as FAILED
    const errorMsg = failedJobs.length > 0
      ? failedJobs[0].exceptionMessage
      : (typeof total === 'number' ? `${failed} of ${total} jobs failed` : `${failed} job(s) failed`)
    await batchRepo.update({ id: batchId }, { 
      status: 'FAILED', 
      failedJobs: failed,
      completedJobs: completed || 0,
      remainingJobs: remaining || 0,
      lastError: errorMsg,
      updatedAt: Date.now() 
    })
    // Refresh row
    const updatedRow = await batchRepo.findOne({ where: { id: batchId } })
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
    } catch (e) { logger.debug('Failed to parse batch metadata', { batchId: String(req.params.id), error: e }) }
  }

  const runtimeActionDecisions = req.query.includeActionDecisions === 'true'
    ? await batchRuntimeActionDecisions(req, row)
    : undefined
  const redacted = await piiRedactionService.redactPayload(req, {
    batch: { ...row, lastError: batchError || row.lastError, ...(suspended === undefined ? {} : { suspended }) },
    engine,
    statistics: outStats,
    failedJobDetails,
    ...(runtimeActionDecisions ? { runtimeActionDecisions } : {}),
  }, 'errors')

  res.json(BatchDetailSchema.parse(redacted))
}))

r.delete('/mission-control-api/batches/:id', requireRuntimeCollectionAction('engine.runtime.batches.cancel', { resourceKind: 'process_definition' }), asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource()
  const batchRepo = dataSource.getRepository(Batch)
  const engineId = (req as any).engineId as string
  const batchId = String(req.params.id)
  const row = await batchRepo.findOne({ where: { id: batchId, engineId } })
  if (!row) throw Errors.notFound('Batch', batchId)
  requireVisibleBatch(row, req.authorizedRuntimeResourceKeys)
  if (row.camundaBatchId) {
    try { await deleteBatch(engineId, row.camundaBatchId) } catch (e) { logger.debug('Failed to delete batch from engine (best-effort)', { batchId, error: e }) }
  }
  const now = Date.now()
  await batchRepo.update({ id: batchId }, { status: 'CANCELED', updatedAt: now })
  res.status(204).end()
}))

/**
 * Delete batch record from database (for completed/failed/canceled batches only)
 */
r.delete('/mission-control-api/batches/:id/record', requireRuntimeCollectionAction('engine.runtime.batches.record.delete', { resourceKind: 'process_definition' }), asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource()
  const batchRepo = dataSource.getRepository(Batch)
  const engineId = (req as any).engineId as string
  const batchId = String(req.params.id)
  const row = await batchRepo.findOne({ where: { id: batchId, engineId } })
  if (!row) throw Errors.notFound('Batch', batchId)
  requireVisibleBatch(row, req.authorizedRuntimeResourceKeys)
  
  const st = String(row.status || '').toUpperCase()
  if (!['COMPLETED', 'FAILED', 'CANCELED'].includes(st)) {
    throw Errors.validation('Can only delete completed, failed, or canceled batches')
  }
  
  await batchRepo.delete({ id: batchId })
  res.status(204).end()
}))

export default r

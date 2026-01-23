/**
 * Mission Control batch service
 */

import { logger } from '@shared/utils/logger.js'
import { randomUUID } from 'node:crypto'
import {
  camundaGet,
  deleteBatchById,
  getBatchInfo,
  getBatchStatistics,
  postJobRetriesAsync,
  postProcessInstanceDeleteAsync,
  postProcessInstanceSuspendedAsync,
  setBatchSuspensionState,
  setExternalTaskRetries,
} from '@shared/services/bpmn-engine-client.js'
import { getDataSource } from '@shared/db/data-source.js'
import { Batch } from '@shared/db/entities/Batch.js'

export interface BatchStatisticsEntry {
  completedJobs?: number
  failedJobs?: number
  remainingJobs?: number
}

export function toNumberOrUndefined(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

export function normalizeBatchStatistics(raw: BatchStatisticsEntry | BatchStatisticsEntry[] | null): BatchStatisticsEntry {
  // Camunda/Operaton may return statistics either as an object or as an array (per-tenant entries)
  if (Array.isArray(raw)) {
    let completed = 0
    let failed = 0
    let remaining = 0
    let sawAny = false
    for (const entry of raw) {
      const c = toNumberOrUndefined(entry?.completedJobs)
      const f = toNumberOrUndefined(entry?.failedJobs)
      const r2 = toNumberOrUndefined(entry?.remainingJobs)
      if (typeof c === 'number') {
        completed += c
        sawAny = true
      }
      if (typeof f === 'number') {
        failed += f
        sawAny = true
      }
      if (typeof r2 === 'number') {
        remaining += r2
        sawAny = true
      }
    }
    return sawAny ? { completedJobs: completed, failedJobs: failed, remainingJobs: remaining } : {}
  }

  if (raw && typeof raw === 'object') {
    const completedJobs = toNumberOrUndefined(raw.completedJobs)
    const failedJobs = toNumberOrUndefined(raw.failedJobs)
    const remainingJobs = toNumberOrUndefined(raw.remainingJobs)
    const out: BatchStatisticsEntry = {}
    if (typeof completedJobs === 'number') out.completedJobs = completedJobs
    if (typeof failedJobs === 'number') out.failedJobs = failedJobs
    if (typeof remainingJobs === 'number') out.remainingJobs = remainingJobs
    return out
  }

  return {}
}

/**
 * Hybrid batch retry processing
 * - Uses Camunda batch API for jobs (fast, native)
 * - Uses parallel processing for external tasks (fast, resilient)
 */
export async function processRetries(engineId: string, batchId: string, processInstanceIds: string[]) {
  const dataSource = await getDataSource()
  const batchRepo = dataSource.getRepository(Batch)

  try {
    await batchRepo.update({ id: batchId }, { status: 'RUNNING', updatedAt: Date.now() })

    // PHASE 1: Collect all job IDs and external task IDs in parallel
    logger.info(`[BATCH RETRY] Collecting failures for ${processInstanceIds.length} instances...`)
    const { jobIds, externalTaskIds } = await collectAllFailures(engineId, processInstanceIds)
    logger.info(`[BATCH RETRY] Found ${jobIds.length} failed jobs, ${externalTaskIds.length} failed external tasks`)

    const totalItems = jobIds.length + externalTaskIds.length
    let camundaBatchId: string | null = null

    // Store metadata
    const metadata = {
      jobsTotal: jobIds.length,
      jobsCompleted: 0,
      jobsFailed: 0,
      jobsRemaining: jobIds.length,
      externalTasksTotal: externalTaskIds.length,
      externalTasksCompleted: 0,
      externalTasksFailed: 0,
      externalTasksRemaining: externalTaskIds.length,
      processingMode: 'hybrid',
    }

    await batchRepo.update(
      { id: batchId },
      {
        totalJobs: totalItems,
        jobsCreated: totalItems,
        metadata: JSON.stringify(metadata),
        updatedAt: Date.now(),
      }
    )

    // PHASE 2: Create Camunda batch for jobs (if any)
    if (jobIds.length > 0) {
      logger.info(`[BATCH RETRY] Creating Camunda batch for ${jobIds.length} jobs...`)
      const engineDto: any = await postJobRetriesAsync(engineId, { jobIds, retries: 1 })
      camundaBatchId = engineDto?.id || null
      logger.info(`[BATCH RETRY] Camunda batch created: ${camundaBatchId}`)

      await batchRepo.update(
        { id: batchId },
        {
          camundaBatchId,
          updatedAt: Date.now(),
        }
      )
    }

    // PHASE 3: Process external tasks in parallel (if any)
    if (externalTaskIds.length > 0) {
      logger.info(`[BATCH RETRY] Processing ${externalTaskIds.length} external tasks in parallel...`)
      await retryExternalTasksInParallel(engineId, batchId, externalTaskIds, metadata)
    }

    // PHASE 4: Monitor Camunda batch completion (if exists)
    if (camundaBatchId) {
      await monitorCamundaBatch(engineId, batchId, camundaBatchId, metadata)
    }

    // Final status update
    const finalMeta = await getFinalMetadata(batchId)
    const allCompleted = finalMeta.jobsCompleted + finalMeta.externalTasksCompleted === totalItems
    const hasFailed = finalMeta.jobsFailed + finalMeta.externalTasksFailed > 0

    await batchRepo.update(
      { id: batchId },
      {
        status: allCompleted ? 'COMPLETED' : (hasFailed ? 'FAILED' : 'COMPLETED'),
        progress: 100,
        completedJobs: finalMeta.jobsCompleted + finalMeta.externalTasksCompleted,
        failedJobs: finalMeta.jobsFailed + finalMeta.externalTasksFailed,
        completedAt: Date.now(),
        updatedAt: Date.now(),
      }
    )

    logger.info(`[BATCH RETRY] Batch ${batchId} completed`)
  } catch (err: any) {
    logger.error('[BATCH RETRY] Processing failed:', err)
    await batchRepo.update(
      { id: batchId },
      {
        status: 'FAILED',
        lastError: err?.message || String(err),
        updatedAt: Date.now(),
      }
    )
  }
}

/**
 * Collect all failed job IDs and external task IDs from process instances
 */
export async function collectAllFailures(engineId: string, processInstanceIds: string[]) {
  const jobIds: string[] = []
  const externalTaskIds: string[] = []

  // Query all instances in parallel for speed
  const results = await Promise.allSettled(
    processInstanceIds.map(async (id) => {
      const [incidents, jobs, extTasks] = await Promise.all([
        camundaGet<any[]>(engineId, '/incident', { processInstanceId: id }),
        camundaGet<any[]>(engineId, '/job', { processInstanceId: id, withException: true }),
        camundaGet<any[]>(engineId, '/external-task', { processInstanceId: id }),
      ])

      return { incidents, jobs, extTasks }
    })
  )

  for (const result of results) {
    if (result.status === 'fulfilled') {
      const { incidents, jobs, extTasks } = result.value

      // Collect failed job IDs
      const hasJobIncidents = incidents.some((inc: any) => inc.incidentType === 'failedJob')
      if (hasJobIncidents) {
        jobIds.push(...jobs.filter((j: any) => j.exceptionMessage).map((j: any) => j.id))
      }

      // Collect failed external task IDs
      const hasExtTaskIncidents = incidents.some((inc: any) => inc.incidentType === 'failedExternalTask')
      if (hasExtTaskIncidents) {
        externalTaskIds.push(...extTasks.filter((et: any) => et.errorMessage).map((et: any) => et.id))
      }
    }
  }

  return { jobIds, externalTaskIds }
}

/**
 * Retry external tasks in parallel with chunking for performance
 */
export async function retryExternalTasksInParallel(engineId: string, batchId: string, externalTaskIds: string[], metadata: any) {
  const dataSource = await getDataSource()
  const batchRepo = dataSource.getRepository(Batch)
  const CONCURRENCY = 10 // Process 10 at a time
  const chunks: string[][] = []

  for (let i = 0; i < externalTaskIds.length; i += CONCURRENCY) {
    chunks.push(externalTaskIds.slice(i, i + CONCURRENCY))
  }

  let completed = 0
  let failed = 0

  for (const chunk of chunks) {
    const results = await Promise.allSettled(chunk.map(id => setExternalTaskRetries(engineId, id, { retries: 1 })))

    results.forEach(r => {
      if (r.status === 'fulfilled') completed++
      else failed++
    })

    // Update metadata after each chunk
    metadata.externalTasksCompleted = completed
    metadata.externalTasksFailed = failed
    metadata.externalTasksRemaining = externalTaskIds.length - completed - failed

    const totalCompleted = metadata.jobsCompleted + completed
    const totalItems = metadata.jobsTotal + metadata.externalTasksTotal
    const progress = totalItems > 0 ? Math.round((totalCompleted / totalItems) * 100) : 0

    await batchRepo.update(
      { id: batchId },
      {
        progress,
        completedJobs: totalCompleted,
        failedJobs: metadata.jobsFailed + failed,
        metadata: JSON.stringify(metadata),
        updatedAt: Date.now(),
      }
    )
  }

  logger.info(`[BATCH RETRY] External tasks completed: ${completed}, failed: ${failed}`)
}

export async function monitorCamundaBatch(engineId: string, batchId: string, camundaBatchId: string, metadata: any) {
  const dataSource = await getDataSource()
  const batchRepo = dataSource.getRepository(Batch)

  let done = false
  while (!done) {
    await new Promise((r) => setTimeout(r, 2000))
    const statsRaw = await getBatchStatistics<any>(engineId, camundaBatchId)
    const stats = normalizeBatchStatistics(statsRaw)

    const completedJobs = stats.completedJobs ?? 0
    const failedJobs = stats.failedJobs ?? 0
    const remainingJobs = stats.remainingJobs ?? 0

    metadata.jobsCompleted = completedJobs
    metadata.jobsFailed = failedJobs
    metadata.jobsRemaining = remainingJobs

    const totalCompleted = completedJobs + metadata.externalTasksCompleted
    const totalItems = metadata.jobsTotal + metadata.externalTasksTotal
    const progress = totalItems > 0 ? Math.round((totalCompleted / totalItems) * 100) : 0

    await batchRepo.update(
      { id: batchId },
      {
        progress,
        completedJobs: totalCompleted,
        failedJobs: failedJobs + metadata.externalTasksFailed,
        metadata: JSON.stringify(metadata),
        updatedAt: Date.now(),
      }
    )

    if (remainingJobs === 0) {
      done = true
    }
  }
}

export async function getFinalMetadata(batchId: string) {
  const dataSource = await getDataSource()
  const batchRepo = dataSource.getRepository(Batch)
  const batch = await batchRepo.findOneBy({ id: batchId })
  const metadata = batch?.metadata ? JSON.parse(batch.metadata) : {}
  return {
    jobsCompleted: metadata.jobsCompleted || 0,
    jobsFailed: metadata.jobsFailed || 0,
    externalTasksCompleted: metadata.externalTasksCompleted || 0,
    externalTasksFailed: metadata.externalTasksFailed || 0,
  }
}

export async function listCamundaBatches(engineId: string, query: any) {
  return camundaGet<any[]>(engineId, '/batch', query)
}

export async function fetchJobsByDefinitionIds(engineId: string, definitionIds: string[]) {
  const defIds = Array.from(new Set(definitionIds.filter(Boolean)))
  if (defIds.length === 0) return []
  const results = await Promise.allSettled(
    defIds.map((jobDefinitionId) => camundaGet<any[]>(engineId, '/job', { jobDefinitionId, withException: true }))
  )
  const all: any[] = []
  for (const r of results) {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) {
      all.push(...r.value)
    }
  }
  return all
}

export async function fetchJobStacktrace(engineId: string, jobId: string) {
  return camundaGet<any>(engineId, `/job/${encodeURIComponent(jobId)}/stacktrace`)
}

export async function fetchBatchInfo(engineId: string, id: string) {
  return getBatchInfo<any>(engineId, id)
}

export async function fetchBatchStatistics(engineId: string, id: string) {
  return normalizeBatchStatistics(await getBatchStatistics<any>(engineId, id))
}

export async function deleteBatch(engineId: string, id: string) {
  await deleteBatchById(engineId, id)
}

export async function suspendProcessInstancesBatch(engineId: string, body: any) {
  return postProcessInstanceSuspendedAsync<any>(engineId, body)
}

export async function deleteProcessInstancesBatch(engineId: string, body: any) {
  return postProcessInstanceDeleteAsync<any>(engineId, body)
}

export async function setBatchSuspended(engineId: string, id: string, suspended: boolean) {
  return setBatchSuspensionState(engineId, id, { suspended })
}

export async function setJobRetries(engineId: string, body: any) {
  return postJobRetriesAsync<any>(engineId, body)
}

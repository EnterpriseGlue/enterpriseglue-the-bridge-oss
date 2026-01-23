import { getDataSource } from '@shared/db/data-source.js'
import { Batch } from '@shared/db/entities/Batch.js'
import { In } from 'typeorm'
import { getBatchInfo, getBatchStatistics } from '@shared/services/bpmn-engine-client.js'

let timer: ReturnType<typeof setInterval> | null = null

export function startBatchPoller(intervalMs = Number(process.env.BATCH_POLL_INTERVAL_MS || 5000)) {
  if (timer) return timer
  timer = setInterval(async () => {
    try {
      const dataSource = await getDataSource()
      const batchRepo = dataSource.getRepository(Batch)
      // Load active batches directly
      const active = await batchRepo.find({
        where: { status: In(['RUNNING', 'PENDING']) },
      })
      const now = Date.now()
      for (const row of active) {
        try {
          // Skip batches without engineId (legacy data)
          if (!row.engineId) continue
          let engine: any = null
          let stats: any = null
          let engineErr: any = null
          let statsErr: any = null
          try { engine = await getBatchInfo<any>(row.engineId, row.camundaBatchId!) } catch (e) { engineErr = e }
          try { stats = await getBatchStatistics<any>(row.engineId, row.camundaBatchId!) } catch (e) { statsErr = e }
          let status = row.status
          let progress = row.progress || 0
          // Prefer engine totals but derive a fallback from stats; never downgrade to 0 if stats missing
          const engTotal = typeof engine?.totalJobs === 'number' ? engine.totalJobs : null
          const sCompleted = typeof stats?.completedJobs === 'number' ? stats.completedJobs : undefined
          const sFailed = typeof stats?.failedJobs === 'number' ? stats.failedJobs : undefined
          const sRemaining = typeof stats?.remainingJobs === 'number' ? stats.remainingJobs : undefined
          const completedJobsNum = (sCompleted ?? row.completedJobs ?? 0)
          const failedJobsNum = (sFailed ?? row.failedJobs ?? 0)
          const remainingJobsNum = (sRemaining ?? row.remainingJobs ?? null)
          const derivedTotal = (typeof remainingJobsNum === 'number')
            ? (completedJobsNum + failedJobsNum + remainingJobsNum)
            : null
          const totalJobs = engTotal ?? row.totalJobs ?? derivedTotal ?? 0

          // Progress: use engine total if available; otherwise derive from stats
          if (totalJobs > 0) {
            progress = Math.max(0, Math.min(100, Math.round(((completedJobsNum + failedJobsNum) / totalJobs) * 100)))
          } else if (derivedTotal && derivedTotal > 0) {
            progress = Math.max(0, Math.min(100, Math.round(((completedJobsNum + failedJobsNum) / derivedTotal) * 100)))
          } else if (remainingJobsNum === 0) {
            // Edge: engine hasn't populated totals but stats say done
            progress = 100
          }

          let completedAt: number | null = row.completedAt || null
          const engineJobsCreatedEqTotal = (typeof engine?.jobsCreated === 'number' && typeof engTotal === 'number' && engine.jobsCreated === engTotal)
          const statsIndicateDone = (typeof remainingJobsNum === 'number' && remainingJobsNum === 0)
          const totalsIndicateDone = (typeof totalJobs === 'number' && totalJobs > 0 && (completedJobsNum + failedJobsNum) >= totalJobs)
          const engine404 = !!(engineErr && typeof engineErr?.message === 'string' && engineErr.message.includes(' 404 '))
          const stats404 = !!(statsErr && typeof statsErr?.message === 'string' && statsErr.message.includes(' 404 '))
          if (statsIndicateDone || totalsIndicateDone || (engineJobsCreatedEqTotal && statsIndicateDone) || (engine404 && stats404)) {
            status = 'COMPLETED'
            progress = 100
            completedAt = completedAt || now
          }
          // Prepare persisted stats (do not overwrite with zero; on completion, fill missing fields)
          let persistCompleted = (typeof sCompleted === 'number' ? sCompleted : row.completedJobs) ?? null
          let persistFailed = (typeof sFailed === 'number' ? sFailed : row.failedJobs) ?? null
          let persistRemaining = (typeof sRemaining === 'number' ? sRemaining : row.remainingJobs) ?? null
          if (status === 'COMPLETED') {
            // Fill in missing snapshot values based on totals
            const baseTotal = totalJobs || derivedTotal || (typeof row.totalJobs === 'number' ? row.totalJobs : null)
            if (persistFailed == null) persistFailed = 0
            if (persistRemaining == null) persistRemaining = 0
            if (typeof baseTotal === 'number') {
              const computedCompleted = Math.max(0, baseTotal - (persistFailed || 0) - (persistRemaining || 0))
              const currentCompleted = typeof persistCompleted === 'number' ? persistCompleted : 0
              // Keep the higher of measured or computed to avoid downgrade to 0
              persistCompleted = Math.max(currentCompleted, computedCompleted)
            } else if (persistCompleted == null) {
              persistCompleted = 0
            }
          }
          await batchRepo.update({ id: row.id }, {
            totalJobs: (engTotal ?? derivedTotal ?? row.totalJobs) ?? null,
            jobsCreated: (typeof engine?.jobsCreated === 'number' ? engine.jobsCreated : row.jobsCreated) ?? null,
            completedJobs: persistCompleted,
            failedJobs: persistFailed,
            remainingJobs: persistRemaining,
            invocationsPerBatchJob: engine?.invocationsPerBatchJob ?? row.invocationsPerBatchJob ?? null,
            seedJobDefinitionId: engine?.seedJobDefinitionId ?? row.seedJobDefinitionId ?? null,
            monitorJobDefinitionId: engine?.monitorJobDefinitionId ?? row.monitorJobDefinitionId ?? null,
            batchJobDefinitionId: engine?.batchJobDefinitionId ?? row.batchJobDefinitionId ?? null,
            status,
            progress,
            updatedAt: now,
            completedAt,
          })
        } catch (e) {
          // swallow; will retry next iteration
        }
      }
    } catch {
      // swallow poller errors; avoid crashing
    }
  }, intervalMs)
  return timer
}

export function stopBatchPoller() {
  if (timer) clearInterval(timer)
  timer = null
}

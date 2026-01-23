/**
 * Mission Control direct action service
 */

import { camundaDelete, camundaGet, camundaPost, camundaPut } from '@shared/services/bpmn-engine-client.js'

export async function deleteProcessInstancesDirect(engineId: string, params: {
  processInstanceIds: string[]
  skipCustomListeners?: boolean
  skipIoMappings?: boolean
  failIfNotExists?: boolean
  skipSubprocesses?: boolean
  deleteReason?: string
}) {
  const {
    processInstanceIds,
    skipCustomListeners,
    skipIoMappings,
    failIfNotExists,
    skipSubprocesses,
    deleteReason,
  } = params
  const qs = new URLSearchParams()
  if (typeof skipCustomListeners === 'boolean') qs.set('skipCustomListeners', String(skipCustomListeners))
  if (typeof skipIoMappings === 'boolean') qs.set('skipIoMappings', String(skipIoMappings))
  if (typeof failIfNotExists === 'boolean') qs.set('failIfNotExists', String(failIfNotExists))
  if (typeof skipSubprocesses === 'boolean') qs.set('skipSubprocesses', String(skipSubprocesses))
  qs.set('deleteReason', typeof deleteReason === 'string' && deleteReason.trim()
    ? deleteReason.trim()
    : 'Canceled via Mission Control')

  const results: Array<{ id: string; ok: boolean; error?: string }> = []
  for (const id of processInstanceIds) {
    try {
      await camundaDelete(engineId, `/process-instance/${encodeURIComponent(id)}${qs.toString() ? `?${qs.toString()}` : ''}`)
      results.push({ id, ok: true })
    } catch (e: any) {
      results.push({ id, ok: false, error: e?.message })
    }
  }
  return results
}

export async function suspendActivateProcessInstancesDirect(engineId: string, ids: string[], suspended: boolean) {
  const results: Array<{ id: string; ok: boolean; error?: string }> = []
  for (const id of ids) {
    try {
      await camundaPut(engineId, `/process-instance/${encodeURIComponent(id)}/suspended`, { suspended })
      results.push({ id, ok: true })
    } catch (e: any) {
      results.push({ id, ok: false, error: e?.message })
    }
  }
  return results
}

export async function setJobRetriesDirect(engineId: string, params: {
  processInstanceIds: string[]
  retries: number
  onlyFailed?: boolean
}) {
  const { processInstanceIds, retries, onlyFailed } = params
  const results: Array<{ id: string; ok: boolean; error?: string }> = []
  for (const pid of processInstanceIds) {
    try {
      const jobs: any[] = await camundaGet<any[]>(engineId, '/job', {
        processInstanceId: pid,
        withException: onlyFailed ? true : undefined,
      })
      for (const j of jobs) {
        await camundaPut(engineId, `/job/${encodeURIComponent(j.id)}/retries`, { retries })
      }
      results.push({ id: pid, ok: true })
    } catch (e: any) {
      results.push({ id: pid, ok: false, error: e?.message })
    }
  }
  return results
}

export async function executeMigrationDirect(engineId: string, params: {
  plan: any
  processInstanceIds?: string[]
  skipCustomListeners?: boolean
  skipIoMappings?: boolean
}) {
  const { plan, processInstanceIds, skipCustomListeners, skipIoMappings } = params
  const engineReq: any = { migrationPlan: plan }
  if (Array.isArray(processInstanceIds) && processInstanceIds.length > 0) {
    engineReq.processInstanceIds = processInstanceIds
  }
  if (typeof skipCustomListeners === 'boolean') engineReq.skipCustomListeners = skipCustomListeners
  if (typeof skipIoMappings === 'boolean') engineReq.skipIoMappings = skipIoMappings
  return camundaPost<any>(engineId, '/migration/execute', engineReq)
}

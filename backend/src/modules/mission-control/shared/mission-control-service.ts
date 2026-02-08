/**
 * Mission Control shared service
 */

import { camundaDelete, camundaGet, camundaPost, camundaPut, setJobDuedate, getExternalTasks, setExternalTaskRetries } from '@shared/services/bpmn-engine-client.js'

export async function listProcessDefinitions(engineId: string, params: { key?: string; nameLike?: string; latest?: string }) {
  const { key, nameLike, latest } = params
  const query: Record<string, any> = {}
  if (key) query.key = key
  if (nameLike) query.nameLike = nameLike
  if (latest) query.latestVersion = latest === 'true' || latest === '1'
  return camundaGet<any[]>(engineId, '/process-definition', query)
}

export async function getProcessDefinitionById(engineId: string, id: string) {
  return camundaGet<any>(engineId, `/process-definition/${encodeURIComponent(id)}`)
}

export async function getProcessDefinitionXmlById(engineId: string, id: string) {
  return camundaGet<any>(engineId, `/process-definition/${encodeURIComponent(id)}/xml`)
}

export async function resolveProcessDefinition(engineId: string, params: { key?: string; version?: string }) {
  const { key, version } = params
  if (!key || !version) {
    throw new Error('key and version are required')
  }
  const defs = await camundaGet<any[]>(engineId, '/process-definition', {
    key,
    version: Number(version),
  })
  if (!defs || defs.length === 0) {
    const err: any = new Error('Process definition not found')
    err.status = 404
    throw err
  }
  return defs[0]
}

export async function getActiveActivityCounts(engineId: string, definitionId: string) {
  const items = await camundaGet<any[]>(engineId, `/history/activity-instance`, { processDefinitionId: definitionId, unfinished: true })
  const counts: Record<string, number> = {}
  for (const a of items) {
    const id = a.activityId
    if (!id) continue
    counts[id] = (counts[id] || 0) + 1
  }
  return counts
}

export async function getActivityCountsByState(engineId: string, definitionId: string) {
  const [stats, suspendedInstances, canceledItems, completedItems] = await Promise.all([
    camundaGet<any[]>(engineId, `/process-definition/${encodeURIComponent(definitionId)}/statistics`, { incidents: true }),
    camundaGet<any[]>(engineId, `/process-instance`, { processDefinitionId: definitionId, suspended: true }),
    camundaGet<any[]>(engineId, `/history/activity-instance`, { processDefinitionId: definitionId, canceled: true }),
    camundaGet<any[]>(engineId, `/history/activity-instance`, { processDefinitionId: definitionId, finished: true, canceled: false }),
  ])

  const result: Record<string, Record<string, number>> = {
    active: {},
    incidents: {},
    suspended: {},
    canceled: {},
    completed: {},
  }

  const suspendedIds = (suspendedInstances || []).map((p: any) => p?.id).filter(Boolean) as string[]
  const suspendedCounts: Record<string, number> = {}

  const collectActivityIds = (node: any, out: string[]) => {
    if (!node) return
    const actId = node.activityId
    if (actId) out.push(actId)
    const children = Array.isArray(node.childActivityInstances) ? node.childActivityInstances : []
    for (const c of children) collectActivityIds(c, out)
  }

  for (const pid of suspendedIds) {
    try {
      const tree = await camundaGet<any>(engineId, `/process-instance/${encodeURIComponent(pid)}/activity-instances`)
      const ids: string[] = []
      collectActivityIds(tree, ids)
      for (const id of ids) {
        suspendedCounts[id] = (suspendedCounts[id] || 0) + 1
      }
    } catch {
      // ignore a single instance failure
    }
  }

  for (const s of stats || []) {
    const actId = s?.id
    if (!actId) continue

    const instances = typeof s?.instances === 'number' ? s.instances : 0

    let incidentAtAct = 0
    const rawIncidents = (s as any)?.incidents
    if (typeof rawIncidents === 'number') {
      incidentAtAct = rawIncidents
    } else if (Array.isArray(rawIncidents)) {
      for (const it of rawIncidents) {
        const c = typeof it?.incidentCount === 'number' ? it.incidentCount : 0
        incidentAtAct += c
      }
    }
    if (incidentAtAct > 0) result.incidents[actId] = incidentAtAct

    const suspendedAtAct = suspendedCounts[actId] || 0
    if (suspendedAtAct > 0) result.suspended[actId] = suspendedAtAct

    const activeAtAct = Math.max(0, instances - suspendedAtAct - incidentAtAct)
    if (activeAtAct > 0) result.active[actId] = activeAtAct
  }

  for (const a of canceledItems || []) {
    const actId = a.activityId
    if (!actId) continue
    result.canceled[actId] = (result.canceled[actId] || 0) + 1
  }

  for (const a of completedItems || []) {
    const actId = a.activityId
    const actType = a.activityType
    if (!actId) continue
    if (actType && actType.toLowerCase().includes('endevent')) {
      result.completed[actId] = (result.completed[actId] || 0) + 1
    }
  }

  return result
}

export async function previewProcessInstanceCount(engineId: string, body: any) {
  const data = await camundaPost<any>(engineId, '/process-instance/count', body)
  return { count: typeof data?.count === 'number' ? data.count : 0 }
}

export async function listProcessInstancesDetailed(engineId: string, query: any) {
  const {
    processDefinitionKey,
    processDefinitionId,
    superProcessInstanceId,
    active,
    suspended,
    withIncidents,
    completed,
    canceled,
    activityId,
    startedAfter,
    startedBefore,
  } = query as {
    processDefinitionKey?: string
    processDefinitionId?: string
    superProcessInstanceId?: string
    active?: string
    suspended?: string
    withIncidents?: string
    completed?: string
    canceled?: string
    activityId?: string
    startedAfter?: string
    startedBefore?: string
  }

  const wantActive = active === 'true' || active === '1'
  const wantSuspended = suspended === 'true' || suspended === '1'
  const wantIncidents = withIncidents === 'true' || withIncidents === '1'
  const wantCompleted = completed === 'true' || completed === '1'
  const wantCanceled = canceled === 'true' || canceled === '1'

  let out: Array<{
    id: string
    processDefinitionKey: string | undefined
    version: number | undefined
    superProcessInstanceId: string | null
    rootProcessInstanceId: string | null
    startTime: string | null
    endTime: string | null
    state: 'ACTIVE' | 'SUSPENDED' | 'COMPLETED' | 'CANCELED' | 'INCIDENT'
    hasIncident?: boolean
  }> = []
  const seen = new Set<string>()

  async function pushRuntime(params: Record<string, any>) {
    const runtime = await camundaGet<any[]>(engineId, '/process-instance', params)
    for (const r of runtime) {
      if (seen.has(r.id)) continue
      seen.add(r.id)
      const defId: string | undefined = r.definitionId
      const defKey = typeof defId === 'string' ? defId.split(':')[0] : (processDefinitionKey || undefined)
      const defVer = typeof defId === 'string' ? Number(defId.split(':')[1]) : undefined
      out.push({
        id: r.id,
        processDefinitionKey: defKey,
        version: defVer,
        superProcessInstanceId: r.superProcessInstanceId || null,
        rootProcessInstanceId: r.rootProcessInstanceId || null,
        startTime: null,
        endTime: null,
        state: r.suspended ? 'SUSPENDED' : 'ACTIVE',
      })
    }
  }

  if (wantActive) {
    const p: Record<string, any> = { active: true, suspended: false }
    if (processDefinitionKey) p.processDefinitionKey = processDefinitionKey
    if (processDefinitionId) p.processDefinitionId = processDefinitionId
    if (superProcessInstanceId) p.superProcessInstanceId = superProcessInstanceId
    if (activityId) p.activityIdIn = activityId
    await pushRuntime(p)
  }
  if (wantSuspended) {
    const p: Record<string, any> = { suspended: true }
    if (processDefinitionKey) p.processDefinitionKey = processDefinitionKey
    if (processDefinitionId) p.processDefinitionId = processDefinitionId
    if (superProcessInstanceId) p.superProcessInstanceId = superProcessInstanceId
    if (activityId) p.activityIdIn = activityId
    await pushRuntime(p)
  }
  if (wantIncidents) {
    const p: Record<string, any> = { withIncident: true, suspended: false }
    if (processDefinitionKey) p.processDefinitionKey = processDefinitionKey
    if (processDefinitionId) p.processDefinitionId = processDefinitionId
    if (superProcessInstanceId) p.superProcessInstanceId = superProcessInstanceId
    if (activityId) p.activityIdIn = activityId
    await pushRuntime(p)
  }

  const runtimeIds = out.filter(o => o.state === 'ACTIVE' || o.state === 'SUSPENDED').map(o => o.id)
  if (runtimeIds.length > 0) {
    try {
      const incidents = await camundaGet<any[]>(engineId, '/incident', { processInstanceIdIn: runtimeIds.join(',') })
      const set = new Set<string>((incidents || []).map((i: any) => i.processInstanceId))
      for (const o of out) {
        if (set.has(o.id)) o.hasIncident = true
      }
    } catch {}
    try {
      const hist = await camundaGet<any[]>(engineId, '/history/process-instance', { processInstanceIdIn: runtimeIds.join(',') })
      const starts = new Map<string, string>()
      const parents = new Map<string, string>()
      for (const h of hist) {
        if (h.id && h.startTime) starts.set(h.id, h.startTime)
        if (h.id && h.superProcessInstanceId) parents.set(h.id, h.superProcessInstanceId)
      }
      for (const o of out) {
        if (o.startTime == null && starts.has(o.id)) o.startTime = starts.get(o.id) || null
        if (o.superProcessInstanceId == null && parents.has(o.id)) o.superProcessInstanceId = parents.get(o.id) || null
      }
    } catch {}
  }

  if (!wantIncidents) {
    out = out.filter((o) => {
      const state = o.state
      const hasIncident = !!o.hasIncident
      if (state === 'ACTIVE' || state === 'SUSPENDED') {
        return !hasIncident
      }
      return true
    })
  }

  if (wantCompleted || wantCanceled) {
    const histParams: Record<string, any> = { finished: true }
    if (processDefinitionKey) histParams.processDefinitionKey = processDefinitionKey
    if (processDefinitionId) histParams.processDefinitionId = processDefinitionId
    if (superProcessInstanceId) histParams.superProcessInstanceId = superProcessInstanceId

    let endEventEndTimesByProcId: Map<string, number> | null = null
    let canceledAtNodeProcIds: Set<string> | null = null

    if (activityId && (wantCompleted || wantCanceled)) {
      if (wantCompleted) {
        try {
          const activityParams: Record<string, any> = { activityId, finished: true }
          if (processDefinitionKey) activityParams.processDefinitionKey = processDefinitionKey
          if (processDefinitionId) activityParams.processDefinitionId = processDefinitionId
          const histActs = await camundaGet<any[]>(engineId, '/history/activity-instance', activityParams)

          const isEndEvent = (histActs || []).some((a: any) => {
            const t = String(a?.activityType || '').toLowerCase()
            return t.includes('endevent')
          })

          if (isEndEvent) {
            endEventEndTimesByProcId = new Map<string, number>()
            for (const a of histActs || []) {
              const pid = a?.processInstanceId
              const endTime = a?.endTime
              if (!pid || !endTime) continue
              const ts = new Date(endTime).getTime()
              const prev = endEventEndTimesByProcId.get(pid)
              if (prev == null || ts > prev) endEventEndTimesByProcId.set(pid, ts)
            }
          }
        } catch {
          // ignore
        }
      }

      if (wantCanceled) {
        try {
          const activityParams: Record<string, any> = { activityId, canceled: true }
          if (processDefinitionKey) activityParams.processDefinitionKey = processDefinitionKey
          if (processDefinitionId) activityParams.processDefinitionId = processDefinitionId
          const canceledActs = await camundaGet<any[]>(engineId, '/history/activity-instance', activityParams)
          canceledAtNodeProcIds = new Set<string>((canceledActs || []).map((a: any) => a?.processInstanceId).filter(Boolean))
        } catch {
          // ignore
        }
      }
    }

    const hist = await camundaGet<any[]>(engineId, '/history/process-instance', histParams)
    for (const h of hist) {
      const isCanceled = !!h.deleteReason || h.state === 'EXTERNALLY_TERMINATED' || h.state === 'INTERNALLY_TERMINATED'

      if (activityId) {
        if (isCanceled) {
          if (!wantCanceled) continue
          if (canceledAtNodeProcIds && !canceledAtNodeProcIds.has(h.id)) continue
          if (!canceledAtNodeProcIds) continue
        } else {
          if (!wantCompleted) continue
          if (!endEventEndTimesByProcId) continue
          const actEnd = endEventEndTimesByProcId.get(h.id)
          if (!actEnd || !h.endTime) continue
          const procEnd = new Date(h.endTime).getTime()
          if (Math.abs(actEnd - procEnd) > 1000) continue
        }
      }

      if ((wantCanceled && isCanceled) || (wantCompleted && !isCanceled)) {
        if (seen.has(h.id)) continue
        seen.add(h.id)
        const defId = h.processDefinitionId as string | undefined
        const defVer = defId ? Number(defId.split(':')[1]) : undefined
        out.push({
          id: h.id,
          processDefinitionKey: h.processDefinitionKey,
          version: defVer,
          superProcessInstanceId: h.superProcessInstanceId || null,
          rootProcessInstanceId: h.rootProcessInstanceId || null,
          startTime: h.startTime || null,
          endTime: h.endTime || null,
          state: isCanceled ? 'CANCELED' : 'COMPLETED',
        })
      }
    }
  }

  if (!wantActive && !wantSuspended && !wantIncidents && !wantCompleted && !wantCanceled) {
    return []
  }

  out.sort((a: any, b: any) => {
    const tA = a.startTime ? new Date(a.startTime).getTime() : 0
    const tB = b.startTime ? new Date(b.startTime).getTime() : 0
    return tB - tA
  })

  const afterTs = startedAfter ? new Date(startedAfter).getTime() : NaN
  const beforeTs = startedBefore ? new Date(startedBefore).getTime() : NaN
  if (!isNaN(afterTs) || !isNaN(beforeTs)) {
    out = out.filter((o: any) => {
      const t = o.startTime ? new Date(o.startTime).getTime() : NaN
      if (isNaN(t)) return false
      if (!isNaN(afterTs) && t < afterTs) return false
      if (!isNaN(beforeTs) && t > beforeTs) return false
      return true
    })
  }

  return out
}

export async function getProcessInstanceById(engineId: string, id: string) {
  return camundaGet<any>(engineId, `/process-instance/${encodeURIComponent(id)}`)
}

export async function getProcessInstanceVariables(engineId: string, id: string) {
  const histVars = await camundaGet<any[]>(engineId, '/history/variable-instance', { processInstanceId: id })
  const out: Record<string, { value: any; type: string }> = {}
  for (const v of histVars || []) {
    if (!v || !v.name) continue
    out[v.name] = {
      value: v.value,
      type: v.type || (v.value !== null && v.value !== undefined ? typeof v.value : 'Unknown'),
    }
  }
  return out
}

export async function listProcessInstanceActivityHistory(engineId: string, id: string) {
  const pageSize = 200
  let firstResult = 0
  const all: any[] = []
  while (true) {
    const page = await camundaGet<any[]>(engineId, '/history/activity-instance', {
      processInstanceId: id,
      sortBy: 'startTime',
      sortOrder: 'asc',
      firstResult,
      maxResults: pageSize,
    })
    if (!Array.isArray(page) || page.length === 0) break
    all.push(...page)
    if (page.length < pageSize) break
    firstResult += page.length
  }
  return all
}

export async function listProcessInstanceJobs(engineId: string, id: string) {
  return camundaGet<any[]>(engineId, '/job', { processInstanceId: id, withException: true })
}

export async function getHistoricProcessInstanceById(engineId: string, id: string) {
  return camundaGet<any>(engineId, `/history/process-instance/${encodeURIComponent(id)}`)
}

export async function listHistoricProcessInstances(engineId: string, params: any) {
  return camundaGet<any[]>(engineId, '/history/process-instance', params)
}

export async function listHistoricVariableInstances(engineId: string, params: any) {
  return camundaGet<any[]>(engineId, '/history/variable-instance', params)
}

export async function listProcessInstanceIncidents(engineId: string, id: string) {
  return camundaGet<any[]>(engineId, '/incident', { processInstanceId: id })
}

export async function suspendProcessInstanceById(engineId: string, id: string) {
  return camundaPut(engineId, `/process-instance/${encodeURIComponent(id)}/suspended`, { suspended: true })
}

export async function activateProcessInstanceById(engineId: string, id: string) {
  return camundaPut(engineId, `/process-instance/${encodeURIComponent(id)}/suspended`, { suspended: false })
}

export async function deleteProcessInstanceById(engineId: string, id: string) {
  return camundaDelete(engineId, `/process-instance/${encodeURIComponent(id)}`)
}

export async function listFailedExternalTasks(engineId: string, processInstanceId: string) {
  const allExtTasks = await getExternalTasks<any[]>(engineId, { processInstanceId })
  return (allExtTasks || []).filter((et: any) => {
    const hasNoRetries = et.retries === 0 || et.retries === null
    const hasError = et.errorMessage || et.errorDetails
    return hasNoRetries && hasError
  })
}

export async function retryProcessInstanceFailures(engineId: string, processInstanceId: string, body: { jobIds?: string[]; externalTaskIds?: string[]; dueDate?: string; retries?: number }) {
  const { jobIds, externalTaskIds, dueDate, retries } = body || {}

  const newRetries = typeof retries === 'number' && retries >= 0 ? retries : 1

  if (Array.isArray(jobIds) && jobIds.length > 0) {
    for (const jid of jobIds) {
      await camundaPut(engineId, `/job/${encodeURIComponent(jid)}/retries`, { retries: newRetries })
      if (dueDate) {
        await setJobDuedate(engineId, jid, { duedate: dueDate, cascade: false })
      }
    }
  }

  if (Array.isArray(externalTaskIds) && externalTaskIds.length > 0) {
    for (const etid of externalTaskIds) {
      await setExternalTaskRetries(engineId, etid, { retries: newRetries })
    }
  }

  if ((!jobIds || jobIds.length === 0) && (!externalTaskIds || externalTaskIds.length === 0)) {
    const incidents = await camundaGet<any[]>(engineId, '/incident', { processInstanceId })

    const hasJobIncidents = incidents.some((inc: any) => inc.incidentType === 'failedJob')
    const hasExtTaskIncidents = incidents.some((inc: any) => inc.incidentType === 'failedExternalTask')

    if (hasJobIncidents) {
      const jobs = await camundaGet<any[]>(engineId, '/job', { processInstanceId, withException: true })
      for (const job of jobs || []) {
        await camundaPut(engineId, `/job/${encodeURIComponent(job.id)}/retries`, { retries: newRetries })
        if (dueDate) {
          await setJobDuedate(engineId, job.id, { duedate: dueDate, cascade: false })
        }
      }
    }

    if (hasExtTaskIncidents) {
      const extTasks = await getExternalTasks<any[]>(engineId, { processInstanceId })
      const failedExtTasks = (extTasks || []).filter((et: any) => {
        return (et.retries === 0 || et.retries === null) && (et.errorMessage || et.errorDetails)
      })
      for (const et of failedExtTasks) {
        await setExternalTaskRetries(engineId, et.id, { retries: newRetries })
      }
    }
  }
}

import React from 'react'

type GroupedActivity = {
  activityId: string
  activityName: string
  activityType: string
  instances: any[]
  active: boolean
  hasIncident: boolean
  isClickable: boolean
  isSelected: boolean
  totalExecCount: number
  statusLabel: string
  statusType: string
  _sort: {
    endKey: number
    startKey: number
    typeRank: number
    activeSort: number
    stableIndex: number
  }
  _summary: {
    startTs: number | null
    endTs: number | null
    durationMs: number | null
  }
}

export function buildHistoryContext(g: any) {
  if (!g) return null
  return {
    activityId: g.activityId,
    activityName: g.activityName,
    startTime: g._summary?.startTs ? new Date(g._summary.startTs).toISOString() : null,
    endTime: g._summary?.endTs && g._summary?.endTs !== Number.POSITIVE_INFINITY
      ? new Date(g._summary.endTs).toISOString()
      : null,
    durationMs: g._summary?.durationMs ?? null,
    executions: g.totalExecCount || 1,
    statusLabel: g.statusLabel,
  }
}

function parseTs(ts?: string | null) {
  if (!ts) return null
  const v = new Date(ts).getTime()
  return Number.isFinite(v) ? v : null
}

function getTypeRank(activityId: string, activityType?: string, bpmnRef?: React.MutableRefObject<any>) {
  const reg = bpmnRef?.current?.get?.('elementRegistry')
  const el = reg?.get?.(activityId)
  const raw = (el?.businessObject?.$type || el?.type || '') as string
  const t = raw.replace(/^bpmn:/, '')

  if (t === 'StartEvent') return 0
  if (t === 'EndEvent') return 100
  if (t.includes('Gateway')) return 60
  if (t.endsWith('Event') || t.includes('BoundaryEvent')) return 70
  if (t.includes('Task')) return 40
  if (t === 'CallActivity' || t === 'SubProcess' || t === 'Transaction') return 45

  const at = (activityType || '').toLowerCase()
  if (at.includes('startevent')) return 0
  if (at.includes('endevent')) return 100
  if (at.includes('gateway')) return 60
  if (at.includes('event')) return 70
  if (at.includes('task')) return 40

  return 50
}

export function buildActivityGroups({
  sortedActs,
  incidentActivityIds,
  clickableActivityIds,
  selectedActivityId,
  execCounts,
  bpmnRef,
}: {
  sortedActs: any[]
  incidentActivityIds: Set<string>
  clickableActivityIds: Set<string>
  selectedActivityId: string | null
  execCounts: Map<string, number>
  bpmnRef?: React.MutableRefObject<any>
}): GroupedActivity[] {
  const map = new Map<string, any[]>()
  const firstSeenIndex = new Map<string, number>()

  for (const a of sortedActs || []) {
    const id = a?.activityId
    if (!id) continue
    if (!map.has(id)) {
      map.set(id, [])
      firstSeenIndex.set(id, firstSeenIndex.size)
    }
    map.get(id)!.push(a)
  }

  const groups = Array.from(map.entries()).map(([activityId, instances]) => {
    const first = instances[0] || {}
    const active = instances.some((i: any) => !i?.endTime)
    const hasIncident = incidentActivityIds.has(activityId)
    const isClickable = clickableActivityIds.has(activityId)
    const isSelected = selectedActivityId === activityId
    const totalExecCount = execCounts.get(activityId) || instances.length || 1

    const statusLabel = hasIncident ? 'INCIDENT' : active ? 'ACTIVE' : 'COMPLETED'
    const statusType = hasIncident ? 'red' : active ? 'green' : 'cool-gray'

    const activeSort = active ? Number.POSITIVE_INFINITY : 0
    const endKey = active
      ? Number.POSITIVE_INFINITY
      : Math.max(
          ...instances.map((i: any) => {
            const end = parseTs(i?.endTime)
            const start = parseTs(i?.startTime)
            return end ?? start ?? 0
          })
        )
    const startKey = Math.min(
      ...instances.map((i: any) => {
        const start = parseTs(i?.startTime)
        const end = parseTs(i?.endTime)
        return start ?? end ?? Number.POSITIVE_INFINITY
      })
    )
    const typeRank = getTypeRank(activityId, first?.activityType, bpmnRef)
    const stableIndex = firstSeenIndex.get(activityId) ?? 0

    return {
      activityId,
      activityName: first?.activityName || activityId,
      activityType: first?.activityType || '',
      instances,
      active,
      hasIncident,
      isClickable,
      isSelected,
      totalExecCount,
      statusLabel,
      statusType,
      _sort: { endKey, startKey, typeRank, activeSort, stableIndex },
      _summary: {
        startTs: Number.isFinite(startKey) ? startKey : null,
        endTs: Number.isFinite(endKey) ? endKey : null,
        durationMs:
          Number.isFinite(startKey) && Number.isFinite(endKey) && endKey !== Number.POSITIVE_INFINITY
            ? Math.max(0, endKey - startKey)
            : null,
      },
    }
  })

  groups.sort((a, b) => {
    if (a._sort.endKey !== b._sort.endKey) return a._sort.endKey - b._sort.endKey
    if (a._sort.startKey !== b._sort.startKey) return a._sort.startKey - b._sort.startKey
    if (a._sort.typeRank !== b._sort.typeRank) return a._sort.typeRank - b._sort.typeRank
    if (a._sort.stableIndex !== b._sort.stableIndex) return a._sort.stableIndex - b._sort.stableIndex
    return (a.activityName || a.activityId).localeCompare(b.activityName || b.activityId)
  })

  return groups
}

import React from 'react'

type HistorySummary = {
  startTs: number | null
  endTs: number | null
  durationMs: number | null
}

export type ExecutionTrailGroup = {
  kind: 'group'
  groupKey: string
  activityId: string
  activityName: string
  activityType: string
  instances: ExecutionTrailInstance[]
  active: boolean
  hasIncident: boolean
  isClickable: boolean
  isSelected: boolean
  totalExecCount: number
  statusLabel: string
  statusType: string
  depth: number
  hasNestedChildren: boolean
  isExpandable: boolean
  _sort: {
    startKey: number
    endKey: number
    typeRank: number
    stableIndex: number
  }
  _summary: HistorySummary
}

export type ExecutionTrailInstance = {
  kind: 'execution'
  key: string
  id: string
  activityInstanceId: string
  parentActivityInstanceId: string | null
  activityId: string
  activityName: string
  activityType: string
  executionId: string | null
  calledProcessInstanceId: string | null
  taskId: string | null
  startTime: string | null
  endTime: string | null
  durationMs: number | null
  active: boolean
  hasIncident: boolean
  isClickable: boolean
  isSelected: boolean
  statusLabel: string
  statusType: string
  depth: number
  children: ExecutionTrailGroup[]
  _sort: {
    startKey: number
    endKey: number
    stableIndex: number
  }
  _summary: HistorySummary
}

type RawExecution = {
  id: string
  activityInstanceId: string
  parentActivityInstanceId: string | null
  activityId: string
  activityName: string
  activityType: string
  executionId: string | null
  calledProcessInstanceId: string | null
  taskId: string | null
  startTime: string | null
  endTime: string | null
  durationMs: number | null
  active: boolean
  hasIncident: boolean
  stableIndex: number
}

export function buildHistoryContext(g: any) {
  if (!g) return null
  if (g.kind === 'execution') {
    return {
      kind: 'execution' as const,
      activityId: g.activityId,
      activityName: g.activityName,
      startTime: g.startTime || null,
      endTime: g.endTime || null,
      durationMs: g.durationMs ?? null,
      executions: 1,
      statusLabel: g.statusLabel,
      activityInstanceId: g.activityInstanceId || null,
      executionId: g.executionId || null,
    }
  }
  return {
    kind: 'group' as const,
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

function getDurationMs(durationInMillis?: unknown, startTime?: string | null, endTime?: string | null) {
  if (typeof durationInMillis === 'number') {
    if (Number.isFinite(durationInMillis) && durationInMillis >= 0) return durationInMillis
  } else if (typeof durationInMillis === 'string' && durationInMillis.trim() !== '') {
    const numeric = Number(durationInMillis)
    if (Number.isFinite(numeric) && numeric >= 0) return numeric
  }

  const startTs = parseTs(startTime)
  const endTs = endTime ? parseTs(endTime) : Date.now()
  if (startTs === null || endTs === null) return null
  return Math.max(0, endTs - startTs)
}

function sortableTs(value: number | null, fallback: number) {
  return value === null ? fallback : value
}

export function formatDurationMs(durationMs?: number | null, startTime?: string | null, endTime?: string | null) {
  const resolved = getDurationMs(durationMs, startTime, endTime)
  if (resolved === null || !Number.isFinite(resolved) || resolved < 0) return ''
  if (resolved < 1000) return `${Math.floor(resolved)} ms`

  const totalSeconds = Math.floor(resolved / 1000)
  if (totalSeconds < 60) return `${totalSeconds} sec`

  const totalMinutes = Math.floor(totalSeconds / 60)
  if (totalMinutes < 60) {
    const seconds = totalSeconds % 60
    return seconds > 0 ? `${totalMinutes} min ${seconds} sec` : `${totalMinutes} min`
  }

  const totalHours = Math.floor(totalMinutes / 60)
  if (totalHours < 24) {
    const minutes = totalMinutes % 60
    return minutes > 0 ? `${totalHours} hr ${String(minutes).padStart(2, '0')} min` : `${totalHours} hr`
  }

  const days = Math.floor(totalHours / 24)
  const hours = totalHours % 24
  if (hours > 0) return `${days} day${days === 1 ? '' : 's'} ${hours} hr`
  return days === 1 ? '1 day' : `${days} days`
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

function sortExecutions(a: RawExecution, b: RawExecution) {
  const aStart = sortableTs(parseTs(a.startTime), Number.POSITIVE_INFINITY)
  const bStart = sortableTs(parseTs(b.startTime), Number.POSITIVE_INFINITY)
  if (aStart !== bStart) return aStart - bStart

  const aEnd = sortableTs(parseTs(a.endTime), Number.POSITIVE_INFINITY)
  const bEnd = sortableTs(parseTs(b.endTime), Number.POSITIVE_INFINITY)
  if (aEnd !== bEnd) return aEnd - bEnd

  if (a.stableIndex !== b.stableIndex) return a.stableIndex - b.stableIndex
  return (a.activityName || a.activityId).localeCompare(b.activityName || b.activityId)
}

export function buildActivityGroups({
  sortedActs,
  incidentActivityIds,
  clickableActivityIds,
  selectedActivityId,
  bpmnRef,
}: {
  sortedActs: any[]
  incidentActivityIds: Set<string>
  clickableActivityIds: Set<string>
  selectedActivityId: string | null
  bpmnRef?: React.MutableRefObject<any>
}): ExecutionTrailGroup[] {
  const rawExecutions: RawExecution[] = []
  const knownInstanceIds = new Set<string>()

  for (const [index, activity] of (sortedActs || []).entries()) {
    const activityId = activity?.activityId
    const activityInstanceId = String(activity?.activityInstanceId || activity?.id || `${activityId || 'activity'}-${index}`)
    const entry: RawExecution = {
      id: String(activity?.id || activityInstanceId),
      activityInstanceId,
      parentActivityInstanceId: activity?.parentActivityInstanceId ? String(activity.parentActivityInstanceId) : null,
      activityId: String(activityId || ''),
      activityName: String(activity?.activityName || activityId || activity?.activityType || 'Unnamed activity'),
      activityType: String(activity?.activityType || ''),
      executionId: activity?.executionId ? String(activity.executionId) : null,
      calledProcessInstanceId: activity?.calledProcessInstanceId ? String(activity.calledProcessInstanceId) : null,
      taskId: activity?.taskId ? String(activity.taskId) : null,
      startTime: activity?.startTime || null,
      endTime: activity?.endTime || null,
      durationMs: getDurationMs(activity?.durationInMillis, activity?.startTime, activity?.endTime),
      active: !activity?.endTime && !(activity as any)?.canceled,
      hasIncident: !!activityId && incidentActivityIds.has(String(activityId)),
      stableIndex: index,
    }
    rawExecutions.push(entry)
    knownInstanceIds.add(activityInstanceId)
  }

  const childrenByParent = new Map<string, RawExecution[]>()
  const rootKey = '__execution_trail_root__'

  for (const execution of rawExecutions) {
    if (!execution.activityId) continue
    const resolvedParent = execution.parentActivityInstanceId && knownInstanceIds.has(execution.parentActivityInstanceId)
      ? execution.parentActivityInstanceId
      : rootKey
    const siblings = childrenByParent.get(resolvedParent) || []
    siblings.push(execution)
    childrenByParent.set(resolvedParent, siblings)
  }

  const buildGroupsForParent = (parentKey: string, depth: number): ExecutionTrailGroup[] => {
    const children = [...(childrenByParent.get(parentKey) || [])].sort(sortExecutions)
    const grouped = new Map<string, RawExecution[]>()

    for (const child of children) {
      const groupKey = `${parentKey}::${child.activityId}`
      const list = grouped.get(groupKey) || []
      list.push(child)
      grouped.set(groupKey, list)
    }

    const groups: ExecutionTrailGroup[] = Array.from(grouped.entries()).map(([groupKey, executions]) => {
      const sortedExecutions = [...executions].sort(sortExecutions)
      const first = sortedExecutions[0]

      const instances: ExecutionTrailInstance[] = sortedExecutions.map((execution) => {
        const childGroups = buildGroupsForParent(execution.activityInstanceId, depth + 1)
        const statusLabel = execution.hasIncident ? 'INCIDENT' : execution.active ? 'ACTIVE' : 'COMPLETED'
        const statusType = execution.hasIncident ? 'red' : execution.active ? 'green' : 'cool-gray'
        const startTs = parseTs(execution.startTime)
        const endTs = parseTs(execution.endTime)

        return {
          kind: 'execution' as const,
          key: execution.activityInstanceId,
          id: execution.id,
          activityInstanceId: execution.activityInstanceId,
          parentActivityInstanceId: execution.parentActivityInstanceId,
          activityId: execution.activityId,
          activityName: execution.activityName,
          activityType: execution.activityType,
          executionId: execution.executionId,
          calledProcessInstanceId: execution.calledProcessInstanceId,
          taskId: execution.taskId,
          startTime: execution.startTime,
          endTime: execution.endTime,
          durationMs: execution.durationMs,
          active: execution.active,
          hasIncident: execution.hasIncident,
          isClickable: clickableActivityIds.has(execution.activityId),
          isSelected: selectedActivityId === execution.activityId,
          statusLabel,
          statusType,
          depth: depth + 1,
          children: childGroups,
          _sort: {
            startKey: sortableTs(startTs, Number.POSITIVE_INFINITY),
            endKey: sortableTs(endTs, execution.active ? Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY),
            stableIndex: execution.stableIndex,
          },
          _summary: {
            startTs,
            endTs,
            durationMs: execution.durationMs,
          },
        }
      })

      const active = instances.some((instance) => instance.active)
      const hasIncident = instances.some((instance) => instance.hasIncident)
      const hasNestedChildren = instances.some((instance) => instance.children.length > 0)
      const startKey = Math.min(...instances.map((instance) => sortableTs(instance._summary.startTs, Number.POSITIVE_INFINITY)))
      const completedEndTimes = instances
        .map((instance) => instance._summary.endTs)
        .filter((value): value is number => value !== null)
      const endKey = completedEndTimes.length > 0 ? Math.max(...completedEndTimes) : null

      return {
        kind: 'group' as const,
        groupKey,
        activityId: first.activityId,
        activityName: first.activityName,
        activityType: first.activityType,
        instances,
        active,
        hasIncident,
        isClickable: clickableActivityIds.has(first.activityId),
        isSelected: selectedActivityId === first.activityId,
        totalExecCount: instances.length,
        statusLabel: hasIncident ? 'INCIDENT' : active ? 'ACTIVE' : 'COMPLETED',
        statusType: hasIncident ? 'red' : active ? 'green' : 'cool-gray',
        depth,
        hasNestedChildren,
        isExpandable: instances.length > 1 || hasNestedChildren,
        _sort: {
          startKey,
          endKey: active ? Number.POSITIVE_INFINITY : sortableTs(endKey, Number.POSITIVE_INFINITY),
          typeRank: getTypeRank(first.activityId, first.activityType, bpmnRef),
          stableIndex: first.stableIndex,
        },
        _summary: {
          startTs: Number.isFinite(startKey) ? startKey : null,
          endTs: active ? null : endKey,
          durationMs: instances.length === 1 ? instances[0].durationMs : null,
        },
      }
    })

    groups.sort((a, b) => {
      if (a._sort.startKey !== b._sort.startKey) return a._sort.startKey - b._sort.startKey
      if (a._sort.endKey !== b._sort.endKey) return a._sort.endKey - b._sort.endKey
      if (a._sort.typeRank !== b._sort.typeRank) return a._sort.typeRank - b._sort.typeRank
      if (a._sort.stableIndex !== b._sort.stableIndex) return a._sort.stableIndex - b._sort.stableIndex
      return (a.activityName || a.activityId).localeCompare(b.activityName || b.activityId)
    })

    return groups
  }

  return buildGroupsForParent(rootKey, 0)
}

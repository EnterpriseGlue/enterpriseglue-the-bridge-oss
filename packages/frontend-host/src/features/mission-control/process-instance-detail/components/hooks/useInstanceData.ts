import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import type { ActivityInstance, ProcessDefinition } from '../types'
import type { RuntimeActivityInstanceTree, Variables } from '@enterpriseglue/shared/schemas/mission-control/process.js'
import type { HistoricVariableInstance } from '@enterpriseglue/shared/schemas/mission-control/history.js'
import { useSelectedEngine } from '../../../../../components/EngineSelector'
import {
  getProcessInstance,
  getProcessInstanceVariables,
  getProcessInstanceActivityHistory,
  getProcessInstanceActivityTree,
  getProcessInstanceIncidents,
  getProcessInstanceJobs,
  getProcessInstanceExternalTasks,
  fetchProcessDefinitionXml,
  getHistoricalProcessInstance,
  getHistoricalVariableInstances,
  listProcessDefinitions,
} from '../../api/processInstances'

interface UseInstanceDataOptions {
  historyProcessInstanceEnabled?: boolean
  variablesEnabled?: boolean
  historicVariablesEnabled?: boolean
  activityTreeEnabled?: boolean
  activityHistoryEnabled?: boolean
  incidentsEnabled?: boolean
  jobsEnabled?: boolean
  externalTasksEnabled?: boolean
}

export function flattenRuntimeActivityTree(tree: RuntimeActivityInstanceTree | null | undefined): ActivityInstance[] {
  const flattened: ActivityInstance[] = []
  const visit = (node: RuntimeActivityInstanceTree | null | undefined, parentId?: string | null) => {
    if (!node) return
    const nodeId = node.id ? String(node.id) : ''
    const activityId = node.activityId ? String(node.activityId) : ''
    const activityInstanceId = nodeId || activityId
    if (activityId && activityInstanceId) {
      flattened.push({
        id: activityInstanceId,
        activityId,
        activityName: node.activityName ? String(node.activityName) : undefined,
        activityType: node.activityType ? String(node.activityType) : undefined,
        activityInstanceId,
        parentActivityInstanceId: node.parentActivityInstanceId ? String(node.parentActivityInstanceId) : parentId || null,
        executionId: Array.isArray(node.executionIds) && node.executionIds[0] ? String(node.executionIds[0]) : null,
      })
    }

    for (const child of node.childActivityInstances || []) {
      visit(child, nodeId || parentId || null)
    }
    for (const transition of node.childTransitionInstances || []) {
      visit(transition, nodeId || parentId || null)
    }
  }

  visit(tree)
  return flattened
}

export function historicProcessVariables(
  entries: HistoricVariableInstance[],
  processInstanceId: string,
): Variables {
  const variables: Variables = {}
  const hasExecutionScope = entries.some((entry) => entry.executionId !== undefined && entry.executionId !== null)

  for (const entry of entries) {
    if (!entry?.name || variables[entry.name]) continue
    if (hasExecutionScope && String(entry.executionId ?? '') !== processInstanceId) continue
    variables[entry.name] = {
      type: entry.type || 'String',
      value: entry.value,
      ...(entry.valueRedacted === true ? { valueRedacted: true } : {}),
    }
  }

  return variables
}

export function useInstanceData(instanceId: string, options: UseInstanceDataOptions = {}) {
  const selectedEngineId = useSelectedEngine()
  const historyProcessInstanceEnabled = options.historyProcessInstanceEnabled ?? true
  const variablesEnabled = options.variablesEnabled ?? true
  const historicVariablesEnabled = options.historicVariablesEnabled ?? true
  const activityTreeEnabled = options.activityTreeEnabled ?? true
  const activityHistoryEnabled = options.activityHistoryEnabled ?? true
  const incidentsEnabled = options.incidentsEnabled ?? true
  const jobsEnabled = options.jobsEnabled ?? true
  const externalTasksEnabled = options.externalTasksEnabled ?? true

  // Historical instance data
  const histQ = useQuery({
    queryKey: ['mission-control', 'hist-inst', instanceId, selectedEngineId],
    queryFn: () => getHistoricalProcessInstance(instanceId, selectedEngineId),
    enabled: historyProcessInstanceEnabled && !!instanceId && !!selectedEngineId,
    retry: false,
  })

  // Runtime instance data (only if not completed)
  const runtimeQ = useQuery({
    queryKey: ['mission-control', 'instance', instanceId, selectedEngineId],
    queryFn: () => getProcessInstance(instanceId, selectedEngineId),
    enabled: !!instanceId && !!selectedEngineId && histQ.isFetched && !histQ.data?.endTime,
    retry: false,
  })

  // Process definitions
  const defsQ = useQuery({
    queryKey: ['mission-control', 'defs', selectedEngineId],
    queryFn: () => listProcessDefinitions(selectedEngineId) as Promise<ProcessDefinition[]>,
    enabled: !!selectedEngineId,
  })

  // Derived process definition info
  const defId = histQ.data?.processDefinitionId || runtimeQ.data?.definitionId || null
  const defKey = histQ.data?.processDefinitionKey || runtimeQ.data?.definitionId?.split(':')[0] || ''
  const matchingDefinition = useMemo(
    () => (defsQ.data || []).find(d => d.id === defId) || (defsQ.data || []).find(d => d.key === defKey),
    [defsQ.data, defId, defKey]
  )
  const defName = histQ.data?.processDefinitionName || matchingDefinition?.name || defKey || '--'
  const defVersion = histQ.data?.processDefinitionVersion ?? matchingDefinition?.version ?? runtimeQ.data?.version ?? null

  // Process definition XML
  const xmlQ = useQuery({
    queryKey: ['mission-control', 'def-xml', defId, selectedEngineId],
    queryFn: () => defId ? fetchProcessDefinitionXml(defId, selectedEngineId) : Promise.resolve(null as any),
    enabled: !!defId && !!selectedEngineId,
  })

  // Variables
  const varsQ = useQuery({
    queryKey: ['mission-control', 'vars', instanceId, selectedEngineId],
    queryFn: () => getProcessInstanceVariables(instanceId, selectedEngineId),
    enabled: variablesEnabled && !!instanceId && !!selectedEngineId && histQ.isFetched && !histQ.data?.endTime,
  })

  // Historical variables
  const histVarsQ = useQuery({
    queryKey: ['mission-control', 'hist-vars', instanceId, selectedEngineId],
    queryFn: () => getHistoricalVariableInstances(instanceId, selectedEngineId),
    enabled: historicVariablesEnabled && !!instanceId && !!selectedEngineId,
  })

  const completedVariables = useMemo(
    () => historicProcessVariables(histVarsQ.data || [], instanceId),
    [histVarsQ.data, instanceId]
  )
  const completed = Boolean(histQ.data?.endTime)
  const displayVarsQ = useMemo(() => ({
    ...varsQ,
    data: completed ? completedVariables : varsQ.data,
    isLoading: completed ? histVarsQ.isLoading : varsQ.isLoading,
  }), [completed, completedVariables, histVarsQ.isLoading, varsQ])

  // Variable type map
  const variableTypeMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const entry of histVarsQ.data || []) {
      if (entry?.name && entry?.type && !map.has(entry.name)) {
        map.set(entry.name, entry.type)
      }
    }
    const globals = displayVarsQ.data || {}
    for (const [name, meta] of Object.entries(globals)) {
      if (name && (meta as any)?.type && !map.has(name)) {
        map.set(name, (meta as any).type)
      }
    }
    return map
  }, [displayVarsQ.data, histVarsQ.data])

  const lookupVarType = useMemo(
    () => (name?: string | null) => {
      if (!name) return ''
      return variableTypeMap.get(name) || ''
    },
    [variableTypeMap]
  )

  // Activity instances
  const actQ = useQuery({
    queryKey: ['mission-control', 'act', instanceId, selectedEngineId],
    queryFn: () => getProcessInstanceActivityHistory(instanceId, selectedEngineId),
    enabled: activityHistoryEnabled && !!instanceId && !!selectedEngineId,
  })

  const activityTreeQ = useQuery({
    queryKey: ['mission-control', 'activity-tree', instanceId, selectedEngineId],
    queryFn: () => getProcessInstanceActivityTree(instanceId, selectedEngineId),
    enabled: activityTreeEnabled && !!instanceId && !!selectedEngineId && histQ.isFetched && !histQ.data?.endTime,
    retry: false,
  })

  const runtimeActivityInstances = useMemo(
    () => flattenRuntimeActivityTree(activityTreeQ.data),
    [activityTreeQ.data]
  )

  // Sorted activities
  const sortedActs = useMemo(() => {
    const items = [...(actQ.data || [])]
    items.sort((a, b) => {
      const aEnd = a.endTime ? new Date(a.endTime).getTime() : Number.POSITIVE_INFINITY
      const bEnd = b.endTime ? new Date(b.endTime).getTime() : Number.POSITIVE_INFINITY
      if (aEnd !== bEnd) return aEnd - bEnd

      const aStart = a.startTime ? new Date(a.startTime).getTime() : Number.POSITIVE_INFINITY
      const bStart = b.startTime ? new Date(b.startTime).getTime() : Number.POSITIVE_INFINITY
      if (aStart !== bStart) return aStart - bStart

      const aName = a.activityName || a.activityId || ''
      const bName = b.activityName || b.activityId || ''
      return aName.localeCompare(bName)
    })
    return items
  }, [actQ.data])

  // Incidents
  const incidentsQ = useQuery({
    queryKey: ['mission-control', 'inc', instanceId, selectedEngineId],
    queryFn: () => getProcessInstanceIncidents(instanceId, selectedEngineId),
    enabled: incidentsEnabled && !!instanceId && !!selectedEngineId,
  })

  // Retry jobs
  const retryJobsQ = useQuery({
    queryKey: ['mission-control', 'jobs', instanceId, selectedEngineId],
    queryFn: () => getProcessInstanceJobs(instanceId, selectedEngineId),
    enabled: jobsEnabled && !!instanceId && !!selectedEngineId,
  })

  // Retry external tasks
  const retryExtTasksQ = useQuery({
    queryKey: ['mission-control', 'external-tasks', instanceId, selectedEngineId],
    queryFn: () => getProcessInstanceExternalTasks(instanceId, selectedEngineId),
    enabled: externalTasksEnabled && !!instanceId && !!selectedEngineId,
  })

  // All retry items
  const allRetryItems = useMemo(() => {
    const jobs = (retryJobsQ.data || []).map((j: any) => ({ ...j, itemType: 'job' }))
    const extTasks = (retryExtTasksQ.data || []).map((et: any) => ({ ...et, itemType: 'externalTask' }))
    return [...jobs, ...extTasks]
  }, [retryJobsQ.data, retryExtTasksQ.data])

  // Job by ID map
  const jobById = useMemo(() => {
    const map = new Map<string, any>()
    for (const job of retryJobsQ.data || []) {
      if (job?.id) map.set(job.id, job)
    }
    return map
  }, [retryJobsQ.data])

  // Incident activity IDs
  const incidentActivityIds = useMemo(() => {
    const set = new Set<string>()
    for (const inc of incidentsQ.data || []) {
      const actId = (inc as any).activityId as string | undefined
      if (actId) set.add(actId)
    }
    return set
  }, [incidentsQ.data])

  // Activity ID to instances map
  const activityIdToInstances = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const inst of [...(actQ.data || []), ...runtimeActivityInstances]) {
      if (!inst?.activityId || !inst?.id) continue
      const list = map.get(inst.activityId) || []
      list.push(inst.id)
      map.set(inst.activityId, list)
    }
    return map
  }, [actQ.data, runtimeActivityInstances])

  // Clickable activity IDs (include incident activities so they're selectable in mod mode)
  const clickableActivityIds = useMemo(() => {
    const set = new Set(activityIdToInstances.keys())
    for (const id of incidentActivityIds) set.add(id)
    return set
  }, [activityIdToInstances, incidentActivityIds])

  // Parent process instance ID
  const parentId = histQ.data?.superProcessInstanceId || null

  // Status
  const status = histQ.data?.state || 'UNKNOWN'

  return {
    // Queries
    histQ,
    runtimeQ,
    defsQ,
    xmlQ,
    varsQ: displayVarsQ,
    histVarsQ,
    actQ,
    activityTreeQ,
    incidentsQ,
    retryJobsQ,
    retryExtTasksQ,

    // Derived data
    defId,
    defKey,
    defName,
    defVersion,
    sortedActs,
    runtimeActivityInstances,
    allRetryItems,
    jobById,
    incidentActivityIds,
    activityIdToInstances,
    clickableActivityIds,
    variableTypeMap,
    lookupVarType,
    parentId,
    status,
  }
}

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import type { ProcessDefinition } from '../types'
import { useSelectedEngine } from '../../../../../components/EngineSelector'
import {
  getProcessInstance,
  getProcessInstanceVariables,
  getProcessInstanceActivityHistory,
  getProcessInstanceIncidents,
  getProcessInstanceJobs,
  getProcessInstanceExternalTasks,
  fetchProcessDefinitionXml,
  getHistoricalProcessInstance,
  getHistoricalVariableInstances,
  getCalledProcessInstances,
  listProcessDefinitions,
} from '../../api/processInstances'

export function useInstanceData(instanceId: string) {
  const selectedEngineId = useSelectedEngine()

  // Historical instance data
  const histQ = useQuery({
    queryKey: ['mission-control', 'hist-inst', instanceId],
    queryFn: () => getHistoricalProcessInstance(instanceId, selectedEngineId),
    retry: false,
  })

  // Runtime instance data (only if not completed)
  const runtimeQ = useQuery({
    queryKey: ['mission-control', 'instance', instanceId],
    queryFn: () => getProcessInstance(instanceId, selectedEngineId),
    enabled: !!instanceId && histQ.isFetched && !(histQ.data as any)?.endTime,
    retry: false,
  })

  // Process definitions
  const defsQ = useQuery({
    queryKey: ['mission-control', 'defs', selectedEngineId],
    queryFn: () => listProcessDefinitions(selectedEngineId) as Promise<ProcessDefinition[]>,
    enabled: !!selectedEngineId,
  })

  // Derived process definition info
  const defId = (histQ.data as any)?.processDefinitionId || (runtimeQ.data as any)?.definitionId || null
  const defKey = (histQ.data as any)?.processDefinitionKey || (runtimeQ.data as any)?.definitionId?.split(':')[0] || ''
  const defName = useMemo(() => {
    const m = (defsQ.data || []).find(d => d.key === defKey)
    return m?.name || defKey || '--'
  }, [defsQ.data, defKey])

  // Process definition XML
  const xmlQ = useQuery({
    queryKey: ['mission-control', 'def-xml', defId, selectedEngineId],
    queryFn: () => defId ? fetchProcessDefinitionXml(defId, selectedEngineId) : Promise.resolve(null as any),
    enabled: !!defId && !!selectedEngineId,
  })

  // Variables
  const varsQ = useQuery({
    queryKey: ['mission-control', 'vars', instanceId],
    queryFn: () => getProcessInstanceVariables(instanceId, selectedEngineId),
  })

  // Historical variables
  const histVarsQ = useQuery({
    queryKey: ['mission-control', 'hist-vars', instanceId],
    queryFn: () => getHistoricalVariableInstances(instanceId, selectedEngineId),
  })

  // Variable type map
  const variableTypeMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const entry of histVarsQ.data || []) {
      if (entry?.name && entry?.type && !map.has(entry.name)) {
        map.set(entry.name, entry.type)
      }
    }
    const globals = varsQ.data || {}
    for (const [name, meta] of Object.entries(globals)) {
      if (name && (meta as any)?.type && !map.has(name)) {
        map.set(name, (meta as any).type)
      }
    }
    return map
  }, [histVarsQ.data, varsQ.data])

  const lookupVarType = useMemo(
    () => (name?: string | null) => {
      if (!name) return ''
      return variableTypeMap.get(name) || ''
    },
    [variableTypeMap]
  )

  // Activity instances
  const actQ = useQuery({
    queryKey: ['mission-control', 'act', instanceId],
    queryFn: () => getProcessInstanceActivityHistory(instanceId, selectedEngineId),
  })

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
    queryKey: ['mission-control', 'inc', instanceId],
    queryFn: () => getProcessInstanceIncidents(instanceId, selectedEngineId),
  })

  // Retry jobs
  const retryJobsQ = useQuery({
    queryKey: ['mission-control', 'jobs', instanceId],
    queryFn: () => getProcessInstanceJobs(instanceId, selectedEngineId),
    enabled: !!instanceId,
  })

  // Retry external tasks
  const retryExtTasksQ = useQuery({
    queryKey: ['mission-control', 'external-tasks', instanceId],
    queryFn: () => getProcessInstanceExternalTasks(instanceId, selectedEngineId),
    enabled: !!instanceId,
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
    for (const inst of actQ.data || []) {
      if (!inst?.activityId || !inst?.id) continue
      const list = map.get(inst.activityId) || []
      list.push(inst.id)
      map.set(inst.activityId, list)
    }
    return map
  }, [actQ.data])

  // Clickable activity IDs
  const clickableActivityIds = useMemo(() => new Set(activityIdToInstances.keys()), [activityIdToInstances])

  // Called process instances - disabled as endpoint doesn't exist yet
  const calledQ = useQuery({
    queryKey: ['mission-control', 'called', instanceId],
    queryFn: () => getCalledProcessInstances(instanceId, selectedEngineId),
    enabled: false,
  })

  // Parent process instance ID
  const parentId = (histQ.data as any)?.superProcessInstanceId || null

  // Status
  const status = (histQ.data as any)?.state || 'UNKNOWN'

  return {
    // Queries
    histQ,
    runtimeQ,
    defsQ,
    xmlQ,
    varsQ,
    histVarsQ,
    actQ,
    incidentsQ,
    retryJobsQ,
    retryExtTasksQ,
    calledQ,

    // Derived data
    defId,
    defKey,
    defName,
    sortedActs,
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

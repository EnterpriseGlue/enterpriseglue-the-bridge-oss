import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef } from 'react'
import { useSelectedEngine } from '../../../../components/EngineSelector'
import {
  listProcessDefinitions,
  fetchProcessDefinitionXml,
  getActiveActivityCounts,
  fetchActivityCountsByState,
  listProcessInstances,
  fetchPreviewCount,
  type ProcessDefinition,
  type ProcessInstance,
  type ActivityCountsByState,
} from '../api/processDefinitions'

function isValidTime(value: string) {
  if (!value) return true
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

function toIso(date: string, time: string, mode: 'from' | 'to') {
  if (!date) return null
  const t = time || (mode === 'to' ? '23:59' : '00:00')
  if (!isValidTime(t)) return null
  const [yyyyStr, mmStr, ddStr] = date.split('-')
  const [hhStr, minStr] = t.split(':')
  const yyyy = Number(yyyyStr)
  const mm = Number(mmStr)
  const dd = Number(ddStr)
  const hh = Number(hhStr)
  const min = Number(minStr)
  if (!yyyy || !mm || !dd || isNaN(hh) || isNaN(min)) return null
  const d = new Date(yyyy, mm - 1, dd, hh, min, 0, 0)
  if (isNaN(d.getTime())) return null
  if (mode === 'to') d.setSeconds(59, 999)
  return d.toISOString()
}

interface UseProcessesDataProps {
  selectedProcess: { key: string; label: string } | null
  selectedVersion: number | null
  setSelectedVersion: (version: number | null) => void
  active: boolean
  suspended: boolean
  incidents: boolean
  completed: boolean
  canceled: boolean
  flowNode: string
  dateFrom: string
  dateTo: string
  timeFrom: string
  timeTo: string
  varName: string
  varType: 'String' | 'Boolean' | 'Long' | 'Double' | 'JSON'
  varOp: 'equals' | 'notEquals' | 'like' | 'greaterThan' | 'lessThan' | 'greaterThanOrEquals' | 'lessThanOrEquals'
  varValue: string
  advancedOpen: boolean
}

export function useProcessesData({
  selectedProcess,
  selectedVersion,
  setSelectedVersion,
  active,
  suspended,
  incidents,
  completed,
  canceled,
  flowNode,
  dateFrom,
  dateTo,
  timeFrom,
  timeTo,
  varName,
  varType,
  varOp,
  varValue,
  advancedOpen,
}: UseProcessesDataProps) {
  // Get selected engine from global store
  const selectedEngineId = useSelectedEngine()

  // Fetch all process definitions (filtered by engine)
  const defsQ = useQuery({ 
    queryKey: ['mission-control', 'defs', selectedEngineId], 
    queryFn: () => listProcessDefinitions(selectedEngineId || undefined),
    enabled: !!selectedEngineId,
  })

  // Build list of unique processes for dropdown
  const defItems = useMemo(() => {
    const d = (defsQ.data || []) as ProcessDefinition[]
    const byKey = new Map<string, { id: string; label: string; key: string; version: number }>()
    for (const x of d) {
      const label = x.name || x.key
      const existing = byKey.get(x.key)
      if (!existing || x.version > existing.version) {
        byKey.set(x.key, { id: x.key, label, key: x.key, version: x.version })
      }
    }
    return Array.from(byKey.values()).sort((a, b) => a.label.localeCompare(b.label))
  }, [defsQ.data])

  const currentKey = selectedProcess?.key || ''

  // Get available versions for selected process
  const versions = useMemo(() => {
    const d = (defsQ.data || []).filter(x => x.key === currentKey).map(x => x.version)
    const uniq = Array.from(new Set(d)).sort((a, b) => b - a)
    return uniq
  }, [defsQ.data, currentKey])

  // Track previous process key to detect process changes
  const prevKeyRef = useRef<string | null>(null)
  
  // Auto-select latest version only when process changes (not on initial load with persisted state)
  useEffect(() => {
    // Skip if definitions haven't loaded yet - don't reset persisted state
    if (!defsQ.data) return
    
    const processChanged = prevKeyRef.current !== null && prevKeyRef.current !== currentKey
    prevKeyRef.current = currentKey
    
    // If no process selected or no versions available, clear version
    if (!currentKey || versions.length === 0) {
      if (selectedVersion !== null) {
        setSelectedVersion(null)
      }
      return
    }
    
    // Only auto-select if:
    // 1. Process just changed (user selected a different process), OR
    // 2. Selected version doesn't exist in available versions (invalid persisted state)
    if (processChanged || (selectedVersion !== null && !versions.includes(selectedVersion))) {
      setSelectedVersion(versions[0])
    }
    // Note: selectedVersion === null means "All versions" - don't override it
  }, [defsQ.data, versions, currentKey, selectedVersion, setSelectedVersion])

  // Resolve definition ID for selected version
  const defIdQ = useQuery({
    queryKey: ['mission-control', 'definition-id', currentKey, selectedVersion],
    queryFn: async () => {
      if (!currentKey || !selectedVersion) return null
      const match = (defsQ.data || []).find(x => x.key === currentKey && x.version === selectedVersion)
      if (match?.id) return match.id
      console.warn(`Process definition not found for key=${currentKey}, version=${selectedVersion}`)
      return null
    },
    enabled: !!currentKey && !!defsQ.data,
  })

  const defIdForVersion = defIdQ.data || null

  // Fetch BPMN XML for diagram
  const xmlQ = useQuery({
    queryKey: ['mission-control', 'def-xml', defIdForVersion, selectedEngineId],
    queryFn: () => fetchProcessDefinitionXml(defIdForVersion!, selectedEngineId),
    enabled: !!defIdForVersion && !!selectedEngineId,
  })

  // Fetch activity counts for badges (legacy - active only)
  const countsQ = useQuery({
    queryKey: ['mission-control', 'def-counts', defIdForVersion, selectedEngineId],
    queryFn: () => getActiveActivityCounts(defIdForVersion!, selectedEngineId),
    enabled: !!defIdForVersion && !!selectedEngineId,
  })

  // Fetch activity counts by state for badges
  const countsByStateQ = useQuery({
    queryKey: ['mission-control', 'def-counts-by-state', defIdForVersion, selectedEngineId],
    queryFn: () => fetchActivityCountsByState(defIdForVersion!, selectedEngineId),
    enabled: !!defIdForVersion && !!selectedEngineId,
  })

  // Build preview count body for advanced filters
  const previewBody = useMemo(() => {
    const body: any = {}
    if (selectedEngineId) body.engineId = selectedEngineId
    if (defIdForVersion) body.processDefinitionId = defIdForVersion
    else if (currentKey) body.processDefinitionKey = currentKey
    if (active) body.active = true
    if (suspended) body.suspended = true
    if (incidents) body.withIncident = true
    
    const name = varName.trim()
    if (name) {
      let value: any = varValue
      if (varType === 'Boolean') value = String(varValue).toLowerCase() === 'true'
      else if (varType === 'Long' || varType === 'Double') {
        const n = Number(varValue)
        if (!isNaN(n)) value = n
      } else if (varType === 'JSON') {
        try { value = JSON.parse(varValue) } catch {}
      }
      body.variables = [{ name, operator: varOp, value }]
    }
    return body
  }, [defIdForVersion, currentKey, active, suspended, incidents, varName, varType, varOp, varValue])

  // Preview count for advanced filters
  const previewCountQ = useQuery({
    queryKey: ['mission-control', 'proc', 'preview-count', defIdForVersion, currentKey, active, suspended, incidents, varName, varType, varOp, varValue],
    queryFn: () => fetchPreviewCount(previewBody),
    enabled: advancedOpen && (!!defIdForVersion || !!currentKey),
  })

  // Fetch process instances based on filters (filtered by engine)
  const instQ = useQuery({
    queryKey: ['mission-control', 'instances', selectedEngineId, currentKey, selectedVersion, defIdForVersion, active, suspended, incidents, completed, canceled, flowNode, dateFrom, dateTo, timeFrom, timeTo],
    queryFn: () => {
      const startedAfter = toIso(dateFrom, timeFrom, 'from')
      const startedBefore = toIso(dateTo, timeTo, 'to')
      
      return listProcessInstances({
        engineId: selectedEngineId || undefined,
        active: active || undefined,
        completed: completed || undefined,
        canceled: canceled || undefined,
        withIncidents: incidents || undefined,
        suspended: suspended || undefined,
        processDefinitionId: selectedVersion && defIdForVersion ? defIdForVersion : undefined,
        processDefinitionKey: !selectedVersion && currentKey ? currentKey : undefined,
        activityId: flowNode || undefined,
        startedAfter: startedAfter || undefined,
        startedBefore: startedBefore || undefined,
      })
    },
    enabled: !!selectedEngineId && (!selectedVersion || !!defIdForVersion),
  })


  return {
    defsQ,
    defItems,
    versions,
    currentKey,
    defIdForVersion,
    xmlQ,
    countsQ,
    countsByStateQ,
    previewCountQ,
    instQ,
    defIdQ,
  }
}

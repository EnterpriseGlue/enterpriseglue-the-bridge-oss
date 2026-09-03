import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Dropdown } from '@carbon/react'
import { useEngineSelectorStore } from '../stores/engineSelectorStore'
import { getAccessibleEngines } from '../features/mission-control/engines/api/engines'
import type { AccessibleEngineSummary } from '@enterpriseglue/shared/schemas/mission-control/engine.js'

export const ENGINE_SELECTOR_QUERY_KEY = ['engines-selector'] as const

export function sortAccessibleEngines(engines: AccessibleEngineSummary[]): AccessibleEngineSummary[] {
  return [...engines].sort((left, right) => {
    const leftLabel = left.name ?? left.baseUrl ?? ''
    const rightLabel = right.name ?? right.baseUrl ?? ''
    return leftLabel.localeCompare(rightLabel)
      || String(left.baseUrl ?? '').localeCompare(String(right.baseUrl ?? ''))
      || left.id.localeCompare(right.id)
  })
}

export function resolveSelectedEngineId(
  engines: AccessibleEngineSummary[],
  persistedEngineId: string | undefined,
  requestedEngineId?: string,
): string | undefined {
  if (engines.length === 0) return undefined
  // A deep link must select its explicit accessible engine before any feature
  // query is enabled. Applying this only in a page effect allowed one render
  // against a stale persisted engine, producing avoidable 4xx/5xx requests.
  if (requestedEngineId && engines.some((engine) => engine.id === requestedEngineId)) {
    return requestedEngineId
  }
  if (persistedEngineId && engines.some((engine) => engine.id === persistedEngineId)) {
    return persistedEngineId
  }
  return engines[0].id
}

export function useEngineSelection() {
  const { selectedEngineId: persistedEngineId, setSelectedEngineId } = useEngineSelectorStore()
  const enginesQuery = useQuery({
    queryKey: ENGINE_SELECTOR_QUERY_KEY,
    queryFn: getAccessibleEngines,
    staleTime: 60000,
    retry: false,
  })

  const engines = React.useMemo(
    () => sortAccessibleEngines(enginesQuery.data || []),
    [enginesQuery.data],
  )
  const requestedEngineId = typeof window === 'undefined'
    ? undefined
    : new URLSearchParams(window.location.search).get('engineId') || undefined
  const selectedEngineId = enginesQuery.isSuccess
    ? resolveSelectedEngineId(engines, persistedEngineId, requestedEngineId)
    : undefined

  React.useEffect(() => {
    if (!enginesQuery.isSuccess || selectedEngineId === persistedEngineId) return
    setSelectedEngineId(selectedEngineId)
  }, [enginesQuery.isSuccess, persistedEngineId, selectedEngineId, setSelectedEngineId])

  return {
    engines,
    selectedEngineId,
    isResolving: enginesQuery.isPending,
    isEmpty: enginesQuery.isSuccess && engines.length === 0,
    isError: enginesQuery.isError,
    error: enginesQuery.error,
    refetch: enginesQuery.refetch,
  }
}

interface EngineSelectorProps {
  style?: React.CSSProperties
  size?: 'sm' | 'md' | 'lg'
  label?: string
}

export function EngineSelector({ style, size = 'sm', label = 'Engine' }: EngineSelectorProps) {
  const { setSelectedEngineId } = useEngineSelectorStore()
  const { engines, selectedEngineId, isResolving, isError } = useEngineSelection()

  // Build items list (no "All Engines" option)
  const items = React.useMemo(() => {
    if (engines.length === 0) return []
    return engines.map(e => ({
      id: e.id,
      label: e.name || e.baseUrl,
      technicalId: e.id,
      baseUrl: e.baseUrl,
    }))
  }, [engines])

  // Find current selection
  const currentItem = React.useMemo(() => {
    if (items.length === 0) return null
    return items.find(i => i.id === selectedEngineId) || items[0]
  }, [items, selectedEngineId])

  // Don't render if loading or no engines - but keep hook count stable
  if (isResolving || isError || engines.length === 0) {
    return null
  }

  return (
    <Dropdown
      id="engine-selector"
      aria-label={label || 'Engine'}
      titleText=""
      label={label}
      size={size}
      items={items}
      itemToString={(item: any) => item?.label || ''}
      itemToElement={(item: any) => (
        <div style={{ display: 'grid', gap: '0.125rem', minWidth: 0 }}>
          <span>{item?.label || ''}</span>
          <span style={{ color: 'var(--cds-text-secondary)', fontSize: '0.75rem', overflowWrap: 'anywhere' }}>
            {item?.technicalId}
          </span>
        </div>
      )}
      selectedItem={currentItem}
      onChange={({ selectedItem }: any) => {
        if (selectedItem?.id) {
          setSelectedEngineId(selectedItem.id)
        }
      }}
      style={{ minWidth: '180px', ...style }}
    />
  )
}

// Hook to get the current engine filter for queries
export function useSelectedEngine() {
  return useEngineSelection().selectedEngineId
}

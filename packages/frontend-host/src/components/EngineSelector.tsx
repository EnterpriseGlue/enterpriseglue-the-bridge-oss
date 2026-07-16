import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Dropdown } from '@carbon/react'
import { useEngineSelectorStore } from '../stores/engineSelectorStore'
import { getAccessibleEngines } from '../features/mission-control/engines/api/engines'

interface EngineSelectorProps {
  style?: React.CSSProperties
  size?: 'sm' | 'md' | 'lg'
  label?: string
}

export function EngineSelector({ style, size = 'sm', label = 'Engine' }: EngineSelectorProps) {
  const { selectedEngineId, setSelectedEngineId } = useEngineSelectorStore()

  const enginesQuery = useQuery({
    queryKey: ['engines-selector'],
    queryFn: () => getAccessibleEngines().catch(() => []),
    staleTime: 60000,
  })

  const engines = React.useMemo(() => {
    // The route is guarded by engine.visibleCollection. Do not re-filter by
    // legacy display roles here: custom and runtime-derived grants may not
    // have a synthetic owner/delegate/operator value.
    return [...(enginesQuery.data || [])].sort((a, b) =>
      (a.name ?? a.baseUrl ?? '').localeCompare(b.name ?? b.baseUrl ?? '')
    )
  }, [enginesQuery.data])

  // Auto-select engine: single engine or first alphabetically
  React.useEffect(() => {
    if (engines.length > 0 && (!selectedEngineId || !engines.some((engine) => engine.id === selectedEngineId))) {
      setSelectedEngineId(engines[0].id)
    }
  }, [engines, selectedEngineId, setSelectedEngineId])

  // Build items list (no "All Engines" option)
  const items = React.useMemo(() => {
    if (engines.length === 0) return []
    return engines.map(e => ({ id: e.id, label: e.name || e.baseUrl }))
  }, [engines])

  // Find current selection
  const currentItem = React.useMemo(() => {
    if (items.length === 0) return null
    return items.find(i => i.id === selectedEngineId) || items[0]
  }, [items, selectedEngineId])

  // Don't render if loading or no engines - but keep hook count stable
  if (enginesQuery.isLoading || engines.length === 0) {
    return null
  }

  return (
    <Dropdown
      id="engine-selector"
      titleText=""
      label={label}
      size={size}
      items={items}
      itemToString={(item: any) => item?.label || ''}
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
  const { selectedEngineId } = useEngineSelectorStore()
  return selectedEngineId
}

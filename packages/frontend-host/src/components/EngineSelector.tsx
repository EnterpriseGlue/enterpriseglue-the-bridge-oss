import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Dropdown } from '@carbon/react'
import { useEngineSelectorStore } from '../stores/engineSelectorStore'
import { getAccessibleEngines } from '../features/mission-control/engines/api/engines'
import type { AccessibleEngineSummary } from '@enterpriseglue/shared/schemas/mission-control/engine.js'
import { isMissionControlBrowserPath, withEngineContext } from '../features/mission-control/shared/engineContext'
import { useLocation, useNavigate } from 'react-router-dom'
import { AuthContext } from '../contexts/AuthContext'

export const ENGINE_SELECTOR_QUERY_KEY = ['engines-selector'] as const

export function engineSelectionScope(
  pathname: string,
  user?: { id?: string; session?: { principal?: { id?: string }; tenant?: { id?: string | null } } } | null,
): string {
  const tenantSlugMatch = pathname.match(/^\/t\/([^/]+)(?:\/|$)/)
  const pathTenant = tenantSlugMatch?.[1] ? decodeURIComponent(tenantSlugMatch[1]) : 'root'
  const principalId = user?.session?.principal?.id || user?.id || 'anonymous'
  const tenantId = user?.session?.tenant?.id || pathTenant
  // Include both the authenticated tenant and tenant route. Tenant switching
  // can update these in separate renders; either transition must use a fresh
  // inventory rather than momentarily exposing the previous tenant's cache.
  return `${encodeURIComponent(principalId)}:${encodeURIComponent(tenantId)}:${encodeURIComponent(pathTenant)}`
}

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
  if (requestedEngineId) {
    return engines.some((engine) => engine.id === requestedEngineId)
      ? requestedEngineId
      : undefined
  }
  if (persistedEngineId && engines.some((engine) => engine.id === persistedEngineId)) {
    return persistedEngineId
  }
  return engines[0].id
}

export function useEngineSelection(enabled = true) {
  const location = useLocation()
  const authContext = React.useContext(AuthContext)
  const scope = React.useMemo(
    () => engineSelectionScope(location.pathname, authContext?.user),
    [authContext?.user, location.pathname],
  )
  const {
    activeScope,
    selectedEngineIdsByScope,
    setActiveEngineScope,
    setSelectedEngineIdForScope,
  } = useEngineSelectorStore()
  const persistedEngineId = selectedEngineIdsByScope[scope]
  const enginesQuery = useQuery({
    queryKey: [...ENGINE_SELECTOR_QUERY_KEY, scope],
    queryFn: getAccessibleEngines,
    enabled,
    staleTime: 60000,
    retry: false,
  })

  const engines = React.useMemo(
    () => enabled ? sortAccessibleEngines(enginesQuery.data || []) : [],
    [enabled, enginesQuery.data],
  )
  const requestedEngineId = !isMissionControlBrowserPath(location.pathname)
    ? undefined
    : new URLSearchParams(location.search).get('engineId') || undefined
  const isRequestedEngineUnavailable = Boolean(
    enabled
    && enginesQuery.isSuccess
    && requestedEngineId
    && !engines.some((engine) => engine.id === requestedEngineId),
  )
  const selectedEngineId = enabled && enginesQuery.isSuccess
    ? resolveSelectedEngineId(engines, persistedEngineId, requestedEngineId)
    : undefined

  React.useEffect(() => {
    if (activeScope !== scope) setActiveEngineScope(scope)
  }, [activeScope, scope, setActiveEngineScope])

  React.useEffect(() => {
    if (!enabled || !enginesQuery.isSuccess || selectedEngineId === persistedEngineId) return
    setSelectedEngineIdForScope(scope, selectedEngineId)
  }, [enabled, enginesQuery.isSuccess, persistedEngineId, scope, selectedEngineId, setSelectedEngineIdForScope])

  return {
    engines,
    scope,
    requestedEngineId,
    selectedEngineId,
    isRequestedEngineUnavailable,
    isResolving: enabled && enginesQuery.isPending,
    isEmpty: enabled && enginesQuery.isSuccess && engines.length === 0,
    isError: enabled && enginesQuery.isError,
    error: enabled ? enginesQuery.error : null,
    refetch: enginesQuery.refetch,
  }
}

interface EngineSelectorProps {
  style?: React.CSSProperties
  size?: 'sm' | 'md' | 'lg'
  label?: string
  enabled?: boolean
}

export function EngineSelector({ style, size = 'sm', label = 'Engine', enabled = true }: EngineSelectorProps) {
  const { setSelectedEngineIdForScope } = useEngineSelectorStore()
  const { engines, scope, selectedEngineId, isResolving, isError, isRequestedEngineUnavailable } = useEngineSelection(enabled)
  const location = useLocation()
  const navigate = useNavigate()

  React.useEffect(() => {
    if (!selectedEngineId || !isMissionControlBrowserPath(location.pathname)) return
    if (new URLSearchParams(location.search).get('engineId') === selectedEngineId) return
    navigate(withEngineContext(`${location.pathname}${location.search}${location.hash}`, selectedEngineId), { replace: true })
  }, [location.hash, location.pathname, location.search, navigate, selectedEngineId])

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
    return items.find(i => i.id === selectedEngineId) || null
  }, [items, selectedEngineId])

  // Don't render if loading or no engines - but keep hook count stable
  if (!enabled || isResolving || isError || isRequestedEngineUnavailable || engines.length === 0) {
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
          if (isMissionControlBrowserPath(location.pathname)) {
            navigate(withEngineContext(`${location.pathname}${location.search}${location.hash}`, selectedItem.id), { replace: true })
          }
          setSelectedEngineIdForScope(scope, selectedItem.id)
        }
      }}
      style={{ minWidth: '180px', ...style }}
    />
  )
}

// Hook to get the current engine filter for queries
export function useSelectedEngine(enabled = true) {
  return useEngineSelection(enabled).selectedEngineId
}

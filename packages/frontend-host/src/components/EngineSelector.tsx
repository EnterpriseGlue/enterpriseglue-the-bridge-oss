import React from 'react'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { Dropdown, DropdownSkeleton } from '@carbon/react'
import { useEngineSelectorStore } from '../stores/engineSelectorStore'
import { getAccessibleEngines } from '../features/mission-control/engines/api/engines'
import type { AccessibleEngineSummary } from '@enterpriseglue/shared/schemas/mission-control/engine.js'
import { isMissionControlBrowserPath, withEngineContext } from '../features/mission-control/shared/engineContext'
import { useLocation, useNavigate } from 'react-router-dom'
import { AuthContext } from '../contexts/AuthContext'

export const ENGINE_SELECTOR_QUERY_KEY = ['engines-selector'] as const

export function engineInventoryQuery(scope: string) {
  return queryOptions({
    queryKey: [...ENGINE_SELECTOR_QUERY_KEY, scope],
    queryFn: getAccessibleEngines,
    staleTime: 60000,
    retry: false,
  })
}

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
  const enginesQuery = useQuery({ ...engineInventoryQuery(scope), enabled })

  const engines = React.useMemo(
    () => enabled
      ? sortAccessibleEngines(enginesQuery.data ?? [])
      : [],
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
  showLabel?: boolean
}

export function EngineSelector({ style, size = 'sm', label = 'Engine', enabled = true, showLabel = false }: EngineSelectorProps) {
  const { setSelectedEngineIdForScope } = useEngineSelectorStore()
  const inputId = React.useId()
  const trigger = React.useRef<HTMLButtonElement>(null)
  const { engines, scope, selectedEngineId, isResolving, isError, isRequestedEngineUnavailable } = useEngineSelection(enabled)
  const location = useLocation()
  const navigate = useNavigate()

  React.useEffect(() => {
    if (!selectedEngineId || !isMissionControlBrowserPath(location.pathname)) return
    if (new URLSearchParams(location.search).get('engineId') === selectedEngineId) return
    navigate(withEngineContext(`${location.pathname}${location.search}${location.hash}`, selectedEngineId), { replace: true })
  }, [location.hash, location.pathname, location.search, navigate, selectedEngineId])

  const items = React.useMemo(() => engines.map((engine) => ({
    id: engine.id,
    label: engineDisplayName(engine),
  })), [engines])
  const currentItem = items.find((item) => item.id === selectedEngineId) || null
  const currentLabel = currentItem?.label

  React.useLayoutEffect(() => {
    // Carbon sets a native title on the toggle. The selected name now wraps
    // visibly, so the duplicate tooltip can be removed before paint.
    trigger.current?.removeAttribute('title')
  }, [currentLabel, isResolving, isError, isRequestedEngineUnavailable])

  if (!enabled || isError || isRequestedEngineUnavailable) return null
  if (isResolving) {
    return <DropdownSkeleton className="eg-engine-dropdown" style={style} hideLabel={!showLabel} />
  }
  if (items.length === 0) return null
  if (showLabel && items.length === 1) return (
    <div className="eg-engine-context" role="group" aria-label={label} style={style}>
      <span className="cds--label">{label}</span>
      <p className="eg-engine-context__value">{currentLabel}</p>
    </div>
  )

  return (
    <Dropdown
      id={`engine-selector-${inputId}`}
      ref={trigger}
      className="eg-engine-dropdown"
      aria-label={label || 'Engine'}
      titleText={showLabel ? label : ''}
      label={label}
      size={size}
      items={items}
      itemToString={(item) => item?.label || ''}
      autoAlign
      selectedItem={currentItem}
      onChange={({ selectedItem }) => {
        if (selectedItem?.id) {
          if (isMissionControlBrowserPath(location.pathname)) {
            navigate(withEngineContext(`${location.pathname}${location.search}${location.hash}`, selectedItem.id), { replace: true })
          }
          setSelectedEngineIdForScope(scope, selectedItem.id)
        }
      }}
      style={style}
    />
  )
}

/** A readable engine label: its name, else its host, never a raw ID. */
export function engineDisplayName(engine: Pick<AccessibleEngineSummary, 'name' | 'baseUrl'>): string {
  const name = engine.name?.trim()
  if (name) return name
  try {
    return new URL(String(engine.baseUrl)).host || 'Engine'
  } catch {
    return engine.baseUrl ? String(engine.baseUrl) : 'Engine'
  }
}

// Hook to get the current engine filter for queries
export function useSelectedEngine(enabled = true) {
  return useEngineSelection(enabled).selectedEngineId
}

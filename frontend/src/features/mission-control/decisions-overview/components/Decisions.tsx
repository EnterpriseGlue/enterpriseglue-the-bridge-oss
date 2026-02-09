import React from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  InlineNotification,
  BreadcrumbItem,
} from '@carbon/react'
import { BreadcrumbBar } from '../../../shared/components/BreadcrumbBar'
import { listDecisionDefinitions, fetchDecisionDefinitionDmnXml, listDecisionHistory, type DecisionHistoryEntry } from '../api/decisions'
import SplitPane from 'react-split-pane'
import { useSearchParams, useLocation } from 'react-router-dom'
import { sanitizePathParam } from '../../../../shared/utils/sanitize'
import { useTenantNavigate } from '../../../../shared/hooks/useTenantNavigate'
import { DecisionsDataTable } from './DecisionsDataTable'
import { PageLoader } from '../../../../shared/components/PageLoader'
import { useDecisionsFilterStore } from '../../shared/stores/decisionsFilterStore'
import { EngineAccessError, isEngineAccessError } from '../../shared/components/EngineAccessError'
import { useSelectedEngine } from '../../../../components/EngineSelector'
import styles from './Decisions.module.css'

const DMNDrdMini = React.lazy(() => import('../../../starbase/components/DMNDrdMini'))

const SPLIT_PANE_STORAGE_KEY = 'decisions-split-pane-size-v2'
const DEFAULT_SPLIT_SIZE = '60%'

type DecisionDef = {
  id: string
  key: string
  name?: string | null
  version: number
  versionTag?: string | null
}

export default function Decisions() {
  const { tenantNavigate, toTenantPath } = useTenantNavigate()
  const location = useLocation() as any
  const [searchParams, setSearchParams] = useSearchParams()
  const fromInstanceId = location?.state?.fromInstanceId as string | undefined

  const isValidTime = (value: string) => {
    if (!value) return true
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
  }

  const toIso = (date: string, time: string, mode: 'from' | 'to') => {
    if (!date) return null
    const t = time || (mode === 'to' ? '23:59' : '00:00')
    if (!isValidTime(t)) return null
    const d = new Date(`${date}T${t}:00`)
    if (isNaN(d.getTime())) return null
    if (mode === 'to') d.setSeconds(59, 999)
    return d.toISOString()
  }
  
  // Split pane state with localStorage persistence
  const [splitSize, setSplitSize] = React.useState<string | number>(() => {
    const saved = localStorage.getItem(SPLIT_PANE_STORAGE_KEY)
    if (saved) {
      if (saved.includes('%')) return saved
      return parseInt(saved, 10)
    }
    return DEFAULT_SPLIT_SIZE
  })
  
  const handleSplitChange = (size: number | string) => {
    setSplitSize(size)
    localStorage.setItem(SPLIT_PANE_STORAGE_KEY, String(size))
  }
  
  
  // Use Zustand store for filter persistence
  const {
    selectedDefinition,
    selectedVersion,
    selectedStates,
    searchValue,
    dateFrom,
    dateTo,
    timeFrom,
    timeTo,
    setSelectedDefinition,
    setSelectedVersion,
    setSelectedStates,
    reset: resetStore
  } = useDecisionsFilterStore()
  
  const [maxResults] = React.useState(50)
  const selectedEngineId = useSelectedEngine()

  const defsQ = useQuery({
    queryKey: ['mission-control', 'decision-defs', selectedEngineId],
    queryFn: () => listDecisionDefinitions(selectedEngineId),
    enabled: !!selectedEngineId,
  })

  const defItems = React.useMemo(() => {
    const d = (defsQ.data || []) as DecisionDef[]
    const byKey = new Map<string, { id: string; label: string; key: string; version: number }>()
    for (const x of d) {
      const label = x.name || x.key
      const existing = byKey.get(x.key)
      if (!existing || x.version > existing.version) {
        byKey.set(x.key, { id: x.id, label, key: x.key, version: x.version })
      }
    }
    return Array.from(byKey.values()).sort((a, b) => a.label.localeCompare(b.label))
  }, [defsQ.data])

  // Handle URL query parameter for decision key
  React.useEffect(() => {
    const decisionKey = searchParams.get('decision')
    const nodeId = searchParams.get('node')
    if (decisionKey && defItems.length > 0) {
      const matchingDef = defItems.find(d => d.key === decisionKey)
      if (matchingDef) {
        setSelectedDefinition(matchingDef)
        // Clear the URL parameter after applying
        searchParams.delete('decision')
        // node is used for deep-linking (optional) - clear it to keep URL clean
        if (nodeId) searchParams.delete('node')
        setSearchParams(searchParams, { replace: true })
      }
    }
  }, [searchParams, defItems, setSelectedDefinition, setSearchParams])

  // If `node` is present without `decision`, clear it (prevents stale URLs)
  React.useEffect(() => {
    const nodeId = searchParams.get('node')
    if (!nodeId) return
    const decisionKey = searchParams.get('decision')
    if (decisionKey) return

    searchParams.delete('node')
    setSearchParams(searchParams, { replace: true })
  }, [searchParams, setSearchParams])

  const currentKey = selectedDefinition?.key || ''

  const versions = React.useMemo(() => {
    const d = (defsQ.data || []).filter((x) => x.key === currentKey).map((x) => x.version)
    const uniq = Array.from(new Set(d)).sort((a, b) => b - a)
    return uniq
  }, [defsQ.data, currentKey])

  React.useEffect(() => {
    if (versions.length > 0 && (selectedVersion === null || !versions.includes(selectedVersion))) {
      setSelectedVersion(versions[0])
    }
    if (versions.length === 0) setSelectedVersion(null)
  }, [versions])


  const currentDef: DecisionDef | null = React.useMemo(() => {
    if (!currentKey || selectedVersion === null) return null
    return (defsQ.data || []).find((x) => x.key === currentKey && x.version === selectedVersion) || null
  }, [defsQ.data, currentKey, selectedVersion])

  const xmlQ = useQuery({
    queryKey: ['mission-control', 'decision-xml', currentDef?.id, selectedEngineId],
    queryFn: async () => {
      if (!currentDef) return ''
      return fetchDecisionDefinitionDmnXml(currentDef.id, selectedEngineId)
    },
    enabled: !!currentDef?.id && !!selectedEngineId,
  })

  // Derived boolean flags from selectedStates
  const evaluatedOnly = selectedStates.some(s => s.id === 'evaluated')
  const failedOnly = selectedStates.some(s => s.id === 'failed')

  const historyQ = useQuery({
    queryKey: ['mission-control', 'decision-history', currentDef?.id, evaluatedOnly, failedOnly, maxResults, dateFrom, dateTo, timeFrom, timeTo, selectedEngineId],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (selectedEngineId) params.set('engineId', selectedEngineId)
      if (currentDef?.id) params.set('decisionDefinitionId', currentDef.id)
      params.set('rootDecisionInstancesOnly', 'true')
      params.set('sortBy', 'evaluationTime')
      params.set('sortOrder', 'desc')
      params.set('maxResults', String(maxResults))

      const evaluatedAfter = toIso(dateFrom, timeFrom, 'from')
      const evaluatedBefore = toIso(dateTo, timeTo, 'to')
      if (evaluatedAfter) params.set('evaluatedAfter', evaluatedAfter)
      if (evaluatedBefore) params.set('evaluatedBefore', evaluatedBefore)

      return listDecisionHistory(params)
    },
    enabled: !!selectedEngineId,
  })


  function fmt(ts?: string | null) {
    if (!ts) return '--'
    const d = new Date(ts)
    return isNaN(d.getTime()) ? '--' : d.toISOString().replace('T', ' ').slice(0, 19)
  }

  const rows = React.useMemo(() => {
    const list = historyQ.data || []
    return list.map((h: DecisionHistoryEntry) => {
      const versionLabel = (() => {
        if (h.decisionDefinitionId) {
          const parts = h.decisionDefinitionId.split(':')
          if (parts.length >= 2 && parts[1]) return `v${parts[1]}`
        }
        if (currentDef?.version) return `v${currentDef.version}`
        return ''
      })()
      return {
        id: h.id,
        name: h.decisionDefinitionName || h.decisionDefinitionKey || '',
        instanceKey: h.id,
        version: versionLabel,
        evaluationTime: fmt(h.evaluationTime || null),
        processInstance: h.processInstanceId || 'None',
        status: (h.state === 'FAILED' ? 'failed' : 'evaluated') as 'evaluated' | 'failed',
      }
    })
  }, [historyQ.data, currentDef])

  // Check if initial data is loading
  const isInitialLoading = defsQ.isLoading || (!!currentDef && xmlQ.isLoading)

  // Check for engine access errors (403/503)
  const engineAccessError = isEngineAccessError(defsQ.error)
  if (engineAccessError) {
    return <EngineAccessError status={engineAccessError.status} message={engineAccessError.message} />
  }

  return (
    <PageLoader isLoading={isInitialLoading} skeletonType="page">
    <div style={{ 
      display: 'flex',
      flexDirection: 'column',
      height: 'calc(100vh - var(--header-height))',
    }}>
      <style>
        {`
          /* React Split Pane styles */
          .Resizer {
            background: var(--cds-layer-02, #e0e0e0);
            opacity: 1;
            z-index: 1;
            box-sizing: border-box;
            background-clip: padding-box;
          }
          
          .Resizer:hover {
            transition: all 0.2s ease;
          }
          
          .Resizer.horizontal {
            height: 6px;
            margin: 0;
            border-top: 1px solid var(--cds-border-subtle-01, #c6c6c6);
            border-bottom: 1px solid var(--cds-border-subtle-01, #c6c6c6);
            cursor: row-resize;
            width: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          
          .Resizer.horizontal:hover {
            background: var(--cds-layer-hover-02, #d1d1d1);
          }
          
          .Resizer.horizontal::after {
            content: '';
            width: 32px;
            height: 3px;
            background: var(--cds-icon-secondary, #525252);
            border-radius: 2px;
          }
        `}
      </style>

      {/* Breadcrumb Bar - shared component */}
      <BreadcrumbBar>
        <BreadcrumbItem>
          <a href={toTenantPath('/mission-control')} onClick={(e) => { e.preventDefault(); tenantNavigate('/mission-control'); }}>
            Mission Control
          </a>
        </BreadcrumbItem>
        {fromInstanceId && (
          <BreadcrumbItem>
            <a
              href={toTenantPath(`/mission-control/processes/instances/${encodeURIComponent(sanitizePathParam(fromInstanceId))}`)}
              onClick={(e) => {
                e.preventDefault()
                tenantNavigate(`/mission-control/processes/instances/${encodeURIComponent(sanitizePathParam(fromInstanceId))}`)
              }}
            >
              Instance {sanitizePathParam(fromInstanceId).substring(0, 8)}...
            </a>
          </BreadcrumbItem>
        )}
        <BreadcrumbItem isCurrentPage={!selectedDefinition}>
          {selectedDefinition ? (
            <a
              href={toTenantPath('/mission-control/decisions')}
              onClick={(e) => {
                e.preventDefault()
                // Reset all decision filters (definition, version, states, search)
                resetStore()
                tenantNavigate('/mission-control/decisions')
              }}
            >
              Decisions
            </a>
          ) : (
            'Decisions'
          )}
        </BreadcrumbItem>
        {selectedDefinition && (
          <BreadcrumbItem isCurrentPage>
            {`${selectedDefinition.label || selectedDefinition.key}${selectedVersion ? ` (v${selectedVersion})` : ''}`}
          </BreadcrumbItem>
        )}
      </BreadcrumbBar>

      {/* SplitPane wrapper - needed because react-split-pane uses absolute positioning */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
      {/* @ts-ignore - react-split-pane types not compatible with React 19 */}
      <SplitPane
        split="horizontal"
        size={splitSize}
        onChange={handleSplitChange}
        minSize={200}
        maxSize={-200}
        style={{ 
          marginTop: 'var(--spacing-0)', 
          position: 'relative',
          marginLeft: '0',
          marginRight: '0',
          width: '100%'
        }}
        pane1Style={{ overflow: 'hidden' }}
        pane2Style={{ overflow: 'auto' }}
      >
        {/* DMN Diagram area (top pane) */}
        <div style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-border-primary)', position: 'relative', overflow: 'hidden', height: '100%', width: '100%' }}>
          {!currentKey ? (
            <div style={{ color: 'var(--color-text-tertiary)', position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 'var(--z-base)' }}>
              To view a Decision Table, select a Decision in the Filters panel
            </div>
          ) : selectedVersion === null ? (
            <div style={{ color: 'var(--color-text-tertiary)', position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 'var(--z-base)' }}>
              To see a Decision Table, select a single Version
            </div>
          ) : !currentDef ? (
            <div style={{ color: 'var(--color-text-tertiary)', position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 'var(--z-base)' }}>
              Loading...
            </div>
          ) : xmlQ.isLoading ? (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-tertiary)', background: 'var(--color-bg-primary)', zIndex: 10 }}>
              Loading decision table...
            </div>
          ) : xmlQ.isError ? (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--color-error)', background: 'var(--color-bg-primary)', zIndex: 10 }}>
              <div>Error loading decision table</div>
              <div style={{ fontSize: 'var(--text-12)', marginTop: 'var(--spacing-1)' }}>{String(xmlQ.error)}</div>
            </div>
          ) : (
            <React.Suspense fallback={<div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-tertiary)', background: 'var(--color-bg-primary)', zIndex: 10 }}>Loading decision table...</div>}>
              <DMNDrdMini
                xml={(xmlQ.data as string) || ''}
                preferDecisionTable
                decisionId={currentDef.key}
                decisionName={currentDef.name || undefined}
              />
            </React.Suspense>
          )}
        </div>

        {/* DataTable area (bottom pane) */}
        <div style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '100%' }}>
          {/* Action bar */}
          <div style={{ 
            background: 'white', 
            color: 'black', 
            padding: '1px var(--spacing-3)', 
            display: 'flex', 
            alignItems: 'center', 
            gap: 'var(--spacing-4)',
            minHeight: '25px',
            maxHeight: '25px',
            borderBottom: '1px solid var(--color-border-primary)',
            zIndex: 10
          }}>
            <div style={{ fontSize: 'var(--text-14)', fontWeight: '', whiteSpace: 'nowrap' }}>
              {historyQ.data?.length || 0} Decision Instances
            </div>
          </div>
          
          {/* Table */}
          <div style={{ flex: 1, overflow: 'auto' }}>
            {historyQ.isLoading ? (
              <div
                style={{
                  textAlign: 'center',
                  padding: 'var(--spacing-6)',
                  color: 'var(--color-text-tertiary)',
                }}
              >
                Loading decision instances...
              </div>
            ) : historyQ.isError ? (
              <div style={{ padding: 'var(--spacing-4)' }}>
                <InlineNotification
                  kind="error"
                  title="Failed to load decision instances"
                  subtitle={String(historyQ.error)}
                  lowContrast
                  hideCloseButton
                />
              </div>
            ) : (
              <DecisionsDataTable data={rows} searchValue={searchValue} />
            )}
          </div>
        </div>
      </SplitPane>
      </div>
    </div>
    </PageLoader>
  )
}

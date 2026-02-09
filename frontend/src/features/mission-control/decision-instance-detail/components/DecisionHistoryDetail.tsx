import React from 'react'
import { useParams, useLocation } from 'react-router-dom'
import { useTenantNavigate } from '../../../../shared/hooks/useTenantNavigate'
import { sanitizePathParam } from '../../../../shared/utils/sanitize'
import { useQuery } from '@tanstack/react-query'
import {
  Button,
  InlineNotification,
  BreadcrumbItem,
  Tabs,
  TabList,
  Tab,
  Tile,
  DataTable,
  Table,
  TableContainer,
  TableHead,
  TableRow,
  TableHeader,
  TableBody,
  TableCell,
} from '@carbon/react'
import { Copy } from '@carbon/icons-react'
import { PageLoader } from '../../../../shared/components/PageLoader'
import { BreadcrumbBar } from '../../../shared/components/BreadcrumbBar'
import { apiClient } from '../../../../shared/api/client'
import { useSelectedEngine } from '../../../../components/EngineSelector'
import styles from '../../process-instance-detail/styles/InstanceDetail.module.css'
import SplitPane from 'react-split-pane'

const DMNDrdMini = React.lazy(() => import('../../../starbase/components/DMNDrdMini'))

type HistoricDecisionInstance = {
  id: string
  decisionDefinitionId?: string | null
  decisionDefinitionKey?: string | null
  decisionDefinitionName?: string | null
  rootDecisionInstanceId?: string | null
  evaluationTime?: string | null
  processInstanceId?: string | null
}

type DecisionIo = {
  id?: string
  clauseId?: string | null
  clauseName?: string | null
  type?: string | null
  value?: any
  ruleId?: string | null
}

function fmt(ts?: string | null) {
  if (!ts) return '--'
  const d = new Date(ts)
  return isNaN(d.getTime()) ? '--' : d.toISOString().replace('T', ' ').slice(0, 19)
}

export default function DecisionHistoryDetail() {
  const { id = '' } = useParams()
  const { tenantNavigate, toTenantPath } = useTenantNavigate()
  const location = useLocation() as any
  const selectedEngineId = useSelectedEngine()
  const searchParams = new URLSearchParams(location.search)
  const fromInstanceId = searchParams.get('fromInstance') || (location?.state?.fromInstanceId as string | undefined)
  const processLabel = searchParams.get('processLabel') || null

  const histQ = useQuery({
    queryKey: ['mission-control', 'decision-hist', id, selectedEngineId],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (selectedEngineId) params.set('engineId', selectedEngineId)
      params.set('decisionInstanceId', id)
      const data = await apiClient.get<HistoricDecisionInstance[]>(
        `/mission-control-api/history/decisions?${params.toString()}`,
        undefined,
        { credentials: 'include' },
      )
      return data[0] || null
    },
    enabled: !!id && !!selectedEngineId,
  })

  const decision = histQ.data as HistoricDecisionInstance | null
  const [drdOpen, setDrdOpen] = React.useState(false)

  const rootDecisionInstanceId =
    (decision as any)?.rootDecisionInstanceId || decision?.id || null

  const relatedQ = useQuery({
    queryKey: ['mission-control', 'decision-related', rootDecisionInstanceId, selectedEngineId],
    queryFn: async () => {
      if (!rootDecisionInstanceId) return [] as HistoricDecisionInstance[]
      const params = new URLSearchParams()
      if (selectedEngineId) params.set('engineId', selectedEngineId)
      params.set('rootDecisionInstanceId', rootDecisionInstanceId)
      const data = await apiClient.get<HistoricDecisionInstance[]>(
        `/mission-control-api/history/decisions?${params.toString()}`,
        undefined,
        { credentials: 'include' },
      )
      return data
    },
    enabled: !!rootDecisionInstanceId && !!selectedEngineId,
  })

  const versionLabel = React.useMemo(() => {
    const defId = decision?.decisionDefinitionId || ''
    if (!defId) return ''
    const parts = defId.split(':')
    if (parts.length >= 2 && parts[1]) return `v${parts[1]}`
    return ''
  }, [decision?.decisionDefinitionId])

  const xmlQ = useQuery({
    queryKey: ['mission-control', 'decision-xml', decision?.decisionDefinitionId, selectedEngineId],
    queryFn: async () => {
      if (!decision?.decisionDefinitionId) return ''
      const params = selectedEngineId ? `?engineId=${encodeURIComponent(selectedEngineId)}` : ''
      const data = await apiClient.get<{ dmnXml: string }>(
        `/mission-control-api/decision-definitions/${encodeURIComponent(
          decision.decisionDefinitionId,
        )}/xml${params}`,
        undefined,
        { credentials: 'include' },
      )
      return data.dmnXml
    },
    enabled: !!decision?.decisionDefinitionId && !!selectedEngineId,
  })

  const inputsQ = useQuery({
    queryKey: ['mission-control', 'decision-inputs', id, selectedEngineId],
    queryFn: () => {
      const params = new URLSearchParams()
      if (selectedEngineId) params.set('engineId', selectedEngineId)
      return apiClient.get<DecisionIo[]>(
        `/mission-control-api/history/decisions/${id}/inputs?${params.toString()}`,
        undefined,
        { credentials: 'include' },
      )
    },
    enabled: !!id && !!selectedEngineId,
  })

  const outputsQ = useQuery<DecisionIo[]>({
    queryKey: ['mission-control', 'decision-outputs', id, selectedEngineId],
    queryFn: () => {
      const params = new URLSearchParams()
      if (selectedEngineId) params.set('engineId', selectedEngineId)
      return apiClient.get<DecisionIo[]>(
        `/mission-control-api/history/decisions/${id}/outputs?${params.toString()}`,
        undefined,
        { credentials: 'include' },
      )
    },
    enabled: !!id && !!selectedEngineId,
  })

  const title = decision?.decisionDefinitionName || decision?.decisionDefinitionKey || 'Decision'

  const hitRuleIds = React.useMemo(() => {
    const list = outputsQ.data || []
    const ids = list
      .map((o: DecisionIo) => o.ruleId)
      .filter((x): x is string => typeof x === 'string' && x.length > 0)
    return Array.from(new Set(ids))
  }, [outputsQ.data])

  const relatedInstances = React.useMemo(() => {
    if (!decision) return [] as HistoricDecisionInstance[]
    const base = (relatedQ.data && relatedQ.data.length > 0
      ? relatedQ.data
      : [decision]) as HistoricDecisionInstance[]
    const items = [...base]
    items.sort((a, b) => {
      const aTime = a.evaluationTime ? new Date(a.evaluationTime).getTime() : 0
      const bTime = b.evaluationTime ? new Date(b.evaluationTime).getTime() : 0
      return aTime - bTime
    })
    return items
  }, [relatedQ.data, decision])

  const selectedRelatedIndex = React.useMemo(() => {
    if (!decision || !relatedInstances || relatedInstances.length === 0) return 0
    const idx = relatedInstances.findIndex((d) => d.id === decision.id)
    return idx >= 0 ? idx : 0
  }, [decision, relatedInstances])

  const formatIoValue = React.useCallback((v: any) => {
    if (v === null || v === undefined) return 'null'
    if (typeof v === 'object') {
      try {
        return JSON.stringify(v)
      } catch {
        return String(v)
      }
    }
    try {
      return JSON.stringify(v)
    } catch {
      return String(v)
    }
  }, [])

  // Check if initial data is loading
  const isInitialLoading = histQ.isLoading || xmlQ.isLoading

  return (
    <PageLoader isLoading={isInitialLoading} skeletonType="instance-detail">
    <div className={styles.container}>
      {/* Breadcrumb Bar - shared component (same as InstanceDetail) */}
      <BreadcrumbBar>
        <BreadcrumbItem>
          <a href={toTenantPath('/mission-control')} onClick={(e) => { e.preventDefault(); tenantNavigate('/mission-control'); }}>
            Mission Control
          </a>
        </BreadcrumbItem>
        {fromInstanceId && (
          <BreadcrumbItem>
            <a href={toTenantPath('/mission-control/processes')} onClick={(e) => { e.preventDefault(); tenantNavigate('/mission-control/processes'); }}>
              Processes
            </a>
          </BreadcrumbItem>
        )}
        {fromInstanceId && processLabel && (
          <BreadcrumbItem>
            <a href={toTenantPath('/mission-control/processes')} onClick={(e) => { e.preventDefault(); tenantNavigate('/mission-control/processes'); }}>
              <span>{processLabel}</span>
            </a>
          </BreadcrumbItem>
        )}
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
        {fromInstanceId && (
          <BreadcrumbItem isCurrentPage>
            <span>{id}</span>
          </BreadcrumbItem>
        )}
        {!fromInstanceId && (
          <BreadcrumbItem>
            <a href={toTenantPath('/mission-control/decisions')} onClick={(e) => { e.preventDefault(); tenantNavigate('/mission-control/decisions'); }}>
              Decisions
            </a>
          </BreadcrumbItem>
        )}
        {!fromInstanceId && title && title !== 'Decision' && (
          <BreadcrumbItem>
            <a href={toTenantPath('/mission-control/decisions')} onClick={(e) => { e.preventDefault(); tenantNavigate('/mission-control/decisions'); }}>
              {title}{versionLabel ? ` (${versionLabel})` : ''}
            </a>
          </BreadcrumbItem>
        )}
        {!fromInstanceId && (
          <BreadcrumbItem isCurrentPage>
            <span>{id}</span>
          </BreadcrumbItem>
        )}
      </BreadcrumbBar>
      
      {/* SplitPane wrapper to fill remaining height */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        {/* @ts-expect-error - react-split-pane has type incompatibility with React 19 */}
        <SplitPane
          split="horizontal"
          defaultSize="60%"
          minSize={200}
          maxSize={-150}
          className={styles.splitPane}
          pane1Style={{ overflow: 'hidden' }}
          pane2Style={{ overflow: 'auto' }}
        >
          {/* Top pane - DMN viewer (match main Decisions page layout) */}
          <div
            style={{
              background: 'var(--color-bg-primary)',
              border: '1px solid var(--color-border-primary)',
              position: 'relative',
              overflow: 'hidden',
              height: '100%',
              width: '100%',
            }}
          >
            {xmlQ.isLoading ? (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--color-text-tertiary)',
                  background: 'var(--color-bg-primary)',
                  zIndex: 10,
                }}
              >
                Loading decision table...
              </div>
            ) : xmlQ.isError ? (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--color-error)',
                  background: 'var(--color-bg-primary)',
                  zIndex: 10,
                }}
              >
                <div>Failed to load decision table</div>
                <div style={{ fontSize: 'var(--text-12)', marginTop: 'var(--spacing-1)' }}>{String(xmlQ.error)}</div>
              </div>
            ) : xmlQ.data ? (
              <React.Suspense fallback={<div style={{ padding: 'var(--spacing-4)', color: 'var(--color-text-tertiary)' }}>Loading decision table...</div>}>
                <DMNDrdMini
                  xml={(xmlQ.data as string) || ''}
                  preferDecisionTable
                  decisionId={decision?.decisionDefinitionKey || undefined}
                  decisionName={decision?.decisionDefinitionName || undefined}
                  hitRuleIds={hitRuleIds}
                />
              </React.Suspense>
            ) : (
              <div
                style={{
                  padding: 'var(--spacing-4)',
                  color: 'var(--color-text-tertiary)',
                }}
              >
                No DMN XML available for this decision definition.
              </div>
            )}
          </div>

        {/* Bottom pane - Info bar + Inputs/Outputs and Result tabs */}
        <div
          style={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--color-bg-primary)',
          }}
        >
          {/* Info Bar - blue bar with decision details */}
          <div className={styles.infoBar}>
            <div className={styles.infoBarContent}>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto auto auto auto auto auto auto auto auto', gap: 'var(--spacing-3)', alignItems: 'center', width: '100%' }}>
                {/* Decision Name */}
                <div className={styles.infoBarText}>{title}</div>
                <div className={styles.divider} />
                
                {/* Decision Definition ID - shortened with copy icon */}
                <div className={styles.infoBarTextWithFlex}>
                  <span className={styles.badge}>Decision ID</span>
                  <button
                    className={styles.linkButton}
                    style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}
                    onClick={() => decision?.decisionDefinitionId && navigator.clipboard.writeText(decision.decisionDefinitionId)}
                    title="Click to copy full Decision Definition ID"
                  >
                    {decision?.decisionDefinitionId ? `${decision.decisionDefinitionId.substring(0, 6)}...${decision.decisionDefinitionId.slice(-6)}` : '—'}
                    <Copy size={14} style={{ fill: 'white' }} />
                  </button>
                </div>
                <div className={styles.divider} />
                
                {/* Version */}
                <div className={styles.infoBarText}>
                  <span className={styles.badge}>Ver.</span>
                  {' '}{versionLabel ? versionLabel.replace('v', '') : '—'}
                </div>
                <div className={styles.divider} />
                
                {/* Evaluation Date */}
                <div className={styles.infoBarTextWithFlex}>
                  <span className={styles.badge}>Eval Time</span>
                  {fmt(decision?.evaluationTime || null)}
                </div>
                <div className={styles.divider} />
                
                {/* Process Instance Key - opens in new tab */}
                <div className={styles.infoBarTextWithFlex}>
                  <span className={styles.badge}>Process</span>
                  {decision?.processInstanceId ? (
                    <button
                      className={styles.linkButton}
                      style={{ textDecoration: 'underline', cursor: 'pointer' }}
                      onClick={() => window.open(`/mission-control/processes/instances/${decision.processInstanceId}`, '_blank')}
                    >
                      {decision.processInstanceId}
                    </button>
                  ) : (
                    'None'
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Tabs header */}
          <div
            style={{
              borderBottom: '1px solid var(--color-border-primary)',
              padding: '0 var(--spacing-4)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: 'var(--text-13)',
            }}
          >
            {relatedInstances.length > 1 ? (
              <div style={{ width: '100%', minWidth: 0 }}>
                <Tabs
                  selectedIndex={selectedRelatedIndex}
                  onChange={({ selectedIndex }) => {
                    const next = relatedInstances[selectedIndex]
                    if (next?.id && next.id !== decision?.id) {
                      tenantNavigate(`/mission-control/decisions/instances/${next.id}`)
                    }
                  }}
                >
                  <TabList aria-label="Decisions in this evaluation">
                    {relatedInstances.map((d) => (
                      <Tab key={d.id}>{String(d.decisionDefinitionName || d.decisionDefinitionKey || d.id)}</Tab>
                    ))}
                  </TabList>
                </Tabs>
              </div>
            ) : (
              <div style={{ height: 40 }} />
            )}
          </div>
          <div
            style={{
              flex: 1,
              display: 'flex',
              overflow: 'auto',
              padding: 'var(--spacing-3)',
              paddingTop: 'var(--cds-spacing-06, var(--spacing-5))',
              gap: 'var(--spacing-3)',
            }}
          >
            <Tile style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 'var(--text-14)', fontWeight: 'var(--font-weight-semibold)', marginBottom: 'var(--spacing-2)' }}>
                Inputs
              </div>
              {inputsQ.isLoading ? (
                <div style={{ padding: 'var(--spacing-2)' }}>Loading inputs...</div>
              ) : inputsQ.isError ? (
                <InlineNotification
                  kind="error"
                  title="Failed to load inputs"
                  subtitle={String(inputsQ.error)}
                  lowContrast
                  hideCloseButton
                />
              ) : !inputsQ.data || inputsQ.data.length === 0 ? (
                <div style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--text-12)', padding: 'var(--spacing-2)' }}>
                  No inputs recorded for this decision instance.
                </div>
              ) : (
                <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
                  <DataTable
                    rows={(inputsQ.data || []).map((inp, idx) => ({
                      id: String(inp.id || inp.clauseId || idx),
                      name: String(inp.clauseName || inp.clauseId || inp.id || '-'),
                      type: String(inp.type || '-'),
                      value: formatIoValue(inp.value),
                    }))}
                    headers={[
                      { key: 'name', header: 'Name' },
                      { key: 'type', header: 'Type' },
                      { key: 'value', header: 'Value' },
                    ]}
                  >
                    {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
                      <TableContainer>
                        <Table {...getTableProps()} size="xs">
                          <TableHead>
                            <TableRow>
                              {headers.map((header: any) => {
                                const { key, ...headerProps } = getHeaderProps({ header })
                                return (
                                  <TableHeader key={key} {...headerProps}>
                                    {header.header}
                                  </TableHeader>
                                )
                              })}
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {rows.map((row: any) => {
                              const rowProps = getRowProps({ row })
                              const { key, ...otherRowProps } = rowProps
                              return (
                                <TableRow key={key} {...otherRowProps}>
                                  {row.cells.map((cell: any) => (
                                    <TableCell key={cell.id}>{cell.value}</TableCell>
                                  ))}
                                </TableRow>
                              )
                            })}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    )}
                  </DataTable>
                </div>
              )}
            </Tile>

            <Tile style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 'var(--text-14)', fontWeight: 'var(--font-weight-semibold)', marginBottom: 'var(--spacing-2)' }}>
                Outputs
              </div>
              {outputsQ.isLoading ? (
                <div style={{ padding: 'var(--spacing-2)' }}>Loading outputs...</div>
              ) : outputsQ.isError ? (
                <InlineNotification
                  kind="error"
                  title="Failed to load outputs"
                  subtitle={String(outputsQ.error)}
                  lowContrast
                  hideCloseButton
                />
              ) : !outputsQ.data || outputsQ.data.length === 0 ? (
                <div style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--text-12)', padding: 'var(--spacing-2)' }}>
                  No outputs recorded for this decision instance.
                </div>
              ) : (
                <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
                  <DataTable
                    rows={(outputsQ.data || []).map((out: DecisionIo, idx: number) => ({
                      id: String(out.id || out.clauseId || idx),
                      name: String(out.clauseName || out.clauseId || out.id || '-'),
                      type: String(out.type || '-'),
                      value: formatIoValue(out.value),
                    }))}
                    headers={[
                      { key: 'name', header: 'Name' },
                      { key: 'type', header: 'Type' },
                      { key: 'value', header: 'Value' },
                    ]}
                  >
                    {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
                      <TableContainer>
                        <Table {...getTableProps()} size="xs">
                          <TableHead>
                            <TableRow>
                              {headers.map((header: any) => {
                                const { key, ...headerProps } = getHeaderProps({ header })
                                return (
                                  <TableHeader key={key} {...headerProps}>
                                    {header.header}
                                  </TableHeader>
                                )
                              })}
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {rows.map((row: any) => {
                              const rowProps = getRowProps({ row })
                              const { key, ...otherRowProps } = rowProps
                              return (
                                <TableRow key={key} {...otherRowProps}>
                                  {row.cells.map((cell: any) => (
                                    <TableCell key={cell.id}>{cell.value}</TableCell>
                                  ))}
                                </TableRow>
                              )
                            })}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    )}
                  </DataTable>
                </div>
              )}
            </Tile>
          </div>
        </div>
        </SplitPane>
      </div>
      {drdOpen && xmlQ.data && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.6)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: '80%',
              height: '80%',
              background: 'var(--color-bg-primary)',
              boxShadow: '0 4px 16px rgba(0,0,0,0.45)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                padding: '8px 16px',
                borderBottom: '1px solid var(--color-border-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div
                style={{
                  fontSize: 'var(--text-13)',
                  fontWeight: 'var(--font-weight-semibold)',
                }}
              >
                Decision Requirements Diagram
              </div>
              <Button size="sm" kind="ghost" onClick={() => setDrdOpen(false)}>
                Close
              </Button>
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <React.Suspense fallback={<div style={{ padding: 'var(--spacing-4)', color: 'var(--color-text-tertiary)' }}>Loading diagram...</div>}>
                <DMNDrdMini xml={(xmlQ.data as string) || ''} />
              </React.Suspense>
            </div>
          </div>
        </div>
      )}
    </div>
    </PageLoader>
  )
}

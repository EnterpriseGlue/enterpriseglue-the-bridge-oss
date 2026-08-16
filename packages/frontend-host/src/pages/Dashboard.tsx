import React from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { safeRelativePath, sanitizePathParam } from '../shared/utils/sanitize'
import { useQuery } from '@tanstack/react-query'
import {
  Button,
  ClickableTile,
  Column,
  Dropdown,
  Grid,
  InlineNotification,
  SkeletonPlaceholder,
  StructuredListBody,
  StructuredListCell,
  StructuredListHead,
  StructuredListRow,
  StructuredListWrapper,
  Tile,
} from '@carbon/react'
import { UserAvatar, FolderOpen, Chip, Activity, Checkmark, Time, WarningAlt } from '@carbon/icons-react'
import { useDashboardFilterStore } from '../stores/dashboardFilterStore'
import { apiClient } from '../shared/api/client'
import { EngineSelector, useSelectedEngine } from '../components/EngineSelector'
import { getAccessibleEngines } from '../features/mission-control/engines/api/engines'
import { useAuth } from '../shared/hooks/useAuth'
import { EnginePermission, PlatformPermission } from '../shared/auth/permissions'
import { evaluateActionSnapshot } from '../shared/auth/guards'
import type { DashboardContext, DashboardStats } from '@enterpriseglue/shared/schemas/dashboard.js'
import type { ProcessInstance } from '@enterpriseglue/shared/schemas/mission-control/process.js'
import { PageHeader, PageLayout, PAGE_GRADIENTS } from '../shared/components/PageLayout'

type DashboardBarTone = 'blue' | 'purple' | 'orange' | 'green' | 'red' | 'gray'
type DashboardBarDatum = { label: string; value: number; tone: DashboardBarTone }

function AccessibleBarChart({
  id,
  title,
  data,
  totalLabel,
}: {
  id: string
  title: string
  data: DashboardBarDatum[]
  totalLabel?: string
}) {
  const max = Math.max(...data.map((item) => item.value), 1)
  return (
    <section className="eg-dashboard-chart" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{title}</h2>
      <div className="eg-dashboard-chart__plot" role="list" aria-label={`${title} values`}>
        {data.map((item) => {
          const percentage = (item.value / max) * 100
          return (
            <div key={item.label} className="eg-dashboard-chart__row" role="listitem">
              <div className="eg-dashboard-chart__label">
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
              <div className="eg-dashboard-chart__track" aria-hidden="true">
                <span
                  className={`eg-dashboard-chart__bar eg-dashboard-chart__bar--${item.tone}`}
                  style={{ '--eg-dashboard-bar-size': `${percentage}%` } as React.CSSProperties}
                />
              </div>
            </div>
          )
        })}
      </div>
      {totalLabel ? <p className="eg-dashboard-chart__total">{totalLabel}</p> : null}
      <details className="eg-dashboard-chart__data">
        <summary>View data table</summary>
        <StructuredListWrapper aria-label={`${title} data table`}>
          <StructuredListHead>
            <StructuredListRow head>
              <StructuredListCell head>Category</StructuredListCell>
              <StructuredListCell head>Count</StructuredListCell>
            </StructuredListRow>
          </StructuredListHead>
          <StructuredListBody>
            {data.map((item) => (
              <StructuredListRow key={item.label}>
                <StructuredListCell>{item.label}</StructuredListCell>
                <StructuredListCell>{item.value}</StructuredListCell>
              </StructuredListRow>
            ))}
          </StructuredListBody>
        </StructuredListWrapper>
      </details>
    </section>
  )
}

function DashboardKpi({ label, value, icon: Icon, tone = 'blue' }: {
  label: string
  value: React.ReactNode
  icon: React.ComponentType<{ size?: number; className?: string }>
  tone?: DashboardBarTone
}) {
  return (
    <div className="eg-dashboard-kpi">
      <Icon size={24} className={`eg-dashboard-kpi__icon eg-dashboard-kpi__icon--${tone}`} />
      <span className="eg-dashboard-kpi__label">{label}</span>
      <strong className="eg-dashboard-kpi__value">{value}</strong>
    </div>
  )
}

function DashboardKpiColumn({ children }: { children: React.ReactNode }) {
  return <Column sm={2} md={2} lg={4}>{children}</Column>
}

function DashboardChartColumn({ children }: { children: React.ReactNode }) {
  return <Column sm={4} md={4} lg={5}>{children}</Column>
}

function DashboardSummary({ active, incidents, completed, total }: { active: number; incidents: number; completed: number; total: number }) {
  return (
    <section className="eg-dashboard-summary" aria-labelledby="dashboard-summary-title">
      <h2 id="dashboard-summary-title">Summary</h2>
      <dl>
        <div><dt>Running</dt><dd>{active}</dd></div>
        <div><dt>Incidents</dt><dd>{incidents}</dd></div>
        <div><dt>Completed</dt><dd>{completed}</dd></div>
        <div><dt>Total</dt><dd>{total}</dd></div>
      </dl>
    </section>
  )
}

function DashboardTile({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return onClick ? (
    <ClickableTile className="eg-dashboard-tile" onClick={onClick}>{children}</ClickableTile>
  ) : (
    <Tile className="eg-dashboard-tile">{children}</Tile>
  )
}

function DashboardChartTile({ children }: { children: React.ReactNode }) {
  return <Tile className="eg-dashboard-chart-tile">{children}</Tile>
}

function DashboardLoading() {
  return (
    <PageLayout padding="0">
      <SkeletonPlaceholder className="eg-dashboard-loading" />
    </PageLayout>
  )
}

function DashboardUnauthorized({ reason }: { reason: string }) {
  return (
    <PageLayout padding="0" className="eg-dashboard-page">
      <div className="eg-dashboard-content">
        <InlineNotification kind="warning" title="Dashboard unavailable" subtitle={reason} lowContrast hideCloseButton />
      </div>
    </PageLayout>
  )
}

function DashboardError({ onRetry }: { onRetry: () => void }) {
  return (
    <PageLayout padding="0" className="eg-dashboard-page">
      <PageHeader
        icon={Activity}
        title="Dashboard"
        subtitle="Real-time overview of your platform activity"
        gradient={PAGE_GRADIENTS.blue}
        variant="productive"
      />
      <div className="eg-dashboard-content">
        <div style={{ display: 'grid', gap: 'var(--spacing-3)', justifyItems: 'start' }}>
          <InlineNotification
            kind="error"
            title="Dashboard context could not be loaded"
            subtitle="No dashboard data is shown because its authorization context is unavailable. Try again after checking the platform connection."
            lowContrast
            hideCloseButton
          />
          <Button kind="primary" size="sm" onClick={onRetry}>Retry</Button>
        </div>
      </div>
    </PageLayout>
  )
}

export default function Dashboard() {
  const location = useLocation()
  const navigate = useNavigate()
  const { timePeriod, setTimePeriod } = useDashboardFilterStore()
  const selectedEngineId = useSelectedEngine()
  const { hasPlatformPermission, hasAnyEnginePermission, permissions } = useAuth()
  const dashboardReadDecision = evaluateActionSnapshot(permissions, 'platform.dashboard.read', { type: 'platform', id: null })
  const canReadDashboard = dashboardReadDecision.allowed

  const tenantSlugMatch = location.pathname.match(/^\/t\/([^/]+)(?:\/|$)/)
  const tenantSlug = tenantSlugMatch?.[1] ? sanitizePathParam(decodeURIComponent(tenantSlugMatch[1])) : null
  const tenantPrefix = tenantSlug ? `/t/${encodeURIComponent(tenantSlug)}` : ''
  const toTenantPath = React.useCallback((p: string) => {
    const safe = safeRelativePath(p)
    if (!tenantSlug) return safe
    const combined = `${tenantPrefix}${safe}`
    return safeRelativePath(combined, safe)
  }, [tenantSlug, tenantPrefix])
  const safeNavigate = React.useCallback((path: string, options?: { state?: any; replace?: boolean }) => {
    try {
      const url = new URL(path, window.location.origin)
      if (url.origin !== window.location.origin) return
      navigate(url.pathname + url.search + url.hash, options)
    } catch { /* invalid URL — do not navigate */ }
  }, [navigate])

  const startedAfter = React.useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() - timePeriod)
    return d.toISOString()
  }, [timePeriod])

  // Fetch dashboard context for role-based visibility
  const contextQuery = useQuery({
    queryKey: ['dashboard-context'],
    queryFn: () => apiClient.get<DashboardContext>('/api/dashboard/context'),
    enabled: canReadDashboard,
    staleTime: 60000,
  })
  const ctx = contextQuery.data
  const canViewActiveUsers = Boolean(ctx?.canViewActiveUsers) ||
    hasPlatformPermission(PlatformPermission.USERS_VIEW) ||
    hasPlatformPermission(PlatformPermission.USER_VIEW) ||
    hasPlatformPermission(PlatformPermission.USER_MANAGE)
  const canViewProcessData = Boolean(ctx?.canViewProcessData) ||
    hasAnyEnginePermission([EnginePermission.INSTANCE_VIEW])
  const canViewMetrics = Boolean(ctx?.canViewMetrics) ||
    hasAnyEnginePermission([EnginePermission.INSTANCE_VIEW])
  const selectedEngineHasScopedRuntimeAccess = Boolean(selectedEngineId && ctx?.runtimeScopedEngineIds?.includes(selectedEngineId))

  // Fetch dashboard stats
  const statsQuery = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => apiClient.get<DashboardStats>('/api/dashboard/stats'),
    enabled: canReadDashboard,
  })

  // Fetch engines
  const enginesQuery = useQuery({
    queryKey: ['engines'],
    queryFn: () => getAccessibleEngines(),
    enabled: canReadDashboard,
  })

  // Fetch users
  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => apiClient.get<any[]>('/api/users'),
    enabled: canReadDashboard && canViewActiveUsers,
  })

  // Fetch process instances
  const instancesQuery = useQuery({
    queryKey: ['dashboard-instances', selectedEngineId, timePeriod],
    queryFn: () => apiClient.get<ProcessInstance[]>('/mission-control-api/process-instances', {
      active: true,
      completed: true,
      canceled: true,
      withIncidents: true,
      suspended: true,
      engineId: selectedEngineId || undefined,
      startedAfter: timePeriod ? startedAfter : undefined,
    }),
    enabled: canReadDashboard && !!selectedEngineId && canViewProcessData,
  })

  // Compute stats
  const connectedEngines = enginesQuery.data?.length || 0
  const totalUsers = usersQuery.data?.length || 0
  const instances = instancesQuery.data || []

  const totalProjects = statsQuery.data?.totalProjects || 0
  const showGettingStarted = !statsQuery.isLoading && !enginesQuery.isLoading && !statsQuery.isError && !enginesQuery.isError && (totalProjects === 0 || connectedEngines === 0)

  const instanceStates = React.useMemo(() => ({
    active: instances.filter(i => i.state === 'ACTIVE' && !i.hasIncident).length,
    incidents: instances.filter(i => i.state === 'INCIDENT' || i.hasIncident).length,
    suspended: instances.filter(i => i.state === 'SUSPENDED').length,
    completed: instances.filter(i => i.state === 'COMPLETED').length,
    canceled: instances.filter(i => i.state === 'CANCELED').length,
  }), [instances])

  const metrics = React.useMemo(() => {
    const completedEnded = instances.filter(i => i.state === 'COMPLETED')
    const canceledEnded = instances.filter(i => i.state === 'CANCELED')
    const totalEnded = completedEnded.length + canceledEnded.length

    const completedWithTimes = completedEnded.filter(i => i.startTime && i.endTime)
    const durations = completedWithTimes
      .map((i) => new Date(i.endTime!).getTime() - new Date(i.startTime!).getTime())
      .filter((ms) => Number.isFinite(ms) && ms > 0)
    const avgMs = durations.length > 0
      ? durations.reduce((sum, ms) => sum + ms, 0) / durations.length
      : 0

    const successRate = totalEnded > 0 ? (completedEnded.length / totalEnded) * 100 : 0
    const errorRate = totalEnded > 0 ? (canceledEnded.length / totalEnded) * 100 : 0

    return { avgDurationMs: avgMs, completedCount: durations.length, successRate, errorRate }
  }, [instances])

  // Format duration in appropriate units
  const formatDuration = (ms: number): string => {
    if (ms <= 0) return 'N/A'
    if (ms < 1000) return '<1s'
    const hours = ms / 3600000
    const minutes = ms / 60000
    const seconds = ms / 1000
    if (hours >= 1) return `${hours.toFixed(1)}h`
    if (minutes >= 1) return `${minutes.toFixed(0)}m`
    return `${seconds.toFixed(0)}s`
  }

  if (!canReadDashboard) {
    return <DashboardUnauthorized reason={dashboardReadDecision.reason || 'Missing permission to view dashboard data.'} />
  }

  if (contextQuery.isLoading) {
    return <DashboardLoading />
  }

  if (contextQuery.isError) {
    return <DashboardError onRetry={() => { void contextQuery.refetch() }} />
  }

  const fileTypes = statsQuery.data?.fileTypes || { bpmn: 0, dmn: 0, form: 0 }
  const totalFiles = statsQuery.data?.totalFiles || 0
  const hasFilesToReport = totalFiles > 0
  const fileChartData = ([
    { label: 'BPMN', value: fileTypes.bpmn, tone: 'blue' },
    { label: 'DMN', value: fileTypes.dmn, tone: 'purple' },
    { label: 'Forms', value: fileTypes.form, tone: 'orange' },
  ] satisfies DashboardBarDatum[]).filter((item) => item.value > 0)
  const processStateData: DashboardBarDatum[] = [
    { label: 'Active', value: instanceStates.active, tone: 'green' },
    { label: 'Incidents', value: instanceStates.incidents, tone: 'red' },
    { label: 'Suspended', value: instanceStates.suspended, tone: 'orange' },
    { label: 'Completed', value: instanceStates.completed, tone: 'blue' },
    { label: 'Canceled', value: instanceStates.canceled, tone: 'gray' },
  ]

  return (
    <PageLayout padding="0" className="eg-dashboard-page">
      <PageHeader
        icon={Activity}
        title="Dashboard"
        subtitle="Real-time overview of your platform activity"
        gradient={PAGE_GRADIENTS.blue}
        variant="productive"
      />
      <div className="eg-dashboard-content">
        {statsQuery.isError && (
          <InlineNotification kind="error" title="Project statistics are unavailable" subtitle="Project and file totals could not be loaded. Other available dashboard data is still shown." lowContrast hideCloseButton />
        )}
        {enginesQuery.isError && (
          <InlineNotification kind="error" title="Engine summary is unavailable" subtitle="Connected engine totals could not be loaded. Other available dashboard data is still shown." lowContrast hideCloseButton />
        )}
        {usersQuery.isError && (
          <InlineNotification kind="warning" title="Active user total is unavailable" subtitle="The user directory could not be loaded for this dashboard view." lowContrast hideCloseButton />
        )}
        {instancesQuery.isError && (
          <InlineNotification kind="warning" title="Process metrics are unavailable" subtitle="Process instances could not be loaded for the selected engine and time period." lowContrast hideCloseButton />
        )}
        <div className="eg-dashboard-controls" aria-label="Dashboard filters">
          <EngineSelector size="sm" label="Engine" />
          <Dropdown
            id="time-period"
            label="Time period"
            titleText=""
            size="sm"
            items={[{ id: 7, label: 'Last 7 days' }, { id: 30, label: 'Last 30 days' }, { id: 90, label: 'Last 90 days' }]}
            itemToString={(item: any) => item?.label || ''}
            selectedItem={{ id: timePeriod, label: `Last ${timePeriod} days` }}
            onChange={({ selectedItem }: any) => setTimePeriod(selectedItem?.id || 7)}
          />
        </div>

      {showGettingStarted && (
        <Tile className="eg-dashboard-get-started">
          <div className="eg-dashboard-get-started__content">
            <div>
              <h2>Get started</h2>
              <p>
                Create a project and connect an engine to start deploying and monitoring processes.
              </p>
            </div>
            <div className="eg-dashboard-get-started__actions">
              {totalProjects === 0 && (
                <Button
                  kind="primary"
                  size="sm"
                  onClick={() => safeNavigate(toTenantPath('/starbase'), { state: { openCreateProject: true } })}
                >
                  Create project
                </Button>
              )}
              {connectedEngines === 0 && (
                <Button
                  kind="secondary"
                  size="sm"
                  onClick={() => safeNavigate(toTenantPath('/engines'), { state: { openNewEngine: true } })}
                >
                  Add engine
                </Button>
              )}
              {connectedEngines > 0 && !canViewProcessData && (
                <Button kind="tertiary" size="sm" onClick={() => safeNavigate(toTenantPath('/engines'))}>
                  Request access
                </Button>
              )}
            </div>
          </div>
        </Tile>
      )}

      {selectedEngineHasScopedRuntimeAccess && (
        <InlineNotification
          kind="info"
          lowContrast
          hideCloseButton
          title="Runtime access is scoped"
          subtitle="Process and instance data for this engine is limited to the resources you are authorized to view."
        />
      )}

      <Grid fullWidth narrow className="eg-dashboard-kpi-grid" aria-label="Platform key performance indicators">
        {canViewActiveUsers && (
          <DashboardKpiColumn><DashboardTile onClick={() => safeNavigate(toTenantPath('/admin/users'))}><DashboardKpi label="Active Users" value={totalUsers} icon={UserAvatar} /></DashboardTile></DashboardKpiColumn>
        )}
        <DashboardKpiColumn><DashboardTile onClick={() => safeNavigate(toTenantPath('/starbase'))}><DashboardKpi label="Projects" value={statsQuery.data?.totalProjects || 0} icon={FolderOpen} tone="purple" /></DashboardTile></DashboardKpiColumn>
        <DashboardKpiColumn><DashboardTile onClick={() => safeNavigate(toTenantPath('/engines'))}><DashboardKpi label="Engines" value={connectedEngines} icon={Chip} /></DashboardTile></DashboardKpiColumn>
        {canViewProcessData && (
          <DashboardKpiColumn><DashboardTile onClick={() => safeNavigate(toTenantPath('/mission-control/processes'))}><DashboardKpi label="Instances" value={instances.length} icon={Activity} tone="green" /></DashboardTile></DashboardKpiColumn>
        )}
        {canViewMetrics && (
          <>
            <DashboardKpiColumn><DashboardTile><DashboardKpi label="Avg Duration" value={formatDuration(metrics.avgDurationMs)} icon={Time} /></DashboardTile></DashboardKpiColumn>
            <DashboardKpiColumn><DashboardTile><DashboardKpi label="Success Rate" value={`${metrics.successRate.toFixed(0)}%`} icon={Checkmark} tone={metrics.successRate >= 80 ? 'green' : metrics.successRate >= 50 ? 'orange' : 'red'} /></DashboardTile></DashboardKpiColumn>
            <DashboardKpiColumn><DashboardTile><DashboardKpi label="Failure Rate" value={`${metrics.errorRate.toFixed(1)}%`} icon={WarningAlt} tone={metrics.errorRate > 20 ? 'red' : metrics.errorRate > 10 ? 'orange' : 'green'} /></DashboardTile></DashboardKpiColumn>
          </>
        )}
      </Grid>

      <Grid fullWidth narrow className="eg-dashboard-chart-grid">
        {hasFilesToReport && (
          <DashboardChartColumn><DashboardChartTile><AccessibleBarChart id="file-structure" title="File Structure" data={fileChartData} totalLabel={`Total: ${totalFiles} files`} /></DashboardChartTile></DashboardChartColumn>
        )}
        {canViewProcessData && (
          <DashboardChartColumn><DashboardChartTile><AccessibleBarChart id="process-states" title="Process States" data={processStateData} /></DashboardChartTile></DashboardChartColumn>
        )}
        {canViewMetrics && (
          <DashboardChartColumn><DashboardChartTile><DashboardSummary active={instanceStates.active} incidents={instanceStates.incidents} completed={instanceStates.completed} total={instances.length} /></DashboardChartTile></DashboardChartColumn>
        )}
      </Grid>
      </div>
    </PageLayout>
  )
}

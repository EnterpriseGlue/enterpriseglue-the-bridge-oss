import React from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { safeRelativePath, sanitizePathParam } from '../shared/utils/sanitize'
import { useQuery } from '@tanstack/react-query'
import { Button, ClickableTile, Tile, Dropdown, SkeletonPlaceholder } from '@carbon/react'
import { UserAvatar, FolderOpen, Chip, Activity, Checkmark, Time, WarningAlt } from '@carbon/icons-react'
import { useDashboardFilterStore } from '../stores/dashboardFilterStore'
import { apiClient } from '../shared/api/client'
import { EngineSelector, useSelectedEngine } from '../components/EngineSelector'

type DashboardContext = {
  isPlatformAdmin: boolean
  canViewActiveUsers: boolean
  canViewEngines: boolean
  canViewProcessData: boolean
  canViewDeployments: boolean
  canViewMetrics: boolean
}

type DashboardStatsResponse = {
  totalProjects: number
  totalFiles: number
  fileTypes: { bpmn: number; dmn: number; form: number }
}

type ProcessInstance = {
  id: string
  state: string
  hasIncident?: boolean
  startTime?: string
  endTime?: string
}

// Simple bar component
function SimpleBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div style={{ marginBottom: '0.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '2px' }}>
        <span>{label}</span>
        <span>{value}</span>
      </div>
      <div style={{ height: '8px', background: 'var(--cds-layer-02)', borderRadius: '4px', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: '4px', transition: 'width 0.3s' }} />
      </div>
    </div>
  )
}

export default function Dashboard() {
  const location = useLocation()
  const navigate = useNavigate()
  const { timePeriod, setTimePeriod } = useDashboardFilterStore()
  const selectedEngineId = useSelectedEngine()

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
    staleTime: 60000,
  })
  const ctx = contextQuery.data

  // Fetch dashboard stats
  const statsQuery = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => apiClient.get<DashboardStatsResponse>('/api/dashboard/stats'),
  })

  // Fetch engines
  const enginesQuery = useQuery({
    queryKey: ['engines'],
    queryFn: () => apiClient.get<any[]>('/engines-api/engines').catch(() => []),
  })

  // Fetch users
  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => apiClient.get<any[]>('/api/users').catch(() => []),
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
    }).catch(() => []),
    enabled: !!selectedEngineId,
  })

  // Compute stats
  const connectedEngines = enginesQuery.data?.length || 0
  const totalUsers = usersQuery.data?.length || 0
  const instances = instancesQuery.data || []

  const totalProjects = statsQuery.data?.totalProjects || 0
  const showGettingStarted = !statsQuery.isLoading && !enginesQuery.isLoading && (totalProjects === 0 || connectedEngines === 0)

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

  const tileStyle: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    minHeight: '120px', textAlign: 'center',
  }

  const chartTileStyle: React.CSSProperties = { padding: '1rem', minHeight: '200px' }

  if (contextQuery.isLoading) {
    return <div style={{ padding: '2rem' }}><SkeletonPlaceholder style={{ height: '400px' }} /></div>
  }

  const maxState = Math.max(instanceStates.active, instanceStates.incidents, instanceStates.suspended, instanceStates.completed, instanceStates.canceled, 1)
  const fileTypes = statsQuery.data?.fileTypes || { bpmn: 0, dmn: 0, form: 0 }
  const maxFile = Math.max(fileTypes.bpmn, fileTypes.dmn, fileTypes.form, 1)

  return (
    <div style={{ padding: '2rem', background: 'var(--cds-background)', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 600, color: 'var(--cds-text-primary)' }}>Dashboard</h1>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: 'var(--cds-text-secondary)' }}>
            Real-time overview of your platform activity
          </p>
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end' }}>
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
            style={{ minWidth: '160px' }}
          />
        </div>
      </div>

      {showGettingStarted && (
        <Tile style={{ padding: '1rem', marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 600 }}>Get started</div>
              <div style={{ fontSize: '12px', color: 'var(--cds-text-secondary)', marginTop: '0.25rem' }}>
                Create a project and connect an engine to start deploying and monitoring processes.
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
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
              {connectedEngines > 0 && !ctx?.canViewProcessData && (
                <Button kind="tertiary" size="sm" onClick={() => safeNavigate(toTenantPath('/engines'))}>
                  Request access
                </Button>
              )}
            </div>
          </div>
        </Tile>
      )}

      {/* KPI Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        {ctx?.canViewActiveUsers && (
          <ClickableTile style={tileStyle} onClick={() => safeNavigate(toTenantPath('/admin/users'))}>
            <UserAvatar size={24} style={{ color: 'var(--cds-link-primary)', marginBottom: '0.5rem' }} />
            <span style={{ fontSize: '0.75rem', color: 'var(--cds-text-secondary)' }}>Active Users</span>
            <span style={{ fontSize: '1.75rem', fontWeight: 600 }}>{totalUsers}</span>
          </ClickableTile>
        )}
        <ClickableTile style={tileStyle} onClick={() => safeNavigate(toTenantPath('/starbase'))}>
          <FolderOpen size={24} style={{ color: '#8a3ffc', marginBottom: '0.5rem' }} />
          <span style={{ fontSize: '0.75rem', color: 'var(--cds-text-secondary)' }}>Projects</span>
          <span style={{ fontSize: '1.75rem', fontWeight: 600 }}>{statsQuery.data?.totalProjects || 0}</span>
        </ClickableTile>
        <ClickableTile style={tileStyle} onClick={() => safeNavigate(toTenantPath('/engines'))}>
          <Chip size={24} style={{ color: '#0f62fe', marginBottom: '0.5rem' }} />
          <span style={{ fontSize: '0.75rem', color: 'var(--cds-text-secondary)' }}>Engines</span>
          <span style={{ fontSize: '1.75rem', fontWeight: 600 }}>{connectedEngines}</span>
        </ClickableTile>
        {ctx?.canViewProcessData && (
          <ClickableTile style={tileStyle} onClick={() => safeNavigate(toTenantPath('/mission-control/processes'))}>
            <Activity size={24} style={{ color: '#24a148', marginBottom: '0.5rem' }} />
            <span style={{ fontSize: '0.75rem', color: 'var(--cds-text-secondary)' }}>Instances</span>
            <span style={{ fontSize: '1.75rem', fontWeight: 600 }}>{instances.length}</span>
          </ClickableTile>
        )}
        {ctx?.canViewMetrics && (
          <>
            <Tile style={tileStyle}>
              <Time size={24} style={{ color: '#0f62fe', marginBottom: '0.5rem' }} />
              <span style={{ fontSize: '0.75rem', color: 'var(--cds-text-secondary)' }}>Avg Duration</span>
              <span style={{ fontSize: '1.5rem', fontWeight: 600 }}>{formatDuration(metrics.avgDurationMs)}</span>
            </Tile>
            <Tile style={tileStyle}>
              <Checkmark size={24} style={{ color: '#24a148', marginBottom: '0.5rem' }} />
              <span style={{ fontSize: '0.75rem', color: 'var(--cds-text-secondary)' }}>Success Rate</span>
              <span style={{ fontSize: '1.5rem', fontWeight: 600, color: metrics.successRate >= 80 ? '#24a148' : metrics.successRate >= 50 ? '#f1c21b' : '#da1e28' }}>
                {metrics.successRate.toFixed(0)}%
              </span>
            </Tile>
            <Tile style={tileStyle}>
              <WarningAlt size={24} style={{ color: metrics.errorRate > 20 ? '#da1e28' : '#f1c21b', marginBottom: '0.5rem' }} />
              <span style={{ fontSize: '0.75rem', color: 'var(--cds-text-secondary)' }}>Failure Rate</span>
              <span style={{ fontSize: '1.5rem', fontWeight: 600, color: metrics.errorRate > 20 ? '#da1e28' : metrics.errorRate > 10 ? '#f1c21b' : '#24a148' }}>
                {metrics.errorRate.toFixed(1)}%
              </span>
            </Tile>
          </>
        )}
      </div>

      {/* Charts Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
        {/* File Structure */}
        <Tile style={chartTileStyle}>
          <h4 style={{ margin: '0 0 1rem', fontSize: '0.875rem', fontWeight: 600 }}>File Structure</h4>
          {fileTypes.bpmn > 0 && <SimpleBar label="BPMN" value={fileTypes.bpmn} max={maxFile} color="#0f62fe" />}
          {fileTypes.dmn > 0 && <SimpleBar label="DMN" value={fileTypes.dmn} max={maxFile} color="#8a3ffc" />}
          {fileTypes.form > 0 && <SimpleBar label="Form" value={fileTypes.form} max={maxFile} color="#ff832b" />}
          {fileTypes.bpmn === 0 && fileTypes.dmn === 0 && fileTypes.form === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--cds-text-secondary)', padding: '1rem' }}>No files yet</div>
          )}
          <div style={{ marginTop: '1rem', textAlign: 'center', fontSize: '0.75rem', color: 'var(--cds-text-secondary)' }}>
            Total: {statsQuery.data?.totalFiles || 0} files
          </div>
        </Tile>

        {/* Process States */}
        {ctx?.canViewProcessData && (
          <Tile style={chartTileStyle}>
            <h4 style={{ margin: '0 0 1rem', fontSize: '0.875rem', fontWeight: 600 }}>Process States</h4>
            <SimpleBar label="Active" value={instanceStates.active} max={maxState} color="#24a148" />
            <SimpleBar label="Incidents" value={instanceStates.incidents} max={maxState} color="#da1e28" />
            <SimpleBar label="Suspended" value={instanceStates.suspended} max={maxState} color="#ff832b" />
            <SimpleBar label="Completed" value={instanceStates.completed} max={maxState} color="#697077" />
            <SimpleBar label="Canceled" value={instanceStates.canceled} max={maxState} color="#697077" />
          </Tile>
        )}

        {/* Quick Stats */}
        {ctx?.canViewMetrics && (
          <Tile style={chartTileStyle}>
            <h4 style={{ margin: '0 0 1rem', fontSize: '0.875rem', fontWeight: 600 }}>Summary</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div style={{ textAlign: 'center', padding: '1rem', background: 'var(--cds-layer-02)', borderRadius: '8px' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 600, color: '#24a148' }}>{instanceStates.active}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--cds-text-secondary)' }}>Running</div>
              </div>
              <div style={{ textAlign: 'center', padding: '1rem', background: 'var(--cds-layer-02)', borderRadius: '8px' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 600, color: '#da1e28' }}>{instanceStates.incidents}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--cds-text-secondary)' }}>Incidents</div>
              </div>
              <div style={{ textAlign: 'center', padding: '1rem', background: 'var(--cds-layer-02)', borderRadius: '8px' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>{instanceStates.completed}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--cds-text-secondary)' }}>Completed</div>
              </div>
              <div style={{ textAlign: 'center', padding: '1rem', background: 'var(--cds-layer-02)', borderRadius: '8px' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>{instances.length}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--cds-text-secondary)' }}>Total</div>
              </div>
            </div>
          </Tile>
        )}
      </div>
    </div>
  )
}

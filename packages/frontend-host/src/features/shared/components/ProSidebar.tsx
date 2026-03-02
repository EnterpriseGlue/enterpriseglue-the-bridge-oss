import React from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useLocation } from 'react-router-dom'
import { Sidebar, Menu, MenuItem } from 'react-pro-sidebar'
import {
  DecisionTree,
  DecisionNode,
  BatchJob,
  Reset,
  PlayFilled,
  PauseFilled,
  Checkmark,
  Warning,
  Error as ErrorIcon,
} from '@carbon/icons-react'
import { Dropdown, Checkbox, ComboBox, TextInput, DatePicker, DatePickerInput, TimePicker, Modal, Button, Link } from '@carbon/react'
import { useQuery } from '@tanstack/react-query'
import { useFeatureFlag } from '../../../shared/hooks/useFeatureFlag'
import { useLayoutStore } from '../stores/layoutStore'
import { EngineSelector, useSelectedEngine } from '../../../components/EngineSelector'
import { useDashboardThemeStore } from '../../../stores/dashboardThemeStore'
import { useProcessesFilterStore } from '../../mission-control/shared/stores/processesFilterStore'
import { useDecisionsFilterStore } from '../../mission-control/shared/stores/decisionsFilterStore'
import { useAuth } from '../../../shared/hooks/useAuth'
import { isMultiTenantEnabled } from '../../../enterprise/extensionRegistry'
import { apiClient } from '../../../shared/api/client'
import { STATE_COLORS } from './viewer/viewerConstants'

// Legacy neon colors (no longer applied; sidebar now uses Carbon theme tokens)
const NEON_COLORS = {
  purple: { color: '', glow: '' },
  blue: { color: '', glow: '' },
  green: { color: '', glow: '' },
  red: { color: '', glow: '' },
  teal: { color: '', glow: '' },
}

// Custom Dog Icon Component
const DogIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M18 4l-3 3h-2l-3-3-3 3-3-3v4c0 2.21 1.79 4 4 4h8c2.21 0 4-1.79 4-4V4l-2 2zm-6 6c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm-6 4c-1.66 0-3 1.34-3 3v5h18v-5c0-1.66-1.34-3-3-3H6z"/>
  </svg>
)


export default function ProSidebar() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { sidebarOpen, sidebarCollapsed, setSidebarOpen, setSidebarCollapsed } = useLayoutStore()
  const { futuristicMode } = useDashboardThemeStore()
  const { user } = useAuth()

  const canViewMissionControl = Boolean(user?.capabilities?.canViewMissionControl)
  const canManagePlatformSettings = Boolean(user?.capabilities?.canManagePlatformSettings)
  const isMultiTenant = isMultiTenantEnabled()
  const hideVoyagerForPlatformAdmin = isMultiTenant && canManagePlatformSettings

  const tenantSlugMatch = pathname.match(/^\/t\/([^/]+)(?:\/|$)/)
  const rawTenantSlug = tenantSlugMatch?.[1] ? decodeURIComponent(tenantSlugMatch[1]) : null
  const tenantSlug = rawTenantSlug && /^[a-zA-Z0-9_-]+$/.test(rawTenantSlug) ? rawTenantSlug : null
  const tenantPrefix = tenantSlug ? `/t/${encodeURIComponent(tenantSlug)}` : ''
  const effectivePathname = tenantSlug ? (pathname.replace(/^\/t\/[^/]+/, '') || '/') : pathname
  const toTenantPath = (p: string) => (tenantSlug ? `${tenantPrefix}${p}` : p)

  const isValidTime = (value: string) => {
    if (!value) return true
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
  }

  const formatDate = (d?: Date) => {
    if (!d || isNaN(d.getTime())) return ''
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  }
  
  // Sidebar icons now follow Carbon theme colors; no custom neon styling
  const getNeonIconStyle = (_neonColor: keyof typeof NEON_COLORS) => {
    return {}
  }

  // Ensure sidebar is always "open" (we only use collapsed state now)
  React.useEffect(() => {
    if (!sidebarOpen) {
      setSidebarOpen(true)
    }
  }, [sidebarOpen, setSidebarOpen])

  // Persistent state for expanded submenus
  const [expandedMenus, setExpandedMenus] = React.useState<Record<string, boolean>>(() => {
    const saved = localStorage.getItem('sidebar-expanded-menus')
    return saved ? JSON.parse(saved) : {
      voyager: true,
      missionControl: true,
    }
  })

  // Save to localStorage whenever expandedMenus changes
  React.useEffect(() => {
    localStorage.setItem('sidebar-expanded-menus', JSON.stringify(expandedMenus))
  }, [expandedMenus])

  const toggleMenu = (menuKey: string) => {
    setExpandedMenus(prev => ({ ...prev, [menuKey]: !prev[menuKey] }))
  }

  // Modal state for time filters
  const [processTimeModalOpen, setProcessTimeModalOpen] = React.useState(false)
  const [decisionTimeModalOpen, setDecisionTimeModalOpen] = React.useState(false)

  // Mission Control feature flags
  const isMissionControlEnabled = useFeatureFlag('missionControl')
  const isProcessesEnabled = useFeatureFlag('missionControl.processes')
  const isBatchesEnabled = useFeatureFlag('missionControl.batches')
  const isDecisionsEnabled = useFeatureFlag('missionControl.decisions')

  // Only render sidebar within Mission Control routes
  const inMissionControl = effectivePathname.startsWith('/mission-control')
  const onProcessesPage = effectivePathname.startsWith('/mission-control/processes')
  const onDecisionsPage = effectivePathname.startsWith('/mission-control/decisions')
  const onBatchesPage = effectivePathname.startsWith('/mission-control/batches')
  // Overview pages (filters should only be visible here, not on detail routes)
  const onProcessesOverviewPage = effectivePathname === '/mission-control/processes'
  const onDecisionsOverviewPage = effectivePathname === '/mission-control/decisions'
  const onBatchesOverviewPage = effectivePathname === '/mission-control/batches'

  // Mission Control sidebar should always be expanded (ignore persisted collapsed state)
  const effectiveCollapsed = inMissionControl ? false : sidebarCollapsed

  React.useEffect(() => {
    if (!inMissionControl) return
    if (sidebarCollapsed) setSidebarCollapsed(false)
  }, [inMissionControl, sidebarCollapsed, setSidebarCollapsed])
  
  // Processes filter store
  const {
    selectedProcess, setSelectedProcess,
    selectedVersion, setSelectedVersion,
    flowNode, setFlowNode,
    flowNodes,
    selectedStates, setSelectedStates,
    searchValue, setSearchValue,
    dateFrom, dateTo, timeFrom, timeTo,
    setDateRange, setTimeFrom, setTimeTo,
    reset: resetProcessFilters
  } = useProcessesFilterStore()

  // Decisions filter store
  const {
    selectedDefinition,
    selectedVersion: selectedDecisionVersion,
    selectedStates: decisionSelectedStates,
    searchValue: decisionSearchValue,
    dateFrom: decisionDateFrom,
    dateTo: decisionDateTo,
    timeFrom: decisionTimeFrom,
    timeTo: decisionTimeTo,
    setSelectedDefinition,
    setSelectedVersion: setSelectedDecisionVersion,
    setSelectedStates: setDecisionSelectedStates,
    setSearchValue: setDecisionSearchValue,
    setDateRange: setDecisionDateRange,
    setTimeFrom: setDecisionTimeFrom,
    setTimeTo: setDecisionTimeTo,
    reset: resetDecisionFilters,
  } = useDecisionsFilterStore()

  const selectedEngineId = useSelectedEngine()

  // Fetch process definitions for the dropdown
  const defsQ = useQuery({ 
    queryKey: ['mission-control', 'defs', selectedEngineId], 
    queryFn: async () => {
      const params = selectedEngineId ? `?engineId=${encodeURIComponent(selectedEngineId)}` : ''
      return apiClient.get<Array<{ id: string; key: string; name: string; version: number }>>(
        `/mission-control-api/process-definitions${params}`,
        undefined,
        {
        credentials: 'include',
        }
      )
    },
    enabled: onProcessesPage && !!selectedEngineId
  })

  // Build list of unique processes for dropdown
  const defItems = React.useMemo(() => {
    const d = (defsQ.data || []) as Array<{ id: string; key: string; name: string; version: number }>
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

  // Get available versions for selected process
  const versions = React.useMemo(() => {
    if (!selectedProcess?.key) return []
    const d = (defsQ.data || []).filter((x: any) => x.key === selectedProcess.key).map((x: any) => x.version as number)
    const uniq = Array.from(new Set<number>(d)).sort((a, b) => b - a)
    return uniq
  }, [defsQ.data, selectedProcess?.key])

  // Fetch decision definitions for the Decisions sidebar filters
  const decisionDefsQ = useQuery({
    queryKey: ['mission-control', 'decision-defs', selectedEngineId],
    queryFn: async () => {
      const params = selectedEngineId ? `?engineId=${encodeURIComponent(selectedEngineId)}` : ''
      return apiClient.get<Array<{ id: string; key: string; name?: string | null; version: number }>>(
        `/mission-control-api/decision-definitions${params}`,
        undefined,
        {
          credentials: 'include',
        }
      )
    },
    enabled: onDecisionsPage && !!selectedEngineId,
  })

  // Build list of unique decisions for dropdown
  const decisionDefItems = React.useMemo(() => {
    const d = (decisionDefsQ.data || []) as Array<{ id: string; key: string; name?: string | null; version: number }>
    const byKey = new Map<string, { id: string; label: string; key: string; version: number }>()
    for (const x of d) {
      const label = x.name || x.key
      const existing = byKey.get(x.key)
      if (!existing || x.version > existing.version) {
        byKey.set(x.key, { id: x.id, label, key: x.key, version: x.version })
      }
    }
    return Array.from(byKey.values()).sort((a, b) => a.label.localeCompare(b.label))
  }, [decisionDefsQ.data])

  // Get available versions for selected decision
  const decisionVersions = React.useMemo(() => {
    const currentKey = selectedDefinition?.key
    if (!currentKey) return []
    const d = (decisionDefsQ.data || []).filter((x: any) => x.key === currentKey).map((x: any) => x.version as number)
    const uniq = Array.from(new Set<number>(d)).sort((a, b) => b - a)
    return uniq
  }, [decisionDefsQ.data, selectedDefinition?.key])

  // Status filter options
  const statusOptions = [
    { id: 'active', label: 'Active' },
    { id: 'incidents', label: 'Incidents' },
    { id: 'suspended', label: 'Suspended' },
    { id: 'completed', label: 'Completed' },
    { id: 'canceled', label: 'Canceled' }
  ]

  const handleStatusToggle = (statusId: string) => {
    const status = statusOptions.find(s => s.id === statusId)
    if (!status) return
    const isSelected = selectedStates.some(s => s.id === statusId)
    if (isSelected) {
      setSelectedStates(selectedStates.filter(s => s.id !== statusId))
    } else {
      setSelectedStates([...selectedStates, status])
    }
  }

  const getStatusIcon = (statusId: string) => {
    switch (statusId) {
      case 'active':
        return PlayFilled
      case 'incidents':
        return Warning
      case 'suspended':
        return PauseFilled
      case 'completed':
        return Checkmark
      case 'canceled':
        return ErrorIcon
      default:
        return null
    }
  }

  // Decisions status filter options
  const decisionStatusOptions = [
    { id: 'evaluated', label: 'Evaluated' },
    { id: 'failed', label: 'Failed' },
  ]

  const handleDecisionStatusToggle = (statusId: string) => {
    const status = decisionStatusOptions.find(s => s.id === statusId)
    if (!status) return
    const isSelected = decisionSelectedStates.some(s => s.id === statusId)
    if (isSelected) {
      setDecisionSelectedStates(decisionSelectedStates.filter(s => s.id !== statusId))
    } else {
      setDecisionSelectedStates([...decisionSelectedStates, status])
    }
  }

  const [isResetting, setIsResetting] = React.useState(false)
  const handleReset = () => {
    setIsResetting(true)
    setTimeout(() => setIsResetting(false), 600)
    if (onProcessesPage) {
      resetProcessFilters()
    }
    if (onDecisionsPage) {
      resetDecisionFilters()
    }
  }

  if (!inMissionControl || !isMissionControlEnabled || hideVoyagerForPlatformAdmin || !canViewMissionControl) {
    return null
  }

  return (
    <Sidebar
      collapsed={effectiveCollapsed}
      width="205px"
      collapsedWidth="48px"
      rootStyles={{
        // Sidebar inherits g100 from root Theme - use CSS tokens
        backgroundColor: 'var(--cds-background)',
        borderRight: '1px solid var(--cds-border-subtle-01)',
        height: '100%',
      }}
    >
      <Menu
        transitionDuration={200}
        menuItemStyles={{
          button: ({ level, active, disabled, isSubmenu }) => ({
            color: 'var(--cds-text-primary)',
            // Only show background on leaf items (not submenus)
            backgroundColor: active && !isSubmenu ? 'var(--cds-layer-active)' : 'transparent',
            borderLeft: active 
              ? '4px solid var(--cds-interactive-01)'
              : '4px solid transparent',
            fontSize: '14px',
            fontWeight: level === 0 ? 600 : 400,
            fontFamily: 'IBM Plex Sans, sans-serif',
            letterSpacing: '0.16px',
            paddingLeft: level === 0 ? '12px' : level === 1 ? '28px' : '44px',
            paddingRight: '8px',
            paddingTop: effectiveCollapsed ? '8px' : '12px',
            paddingBottom: effectiveCollapsed ? '8px' : '12px',
            lineHeight: '1.5',
            height: 'auto',
            minHeight: effectiveCollapsed ? '40px' : '48px',
            whiteSpace: 'normal',
            wordBreak: 'break-word',
            '&:hover': {
              backgroundColor: 'var(--cds-layer-hover)',
            },
          }),
          subMenuContent: {
            backgroundColor: 'var(--cds-background) !important',
          },
        }}
        closeOnClick={effectiveCollapsed}
      > 
        {isProcessesEnabled && (
          <MenuItem
            icon={<DecisionTree size={effectiveCollapsed ? 20 : 16} style={getNeonIconStyle('green')} />}
            active={effectivePathname.startsWith('/mission-control/processes')}
            onClick={() => navigate(toTenantPath('/mission-control/processes'))}
            title="Processes"
          >
            Processes
          </MenuItem>
        )}
        {isDecisionsEnabled && (
          <MenuItem
            icon={<DecisionNode size={effectiveCollapsed ? 20 : 16} style={getNeonIconStyle('green')} />}
            active={effectivePathname.startsWith('/mission-control/decisions')}
            onClick={() => navigate(toTenantPath('/mission-control/decisions'))}
            title="Decisions"
          >
            Decisions
          </MenuItem>
        )}
        {isBatchesEnabled && (
          <MenuItem
            icon={<BatchJob size={effectiveCollapsed ? 20 : 16} style={getNeonIconStyle('green')} />}
            active={effectivePathname.startsWith('/mission-control/batches')}
            onClick={() => navigate(toTenantPath('/mission-control/batches'))}
            title="Batches"
          >
            Batches
          </MenuItem>
        )}
      </Menu>

      {/* Divider and Filter Section - only visible on Processes overview page when sidebar is expanded */}
      {onProcessesOverviewPage && !effectiveCollapsed && (
        <>
        {/* Carbon side-nav style divider */}
        <div
          className="cds--side-nav__divider"
          style={{ margin: '12px 12px' }}
        />
        <div style={{ 
          padding: '0 12px 12px 12px',
          backgroundColor: 'var(--cds-background)',
        }}>
          {/* Section header with reset button */}
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between',
            padding: '12px 0 8px 0',
          }}>
            <span style={{ 
              fontSize: '12px', 
              fontWeight: 600, 
              color: 'var(--cds-text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.32px',
            }}>
              Filters
            </span>
            <button
              title="Reset Filters"
              onClick={handleReset}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--cds-text-secondary)',
              }}
            >
              <Reset 
                size={16} 
                style={{ 
                  transform: isResetting ? 'rotate(360deg)' : 'rotate(0deg)',
                  transition: 'transform 0.6s ease-in-out'
                }} 
              />
            </button>
          </div>

          {/* Engine Dropdown */}
          <div style={{ marginBottom: '12px' }}>
            <span style={{ fontSize: '12px', color: 'var(--cds-text-secondary)', display: 'block', marginBottom: '4px' }}>
              Engine
            </span>
            <EngineSelector size="sm" label="" style={{ width: '100%' }} />
          </div>

          {/* Process Dropdown - g10 light variant on dark sidebar */}
          <div style={{ marginBottom: '12px' }}>
            <span style={{ fontSize: '12px', color: 'var(--cds-text-secondary)', display: 'block', marginBottom: '4px' }}>
              Process
            </span>
            <ComboBox
              id="sidebar-process-filter"
              titleText=""
              placeholder="Select process"
              items={defItems}
              selectedItem={selectedProcess}
              itemToString={(item: any) => item?.label || ''}
              onChange={({ selectedItem }: any) => setSelectedProcess(selectedItem || null)}
              size="sm"
              light
            />
          </div>

          {/* Version Dropdown - g10 light variant on dark sidebar */}
          <div style={{ marginBottom: '12px' }}>
            <span style={{ fontSize: '12px', color: 'var(--cds-text-secondary)', display: 'block', marginBottom: '4px' }}>
              Version
            </span>
            <Dropdown
              id="sidebar-version-filter"
              titleText=""
              label="All versions"
              items={['All versions', ...versions]}
              selectedItem={selectedVersion ?? 'All versions'}
              itemToString={(item: any) => String(item)}
              onChange={({ selectedItem }: any) => 
                setSelectedVersion(selectedItem === 'All versions' ? null : selectedItem)
              }
              size="sm"
              disabled={!selectedProcess}
              light
            />
          </div>

          {/* Node Dropdown - g10 light variant on dark sidebar */}
          <div style={{ marginBottom: '12px' }}>
            <span style={{ fontSize: '12px', color: 'var(--cds-text-secondary)', display: 'block', marginBottom: '4px' }}>
              Node
            </span>
            <Dropdown
              id="sidebar-node-filter"
              titleText=""
              label="All nodes"
              items={[{ id: '', name: 'All nodes' }, ...flowNodes]}
              selectedItem={flowNodes.find(n => n.id === flowNode) || { id: '', name: 'All nodes' }}
              itemToString={(item: any) => {
                if (!item || item.id === '') return 'All nodes'
                return item.name || item.type?.replace(/([a-z])([A-Z])/g, '$1 $2') || item.id
              }}
              onChange={({ selectedItem }: any) => setFlowNode(selectedItem?.id || '')}
              size="sm"
              disabled={!selectedProcess || flowNodes.length === 0}
              light
            />
          </div>

          {/* Search Input - g10 light variant on dark sidebar */}
          <div style={{ marginBottom: '12px' }}>
            <span style={{ fontSize: '12px', color: 'var(--cds-text-secondary)', display: 'block', marginBottom: '4px' }}>
              Search
            </span>
            <TextInput
              id="sidebar-search"
              labelText=""
              placeholder="Search..."
              value={searchValue}
              onChange={(e: any) => setSearchValue(e.target.value)}
              size="sm"
              light
            />
          </div>

          {/* Start time range - compact link */}
          <div style={{ marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '12px', color: 'var(--cds-text-secondary)' }}>
                Start time
              </span>
              <Link 
                href="#" 
                size="sm"
                onClick={(e: React.MouseEvent) => {
                  e.preventDefault()
                  setProcessTimeModalOpen(true)
                }}
              >
                {dateFrom || dateTo || timeFrom || timeTo ? 'Edit' : 'Set'}
              </Link>
            </div>
            {(dateFrom || dateTo || timeFrom || timeTo) && (
              <div style={{ fontSize: '11px', color: 'var(--cds-text-secondary)', marginTop: '4px' }}>
                {dateFrom && `From: ${dateFrom} ${timeFrom || '00:00'}`}
                {dateFrom && dateTo && <br />}
                {dateTo && `To: ${dateTo} ${timeTo || '23:59'}`}
              </div>
            )}
          </div>

          {/* Status Checkboxes - stay g100 */}
          <div style={{ marginBottom: '8px' }}>
            <span style={{ 
              fontSize: '12px', 
              fontWeight: 400, 
              color: 'var(--cds-text-secondary)',
              display: 'block',
              marginBottom: '8px',
            }}>
              Status
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {statusOptions.map(status => (
                <Checkbox
                  key={status.id}
                  id={`sidebar-status-${status.id}`}
                  labelText={(() => {
                    const Icon = getStatusIcon(status.id)
                    const color = (STATE_COLORS as any)?.[status.id]?.bg || 'var(--cds-icon-secondary)'
                    return (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        {Icon ? (
                          <span
                            style={{
                              width: 16,
                              height: 16,
                              borderRadius: 9999,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              background: color,
                              flexShrink: 0,
                            }}
                          >
                            <Icon size={status.id === 'active' || status.id === 'completed' ? 14 : 12} style={{ color: '#ffffff' }} />
                          </span>
                        ) : null}
                        <span>{status.label}</span>
                      </span>
                    )
                  })()}
                  checked={selectedStates.some(s => s.id === status.id)}
                  onChange={() => handleStatusToggle(status.id)}
                />
              ))}
            </div>
          </div>
        </div>
        </>
      )}

      {/* Divider and Filter Section - only visible on Decisions overview page when sidebar is expanded */}
      {onDecisionsOverviewPage && !effectiveCollapsed && (
        <>
        {/* Carbon side-nav style divider */}
        <div
          className="cds--side-nav__divider"
          style={{ margin: '12px 12px' }}
        />
        <div style={{ 
          padding: '0 12px 12px 12px',
          backgroundColor: 'var(--cds-background)',
        }}>
          {/* Section header with reset button */}
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between',
            padding: '12px 0 8px 0',
          }}>
            <span style={{ 
              fontSize: '12px', 
              fontWeight: 600, 
              color: 'var(--cds-text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.32px',
            }}>
              Filters
            </span>
            <button
              title="Reset Filters"
              onClick={handleReset}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--cds-text-secondary)',
              }}
            >
              <Reset 
                size={16} 
                style={{ 
                  transform: isResetting ? 'rotate(360deg)' : 'rotate(0deg)',
                  transition: 'transform 0.6s ease-in-out'
                }} 
              />
            </button>
          </div>

          {/* Engine Dropdown */}
          <div style={{ marginBottom: '12px' }}>
            <span style={{ fontSize: '12px', color: 'var(--cds-text-secondary)', display: 'block', marginBottom: '4px' }}>
              Engine
            </span>
            <EngineSelector size="sm" label="" style={{ width: '100%' }} />
          </div>

          {/* Decision Dropdown */}
          <div style={{ marginBottom: '12px' }}>
            <span style={{ fontSize: '12px', color: 'var(--cds-text-secondary)', display: 'block', marginBottom: '4px' }}>
              Decision
            </span>
            <ComboBox
              id="sidebar-decision-filter"
              titleText=""
              placeholder="Select decision"
              items={decisionDefItems}
              selectedItem={selectedDefinition as any}
              itemToString={(item: any) => item?.label || ''}
              onChange={({ selectedItem }: any) => setSelectedDefinition(selectedItem || null)}
              size="sm"
              light
            />
          </div>

          {/* Version Dropdown */}
          <div style={{ marginBottom: '12px' }}>
            <span style={{ fontSize: '12px', color: 'var(--cds-text-secondary)', display: 'block', marginBottom: '4px' }}>
              Version
            </span>
            <Dropdown
              id="sidebar-decision-version-filter"
              titleText=""
              label="All versions"
              items={['All versions', ...decisionVersions]}
              selectedItem={selectedDecisionVersion ?? 'All versions'}
              itemToString={(item: any) => String(item)}
              onChange={({ selectedItem }: any) => 
                setSelectedDecisionVersion(selectedItem === 'All versions' ? null : (selectedItem as number | null))
              }
              size="sm"
              disabled={!selectedDefinition}
              light
            />
          </div>

          {/* Search Input */}
          <div style={{ marginBottom: '12px' }}>
            <span style={{ fontSize: '12px', color: 'var(--cds-text-secondary)', display: 'block', marginBottom: '4px' }}>
              Search
            </span>
            <TextInput
              id="sidebar-decision-search"
              labelText=""
              placeholder="Search..."
              value={decisionSearchValue}
              onChange={(e: any) => setDecisionSearchValue(e.target.value)}
              size="sm"
              light
            />
          </div>

          {/* Evaluation time range - compact link */}
          <div style={{ marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '12px', color: 'var(--cds-text-secondary)' }}>
                Evaluation time
              </span>
              <Link 
                href="#" 
                size="sm"
                onClick={(e: React.MouseEvent) => {
                  e.preventDefault()
                  setDecisionTimeModalOpen(true)
                }}
              >
                {decisionDateFrom || decisionDateTo || decisionTimeFrom || decisionTimeTo ? 'Edit' : 'Set'}
              </Link>
            </div>
            {(decisionDateFrom || decisionDateTo || decisionTimeFrom || decisionTimeTo) && (
              <div style={{ fontSize: '11px', color: 'var(--cds-text-secondary)', marginTop: '4px' }}>
                {decisionDateFrom && `From: ${decisionDateFrom} ${decisionTimeFrom || '00:00'}`}
                {decisionDateFrom && decisionDateTo && <br />}
                {decisionDateTo && `To: ${decisionDateTo} ${decisionTimeTo || '23:59'}`}
              </div>
            )}
          </div>

          {/* Status Checkboxes */}
          <div style={{ marginBottom: '8px' }}>
            <span style={{ 
              fontSize: '12px', 
              fontWeight: 400, 
              color: 'var(--cds-text-secondary)',
              display: 'block',
              marginBottom: '8px',
            }}>
              Status
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {decisionStatusOptions.map(status => (
                <Checkbox
                  key={status.id}
                  id={`sidebar-decision-status-${status.id}`}
                  labelText={status.label}
                  checked={decisionSelectedStates.some(s => s.id === status.id)}
                  onChange={() => handleDecisionStatusToggle(status.id)}
                />
              ))}
            </div>
          </div>
        </div>
        </>
      )}

      {/* Divider and Filter Section - only visible on Batches overview page when sidebar is expanded */}
      {onBatchesOverviewPage && !effectiveCollapsed && (
        <>
        {/* Carbon side-nav style divider */}
        <div
          className="cds--side-nav__divider"
          style={{ margin: '12px 12px' }}
        />
        <div style={{ 
          padding: '0 12px 12px 12px',
          backgroundColor: 'var(--cds-background)',
        }}>
          {/* Section header */}
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between',
            padding: '12px 0 8px 0',
          }}>
            <span style={{ 
              fontSize: '12px', 
              fontWeight: 600, 
              color: 'var(--cds-text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.32px',
            }}>
              Filters
            </span>
          </div>

          {/* Engine Dropdown */}
          <div style={{ marginBottom: '12px' }}>
            <span style={{ fontSize: '12px', color: 'var(--cds-text-secondary)', display: 'block', marginBottom: '4px' }}>
              Engine
            </span>
            <EngineSelector size="sm" label="" style={{ width: '100%' }} />
          </div>
        </div>
        </>
      )}

      {/* Processes Time Filter Modal — portalled to escape react-pro-sidebar z-index:3 stacking context */}
      {createPortal(
      <Modal
        open={processTimeModalOpen}
        onRequestClose={() => setProcessTimeModalOpen(false)}
        onRequestSubmit={() => setProcessTimeModalOpen(false)}
        modalHeading="Filter by Start Time"
        primaryButtonText="Apply"
        secondaryButtonText="Clear"
        onSecondarySubmit={() => {
          setDateRange('', '')
          setTimeFrom('')
          setTimeTo('')
          setProcessTimeModalOpen(false)
        }}
        size="sm"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <DatePicker
            datePickerType="single"
            dateFormat="Y-m-d"
            allowInput
            value={dateFrom || ''}
            onChange={(...args: any[]) => {
              const selectedDates = (args?.[0] || []) as Date[]
              const from = formatDate(selectedDates[0])
              setDateRange(from, dateTo)
            }}
          >
            <DatePickerInput
              id="mc-process-modal-date-from"
              labelText="From date"
              placeholder="yyyy-mm-dd"
              size="md"
            />
          </DatePicker>

          <TimePicker
            id="mc-process-modal-time-from"
            labelText="From time"
            placeholder="hh:mm"
            value={timeFrom}
            onChange={(e: any) => setTimeFrom(e.target.value)}
            size="md"
            maxLength={5}
            pattern="([01]\\d|2[0-3]):[0-5]\\d"
            invalid={!isValidTime(timeFrom)}
            invalidText="Use hh:mm (24h)"
          />

          <DatePicker
            datePickerType="single"
            dateFormat="Y-m-d"
            allowInput
            value={dateTo || ''}
            onChange={(...args: any[]) => {
              const selectedDates = (args?.[0] || []) as Date[]
              const to = formatDate(selectedDates[0])
              setDateRange(dateFrom, to)
            }}
          >
            <DatePickerInput
              id="mc-process-modal-date-to"
              labelText="To date"
              placeholder="yyyy-mm-dd"
              size="md"
            />
          </DatePicker>

          <TimePicker
            id="mc-process-modal-time-to"
            labelText="To time"
            placeholder="hh:mm"
            value={timeTo}
            onChange={(e: any) => setTimeTo(e.target.value)}
            size="md"
            maxLength={5}
            pattern="([01]\\d|2[0-3]):[0-5]\\d"
            invalid={!isValidTime(timeTo)}
            invalidText="Use hh:mm (24h)"
          />
        </div>
      </Modal>,
      document.body
      )}

      {/* Decisions Time Filter Modal — portalled to escape react-pro-sidebar z-index:3 stacking context */}
      {createPortal(
      <Modal
        open={decisionTimeModalOpen}
        onRequestClose={() => setDecisionTimeModalOpen(false)}
        onRequestSubmit={() => setDecisionTimeModalOpen(false)}
        modalHeading="Filter by Evaluation Time"
        primaryButtonText="Apply"
        secondaryButtonText="Clear"
        onSecondarySubmit={() => {
          setDecisionDateRange('', '')
          setDecisionTimeFrom('')
          setDecisionTimeTo('')
          setDecisionTimeModalOpen(false)
        }}
        size="sm"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <DatePicker
            datePickerType="single"
            dateFormat="Y-m-d"
            allowInput
            value={decisionDateFrom || ''}
            onChange={(...args: any[]) => {
              const selectedDates = (args?.[0] || []) as Date[]
              const from = formatDate(selectedDates[0])
              setDecisionDateRange(from, decisionDateTo)
            }}
          >
            <DatePickerInput
              id="mc-decision-modal-date-from"
              labelText="From date"
              placeholder="yyyy-mm-dd"
              size="md"
            />
          </DatePicker>

          <TimePicker
            id="mc-decision-modal-time-from"
            labelText="From time"
            placeholder="hh:mm"
            value={decisionTimeFrom}
            onChange={(e: any) => setDecisionTimeFrom(e.target.value)}
            size="md"
            maxLength={5}
            pattern="([01]\\d|2[0-3]):[0-5]\\d"
            invalid={!isValidTime(decisionTimeFrom)}
            invalidText="Use hh:mm (24h)"
          />

          <DatePicker
            datePickerType="single"
            dateFormat="Y-m-d"
            allowInput
            value={decisionDateTo || ''}
            onChange={(...args: any[]) => {
              const selectedDates = (args?.[0] || []) as Date[]
              const to = formatDate(selectedDates[0])
              setDecisionDateRange(decisionDateFrom, to)
            }}
          >
            <DatePickerInput
              id="mc-decision-modal-date-to"
              labelText="To date"
              placeholder="yyyy-mm-dd"
              size="md"
            />
          </DatePicker>

          <TimePicker
            id="mc-decision-modal-time-to"
            labelText="To time"
            placeholder="hh:mm"
            value={decisionTimeTo}
            onChange={(e: any) => setDecisionTimeTo(e.target.value)}
            size="md"
            maxLength={5}
            pattern="([01]\\d|2[0-3]):[0-5]\\d"
            invalid={!isValidTime(decisionTimeTo)}
            invalidText="Use hh:mm (24h)"
          />
        </div>
      </Modal>,
      document.body
      )}
    </Sidebar>
  )
}

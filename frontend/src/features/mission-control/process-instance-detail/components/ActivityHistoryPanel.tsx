import React from 'react'
import { InlineNotification, Tag } from '@carbon/react'
import { ChevronDown, ChevronRight } from '@carbon/icons-react'

export interface ActivityHistoryPanelProps {
  actQ: { isLoading: boolean; data?: any }
  sortedActs: any[]
  processName?: string
  incidentActivityIds: Set<string>
  execCounts: Map<string, number>
  clickableActivityIds: Set<string>
  selectedActivityId: string | null
  setSelectedActivityId: (id: string | null) => void
  fmt: (ts?: string | null) => string
  isModMode: boolean
  moveSourceActivityId: string | null
  activeActivityIds: Set<string>
  modPlan?: any[]
  onActivityClick?: (activityId: string) => void
  onActivityHover?: (activityId: string | null) => void
  onHistoryContextChange?: (ctx: any | null) => void
  onMoveToHere?: (targetActivityId: string) => void
  execGroups: any[]
  resolveBpmnIconVisual: (id: string, type?: string) => { iconClass: string; kind: string }
  buildHistoryContext: (g: any) => any | null
}

function formatDuration(startTime?: string, endTime?: string) {
  if (!startTime || !endTime) return ''
  const start = new Date(startTime)
  const end = new Date(endTime)
  const diffMs = end.getTime() - start.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 1) return '<1s'
  if (diffSec < 60) return `${diffSec}s`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ${diffSec % 60}s`
  const diffHr = Math.floor(diffMin / 60)
  return `${diffHr}h ${diffMin % 60}m`
}

export function ActivityHistoryPanel({
  actQ,
  sortedActs,
  processName,
  incidentActivityIds,
  execCounts,
  clickableActivityIds,
  selectedActivityId,
  setSelectedActivityId,
  fmt,
  isModMode,
  moveSourceActivityId,
  activeActivityIds,
  modPlan = [],
  onActivityClick,
  onActivityHover,
  onHistoryContextChange,
  onMoveToHere,
  execGroups,
  resolveBpmnIconVisual,
  buildHistoryContext,
}: ActivityHistoryPanelProps) {
  const [historyRootOpen, setHistoryRootOpen] = React.useState(true)
  const [hoveredActivityId, setHoveredActivityId] = React.useState<string | null>(null)
  const lastHistoryContextKeyRef = React.useRef<string>('')

  React.useEffect(() => {
    if (!onHistoryContextChange) return
    const sel = selectedActivityId ? execGroups.find((x) => x.activityId === selectedActivityId) : null
    const nextCtx = sel ? buildHistoryContext(sel) : null
    const nextKey = nextCtx
      ? `${nextCtx.activityId || ''}|${nextCtx.startTime || ''}|${nextCtx.endTime || ''}|${nextCtx.executions || ''}|${nextCtx.statusLabel || ''}`
      : ''

    if (lastHistoryContextKeyRef.current === nextKey) return
    lastHistoryContextKeyRef.current = nextKey
    onHistoryContextChange(nextCtx)
  }, [onHistoryContextChange, selectedActivityId, execGroups, buildHistoryContext])

  const useLegacyTimeline = false

  return (
    <section key="left-panel" style={{ background: 'var(--color-bg-primary)', padding: 'var(--spacing-2)', display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--spacing-2)', marginBottom: 'var(--spacing-2)' }}>
        <h4 style={{ margin: 0, fontSize: 'var(--text-13)', fontWeight: 'var(--font-weight-semibold)' }}>Instance History</h4>
      </div>

      {actQ.isLoading ? <p>Loading...</p> : null}
      {!actQ.isLoading && (sortedActs || []).length === 0 ? (
        <InlineNotification lowContrast kind="info" title="No activity history." />
      ) : null}
      {(sortedActs || []).length > 0 && (
        useLegacyTimeline ? (
          <div
            className="timeline-scroll-container"
            style={{
              overflow: 'auto',
              flex: 1,
              minHeight: 0,
              padding: '8px 0',
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
              scrollBehavior: 'smooth',
              WebkitOverflowScrolling: 'touch',
            }}
          >
            <div style={{ position: 'relative', paddingLeft: '32px' }}>
              <div style={{
                position: 'absolute',
                left: '10px',
                top: 0,
                bottom: 0,
                width: '3px',
                background: 'var(--cds-text-primary)',
              }} />

              {(sortedActs || []).map((a: any) => {
                const active = !a.endTime
                const hasIncident = a.activityId && incidentActivityIds.has(a.activityId)
                const iconBgColor = hasIncident ? 'var(--cds-support-error)' : active ? 'var(--cds-support-success)' : 'var(--cds-icon-secondary)'
                const totalExecCount = execCounts.get(a.activityId) || 1
                const isClickable = a.activityId && clickableActivityIds.has(a.activityId)
                const isSelected = selectedActivityId === a.activityId

                return (
                  <div
                    key={a.id}
                    style={{ position: 'relative', marginBottom: '16px' }}
                    onClick={() => {
                      if (isClickable && a.activityId) {
                        setSelectedActivityId(a.activityId)
                        if (onActivityClick) {
                          onActivityClick(a.activityId)
                        }
                      }
                    }}
                  >
                    <div style={{
                      position: 'absolute',
                      left: '-28px',
                      top: '4px',
                      width: '20px',
                      height: '20px',
                      borderRadius: '50%',
                      background: iconBgColor,
                      border: '3px solid var(--cds-layer-01)',
                      boxShadow: isSelected ? '0 0 0 2px var(--cds-interactive-01)' : '0 0 0 1px var(--cds-text-primary)',
                    }} />

                    <div style={{ fontSize: '12px', color: 'var(--cds-text-secondary)', marginBottom: '4px' }}>
                      {a.startTime ? fmt(a.startTime) : ''}
                    </div>

                    <div style={{
                      background: 'var(--cds-layer-01)',
                      border: isSelected ? '2px solid var(--cds-interactive-01)' : '1px solid var(--cds-border-subtle-01)',
                      borderRadius: '4px',
                      padding: '8px 12px',
                      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
                      cursor: isClickable ? 'pointer' : 'default',
                      transition: 'all 0.2s ease',
                      position: 'relative',
                    }}
                    onMouseEnter={(e) => {
                      if (isClickable) {
                        e.currentTarget.style.boxShadow = '0 2px 6px rgba(0, 0, 0, 0.15)'
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.1)'
                    }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--cds-text-primary)' }}>
                          {a.activityName || a.activityId || a.activityType}
                        </div>
                        {totalExecCount > 1 && (
                          <span style={{
                            background: 'var(--cds-layer-02)',
                            color: 'var(--cds-text-secondary)',
                            padding: '1px 6px',
                            borderRadius: '10px',
                            fontSize: '11px',
                            fontWeight: 600,
                          }}>
                            ×{totalExecCount}
                          </span>
                        )}
                      </div>

                      <div style={{ fontSize: '11px', color: 'var(--cds-text-secondary)', marginBottom: '4px' }}>
                        {a.activityType}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px' }}>
                        <span style={{
                          background: active ? 'var(--cds-layer-selected-01)' : hasIncident ? 'var(--cds-layer-selected-01)' : 'var(--cds-layer-01)',
                          color: active ? 'var(--cds-interactive-01)' : hasIncident ? 'var(--cds-support-error)' : 'var(--cds-text-secondary)',
                          padding: '2px 6px',
                          borderRadius: '3px',
                          fontWeight: 600,
                        }}>
                          {hasIncident ? 'INCIDENT' : active ? 'ACTIVE' : 'COMPLETED'}
                        </span>
                        {a.endTime && (
                          <span style={{ color: 'var(--cds-text-secondary)' }}>
                            {formatDuration(a.startTime, a.endTime)}
                          </span>
                        )}
                      </div>

                      {isModMode && isClickable && (
                        <div style={{
                          position: 'absolute',
                          top: '8px',
                          right: '8px',
                          background: moveSourceActivityId === a.activityId ? 'var(--cds-interactive-01)' : 'transparent',
                          color: moveSourceActivityId === a.activityId ? 'var(--cds-text-on-color)' : 'var(--cds-interactive-01)',
                          border: '1px solid var(--cds-interactive-01)',
                          padding: '2px 6px',
                          borderRadius: '3px',
                          fontSize: '10px',
                          fontWeight: 600,
                        }}>
                          {moveSourceActivityId === a.activityId ? 'SOURCE' : 'SELECTABLE'}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <div style={{ overflow: 'auto', flex: 1, minHeight: 0, paddingTop: 'var(--spacing-1)' }}>
            <button
              type="button"
              onClick={() => setHistoryRootOpen((v) => !v)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--spacing-2)',
                padding: '6px 8px',
                border: 'none',
                background: 'transparent',
                color: 'var(--cds-text-primary)',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              {historyRootOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <span
                style={{
                  width: 18,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--cds-icon-secondary)',
                  flexShrink: 0,
                }}
              >
                <span className="bpmn-icon-process" style={{ fontSize: 14, lineHeight: 1 }} aria-hidden="true" />
              </span>
              <span style={{ fontSize: 'var(--text-12)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {processName || 'Process'}
              </span>
            </button>

            {historyRootOpen ? (
              <div style={{ display: 'grid', gap: 2 }}>
                {execGroups.map((g) => {
                  const icon = resolveBpmnIconVisual(g.activityId, g.activityType)
                  const statusColor = g.hasIncident
                    ? 'var(--cds-support-error)'
                    : g.active
                      ? 'var(--cds-support-success)'
                      : 'var(--cds-icon-secondary)'

                  const rowBg = g.isSelected
                    ? 'var(--cds-layer-selected-01)'
                    : hoveredActivityId === g.activityId
                      ? 'var(--cds-layer-hover-01)'
                      : 'transparent'

                  return (
                    <div key={g.activityId} style={{ paddingLeft: 18 }}>
                      <div
                        onMouseEnter={() => {
                          setHoveredActivityId(g.activityId)
                          if (onActivityHover) onActivityHover(g.activityId)
                        }}
                        onMouseLeave={() => {
                          setHoveredActivityId((prev) => (prev === g.activityId ? null : prev))
                          if (onActivityHover) onActivityHover(null)
                        }}
                        onFocus={() => {
                          setHoveredActivityId(g.activityId)
                          if (onActivityHover) onActivityHover(g.activityId)
                        }}
                        onBlur={() => {
                          setHoveredActivityId((prev) => (prev === g.activityId ? null : prev))
                          if (onActivityHover) onActivityHover(null)
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 'var(--spacing-2)',
                          borderRadius: 2,
                          padding: '6px 8px',
                          background: rowBg,
                          borderLeft: g.isSelected ? '2px solid var(--cds-interactive-01)' : '2px solid transparent',
                        }}
                      >
                        <span style={{ width: 16, display: 'inline-flex', flexShrink: 0 }} />

                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 999,
                            background: statusColor,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        />

                        <span
                          style={{
                            width: 18,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'var(--cds-icon-secondary)',
                            flexShrink: 0,
                          }}
                        >
                          <span
                            className={icon.iconClass}
                            style={{ fontSize: icon.kind === 'marker' ? 14 : 16, lineHeight: 1 }}
                            aria-hidden="true"
                          />
                        </span>

                        <button
                          type="button"
                          disabled={!g.isClickable}
                          onClick={() => {
                            if (g.isClickable) {
                              setSelectedActivityId(g.activityId)
                              if (onActivityClick) onActivityClick(g.activityId)
                              if (onHistoryContextChange) onHistoryContextChange(buildHistoryContext(g))
                            }
                          }}
                          style={{
                            border: 'none',
                            background: 'transparent',
                            padding: 0,
                            cursor: g.isClickable ? 'pointer' : 'default',
                            color: 'var(--cds-text-primary)',
                            textAlign: 'left',
                            minWidth: 0,
                            flex: 1,
                            fontSize: 'var(--text-12)',
                            fontWeight: g.isSelected ? 600 : 400,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {g.activityName}
                        </button>

                        {isModMode && g.isClickable ? (() => {
                          const isSource = moveSourceActivityId === g.activityId
                          const isPlannedSource = modPlan.some((op: any) => op.kind === 'move' && op.fromActivityId === g.activityId)
                          const isPlannedTarget = modPlan.some((op: any) => op.kind === 'move' && op.toActivityId === g.activityId)
                          const tagType = isSource ? 'blue' : isPlannedSource ? 'red' : isPlannedTarget ? 'green' : g.isSelected ? 'green' : 'cool-gray'
                          const tagLabel = isSource ? 'SOURCE' : isPlannedSource ? 'SOURCE' : isPlannedTarget ? 'TARGET' : g.isSelected ? 'SELECTED' : 'SELECTABLE'
                          return (
                            <Tag size="sm" type={tagType} style={{ marginLeft: 'auto', flexShrink: 0 }}>
                              {tagLabel}
                            </Tag>
                          )
                        })() : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : null}
          </div>
        )
      )}
    </section>
  )
}

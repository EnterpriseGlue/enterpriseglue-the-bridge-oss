import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { InlineNotification, Modal, OverflowMenu, OverflowMenuItem, Toggle } from '@carbon/react'
import { ChevronDown, ChevronRight } from '@carbon/icons-react'
import type { ExecutionTrailGroup, ExecutionTrailInstance } from './activityDetailUtils'
import { formatDurationMs } from './activityDetailUtils'
import { getProcessInstanceExecutionDetails } from '../api/processInstances'
import type { ExecutionDetails, HistoricDecisionInstanceLite, HistoricTaskInstanceLite, HistoricVariableInstanceLite, UserOperationLogEntryLite } from './types'

export interface ExecutionTrailPanelProps {
  instanceId: string
  engineId?: string
  actQ: { isLoading: boolean; data?: any }
  sortedActs: any[]
  processName?: string
  selectedActivityId: string | null
  setSelectedActivityId: (id: string | null) => void
  selectedActivityInstanceId: string | null
  setSelectedActivityInstanceId: (id: string | null) => void
  fmt: (ts?: string | null) => string
  isModMode: boolean
  moveSourceActivityId: string | null
  showTokenPassCounts: boolean
  setShowTokenPassCounts: (show: boolean) => void
  modPlan?: any[]
  onActivityClick?: (activityId: string) => void
  onActivityHover?: (activityId: string | null) => void
  onHistoryContextChange?: (ctx: any | null) => void
  execGroups: ExecutionTrailGroup[]
  resolveBpmnIconVisual: (id: string, type?: string) => { iconClass: string; kind: string }
  resolveBpmnLoopMarkerVisual: (id: string) => { iconClass: string; label: string } | null
  buildHistoryContext: (g: any) => any | null
  onNavigateToProcessInstance?: (instanceId: string) => void
}

function findExecutionById(groups: ExecutionTrailGroup[], activityInstanceId: string | null): ExecutionTrailInstance | null {
  if (!activityInstanceId) return null
  for (const group of groups) {
    for (const instance of group.instances) {
      if (instance.activityInstanceId === activityInstanceId) return instance
      const nested = findExecutionById(instance.children, activityInstanceId)
      if (nested) return nested
    }
  }
  return null
}

function findGroupByActivityId(groups: ExecutionTrailGroup[], activityId: string | null): ExecutionTrailGroup | null {
  if (!activityId) return null
  for (const group of groups) {
    if (group.activityId === activityId) return group
    for (const instance of group.instances) {
      const nested = findGroupByActivityId(instance.children, activityId)
      if (nested) return nested
    }
  }
  return null
}

function ExecutionDetailItem({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: '10px', lineHeight: 1.1, color: 'var(--color-text-tertiary)', marginBottom: '2px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
      <div style={{ fontSize: 'var(--text-13)', lineHeight: 1.3, color: 'var(--cds-text-primary)', wordBreak: 'break-word' }}>
        {children}
      </div>
    </div>
  )
}

function getExecutionStatusLabel(execution: ExecutionTrailInstance | null) {
  if (!execution) return '—'
  if (!execution.endTime) return 'Active'
  return 'Completed'
}

function formatExecutionValuePreview(value: any) {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function ExecutionTrailPanel({
  instanceId,
  engineId,
  actQ,
  sortedActs,
  processName,
  selectedActivityId,
  setSelectedActivityId,
  selectedActivityInstanceId,
  setSelectedActivityInstanceId,
  fmt,
  isModMode,
  moveSourceActivityId,
  showTokenPassCounts,
  setShowTokenPassCounts,
  modPlan = [],
  onActivityClick,
  onActivityHover,
  onHistoryContextChange,
  execGroups,
  resolveBpmnIconVisual,
  resolveBpmnLoopMarkerVisual,
  buildHistoryContext,
  onNavigateToProcessInstance,
}: ExecutionTrailPanelProps) {
  const [hoveredRowKey, setHoveredRowKey] = React.useState<string | null>(null)
  const [openGroupKeys, setOpenGroupKeys] = React.useState<Record<string, boolean>>({})
  const [openExecutionKeys, setOpenExecutionKeys] = React.useState<Record<string, boolean>>({})
  const [detailsExecution, setDetailsExecution] = React.useState<ExecutionTrailInstance | null>(null)
  const lastHistoryContextKeyRef = React.useRef<string>('')
  const tokenPassToggleId = React.useId()

  const executionDetailsQ = useQuery<ExecutionDetails>({
    queryKey: [
      'mission-control',
      'execution-details',
      instanceId,
      engineId,
      detailsExecution?.activityInstanceId || '',
      detailsExecution?.executionId || '',
      detailsExecution?.taskId || '',
    ],
    queryFn: () => getProcessInstanceExecutionDetails(instanceId, {
      activityInstanceId: detailsExecution!.activityInstanceId,
      executionId: detailsExecution?.executionId || null,
      taskId: detailsExecution?.taskId || null,
    }, engineId),
    enabled: !!detailsExecution && !!instanceId,
    staleTime: 30000,
  })

  React.useEffect(() => {
    const selectedExecution = findExecutionById(execGroups, selectedActivityInstanceId)
    if (selectedActivityInstanceId && !selectedExecution) {
      setSelectedActivityInstanceId(null)
    }
  }, [execGroups, selectedActivityInstanceId, setSelectedActivityInstanceId])

  React.useEffect(() => {
    const selectedExecution = findExecutionById(execGroups, selectedActivityInstanceId)
    if (selectedExecution && selectedExecution.activityId !== selectedActivityId) {
      setSelectedActivityInstanceId(null)
    }
  }, [execGroups, selectedActivityId, selectedActivityInstanceId, setSelectedActivityInstanceId])

  React.useEffect(() => {
    if (!onHistoryContextChange) return
    const selectedExecution = findExecutionById(execGroups, selectedActivityInstanceId)
    const selectedGroup = selectedExecution ? null : findGroupByActivityId(execGroups, selectedActivityId)
    const source = selectedExecution || selectedGroup
    const nextCtx = source ? buildHistoryContext(source) : null
    const nextKey = nextCtx
      ? `${nextCtx.activityId || ''}|${nextCtx.activityInstanceId || ''}|${nextCtx.startTime || ''}|${nextCtx.endTime || ''}|${nextCtx.executions || ''}|${nextCtx.statusLabel || ''}`
      : ''

    if (lastHistoryContextKeyRef.current === nextKey) return
    lastHistoryContextKeyRef.current = nextKey
    onHistoryContextChange(nextCtx)
  }, [onHistoryContextChange, selectedActivityId, selectedActivityInstanceId, execGroups, buildHistoryContext])

  const toggleGroup = React.useCallback((groupKey: string) => {
    setOpenGroupKeys((current) => ({ ...current, [groupKey]: !current[groupKey] }))
  }, [])

  const toggleExecution = React.useCallback((activityInstanceId: string) => {
    setOpenExecutionKeys((current) => ({ ...current, [activityInstanceId]: !current[activityInstanceId] }))
  }, [])

  const copyText = React.useCallback(async (value?: string | null) => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
    } catch {}
  }, [])

  const selectGroup = React.useCallback((group: ExecutionTrailGroup) => {
    if (!group.isClickable) return
    setSelectedActivityInstanceId(null)
    setSelectedActivityId(group.activityId)
    if (onActivityClick) onActivityClick(group.activityId)
  }, [onActivityClick, setSelectedActivityId, setSelectedActivityInstanceId])

  const selectExecution = React.useCallback((instance: ExecutionTrailInstance) => {
    if (!instance.isClickable) return
    setSelectedActivityInstanceId(instance.activityInstanceId)
    setSelectedActivityId(instance.activityId)
    if (onActivityClick) onActivityClick(instance.activityId)
  }, [onActivityClick, setSelectedActivityId, setSelectedActivityInstanceId])

  const openExecutionDetails = React.useCallback((instance: ExecutionTrailInstance) => {
    selectExecution(instance)
    setDetailsExecution(instance)
  }, [selectExecution])

  const setHoverActivity = React.useCallback((activityId: string | null, rowKey: string | null) => {
    setHoveredRowKey(rowKey)
    if (onActivityHover) onActivityHover(activityId)
  }, [onActivityHover])

  const renderActivityTitle = React.useCallback((activityName: string, activityId: string, isSelected: boolean) => {
    const loopMarker = resolveBpmnLoopMarkerVisual(activityId)
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0 }}>
        <span style={{ fontSize: '13px', lineHeight: 1.2, fontWeight: isSelected ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {activityName}
        </span>
        {loopMarker ? (
          <span
            className={loopMarker.iconClass}
            style={{ fontSize: 11, lineHeight: 1, color: 'var(--cds-icon-secondary)', flexShrink: 0 }}
            aria-label={loopMarker.label}
            title={loopMarker.label}
          />
        ) : null}
      </div>
    )
  }, [resolveBpmnLoopMarkerVisual])

  const getRowIndicatorColor = React.useCallback((hasIncident: boolean, active: boolean) => {
    if (hasIncident) return 'var(--cds-support-error)'
    if (active) return 'var(--cds-support-success)'
    return 'var(--cds-icon-secondary)'
  }, [])

  const renderExecutionRows = React.useCallback((groups: ExecutionTrailGroup[]): React.ReactNode => {
    return groups.map((group) => {
      const shouldRenderGroupShell = group.totalExecCount > 1 || group.hasNestedChildren
      if (!shouldRenderGroupShell && group.instances[0]) {
        const instance = group.instances[0]
        const executionRowKey = `execution:${instance.activityInstanceId}`
        const executionHasChildren = instance.children.length > 0
        const executionIsExpanded = !!openExecutionKeys[instance.activityInstanceId]
        const executionIsSelected = selectedActivityInstanceId === instance.activityInstanceId || (!selectedActivityInstanceId && selectedActivityId === instance.activityId)
        const executionRowBg = executionIsSelected
          ? 'var(--cds-layer-selected-01)'
          : hoveredRowKey === executionRowKey
            ? 'var(--cds-layer-hover-01)'
            : 'transparent'
        const executionIcon = resolveBpmnIconVisual(instance.activityId, instance.activityType)

        return (
          <div key={instance.activityInstanceId} style={{ display: 'grid', gap: 0 }}>
            <div
              onMouseEnter={() => setHoverActivity(instance.activityId, executionRowKey)}
              onMouseLeave={() => setHoverActivity(null, null)}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0,1fr) 8rem 2.5rem',
                alignItems: 'center',
                gap: '4px',
                minHeight: 38,
                padding: '0 var(--spacing-1)',
                background: executionRowBg,
                borderLeft: executionIsSelected ? '2px solid var(--cds-interactive)' : '2px solid transparent',
                borderBottom: '1px solid var(--cds-border-subtle)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, paddingLeft: `${group.depth * 14}px` }}>
                {executionHasChildren ? (
                  <button
                    type="button"
                    onClick={() => toggleExecution(instance.activityInstanceId)}
                    aria-label={executionIsExpanded ? `Collapse nested trail for ${instance.activityName}` : `Expand nested trail for ${instance.activityName}`}
                    style={{ border: 'none', background: 'transparent', padding: 0, width: 16, height: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--cds-icon-primary)' }}
                  >
                    {executionIsExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>
                ) : (
                  <span style={{ width: 12, height: 16, display: 'inline-flex', flexShrink: 0 }} />
                )}

                <span style={{ width: 8, height: 8, borderRadius: 999, background: getRowIndicatorColor(instance.hasIncident, instance.active), display: 'inline-flex', flexShrink: 0 }} />

                <span style={{ width: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--cds-icon-secondary)', flexShrink: 0 }}>
                  <span className={executionIcon.iconClass} style={{ fontSize: executionIcon.kind === 'marker' ? 14 : 16, lineHeight: 1 }} aria-hidden="true" />
                </span>

                <button
                  type="button"
                  disabled={!instance.isClickable}
                  onClick={() => selectExecution(instance)}
                  style={{ border: 'none', background: 'transparent', padding: 0, minWidth: 0, flex: 1, textAlign: 'left', cursor: instance.isClickable ? 'pointer' : 'default', color: 'var(--cds-text-primary)' }}
                >
                  {renderActivityTitle(instance.activityName, instance.activityId, executionIsSelected)}
                </button>
              </div>

              <div style={{ fontSize: 'var(--text-12)', color: 'var(--cds-text-primary)', whiteSpace: 'nowrap', justifySelf: 'end', textAlign: 'right' }}>
                {formatDurationMs(instance.durationMs, instance.startTime, instance.endTime) || '—'}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                {!isModMode ? (
                  <OverflowMenu size="sm" flipped ariaLabel={`Actions for ${instance.activityName}`} iconDescription="" wrapperClasses="eg-no-tooltip">
                    <OverflowMenuItem itemText="Details" onClick={() => openExecutionDetails(instance)} />
                    <OverflowMenuItem itemText="Copy activity instance ID" onClick={() => copyText(instance.activityInstanceId)} />
                    {instance.executionId ? <OverflowMenuItem itemText="Copy execution ID" onClick={() => copyText(instance.executionId)} /> : null}
                    {instance.calledProcessInstanceId ? (
                      <OverflowMenuItem
                        itemText="Open called process instance"
                        onClick={() => {
                          if (onNavigateToProcessInstance) onNavigateToProcessInstance(instance.calledProcessInstanceId as string)
                        }}
                      />
                    ) : null}
                  </OverflowMenu>
                ) : null}
              </div>
            </div>

            {executionHasChildren && executionIsExpanded ? renderExecutionRows(instance.children) : null}
          </div>
        )
      }

      const groupIsExpanded = !!openGroupKeys[group.groupKey]
      const groupRowKey = `group:${group.groupKey}`
      const groupIcon = resolveBpmnIconVisual(group.activityId, group.activityType)
      const groupIsSelected = !selectedActivityInstanceId && selectedActivityId === group.activityId
      const groupRowBg = groupIsSelected
        ? 'var(--cds-layer-selected-01)'
        : hoveredRowKey === groupRowKey
          ? 'var(--cds-layer-hover-01)'
          : 'transparent'
      const groupDuration = group.totalExecCount === 1
        ? formatDurationMs(group._summary.durationMs, group.instances[0]?.startTime, group.instances[0]?.endTime)
        : ''

      return (
        <div key={group.groupKey} style={{ display: 'grid', gap: 0 }}>
          <div
            onMouseEnter={() => setHoverActivity(group.activityId, groupRowKey)}
            onMouseLeave={() => setHoverActivity(null, null)}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0,1fr) 8rem 2.5rem',
              alignItems: 'center',
              gap: 'var(--spacing-1)',
              minHeight: 40,
              padding: '0 var(--spacing-2)',
              background: groupRowBg,
              borderLeft: groupIsSelected ? '2px solid var(--cds-interactive)' : '2px solid transparent',
              borderBottom: '1px solid var(--cds-border-subtle)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-1)', minWidth: 0, paddingLeft: `${group.depth * 16}px` }}>
              {group.isExpandable ? (
                <button
                  type="button"
                  onClick={() => toggleGroup(group.groupKey)}
                  aria-label={groupIsExpanded ? `Collapse ${group.activityName}` : `Expand ${group.activityName}`}
                  style={{ border: 'none', background: 'transparent', padding: 0, width: 16, height: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--cds-icon-primary)' }}
                >
                  {groupIsExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
              ) : (
                <span style={{ width: 12, height: 16, display: 'inline-flex', flexShrink: 0 }} />
              )}

              <span style={{ width: 8, height: 8, borderRadius: 999, background: getRowIndicatorColor(group.hasIncident, group.active), display: 'inline-flex', flexShrink: 0 }} />

              <span style={{ width: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--cds-icon-secondary)', flexShrink: 0 }}>
                <span className={groupIcon.iconClass} style={{ fontSize: groupIcon.kind === 'marker' ? 14 : 16, lineHeight: 1 }} aria-hidden="true" />
              </span>

              <button
                type="button"
                disabled={!group.isClickable}
                onClick={() => selectGroup(group)}
                style={{ border: 'none', background: 'transparent', padding: 0, minWidth: 0, flex: 1, textAlign: 'left', cursor: group.isClickable ? 'pointer' : 'default', color: 'var(--cds-text-primary)' }}
              >
                {renderActivityTitle(group.activityName, group.activityId, groupIsSelected)}
              </button>
            </div>

            <div style={{ fontSize: 'var(--text-12)', color: 'var(--cds-text-primary)', whiteSpace: 'nowrap', justifySelf: 'end', textAlign: 'right' }}>
              {groupDuration || '—'}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              {isModMode && group.isClickable ? (
                <span style={{ fontSize: 'var(--text-10)', color: 'var(--cds-text-secondary)', whiteSpace: 'nowrap' }}>
                  {moveSourceActivityId === group.activityId
                    ? 'Source'
                    : modPlan.some((op: any) => op.kind === 'move' && op.fromActivityId === group.activityId)
                      ? 'Planned source'
                      : modPlan.some((op: any) => op.kind === 'move' && op.toActivityId === group.activityId)
                        ? 'Planned target'
                        : groupIsSelected
                          ? 'Selected'
                          : ''}
                </span>
              ) : null}
            </div>
          </div>

          {groupIsExpanded ? group.instances.map((instance: ExecutionTrailInstance) => {
            const executionRowKey = `execution:${instance.activityInstanceId}`
            const executionHasChildren = instance.children.length > 0
            const executionIsExpanded = !!openExecutionKeys[instance.activityInstanceId]
            const executionIsSelected = selectedActivityInstanceId === instance.activityInstanceId
            const executionRowBg = executionIsSelected
              ? 'var(--cds-layer-selected-01)'
              : hoveredRowKey === executionRowKey
                ? 'var(--cds-layer-hover-01)'
                : 'transparent'
            const executionIcon = resolveBpmnIconVisual(instance.activityId, instance.activityType)

            return (
              <div key={instance.activityInstanceId} style={{ display: 'grid', gap: 0 }}>
                <div
                  onMouseEnter={() => setHoverActivity(instance.activityId, executionRowKey)}
                  onMouseLeave={() => setHoverActivity(null, null)}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0,1fr) 8rem 2.5rem',
                    alignItems: 'center',
                    gap: '4px',
                    minHeight: 38,
                    padding: '0 var(--spacing-1)',
                    background: executionRowBg,
                    borderLeft: executionIsSelected ? '2px solid var(--cds-interactive)' : '2px solid transparent',
                    borderBottom: '1px solid var(--cds-border-subtle)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, paddingLeft: `${(group.depth + 1) * 14 + 12}px` }}>
                    {executionHasChildren ? (
                      <button
                        type="button"
                        onClick={() => toggleExecution(instance.activityInstanceId)}
                        aria-label={executionIsExpanded ? `Collapse nested trail for ${instance.activityName}` : `Expand nested trail for ${instance.activityName}`}
                        style={{ border: 'none', background: 'transparent', padding: 0, width: 16, height: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--cds-icon-primary)' }}
                      >
                        {executionIsExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </button>
                    ) : (
                      <span style={{ width: 12, height: 16, display: 'inline-flex', flexShrink: 0 }} />
                    )}

                    <span style={{ width: 8, height: 8, borderRadius: 999, background: getRowIndicatorColor(instance.hasIncident, instance.active), display: 'inline-flex', flexShrink: 0 }} />

                    <span style={{ width: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--cds-icon-secondary)', flexShrink: 0 }}>
                      <span className={executionIcon.iconClass} style={{ fontSize: executionIcon.kind === 'marker' ? 14 : 16, lineHeight: 1 }} aria-hidden="true" />
                    </span>

                    <button
                      type="button"
                      disabled={!instance.isClickable}
                      onClick={() => selectExecution(instance)}
                      style={{ border: 'none', background: 'transparent', padding: 0, minWidth: 0, flex: 1, textAlign: 'left', cursor: instance.isClickable ? 'pointer' : 'default', color: 'var(--cds-text-primary)' }}
                    >
                      {renderActivityTitle(instance.activityName, instance.activityId, executionIsSelected)}
                    </button>
                  </div>

                  <div style={{ fontSize: 'var(--text-12)', color: 'var(--cds-text-primary)', whiteSpace: 'nowrap', justifySelf: 'end', textAlign: 'right' }}>
                    {formatDurationMs(instance.durationMs, instance.startTime, instance.endTime) || '—'}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    {!isModMode ? (
                      <OverflowMenu size="sm" flipped ariaLabel={`Actions for ${instance.activityName}`} iconDescription="" wrapperClasses="eg-no-tooltip">
                        <OverflowMenuItem itemText="Details" onClick={() => openExecutionDetails(instance)} />
                        <OverflowMenuItem itemText="Copy activity instance ID" onClick={() => copyText(instance.activityInstanceId)} />
                        {instance.executionId ? <OverflowMenuItem itemText="Copy execution ID" onClick={() => copyText(instance.executionId)} /> : null}
                        {instance.calledProcessInstanceId ? (
                          <OverflowMenuItem
                            itemText="Open called process instance"
                            onClick={() => {
                              if (onNavigateToProcessInstance) onNavigateToProcessInstance(instance.calledProcessInstanceId as string)
                            }}
                          />
                        ) : null}
                      </OverflowMenu>
                    ) : null}
                  </div>
                </div>

                {executionHasChildren && executionIsExpanded ? renderExecutionRows(instance.children) : null}
              </div>
            )
          }) : null}
        </div>
      )
    })
  }, [copyText, getRowIndicatorColor, hoveredRowKey, isModMode, modPlan, moveSourceActivityId, onNavigateToProcessInstance, openExecutionDetails, openExecutionKeys, openGroupKeys, renderActivityTitle, resolveBpmnIconVisual, selectExecution, selectGroup, selectedActivityId, selectedActivityInstanceId, setHoverActivity, toggleExecution, toggleGroup])

  return (
    <section style={{ background: 'var(--color-bg-primary)', padding: 'var(--spacing-2)', display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--spacing-2)', marginBottom: '2px' }}>
        <div style={{ minWidth: 0 }}>
          <h4 style={{ margin: 0, fontSize: 'var(--text-13)', fontWeight: 'var(--font-weight-semibold)', lineHeight: 1.2 }}>Execution Trail</h4>
          {processName ? (
            <div style={{ marginTop: '2px', fontSize: '11px', fontWeight: 600, color: 'var(--cds-text-secondary)', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {processName}
            </div>
          ) : null}
        </div>

        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', flexShrink: 0, paddingTop: '1px' }}>
          <span style={{ fontSize: '11px', color: 'var(--cds-text-secondary)', whiteSpace: 'nowrap' }}>Instance counts</span>
          <Toggle
            id={tokenPassToggleId}
            size="sm"
            labelA=""
            labelB=""
            hideLabel
            toggled={showTokenPassCounts}
            onToggle={(checked: boolean) => setShowTokenPassCounts(checked)}
            aria-label="Show instance counts on BPMN nodes"
          />
        </div>
      </div>

      {actQ.isLoading ? <p>Loading...</p> : null}
      {!actQ.isLoading && (sortedActs || []).length === 0 ? <InlineNotification lowContrast kind="info" title="No activity history." /> : null}

      {(sortedActs || []).length > 0 ? (
        <div style={{ overflowY: 'auto', overflowX: 'hidden', flex: 1, minHeight: 0, paddingTop: 0 }}>
          {renderExecutionRows(execGroups)}
        </div>
      ) : null}

      <Modal
        open={!!detailsExecution}
        onRequestClose={() => setDetailsExecution(null)}
        passiveModal
        size="lg"
        modalHeading={detailsExecution ? `Execution details — ${detailsExecution.activityName}` : 'Execution details'}
      >
        {detailsExecution ? (
          <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}>
            <div style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)' }}>
              Details for this execution instance. Local variables and decision data remain available from the right-side panels when this execution is selected.
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--spacing-4)' }}>
              <ExecutionDetailItem label="Status">{getExecutionStatusLabel(detailsExecution)}</ExecutionDetailItem>
              <ExecutionDetailItem label="Type">{detailsExecution.activityType || '—'}</ExecutionDetailItem>
              <ExecutionDetailItem label="Started">{detailsExecution.startTime ? fmt(detailsExecution.startTime) : '—'}</ExecutionDetailItem>
              <ExecutionDetailItem label="Ended">{detailsExecution.endTime ? fmt(detailsExecution.endTime) : 'In progress'}</ExecutionDetailItem>
              <ExecutionDetailItem label="Duration">{formatDurationMs(detailsExecution.durationMs, detailsExecution.startTime, detailsExecution.endTime) || '—'}</ExecutionDetailItem>
              <ExecutionDetailItem label="Activity instance ID">{detailsExecution.activityInstanceId || '—'}</ExecutionDetailItem>
              <ExecutionDetailItem label="Execution ID">{detailsExecution.executionId || '—'}</ExecutionDetailItem>
              {detailsExecution.taskId ? <ExecutionDetailItem label="Task ID">{detailsExecution.taskId}</ExecutionDetailItem> : null}
              {detailsExecution.parentActivityInstanceId ? <ExecutionDetailItem label="Parent activity instance">{detailsExecution.parentActivityInstanceId}</ExecutionDetailItem> : null}
              {detailsExecution.calledProcessInstanceId ? (
                <ExecutionDetailItem label="Called process instance">
                  {onNavigateToProcessInstance ? (
                    <button
                      type="button"
                      onClick={() => onNavigateToProcessInstance(detailsExecution.calledProcessInstanceId as string)}
                      style={{ border: 'none', background: 'transparent', padding: 0, color: 'var(--cds-link-primary)', cursor: 'pointer', textDecoration: 'underline', font: 'inherit' }}
                    >
                      {detailsExecution.calledProcessInstanceId}
                    </button>
                  ) : (
                    detailsExecution.calledProcessInstanceId
                  )}
                </ExecutionDetailItem>
              ) : null}
            </div>

            {executionDetailsQ.isLoading ? (
              <div style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)' }}>
                Loading execution drilldown…
              </div>
            ) : null}

            {executionDetailsQ.isError ? (
              <InlineNotification
                lowContrast
                kind="error"
                title="Failed to load execution drilldown"
                subtitle="Execution-specific variables, tasks, decisions, or audit operations could not be loaded."
              />
            ) : null}

            {executionDetailsQ.data ? (
              <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--spacing-4)' }}>
                  <ExecutionDetailItem label="Variable snapshots">{executionDetailsQ.data.variables.length}</ExecutionDetailItem>
                  <ExecutionDetailItem label="Historic tasks">{executionDetailsQ.data.tasks.length}</ExecutionDetailItem>
                  <ExecutionDetailItem label="Decision evaluations">{executionDetailsQ.data.decisions.length}</ExecutionDetailItem>
                  <ExecutionDetailItem label="User operations">{executionDetailsQ.data.userOperations.length}</ExecutionDetailItem>
                </div>

                <div style={{ display: 'grid', gap: 'var(--spacing-4)' }}>
                  <div>
                    <div style={{ fontSize: 'var(--text-13)', fontWeight: 'var(--font-weight-semibold)', marginBottom: 'var(--spacing-2)' }}>Variable snapshots</div>
                    {executionDetailsQ.data.variables.length > 0 ? (
                      <div style={{ display: 'grid', gap: 'var(--spacing-2)' }}>
                        {executionDetailsQ.data.variables.slice(0, 8).map((variable: HistoricVariableInstanceLite) => (
                          <div key={variable.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 'var(--spacing-3)', padding: 'var(--spacing-3)', border: '1px solid var(--cds-border-subtle)', borderRadius: 'var(--border-radius-md)' }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 'var(--text-13)', fontWeight: 'var(--font-weight-semibold)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{variable.name}</div>
                              <div style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)', wordBreak: 'break-word' }}>{formatExecutionValuePreview(variable.value)}</div>
                            </div>
                            <div style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                              <div>{variable.type || '—'}</div>
                              <div>{variable.createTime ? fmt(variable.createTime) : '—'}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
                        No execution-scoped variable snapshots were found.
                      </div>
                    )}
                  </div>

                  <div>
                    <div style={{ fontSize: 'var(--text-13)', fontWeight: 'var(--font-weight-semibold)', marginBottom: 'var(--spacing-2)' }}>Historic tasks</div>
                    {executionDetailsQ.data.tasks.length > 0 ? (
                      <div style={{ display: 'grid', gap: 'var(--spacing-2)' }}>
                        {executionDetailsQ.data.tasks.slice(0, 6).map((task: HistoricTaskInstanceLite) => (
                          <div key={task.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 'var(--spacing-3)', padding: 'var(--spacing-3)', border: '1px solid var(--cds-border-subtle)', borderRadius: 'var(--border-radius-md)' }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 'var(--text-13)', fontWeight: 'var(--font-weight-semibold)' }}>{task.name || task.taskDefinitionKey || task.id}</div>
                              <div style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)' }}>{task.assignee || task.owner || 'Unassigned'}</div>
                            </div>
                            <div style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                              <div>{task.startTime ? fmt(task.startTime) : '—'}</div>
                              <div>{task.endTime ? 'Completed' : task.deleteReason || 'Open'}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
                        No historic tasks were associated with this execution.
                      </div>
                    )}
                  </div>

                  <div>
                    <div style={{ fontSize: 'var(--text-13)', fontWeight: 'var(--font-weight-semibold)', marginBottom: 'var(--spacing-2)' }}>Decision evaluations</div>
                    {executionDetailsQ.data.decisions.length > 0 ? (
                      <div style={{ display: 'grid', gap: 'var(--spacing-2)' }}>
                        {executionDetailsQ.data.decisions.slice(0, 6).map((decision: HistoricDecisionInstanceLite) => (
                          <div key={decision.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 'var(--spacing-3)', padding: 'var(--spacing-3)', border: '1px solid var(--cds-border-subtle)', borderRadius: 'var(--border-radius-md)' }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 'var(--text-13)', fontWeight: 'var(--font-weight-semibold)' }}>{decision.decisionDefinitionName || decision.decisionDefinitionKey || decision.id}</div>
                              <div style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)' }}>{decision.decisionDefinitionKey || 'Decision evaluation'}</div>
                            </div>
                            <div style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                              {decision.evaluationTime ? fmt(decision.evaluationTime) : '—'}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
                        No decision evaluations were associated with this execution.
                      </div>
                    )}
                  </div>

                  <div>
                    <div style={{ fontSize: 'var(--text-13)', fontWeight: 'var(--font-weight-semibold)', marginBottom: 'var(--spacing-2)' }}>User operations</div>
                    {executionDetailsQ.data.userOperations.length > 0 ? (
                      <div style={{ display: 'grid', gap: 'var(--spacing-2)' }}>
                        {executionDetailsQ.data.userOperations.slice(0, 8).map((operation: UserOperationLogEntryLite) => (
                          <div key={operation.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 'var(--spacing-3)', padding: 'var(--spacing-3)', border: '1px solid var(--cds-border-subtle)', borderRadius: 'var(--border-radius-md)' }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 'var(--text-13)', fontWeight: 'var(--font-weight-semibold)' }}>{operation.operationType || operation.entityType || 'Operation'}</div>
                              <div style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)', wordBreak: 'break-word' }}>{operation.property || operation.annotation || operation.newValue || operation.orgValue || '—'}</div>
                            </div>
                            <div style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                              {operation.timestamp ? fmt(operation.timestamp) : '—'}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
                        No user operations were found for this execution.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </section>
  )
}

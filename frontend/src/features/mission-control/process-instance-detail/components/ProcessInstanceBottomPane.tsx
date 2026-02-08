import React from 'react'
import SplitPane from 'react-split-pane'
import { Button } from '@carbon/react'
import styles from '../styles/InstanceDetail.module.css'
import { InstanceInfoBar } from './InstanceInfoBar'
import { ActivityDetailPanel } from './ActivityDetailPanel'

interface ProcessInstanceBottomPaneProps {
  historyContext: any | null
  defName?: string
  instanceId: string
  defs: Array<{ key: string; version: number }>
  defKey?: string
  histData?: any
  parentId?: string | null
  status?: string
  showModifyAction: boolean
  fmt: (ts?: string | null) => string
  onNavigate: (path: string) => void
  onCopy: (value: string) => void
  onSuspend: () => void
  onResume: () => void
  onModify: () => void
  onTerminate: () => void
  showIncidentBanner: boolean
  incidentCount: number
  onViewIncident: () => void
  onRetry?: () => void
  isModMode: boolean
  moveSourceActivityId: string | null
  selectedActivityId: string | null
  onExitModificationMode: () => void
  onUndoLastOperation: () => void
  modPlanLength: number
  verticalSplitSize: number | string
  onVerticalSplitChange: (size: number) => void
  activityPanelProps: {
    actQ: { isLoading: boolean; data?: any }
    sortedActs: any[]
    processName?: string
    incidentActivityIds: Set<string>
    execCounts: Map<string, number>
    clickableActivityIds: Set<string>
    bpmnRef?: React.MutableRefObject<any>
    selectedActivityId: string | null
    setSelectedActivityId: (id: string | null) => void
    selectedActivityName: string
    fmt: (ts?: string | null) => string
    isModMode: boolean
    moveSourceActivityId: string | null
    onActivityHover?: (activityId: string | null) => void
    onHistoryContextChange?: (ctx: any | null) => void
    rightTab: 'variables' | 'io'
    setRightTab: (tab: 'variables' | 'io') => void
    varsQ: { isLoading: boolean; data?: Record<string, { value: any; type: string }> }
    selectedNodeVariables: any[] | null
    shouldShowDecisionPanel: boolean
    status: string
    openVariableEditor: (name: string, value: any) => void
    showAlert: (message: string, kind?: 'info' | 'warning' | 'error', title?: string) => void
    onAddVariable?: () => void
    onBulkUploadVariables?: () => void
    selectedDecisionInstance: any
    decisionInputs: any[]
    decisionOutputs: any[]
    selectedNodeInputMappings: any[] | undefined
    selectedNodeOutputMappings: any[] | undefined
    formatMappingType: (val: any) => string
    formatMappingValue: (val: any) => string
    modPlan: any[]
    activeActivityIds: Set<string>
    resolveActivityName: (id: string) => string
    addPlanOperation: (kind: 'add' | 'addAfter' | 'cancel') => void
    removePlanItem: (index: number) => void
    movePlanItem: (index: number, direction: 'up' | 'down') => void
    updatePlanItemVariables: (index: number, variables: any[]) => void
    undoLastOperation: () => void
    toggleMoveForSelection: () => void
    onMoveToHere: (targetActivityId: string) => void
    applyModifications: () => void
    setDiscardConfirmOpen: (open: boolean) => void
    applyBusy: boolean
    onExitModificationMode: () => void
  }
}

export function ProcessInstanceBottomPane({
  historyContext,
  defName,
  instanceId,
  defs,
  defKey,
  histData,
  parentId,
  status,
  showModifyAction,
  fmt,
  onNavigate,
  onCopy,
  onSuspend,
  onResume,
  onModify,
  onTerminate,
  showIncidentBanner,
  incidentCount,
  onViewIncident,
  onRetry,
  isModMode,
  moveSourceActivityId,
  selectedActivityId,
  onExitModificationMode,
  onUndoLastOperation,
  modPlanLength,
  verticalSplitSize,
  onVerticalSplitChange,
  activityPanelProps,
}: ProcessInstanceBottomPaneProps) {
  return (
    <div className={styles.bottomPaneContainer}>
      <InstanceInfoBar
        historyContext={historyContext}
        defName={defName}
        instanceId={instanceId}
        defs={defs}
        defKey={defKey}
        histData={histData}
        parentId={parentId}
        status={status}
        showModifyAction={showModifyAction}
        fmt={fmt}
        onNavigate={onNavigate}
        onCopy={onCopy}
        onSuspend={onSuspend}
        onResume={onResume}
        onModify={onModify}
        onTerminate={onTerminate}
        onRetry={onRetry}
        incidentCount={incidentCount}
      />
      {showIncidentBanner && (
        <div className={styles.incidentBanner}>
          <div className={styles.incidentBannerText}>
            {incidentCount} incident{incidentCount === 1 ? '' : 's'} occurred in this instance.
          </div>
          <div>
            <Button size="sm" kind="ghost" onClick={onViewIncident} className={styles.incidentBannerButton}>
              View incidents
            </Button>
          </div>
        </div>
      )}
      

      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        {/* @ts-expect-error - react-split-pane has type incompatibility with React 19 */}
        <SplitPane
          split="vertical"
          size={verticalSplitSize}
          onChange={onVerticalSplitChange}
          minSize={200}
          maxSize={-200}
          className={styles.splitPane}
          pane1Style={{ overflow: 'hidden' }}
          pane2Style={{ overflow: 'auto' }}
        >
          {ActivityDetailPanel(activityPanelProps)}
        </SplitPane>
      </div>
    </div>
  )
}

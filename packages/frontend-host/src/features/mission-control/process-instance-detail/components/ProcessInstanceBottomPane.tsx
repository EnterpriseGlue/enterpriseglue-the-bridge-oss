import React from 'react'
import { SplitPane, Pane } from 'react-split-pane'
import { Button } from '@carbon/react'
import styles from '../styles/InstanceDetail.module.css'
import { InstanceInfoBar } from './InstanceInfoBar'
import { ActivityDetailPanel } from './ActivityDetailPanel'
import { NativePluginSlotV1 } from '../../../../plugins/nativePluginRuntime'
import { useActionDecision } from '../../../../shared/auth/guards'
import type { VariableHistoryTarget } from './types'
import type { UiAuthzDecision } from '@enterpriseglue/shared/authz/permission-actions.js'

interface ProcessInstanceBottomPaneProps {
  historyContext: any | null
  defName?: string
  instanceId: string
  engineRef?: string
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
  suspensionDecision?: UiAuthzDecision
  modifyDecision?: UiAuthzDecision
  terminateDecision?: UiAuthzDecision
  showIncidentBanner: boolean
  incidentCount: number
  onViewIncident: () => void
  onRetry?: () => void
  retryDecision?: UiAuthzDecision
  isModMode: boolean
  moveSourceActivityId: string | null
  selectedActivityId: string | null
  onExitModificationMode: () => void
  onUndoLastOperation: () => void
  modPlanLength: number
  verticalSplitSize: number | string
  onVerticalSplitChange: (size: number) => void
  activityPanelProps: {
    instanceId: string
    engineId?: string
    actQ: { isLoading: boolean; data?: any }
    sortedActs: any[]
    processName?: string
    incidentActivityIds: Set<string>
    clickableActivityIds: Set<string>
    bpmnRef?: React.MutableRefObject<any>
    selectedActivityId: string | null
    setSelectedActivityId: (id: string | null) => void
    selectedActivityInstanceId: string | null
    setSelectedActivityInstanceId: (id: string | null) => void
    selectedActivityName: string
    fmt: (ts?: string | null) => string
    isModMode: boolean
    moveSourceActivityId: string | null
    showTokenPassCounts: boolean
    setShowTokenPassCounts: (show: boolean) => void
    onActivityHover?: (activityId: string | null) => void
    onHistoryContextChange?: (ctx: any | null) => void
    onNavigateToProcessInstance?: (instanceId: string) => void
    rightTab: 'variables' | 'io'
    setRightTab: (tab: 'variables' | 'io') => void
    varsQ: { isLoading: boolean; data?: Record<string, { value: any; type: string }> }
    selectedNodeVariables: any[] | null
    globalVariableHistoryTargetsByName: Record<string, VariableHistoryTarget>
    shouldShowDecisionPanel: boolean
    status: string
    openVariableEditor: (name: string, value: any) => void
    openVariableHistory: (target: VariableHistoryTarget) => void
    showAlert: (message: string, kind?: 'info' | 'warning' | 'error', title?: string) => void
    onAddVariable?: () => void
    onBulkUploadVariables?: () => void
    variablesReadDecision?: UiAuthzDecision
    historicVariablesReadDecision?: UiAuthzDecision
    variableHistoryReadDecision?: UiAuthzDecision
    variablesUpdateDecision?: UiAuthzDecision
    executionDetailsReadDecision?: UiAuthzDecision
    historyTasksReadDecision?: UiAuthzDecision
    historyUserOperationsReadDecision?: UiAuthzDecision
    historyDecisionsReadDecision?: UiAuthzDecision
    decisionInputsReadDecision?: UiAuthzDecision
    decisionOutputsReadDecision?: UiAuthzDecision
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
  engineRef,
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
  suspensionDecision,
  modifyDecision,
  terminateDecision,
  showIncidentBanner,
  incidentCount,
  onViewIncident,
  onRetry,
  retryDecision,
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
  const pluginActionDecision = useActionDecision(
    'engine.instances.read',
    { type: 'engine', id: engineRef ?? null },
  )

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
        suspensionDecision={suspensionDecision}
        modifyDecision={modifyDecision}
        terminateDecision={terminateDecision}
        retryDecision={retryDecision}
        incidentCount={incidentCount}
      />
      {showIncidentBanner && (
        <div
          className={styles.incidentBanner}
          role="region"
          aria-label="Process incident"
        >
          <div className={styles.incidentBannerText}>
            {incidentCount} incident{incidentCount === 1 ? '' : 's'} occurred in this instance.
          </div>
          <div className={styles.incidentBannerActions}>
            {engineRef && (
              <NativePluginSlotV1
                slot="mission-control.process-instance.actions.v1"
                context={{
                  schemaVersion: 1,
                  disabled: !pluginActionDecision.allowed,
                  engineRef,
                  processInstanceRef: instanceId,
                  ...(defName ? { displayName: defName } : {}),
                }}
              />
            )}
            <Button size="sm" kind="ghost" onClick={onViewIncident} className={styles.incidentBannerButton}>
              View incidents
            </Button>
          </div>
        </div>
      )}
      

      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <SplitPane
          direction="horizontal"
          dividerClassName="eg-split-divider"
          dividerSize={5}
          onResize={(sizes) => onVerticalSplitChange(sizes[0])}
          className={styles.splitPane}
        >
          <Pane size={verticalSplitSize} minSize={200} style={{ overflow: 'hidden' }}>
            {ActivityDetailPanel(activityPanelProps)[0]}
          </Pane>
          <Pane minSize={200} style={{ overflow: 'auto' }}>
            {ActivityDetailPanel(activityPanelProps)[1]}
          </Pane>
        </SplitPane>
      </div>
    </div>
  )
}

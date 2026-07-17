import type {
  HistoricDecisionIo,
  HistoricDecisionInstance,
  HistoricTaskInstance,
  HistoricVariableInstance,
  VariableHistoryEntry as SharedVariableHistoryEntry,
  UserOperationLogEntry,
  ProcessInstanceExecutionDetails as SharedProcessInstanceExecutionDetails,
} from '@enterpriseglue/shared/schemas/mission-control/history.js'
import type { ProcessInstanceExternalTask, ProcessInstanceIncident, ProcessInstanceJob } from '@enterpriseglue/shared/schemas/mission-control/process.js'
import type { ActivityInstance as SharedActivityInstance } from '@enterpriseglue/shared/schemas/mission-control/process.js'

export type DecisionIo = HistoricDecisionIo

export type HistoricDecisionInstanceLite = HistoricDecisionInstance

export type HistoricVariableInstanceLite = HistoricVariableInstance

export type HistoricTaskInstanceLite = HistoricTaskInstance

export type UserOperationLogEntryLite = UserOperationLogEntry

export type ExecutionDetails = SharedProcessInstanceExecutionDetails

export type ProcessDefinition = {
  id: string
  key: string
  name: string
  version: number
}

export type ActivityInstance = SharedActivityInstance

export type Variable = HistoricVariableInstance

export type VariableHistoryEntry = SharedVariableHistoryEntry

export type VariableHistoryTarget = {
  variableInstanceId?: string | null
  variableName: string
  scope: 'global' | 'local'
  activityInstanceId?: string | null
  currentType?: string | null
  currentValue?: any
}

export type Incident = ProcessInstanceIncident

export type Job = ProcessInstanceJob

export type ExternalTask = ProcessInstanceExternalTask

export type ModificationVariable = {
  name: string
  type: string
  value: string
}

export type ModificationOperation = {
  kind: 'add' | 'addAfter' | 'cancel' | 'move'
  activityId?: string
  activityName?: string
  fromActivityId?: string
  fromActivityName?: string
  toActivityId?: string
  toActivityName?: string
  variables?: ModificationVariable[]
}

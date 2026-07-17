import type {
  HistoricDecisionIo,
  HistoricDecisionInstance,
  HistoricTaskInstance,
  HistoricVariableInstance,
  UserOperationLogEntry,
} from '@enterpriseglue/shared/schemas/mission-control/history.js'
import type { ProcessInstanceExternalTask, ProcessInstanceIncident, ProcessInstanceJob } from '@enterpriseglue/shared/schemas/mission-control/process.js'

export type DecisionIo = HistoricDecisionIo

export type HistoricDecisionInstanceLite = HistoricDecisionInstance

export type HistoricVariableInstanceLite = HistoricVariableInstance

export type HistoricTaskInstanceLite = HistoricTaskInstance

export type UserOperationLogEntryLite = UserOperationLogEntry

export type ExecutionDetails = {
  activityInstanceId: string
  executionId?: string | null
  taskId?: string | null
  variables: HistoricVariableInstanceLite[]
  tasks: HistoricTaskInstanceLite[]
  decisions: HistoricDecisionInstanceLite[]
  userOperations: UserOperationLogEntryLite[]
}

export type ProcessDefinition = {
  id: string
  key: string
  name: string
  version: number
}

export type ActivityInstance = {
  id: string
  activityId: string
  activityName?: string
  startTime?: string
  endTime?: string
  activityType?: string
  activityInstanceId?: string | null
  parentActivityInstanceId?: string | null
  executionId?: string | null
  calledProcessInstanceId?: string | null
  taskId?: string | null
  durationInMillis?: number | null
  canceled?: boolean
  completeScope?: boolean
}

export type Variable = {
  id?: string
  name: string
  type: string
  value: any
  valueInfo?: any
  processInstanceId?: string | null
  executionId?: string | null
  activityInstanceId?: string | null
  taskId?: string | null
  createTime?: string | null
}

export type VariableHistoryEntry = {
  id: string
  variableInstanceId: string
  variableName: string
  value: any
  type?: string | null
  time?: string | null
  activityInstanceId?: string | null
  executionId?: string | null
  taskId?: string | null
  revision?: number | null
  serializerName?: string | null
}

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

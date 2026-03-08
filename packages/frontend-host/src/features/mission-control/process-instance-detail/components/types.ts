export type DecisionIo = {
  id?: string
  clauseId?: string | null
  clauseName?: string | null
  type?: string | null
  value?: any
  ruleId?: string | null
}

export type HistoricDecisionInstanceLite = {
  id: string
  decisionDefinitionId?: string | null
  decisionDefinitionKey?: string | null
  decisionDefinitionName?: string | null
  evaluationTime?: string | null
  processInstanceId?: string | null
  activityId?: string | null
  activityInstanceId?: string | null
}

export type HistoricVariableInstanceLite = {
  id: string
  name: string
  type?: string | null
  value?: any
  createTime?: string | null
  activityInstanceId?: string | null
  executionId?: string | null
  taskId?: string | null
}

export type HistoricTaskInstanceLite = {
  id: string
  name?: string | null
  assignee?: string | null
  owner?: string | null
  startTime?: string | null
  endTime?: string | null
  deleteReason?: string | null
  taskDefinitionKey?: string | null
  activityInstanceId?: string | null
  executionId?: string | null
}

export type UserOperationLogEntryLite = {
  id: string
  operationType?: string | null
  entityType?: string | null
  property?: string | null
  orgValue?: string | null
  newValue?: string | null
  annotation?: string | null
  timestamp?: string | null
  userId?: string | null
}

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

export type Incident = {
  id: string
  incidentType?: string
  type?: string
  activityId?: string
  configuration?: string
  jobId?: string
  incidentMessage?: string
  incidentTimestamp?: string
}

export type Job = {
  id: string
  dueDate?: string
  duedate?: string
  retries?: number
  exceptionMessage?: string
}

export type ExternalTask = {
  id: string
  activityId?: string
  retries?: number
  errorMessage?: string
  errorDetails?: string
}

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

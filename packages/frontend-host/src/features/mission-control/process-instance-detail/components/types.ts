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
}

export type Variable = {
  name: string
  type: string
  value: any
  valueInfo?: any
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

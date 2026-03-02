import { apiClient } from '../../../../shared/api/client'
export { fetchDecisionDefinitionDmnXml } from '../../shared/api/definitions'

// Types
export type DecisionInstanceDetail = {
  id: string
  decisionDefinitionId: string
  decisionDefinitionKey: string
  decisionDefinitionName?: string
  evaluationTime: string
  processDefinitionId?: string
  processDefinitionKey?: string
  processInstanceId?: string
  activityId?: string
  activityInstanceId?: string
  inputs: DecisionInput[]
  outputs: DecisionOutput[]
}

export type DecisionInput = {
  id: string
  clauseId: string
  clauseName?: string
  type: string
  value: unknown
  valueInfo?: Record<string, unknown>
}

export type DecisionOutput = {
  id: string
  clauseId: string
  clauseName?: string
  ruleId: string
  ruleOrder: number
  variableName: string
  type: string
  value: unknown
  valueInfo?: Record<string, unknown>
}

// API Functions
export async function fetchDecisionInstance(instanceId: string): Promise<DecisionInstanceDetail> {
  return apiClient.get<DecisionInstanceDetail>(`/mission-control-api/history/decision-instances/${instanceId}`, undefined, { credentials: 'include' })
}


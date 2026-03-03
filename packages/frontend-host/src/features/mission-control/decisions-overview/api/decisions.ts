import { apiClient } from '../../../../shared/api/client'
export { fetchDecisionDefinitionDmnXml } from '../../shared/api/definitions'

// Types
export type DecisionDefinition = {
  id: string
  key: string
  name?: string | null
  version: number
  versionTag?: string | null
  category?: string
  decisionRequirementsDefinitionId?: string
  decisionRequirementsDefinitionKey?: string
  historyTimeToLive?: number
  tenantId?: string
}

export type DecisionInstance = {
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
  tenantId?: string
}

export type DecisionHistoryEntry = {
  id: string
  decisionDefinitionId?: string | null
  decisionDefinitionKey?: string | null
  decisionDefinitionName?: string | null
  evaluationTime?: string | null
  processInstanceId?: string | null
  state?: string | null
}

// API Functions
export async function listDecisionDefinitions(engineId?: string): Promise<DecisionDefinition[]> {
  const params = new URLSearchParams()
  if (engineId) params.set('engineId', engineId)
  return apiClient.get<DecisionDefinition[]>(`/mission-control-api/decision-definitions?${params}`, undefined, { credentials: 'include' })
}

export async function fetchDecisionDefinition(definitionId: string): Promise<DecisionDefinition> {
  return apiClient.get<DecisionDefinition>(`/mission-control-api/decision-definitions/${definitionId}`, undefined, { credentials: 'include' })
}

export interface GetDecisionInstancesParams {
  engineId?: string
  decisionDefinitionId?: string
  decisionDefinitionKey?: string
  processInstanceId?: string
  evaluatedAfter?: string
  evaluatedBefore?: string
}

export async function listDecisionInstances(params: GetDecisionInstancesParams): Promise<DecisionInstance[]> {
  const searchParams = new URLSearchParams()
  if (params.engineId) searchParams.set('engineId', params.engineId)
  if (params.decisionDefinitionId) searchParams.set('decisionDefinitionId', params.decisionDefinitionId)
  if (params.decisionDefinitionKey) searchParams.set('decisionDefinitionKey', params.decisionDefinitionKey)
  if (params.processInstanceId) searchParams.set('processInstanceId', params.processInstanceId)
  if (params.evaluatedAfter) searchParams.set('evaluatedAfter', params.evaluatedAfter)
  if (params.evaluatedBefore) searchParams.set('evaluatedBefore', params.evaluatedBefore)
  return apiClient.get<DecisionInstance[]>(`/mission-control-api/history/decision-instances?${searchParams}`, undefined, { credentials: 'include' })
}

export async function listDecisionHistory(query: URLSearchParams): Promise<DecisionHistoryEntry[]> {
  return apiClient.get<DecisionHistoryEntry[]>(`/mission-control-api/history/decisions?${query.toString()}`, undefined, { credentials: 'include' })
}

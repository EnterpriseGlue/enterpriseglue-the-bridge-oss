import { apiClient } from '../../../../shared/api/client'
import type { DecisionDefinition as SharedDecisionDefinition } from '@enterpriseglue/shared/schemas/mission-control/decision.js'
import type { HistoricDecisionInstance as SharedHistoricDecisionInstance } from '@enterpriseglue/shared/schemas/mission-control/history.js'
export { fetchDecisionDefinitionDmnXml } from '../../shared/api/definitions'

// Types
export type DecisionDefinition = SharedDecisionDefinition

export type DecisionInstance = SharedHistoricDecisionInstance

export type DecisionHistoryEntry = SharedHistoricDecisionInstance

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
  return apiClient.get<DecisionInstance[]>(`/mission-control-api/history/decisions?${searchParams}`, undefined, { credentials: 'include' })
}

export interface GetDecisionHistoryParams extends GetDecisionInstancesParams {
  decisionRequirementsDefinitionId?: string
  decisionRequirementsDefinitionKey?: string
  rootDecisionInstancesOnly?: boolean
  sortBy?: 'evaluationTime' | 'tenantId'
  sortOrder?: 'asc' | 'desc'
  maxResults?: number
}

export function buildDecisionHistoryQuery(params: GetDecisionHistoryParams): URLSearchParams {
  const searchParams = new URLSearchParams()
  if (params.engineId) searchParams.set('engineId', params.engineId)
  if (params.decisionDefinitionId) searchParams.set('decisionDefinitionId', params.decisionDefinitionId)
  if (params.decisionDefinitionKey) searchParams.set('decisionDefinitionKey', params.decisionDefinitionKey)
  if (params.decisionRequirementsDefinitionId) searchParams.set('decisionRequirementsDefinitionId', params.decisionRequirementsDefinitionId)
  if (params.decisionRequirementsDefinitionKey) searchParams.set('decisionRequirementsDefinitionKey', params.decisionRequirementsDefinitionKey)
  if (params.processInstanceId) searchParams.set('processInstanceId', params.processInstanceId)
  if (params.evaluatedAfter) searchParams.set('evaluatedAfter', params.evaluatedAfter)
  if (params.evaluatedBefore) searchParams.set('evaluatedBefore', params.evaluatedBefore)
  if (typeof params.rootDecisionInstancesOnly === 'boolean') {
    searchParams.set('rootDecisionInstancesOnly', String(params.rootDecisionInstancesOnly))
  }
  if (params.sortBy) searchParams.set('sortBy', params.sortBy)
  if (params.sortOrder) searchParams.set('sortOrder', params.sortOrder)
  if (typeof params.maxResults === 'number') searchParams.set('maxResults', String(params.maxResults))
  return searchParams
}

export async function listDecisionHistory(query: URLSearchParams): Promise<DecisionHistoryEntry[]> {
  return apiClient.get<DecisionHistoryEntry[]>(`/mission-control-api/history/decisions?${query.toString()}`, undefined, { credentials: 'include' })
}

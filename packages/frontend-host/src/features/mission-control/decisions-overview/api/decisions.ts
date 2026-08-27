import { apiClient } from '../../../../shared/api/client'
import { fetchList } from '../../../../shared/api/fetchList';
import type { DecisionDefinition as SharedDecisionDefinition } from '@enterpriseglue/shared/schemas/mission-control/decision.js'
import type {
  HistoricDecisionInstance as SharedHistoricDecisionInstance,
  HistoricDecisionQueryParams as SharedHistoricDecisionQueryParams,
} from '@enterpriseglue/shared/schemas/mission-control/history.js'
export { fetchDecisionDefinitionDmnXml } from '../../shared/api/definitions'

// Types
export type DecisionDefinition = SharedDecisionDefinition

export type DecisionInstance = SharedHistoricDecisionInstance

export type DecisionHistoryEntry = SharedHistoricDecisionInstance

// API Functions
export async function listDecisionDefinitions(engineId?: string): Promise<DecisionDefinition[]> {
  const params = new URLSearchParams()
  if (engineId) params.set('engineId', engineId)
  return fetchList<DecisionDefinition>(`/mission-control-api/decision-definitions?${params}`, undefined, { credentials: 'include' })
}

export async function fetchDecisionDefinition(definitionId: string): Promise<DecisionDefinition> {
  return apiClient.get<DecisionDefinition>(`/mission-control-api/decision-definitions/${definitionId}`, undefined, { credentials: 'include' })
}

export type GetDecisionInstancesParams = { engineId?: string } & Pick<
  SharedHistoricDecisionQueryParams,
  'decisionDefinitionId' | 'decisionDefinitionKey' | 'processInstanceId' | 'evaluatedAfter' | 'evaluatedBefore'
>

export async function listDecisionInstances(params: GetDecisionInstancesParams): Promise<DecisionInstance[]> {
  const searchParams = new URLSearchParams()
  if (params.engineId) searchParams.set('engineId', params.engineId)
  if (params.decisionDefinitionId) searchParams.set('decisionDefinitionId', params.decisionDefinitionId)
  if (params.decisionDefinitionKey) searchParams.set('decisionDefinitionKey', params.decisionDefinitionKey)
  if (params.processInstanceId) searchParams.set('processInstanceId', params.processInstanceId)
  if (params.evaluatedAfter) searchParams.set('evaluatedAfter', params.evaluatedAfter)
  if (params.evaluatedBefore) searchParams.set('evaluatedBefore', params.evaluatedBefore)
  return fetchList<DecisionInstance>(`/mission-control-api/history/decisions?${searchParams}`, undefined, { credentials: 'include' })
}

export type GetDecisionHistoryParams = { engineId?: string } & Pick<
  SharedHistoricDecisionQueryParams,
  | 'decisionDefinitionId'
  | 'decisionDefinitionKey'
  | 'decisionRequirementsDefinitionId'
  | 'decisionRequirementsDefinitionKey'
  | 'processInstanceId'
  | 'evaluatedAfter'
  | 'evaluatedBefore'
  | 'rootDecisionInstancesOnly'
  | 'sortBy'
  | 'sortOrder'
  | 'maxResults'
>

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
  return fetchList<DecisionHistoryEntry>(`/mission-control-api/history/decisions?${query.toString()}`, undefined, { credentials: 'include' })
}

import { apiClient } from '../../../../shared/api/client'
import { HistoricDecisionInstanceDetailSchema } from '@enterpriseglue/shared/schemas/mission-control/history.js'
import type {
  HistoricDecisionInstance as SharedHistoricDecisionInstance,
  HistoricDecisionInstanceDetail as SharedHistoricDecisionInstanceDetail,
  HistoricDecisionIo as SharedHistoricDecisionIo,
} from '@enterpriseglue/shared/schemas/mission-control/history.js'
export { fetchDecisionDefinitionDmnXml } from '../../shared/api/definitions'

// Types
export type DecisionInstanceDetail = SharedHistoricDecisionInstanceDetail
export type DecisionInput = SharedHistoricDecisionIo
export type DecisionOutput = SharedHistoricDecisionIo

// API Functions
export async function fetchDecisionInstance(instanceId: string, engineId?: string): Promise<DecisionInstanceDetail> {
  const query = new URLSearchParams({ decisionInstanceId: instanceId })
  if (engineId) query.set('engineId', engineId)
  const endpoint = `/mission-control-api/history/decisions`
  const engineQuery = engineId ? `?engineId=${encodeURIComponent(engineId)}` : ''
  const [decisions, inputs, outputs] = await Promise.all([
    apiClient.get<SharedHistoricDecisionInstance[]>(`${endpoint}?${query}`, undefined, { credentials: 'include' }),
    apiClient.get<DecisionInput[]>(`${endpoint}/${instanceId}/inputs${engineQuery}`, undefined, { credentials: 'include' }),
    apiClient.get<DecisionOutput[]>(`${endpoint}/${instanceId}/outputs${engineQuery}`, undefined, { credentials: 'include' }),
  ])
  const decision = decisions[0]
  if (!decision) throw new Error(`Historic decision instance ${instanceId} was not found`)
  return HistoricDecisionInstanceDetailSchema.parse({ ...decision, inputs, outputs })
}

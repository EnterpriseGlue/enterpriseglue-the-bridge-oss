import { apiClient } from '../../../../shared/api/client'

export async function fetchProcessDefinitionXml(definitionId: string, engineId?: string): Promise<string> {
  const params = engineId ? `?engineId=${encodeURIComponent(engineId)}` : ''
  const data = await apiClient.get<{ bpmn20Xml: string }>(
    `/mission-control-api/process-definitions/${definitionId}/xml${params}`,
    undefined,
    { credentials: 'include' },
  )
  return data.bpmn20Xml
}

export async function fetchDecisionDefinitionDmnXml(definitionId: string, engineId?: string): Promise<string> {
  const params = engineId ? `?engineId=${encodeURIComponent(engineId)}` : ''
  const data = await apiClient.get<{ dmnXml: string }>(
    `/mission-control-api/decision-definitions/${encodeURIComponent(definitionId)}/xml${params}`,
    undefined,
    { credentials: 'include' },
  )
  return data.dmnXml
}

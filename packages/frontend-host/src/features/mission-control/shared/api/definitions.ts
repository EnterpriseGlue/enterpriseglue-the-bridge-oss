import { apiClient } from '../../../../shared/api/client'
import type { ProcessDefXml } from '@enterpriseglue/shared/schemas/mission-control/process.js'

export async function fetchProcessDefinitionXml(definitionId: string, engineId?: string): Promise<string> {
  const params = engineId ? `?engineId=${encodeURIComponent(engineId)}` : ''
  const data = await apiClient.get<ProcessDefXml>(
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

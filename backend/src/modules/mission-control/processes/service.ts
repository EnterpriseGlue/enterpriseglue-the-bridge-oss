import { camundaGet, camundaPost } from '@shared/services/bpmn-engine-client.js'

export interface ProcessDefinition {
  id: string
  key: string
  name?: string
  version: number
  deploymentId: string
  tenantId?: string
}

export interface ProcessDefinitionListParams {
  key?: string
  nameLike?: string
  latestVersion?: boolean
}

export async function listProcessDefinitions(engineId: string, params: ProcessDefinitionListParams = {}): Promise<ProcessDefinition[]> {
  const queryParams: Record<string, any> = {}
  if (params.key) queryParams.key = params.key
  if (params.nameLike) queryParams.nameLike = params.nameLike
  if (params.latestVersion !== undefined) queryParams.latestVersion = params.latestVersion
  return camundaGet<ProcessDefinition[]>(engineId, '/process-definition', queryParams)
}

export async function getProcessDefinition(engineId: string, id: string): Promise<ProcessDefinition> {
  return camundaGet<ProcessDefinition>(engineId, `/process-definition/${encodeURIComponent(id)}`)
}

export async function getProcessDefinitionXml(engineId: string, id: string): Promise<{ id: string; bpmn20Xml: string }> {
  return camundaGet<{ id: string; bpmn20Xml: string }>(engineId, `/process-definition/${encodeURIComponent(id)}/xml`)
}

export async function getProcessDefinitionStatistics(engineId: string, key: string): Promise<Record<string, number>> {
  const instances = await camundaGet<any[]>(engineId, '/process-instance', { processDefinitionKey: key, active: true })
  const counts: Record<string, number> = {}
  
  for (const inst of instances) {
    try {
      const activityInstances = await camundaGet<any>(engineId, `/process-instance/${inst.id}/activity-instances`)
      const flatten = (node: any) => {
        if (node.activityId) {
          counts[node.activityId] = (counts[node.activityId] || 0) + 1
        }
        if (node.childActivityInstances) {
          for (const child of node.childActivityInstances) flatten(child)
        }
      }
      if (activityInstances) flatten(activityInstances)
    } catch {}
  }
  
  return counts
}

export interface StartProcessParams {
  variables?: Record<string, any>
  businessKey?: string
}

export async function startProcessInstance(engineId: string, key: string, params: StartProcessParams = {}): Promise<any> {
  const payload: any = {}
  if (params.variables) payload.variables = params.variables
  if (params.businessKey) payload.businessKey = params.businessKey
  return camundaPost<any>(engineId, `/process-definition/key/${encodeURIComponent(key)}/start`, payload)
}

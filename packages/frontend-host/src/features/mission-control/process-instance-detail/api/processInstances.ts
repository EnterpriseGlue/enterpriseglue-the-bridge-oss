import { apiClient } from '../../../../shared/api/client'
export { fetchProcessDefinitionXml } from '../../shared/api/definitions'
import type {
  ProcessDefinition,
  Variable,
  ActivityInstance,
  Incident,
  Job,
  ExternalTask,
} from '../components/types'

// Types
export type ProcessInstanceDetail = {
  id: string
  businessKey?: string
  processDefinitionId: string
  processDefinitionKey: string
  processDefinitionName?: string
  startTime: string
  endTime?: string
  state: string
  suspended: boolean
}

const withEngineId = (path: string, engineId?: string) => {
  if (!engineId) return path
  const joiner = path.includes('?') ? '&' : '?'
  return `${path}${joiner}engineId=${encodeURIComponent(engineId)}`
}

// API Functions
export async function getProcessInstance(instanceId: string, engineId?: string): Promise<ProcessInstanceDetail> {
  return apiClient.get<ProcessInstanceDetail>(withEngineId(`/mission-control-api/process-instances/${instanceId}`, engineId), undefined, { credentials: 'include' })
}

export async function getProcessInstanceVariables(instanceId: string, engineId?: string): Promise<Record<string, Variable>> {
  return apiClient.get<Record<string, Variable>>(withEngineId(`/mission-control-api/process-instances/${instanceId}/variables`, engineId), undefined, { credentials: 'include' })
}

export async function getProcessInstanceActivityHistory(instanceId: string, engineId?: string): Promise<ActivityInstance[]> {
  return apiClient.get<ActivityInstance[]>(withEngineId(`/mission-control-api/process-instances/${instanceId}/history/activity-instances`, engineId), undefined, { credentials: 'include' })
}

export async function getProcessInstanceIncidents(instanceId: string, engineId?: string): Promise<Incident[]> {
  return apiClient.get<Incident[]>(withEngineId(`/mission-control-api/process-instances/${instanceId}/incidents`, engineId), undefined, { credentials: 'include' })
}

export async function getProcessInstanceJobs(instanceId: string, engineId?: string): Promise<Job[]> {
  return apiClient.get<Job[]>(withEngineId(`/mission-control-api/process-instances/${instanceId}/jobs`, engineId), undefined, { credentials: 'include' })
}

export async function getProcessInstanceExternalTasks(instanceId: string, engineId?: string): Promise<ExternalTask[]> {
  return apiClient.get<ExternalTask[]>(withEngineId(`/mission-control-api/process-instances/${instanceId}/failed-external-tasks`, engineId), undefined, { credentials: 'include' })
}

// Historical data
export async function getHistoricalProcessInstance(instanceId: string, engineId?: string): Promise<unknown> {
  return apiClient.get<unknown>(withEngineId(`/mission-control-api/history/process-instances/${instanceId}`, engineId), undefined, { credentials: 'include' })
}

export async function getHistoricalVariableInstances(instanceId: string, engineId?: string): Promise<Variable[]> {
  return apiClient.get<Variable[]>(withEngineId(`/mission-control-api/history/variable-instances?processInstanceId=${encodeURIComponent(instanceId)}`, engineId), undefined, { credentials: 'include' })
}

export async function getCalledProcessInstances(instanceId: string, engineId?: string): Promise<unknown[]> {
  return apiClient.get<unknown[]>(withEngineId(`/mission-control-api/process-instances/${instanceId}/called-process-instances`, engineId), undefined, { credentials: 'include' })
}

export async function listProcessDefinitions(engineId?: string): Promise<ProcessDefinition[]> {
  const params = new URLSearchParams()
  if (engineId) params.set('engineId', engineId)
  return apiClient.get<ProcessDefinition[]>(`/mission-control-api/process-definitions?${params}`, undefined, { credentials: 'include' })
}

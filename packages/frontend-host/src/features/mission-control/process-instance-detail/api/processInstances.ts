import { apiClient } from '../../../../shared/api/client'
export { fetchProcessDefinitionXml } from '../../shared/api/definitions'
import type {
  ActivityInstance,
  Variables,
  ProcessInstanceDetail as SharedProcessInstanceDetail,
  RuntimeActivityInstanceTree,
} from '@enterpriseglue/shared/schemas/mission-control/process.js'
import type { HistoricVariableInstance } from '@enterpriseglue/shared/schemas/mission-control/history.js'
import type {
  ProcessDefinition,
  VariableHistoryEntry,
  ExecutionDetails,
  Incident,
  Job,
  ExternalTask,
} from '../components/types'

// Types
export type ProcessInstanceDetail = SharedProcessInstanceDetail

const withEngineId = (path: string, engineId?: string) => {
  if (!engineId) return path
  const joiner = path.includes('?') ? '&' : '?'
  return `${path}${joiner}engineId=${encodeURIComponent(engineId)}`
}

// API Functions
export async function getProcessInstance(instanceId: string, engineId?: string): Promise<ProcessInstanceDetail> {
  return apiClient.get<ProcessInstanceDetail>(withEngineId(`/mission-control-api/process-instances/${instanceId}?includeActionDecisions=true`, engineId), undefined, { credentials: 'include' })
}

export async function getProcessInstanceVariables(instanceId: string, engineId?: string): Promise<Variables> {
  return apiClient.get<Variables>(withEngineId(`/mission-control-api/process-instances/${instanceId}/variables`, engineId), undefined, { credentials: 'include' })
}

export async function getProcessInstanceVariableHistory(instanceId: string, variableInstanceId: string, engineId?: string): Promise<VariableHistoryEntry[]> {
  return apiClient.get<VariableHistoryEntry[]>(withEngineId(`/mission-control-api/process-instances/${instanceId}/variable-history?variableInstanceId=${encodeURIComponent(variableInstanceId)}`, engineId), undefined, { credentials: 'include' })
}

export async function getProcessInstanceActivityHistory(instanceId: string, engineId?: string): Promise<ActivityInstance[]> {
  return apiClient.get<ActivityInstance[]>(withEngineId(`/mission-control-api/process-instances/${instanceId}/history/activity-instances`, engineId), undefined, { credentials: 'include' })
}

export async function getProcessInstanceActivityTree(instanceId: string, engineId?: string): Promise<RuntimeActivityInstanceTree> {
  return apiClient.get<RuntimeActivityInstanceTree>(withEngineId(`/mission-control-api/process-instances/${instanceId}/activity-instances`, engineId), undefined, { credentials: 'include' })
}

export async function getProcessInstanceExecutionDetails(
  instanceId: string,
  params: {
    activityInstanceId: string
    executionId?: string | null
    taskId?: string | null
  },
  engineId?: string
): Promise<ExecutionDetails> {
  const searchParams = new URLSearchParams()
  searchParams.set('activityInstanceId', params.activityInstanceId)
  if (params.executionId) searchParams.set('executionId', params.executionId)
  if (params.taskId) searchParams.set('taskId', params.taskId)
  const basePath = `/mission-control-api/process-instances/${instanceId}/execution-details?${searchParams.toString()}`
  return apiClient.get<ExecutionDetails>(withEngineId(basePath, engineId), undefined, { credentials: 'include' })
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
export async function getHistoricalProcessInstance(instanceId: string, engineId?: string): Promise<ProcessInstanceDetail> {
  return apiClient.get<ProcessInstanceDetail>(withEngineId(`/mission-control-api/history/process-instances/${instanceId}`, engineId), undefined, { credentials: 'include' })
}

export async function getHistoricalVariableInstances(instanceId: string, engineId?: string): Promise<HistoricVariableInstance[]> {
  return apiClient.get<HistoricVariableInstance[]>(withEngineId(`/mission-control-api/history/variable-instances?processInstanceId=${encodeURIComponent(instanceId)}`, engineId), undefined, { credentials: 'include' })
}

export async function listProcessDefinitions(engineId?: string): Promise<ProcessDefinition[]> {
  const params = new URLSearchParams()
  if (engineId) params.set('engineId', engineId)
  return apiClient.get<ProcessDefinition[]>(`/mission-control-api/process-definitions?${params}`, undefined, { credentials: 'include' })
}

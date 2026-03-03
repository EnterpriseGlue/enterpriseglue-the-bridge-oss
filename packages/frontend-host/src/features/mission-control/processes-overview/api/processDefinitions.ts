import { apiClient } from '../../../../shared/api/client'
export { fetchProcessDefinitionXml } from '../../shared/api/definitions'

// Types
export type ProcessDefinition = {
  id: string
  key: string
  name: string
  version: number
  versionTag?: string
  suspended: boolean
}

export type ProcessInstance = {
  id: string
  processDefinitionKey?: string
  businessKey?: string
  superProcessInstanceId?: string | null
  rootProcessInstanceId?: string | null
  startTime?: string | null
  endTime?: string | null
  state?: string
  hasIncident?: boolean
}

export type ActivityCountsByState = {
  active: Record<string, number>
  incidents: Record<string, number>
  suspended: Record<string, number>
  canceled: Record<string, number>
  completed: Record<string, number>
}

// API Functions
export async function listProcessDefinitions(engineId?: string): Promise<ProcessDefinition[]> {
  const params = new URLSearchParams()
  if (engineId) params.set('engineId', engineId)
  return apiClient.get<ProcessDefinition[]>(`/mission-control-api/process-definitions?${params}`, undefined, { credentials: 'include' })
}

export async function getActiveActivityCounts(definitionId: string, engineId?: string): Promise<Record<string, number>> {
  const params = engineId ? `?engineId=${encodeURIComponent(engineId)}` : ''
  return apiClient.get<Record<string, number>>(`/mission-control-api/process-definitions/${definitionId}/active-activity-counts${params}`, undefined, { credentials: 'include' })
}

export async function fetchActivityCountsByState(definitionId: string, engineId?: string): Promise<ActivityCountsByState> {
  const params = engineId ? `?engineId=${encodeURIComponent(engineId)}` : ''
  return apiClient.get<ActivityCountsByState>(`/mission-control-api/process-definitions/${definitionId}/activity-counts-by-state${params}`, undefined, { credentials: 'include' })
}

export interface GetProcessInstancesParams {
  engineId?: string
  active?: boolean
  completed?: boolean
  canceled?: boolean
  withIncidents?: boolean
  suspended?: boolean
  processDefinitionId?: string
  processDefinitionKey?: string
  activityId?: string
  startedAfter?: string
  startedBefore?: string
}

export async function listProcessInstances(params: GetProcessInstancesParams): Promise<ProcessInstance[]> {
  const searchParams = new URLSearchParams()
  if (params.engineId) searchParams.set('engineId', params.engineId)
  if (params.active) searchParams.set('active', 'true')
  if (params.completed) searchParams.set('completed', 'true')
  if (params.canceled) searchParams.set('canceled', 'true')
  if (params.withIncidents) searchParams.set('withIncidents', 'true')
  if (params.suspended) searchParams.set('suspended', 'true')
  if (params.processDefinitionId) searchParams.set('processDefinitionId', params.processDefinitionId)
  if (params.processDefinitionKey) searchParams.set('processDefinitionKey', params.processDefinitionKey)
  if (params.activityId) searchParams.set('activityId', params.activityId)
  if (params.startedAfter) searchParams.set('startedAfter', params.startedAfter)
  if (params.startedBefore) searchParams.set('startedBefore', params.startedBefore)
  return apiClient.get<ProcessInstance[]>(`/mission-control-api/process-instances?${searchParams.toString()}`, undefined, { credentials: 'include' })
}

export async function fetchPreviewCount(body: Record<string, unknown>): Promise<{ count: number }> {
  return apiClient.post<{ count: number }>('/mission-control-api/process-instances/preview-count', body, { credentials: 'include' })
}

// Instance-specific APIs
export async function fetchInstanceVariables(instanceId: string, engineId?: string): Promise<Record<string, { value: unknown; type: string }>> {
  const params = engineId ? `?engineId=${encodeURIComponent(engineId)}` : ''
  return apiClient.get<Record<string, { value: unknown; type: string }>>(`/mission-control-api/process-instances/${instanceId}/variables${params}`, undefined, { credentials: 'include' })
}

export async function listInstanceActivityHistory(instanceId: string, engineId?: string): Promise<unknown[]> {
  const params = engineId ? `?engineId=${encodeURIComponent(engineId)}` : ''
  return apiClient.get<unknown[]>(`/mission-control-api/process-instances/${instanceId}/history/activity-instances${params}`, undefined, { credentials: 'include' })
}

export async function listInstanceJobs(instanceId: string, engineId?: string): Promise<unknown[]> {
  const params = engineId ? `?engineId=${encodeURIComponent(engineId)}` : ''
  return apiClient.get<unknown[]>(`/mission-control-api/process-instances/${instanceId}/jobs${params}`, undefined, { credentials: 'include' })
}

export async function listInstanceExternalTasks(instanceId: string, engineId?: string): Promise<unknown[]> {
  const params = engineId ? `?engineId=${encodeURIComponent(engineId)}` : ''
  return apiClient.get<unknown[]>(`/mission-control-api/process-instances/${instanceId}/failed-external-tasks${params}`, undefined, { credentials: 'include' })
}

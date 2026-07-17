import { apiClient } from '../../../../shared/api/client'
import type {
  SavedFilter as SharedSavedFilter,
  SavedFilterCreateRequest as SharedSavedFilterCreateRequest,
} from '@enterpriseglue/shared/schemas/mission-control/saved-filter.js'
import type {
  ActivityCountByActivityId,
  ActivityCountsByState as SharedActivityCountsByState,
  ActivityInstance,
  ProcessInstance as SharedProcessInstance,
  ProcessInstanceExternalTask,
  ProcessInstanceJob,
  PreviewCountResponse,
  Variables,
} from '@enterpriseglue/shared/schemas/mission-control/process.js'
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

export type ProcessInstance = SharedProcessInstance

export type ActivityCountsByState = SharedActivityCountsByState

export type SavedProcessFilter = SharedSavedFilter
export type CreateSavedProcessFilterRequest = SharedSavedFilterCreateRequest

// API Functions
export async function listProcessDefinitions(engineId?: string): Promise<ProcessDefinition[]> {
  const params = new URLSearchParams()
  if (engineId) params.set('engineId', engineId)
  return apiClient.get<ProcessDefinition[]>(`/mission-control-api/process-definitions?${params}`, undefined, { credentials: 'include' })
}

export async function getActiveActivityCounts(definitionId: string, engineId?: string): Promise<ActivityCountByActivityId> {
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
  includeActionDecisions?: boolean
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
  if (params.includeActionDecisions) searchParams.set('includeActionDecisions', 'true')
  return apiClient.get<ProcessInstance[]>(`/mission-control-api/process-instances?${searchParams.toString()}`, undefined, { credentials: 'include' })
}

export async function fetchPreviewCount(body: Record<string, unknown>): Promise<PreviewCountResponse> {
  return apiClient.post<PreviewCountResponse>('/mission-control-api/process-instances/preview-count', body, { credentials: 'include' })
}

export async function listSavedProcessFilters(): Promise<SavedProcessFilter[]> {
  return apiClient.get<SavedProcessFilter[]>('/engines-api/saved-filters', undefined, { credentials: 'include' })
}

export async function createSavedProcessFilter(body: CreateSavedProcessFilterRequest): Promise<SavedProcessFilter> {
  return apiClient.post<SavedProcessFilter>('/engines-api/saved-filters', body, { credentials: 'include' })
}

export async function deleteSavedProcessFilter(filterId: string): Promise<void> {
  await apiClient.delete(`/engines-api/saved-filters/${encodeURIComponent(filterId)}`, { credentials: 'include' })
}

// Instance-specific APIs
export async function fetchInstanceVariables(instanceId: string, engineId?: string): Promise<Variables> {
  const params = engineId ? `?engineId=${encodeURIComponent(engineId)}` : ''
  return apiClient.get<Variables>(`/mission-control-api/process-instances/${instanceId}/variables${params}`, undefined, { credentials: 'include' })
}

export async function listInstanceActivityHistory(instanceId: string, engineId?: string): Promise<ActivityInstance[]> {
  const params = engineId ? `?engineId=${encodeURIComponent(engineId)}` : ''
  return apiClient.get<ActivityInstance[]>(`/mission-control-api/process-instances/${instanceId}/history/activity-instances${params}`, undefined, { credentials: 'include' })
}

export async function listInstanceJobs(instanceId: string, engineId?: string): Promise<ProcessInstanceJob[]> {
  const params = engineId ? `?engineId=${encodeURIComponent(engineId)}` : ''
  return apiClient.get<ProcessInstanceJob[]>(`/mission-control-api/process-instances/${instanceId}/jobs${params}`, undefined, { credentials: 'include' })
}

export async function listInstanceExternalTasks(instanceId: string, engineId?: string): Promise<ProcessInstanceExternalTask[]> {
  const params = engineId ? `?engineId=${encodeURIComponent(engineId)}` : ''
  return apiClient.get<ProcessInstanceExternalTask[]>(`/mission-control-api/process-instances/${instanceId}/failed-external-tasks${params}`, undefined, { credentials: 'include' })
}

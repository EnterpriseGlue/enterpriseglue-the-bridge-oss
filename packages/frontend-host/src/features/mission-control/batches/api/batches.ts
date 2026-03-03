import { apiClient } from '../../../../shared/api/client'

// Types
export type Batch = {
  id: string
  type: string
  totalJobs: number
  jobsCreated: number
  batchJobsPerSeed: number
  invocationsPerBatchJob: number
  seedJobDefinitionId: string
  monitorJobDefinitionId: string
  batchJobDefinitionId: string
  suspended: boolean
  tenantId?: string
  createUserId?: string
  startTime?: string
  executionStartTime?: string
}

export type BatchStatistics = {
  remainingJobs: number
  completedJobs: number
  failedJobs: number
}

// API Functions
export async function getBatches(engineId?: string): Promise<Batch[]> {
  const params = new URLSearchParams()
  if (engineId) params.set('engineId', engineId)
  const query = params.toString()
  const suffix = query ? `?${query}` : ''
  return apiClient.get<Batch[]>(`/mission-control-api/batches${suffix}`, undefined, { credentials: 'include' })
}

export async function getBatch(batchId: string, engineId?: string): Promise<Batch> {
  const params = new URLSearchParams()
  if (engineId) params.set('engineId', engineId)
  const query = params.toString()
  const suffix = query ? `?${query}` : ''
  return apiClient.get<Batch>(`/mission-control-api/batches/${batchId}${suffix}`, undefined, { credentials: 'include' })
}

export async function getBatchStatistics(batchId: string, engineId?: string): Promise<BatchStatistics> {
  const params = new URLSearchParams()
  if (engineId) params.set('engineId', engineId)
  const query = params.toString()
  const suffix = query ? `?${query}` : ''
  return apiClient.get<BatchStatistics>(`/mission-control-api/batches/${batchId}/statistics${suffix}`, undefined, { credentials: 'include' })
}

export async function deleteBatch(batchId: string, engineId?: string, cascade = true): Promise<void> {
  const params = new URLSearchParams()
  if (engineId) params.set('engineId', engineId)
  params.set('cascade', String(cascade))
  const query = params.toString()
  const suffix = query ? `?${query}` : ''
  return apiClient.delete(`/mission-control-api/batches/${batchId}${suffix}`, { credentials: 'include' })
}

export async function suspendBatch(batchId: string, engineId?: string): Promise<void> {
  await apiClient.put(`/mission-control-api/batches/${batchId}/suspended`, { suspended: true, engineId }, { credentials: 'include' })
}

export async function activateBatch(batchId: string, engineId?: string): Promise<void> {
  await apiClient.put(`/mission-control-api/batches/${batchId}/suspended`, { suspended: false, engineId }, { credentials: 'include' })
}

export interface CreateBatchParams {
  processInstanceIds?: string[]
  processInstanceQuery?: Record<string, unknown>
}

export async function createDeleteBatch(params: CreateBatchParams & { engineId?: string }): Promise<Batch> {
  return apiClient.post<Batch>('/mission-control-api/batches/delete', params, { credentials: 'include' })
}

export async function createSuspendBatch(params: CreateBatchParams & { engineId?: string }): Promise<Batch> {
  return apiClient.post<Batch>('/mission-control-api/batches/suspend', params, { credentials: 'include' })
}

export async function createActivateBatch(params: CreateBatchParams & { engineId?: string }): Promise<Batch> {
  return apiClient.post<Batch>('/mission-control-api/batches/activate', params, { credentials: 'include' })
}

export async function createRetriesBatch(params: CreateBatchParams & { retries: number; engineId?: string }): Promise<Batch> {
  return apiClient.post<Batch>('/mission-control-api/batches/retries', params, { credentials: 'include' })
}

// Bulk operations on process instances
export async function createBulkRetryBatch(processInstanceIds: string[], engineId?: string): Promise<unknown> {
  return apiClient.post<unknown>('/mission-control-api/batches/jobs/retries', { processInstanceIds, engineId }, { credentials: 'include' })
}

export async function createBulkDeleteBatch(processInstanceIds: string[], deleteReason?: string, engineId?: string): Promise<unknown> {
  return apiClient.post<unknown>('/mission-control-api/batches/process-instances/delete', {
    processInstanceIds,
    deleteReason: deleteReason || 'Canceled via Mission Control',
    skipCustomListeners: true,
    skipIoMappings: true,
    engineId,
  }, { credentials: 'include' })
}

export async function createBulkSuspendBatch(processInstanceIds: string[], engineId?: string): Promise<unknown> {
  return apiClient.post<unknown>('/mission-control-api/batches/process-instances/suspend', { processInstanceIds, engineId }, { credentials: 'include' })
}

export async function createBulkActivateBatch(processInstanceIds: string[], engineId?: string): Promise<unknown> {
  return apiClient.post<unknown>('/mission-control-api/batches/process-instances/activate', { processInstanceIds, engineId }, { credentials: 'include' })
}

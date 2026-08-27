import { apiClient } from '../../../../shared/api/client'
import { fetchList } from '../../../../shared/api/fetchList';
import type {
  Batch as SharedBatch,
  BatchDeleteOperationRequest,
  BatchDetail,
  BatchOperationCreateResponse,
  BatchProcessInstanceSelectionRequest,
  BatchRetryOperationRequest,
  BatchStatistics as SharedBatchStatistics,
} from '@enterpriseglue/shared/schemas/mission-control/batch.js'

// Types
export type Batch = SharedBatch

export type BatchStatistics = SharedBatchStatistics

// API Functions
export async function getBatches(engineId?: string): Promise<Batch[]> {
  const params = new URLSearchParams()
  if (engineId) params.set('engineId', engineId)
  const query = params.toString()
  const suffix = query ? `?${query}` : ''
  return fetchList<Batch>(`/mission-control-api/batches${suffix}`, undefined, { credentials: 'include' })
}

export async function getBatch(batchId: string, engineId?: string): Promise<BatchDetail> {
  const params = new URLSearchParams()
  if (engineId) params.set('engineId', engineId)
  const query = params.toString()
  const suffix = query ? `?${query}` : ''
  return apiClient.get<BatchDetail>(`/mission-control-api/batches/${batchId}${suffix}`, undefined, { credentials: 'include' })
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

export type CreateBatchParams = BatchProcessInstanceSelectionRequest

export async function createDeleteBatch(params: BatchDeleteOperationRequest): Promise<BatchOperationCreateResponse> {
  return apiClient.post<BatchOperationCreateResponse>('/mission-control-api/batches/process-instances/delete', params, { credentials: 'include' })
}

export async function createSuspendBatch(params: CreateBatchParams): Promise<BatchOperationCreateResponse> {
  return apiClient.post<BatchOperationCreateResponse>('/mission-control-api/batches/process-instances/suspend', params, { credentials: 'include' })
}

export async function createActivateBatch(params: CreateBatchParams): Promise<BatchOperationCreateResponse> {
  return apiClient.post<BatchOperationCreateResponse>('/mission-control-api/batches/process-instances/activate', params, { credentials: 'include' })
}

export async function createRetriesBatch(params: BatchRetryOperationRequest): Promise<BatchOperationCreateResponse> {
  return apiClient.post<BatchOperationCreateResponse>('/mission-control-api/batches/jobs/retries', params, { credentials: 'include' })
}

// Bulk operations on process instances
export async function createBulkRetryBatch(processInstanceIds: string[], engineId?: string, auditReason?: string): Promise<BatchOperationCreateResponse> {
  return apiClient.post<BatchOperationCreateResponse>('/mission-control-api/batches/jobs/retries', { processInstanceIds, engineId, auditReason }, { credentials: 'include' })
}

export async function createBulkDeleteBatch(processInstanceIds: string[], deleteReason?: string, engineId?: string): Promise<BatchOperationCreateResponse> {
  return apiClient.post<BatchOperationCreateResponse>('/mission-control-api/batches/process-instances/delete', {
    processInstanceIds,
    deleteReason: deleteReason || 'Canceled via Mission Control',
    auditReason: deleteReason || 'Canceled via Mission Control',
    skipCustomListeners: true,
    skipIoMappings: true,
    engineId,
  }, { credentials: 'include' })
}

export async function createBulkSuspendBatch(processInstanceIds: string[], engineId?: string, auditReason?: string): Promise<BatchOperationCreateResponse> {
  return apiClient.post<BatchOperationCreateResponse>('/mission-control-api/batches/process-instances/suspend', { processInstanceIds, engineId, auditReason }, { credentials: 'include' })
}

export async function createBulkActivateBatch(processInstanceIds: string[], engineId?: string, auditReason?: string): Promise<BatchOperationCreateResponse> {
  return apiClient.post<BatchOperationCreateResponse>('/mission-control-api/batches/process-instances/activate', { processInstanceIds, engineId, auditReason }, { credentials: 'include' })
}

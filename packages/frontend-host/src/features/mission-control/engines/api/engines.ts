import { apiClient } from '../../../../shared/api/client'
import type { DeploymentHistoryView, DeploymentLineageView, DeploymentReceiptView } from '@enterpriseglue/shared/schemas/platform-admin/deployment-receipt.js'
import type {
  AccessibleEngineSummary,
  CreateEngineRequest,
  EngineConnectionHealthResponse,
  EngineTenancyDiagnostics,
  EngineTenancyTransitionApplyRequest,
  EngineTenancyTransitionApplyResponse,
  EngineTenancyTransitionPreviewRequest,
  EngineTenancyTransitionPreviewResponse,
  EngineTenantMapping,
  ExternalEngineTenantMappingsUpsertRequest,
  ExternalEngineTenantMappingsUpsertResponse,
  UpdateEngineRequest,
} from '@enterpriseglue/shared/schemas/mission-control/engine.js'
import type {
  EngineDeploymentRequest,
  EngineDeploymentResponse,
} from '@enterpriseglue/shared/schemas/mission-control/deployment.js'
import type { EnvironmentTag } from '@enterpriseglue/shared/schemas/platform-admin/environment-tag.js'
import type { ProjectEngineTarget } from '@enterpriseglue/shared/schemas/platform-admin/authz.js'
import type {
  AddEngineMember,
  EngineEnvironmentUpdateResponse,
  EngineMemberAddResponse,
  EngineMemberCapabilities,
  EngineMemberLookup,
  EngineMembersResponse,
  EngineProjectAccessRequest,
  EngineProjectAccessRequestResult,
  ReissuedManualEngineInvitation,
} from '@enterpriseglue/shared/schemas/platform-admin/engine-management.js'
import type {
  EngineBackstopGroupMappingSummary,
  EngineBackstopGroupMappingWriteRequest,
  EngineBackstopGroupMappingWriteResponse,
  EngineBackstopSyncApplyRequest,
  EngineBackstopSyncRollbackRequest,
  EngineBackstopSyncRunHistory,
  EngineBackstopSyncRunSummary,
} from '@enterpriseglue/shared/schemas/platform-admin/engine-backstop.js'

export interface EngineBackstopStatus {
  mappings: EngineBackstopGroupMappingSummary[]
  latestRun: EngineBackstopSyncRunSummary | null
}

export interface EngineBackstopSyncResult {
  run: EngineBackstopSyncRunSummary
}

function engineBackstopPath(engineId: string, suffix = ''): string {
  return `/engines-api/engines/${encodeURIComponent(engineId)}/backstop${suffix}`
}

export async function getEngineBackstopStatus(engineId: string): Promise<EngineBackstopStatus> {
  return apiClient.get<EngineBackstopStatus>(engineBackstopPath(engineId, '/status'), undefined, { credentials: 'include' })
}

export async function getEngineBackstopMappings(engineId: string): Promise<{ mappings: EngineBackstopGroupMappingSummary[] }> {
  return apiClient.get<{ mappings: EngineBackstopGroupMappingSummary[] }>(engineBackstopPath(engineId, '/mappings'), undefined, { credentials: 'include' })
}

export async function writeEngineBackstopMappings(
  engineId: string,
  payload: EngineBackstopGroupMappingWriteRequest,
): Promise<EngineBackstopGroupMappingWriteResponse> {
  return apiClient.post<EngineBackstopGroupMappingWriteResponse>(engineBackstopPath(engineId, '/mappings'), payload, { credentials: 'include' })
}

export async function getEngineBackstopSyncHistory(engineId: string): Promise<EngineBackstopSyncRunHistory> {
  return apiClient.get<EngineBackstopSyncRunHistory>(engineBackstopPath(engineId, '/sync'), undefined, { credentials: 'include' })
}

export async function previewEngineBackstopSync(engineId: string): Promise<EngineBackstopSyncResult> {
  return apiClient.post<EngineBackstopSyncResult>(engineBackstopPath(engineId, '/sync/preview'), {}, { credentials: 'include' })
}

export async function applyEngineBackstopSync(
  engineId: string,
  runId: string,
  payload: EngineBackstopSyncApplyRequest,
): Promise<EngineBackstopSyncResult> {
  return apiClient.post<EngineBackstopSyncResult>(
    engineBackstopPath(engineId, `/sync/${encodeURIComponent(runId)}/apply`),
    payload,
    { credentials: 'include' },
  )
}

export async function rollbackEngineBackstopSync(
  engineId: string,
  runId: string,
  payload: EngineBackstopSyncRollbackRequest,
): Promise<EngineBackstopSyncResult> {
  return apiClient.post<EngineBackstopSyncResult>(
    engineBackstopPath(engineId, `/sync/${encodeURIComponent(runId)}/rollback`),
    payload,
    { credentials: 'include' },
  )
}

export async function checkEngineBackstopDrift(engineId: string, runId: string): Promise<EngineBackstopSyncResult> {
  return apiClient.post<EngineBackstopSyncResult>(
    engineBackstopPath(engineId, `/sync/${encodeURIComponent(runId)}/drift-check`),
    {},
    { credentials: 'include' },
  )
}

/**
 * Returns the authorization-filtered engine collection. This is deliberately
 * the sanitized inventory contract rather than a persistence-shaped engine.
 */
export async function getAccessibleEngines(): Promise<AccessibleEngineSummary[]> {
  return apiClient.get<AccessibleEngineSummary[]>('/engines-api/engines', undefined, { credentials: 'include' })
}

/**
 * Administrative inventory includes shared engines that the caller may edit
 * even while their runtime-resource mappings are incomplete. Runtime selectors
 * must continue to use getAccessibleEngines so quarantine stays fail-closed.
 */
export async function getManageableEngines(): Promise<AccessibleEngineSummary[]> {
  return apiClient.get<AccessibleEngineSummary[]>(
    '/engines-api/engines',
    { includeManageableShared: 'true' },
    { credentials: 'include' },
  )
}

export async function createEngine(payload: CreateEngineRequest): Promise<AccessibleEngineSummary> {
  return apiClient.post<AccessibleEngineSummary>('/engines-api/engines', payload, { credentials: 'include' })
}

export async function updateEngine(engineId: string, payload: UpdateEngineRequest): Promise<AccessibleEngineSummary> {
  return apiClient.put<AccessibleEngineSummary>(
    `/engines-api/engines/${encodeURIComponent(engineId)}`,
    payload,
    { credentials: 'include' },
  )
}

export async function deleteEngine(engineId: string): Promise<void> {
  await apiClient.delete(`/engines-api/engines/${encodeURIComponent(engineId)}`, { credentials: 'include' })
}

export async function setEngineEnvironment(engineId: string, environmentTagId: string | null): Promise<EngineEnvironmentUpdateResponse> {
  return apiClient.post<EngineEnvironmentUpdateResponse>(
    `/engines-api/engines/${encodeURIComponent(engineId)}/environment`,
    { environmentTagId },
    { credentials: 'include' },
  )
}

export async function testEngineConnection(engineId: string): Promise<EngineConnectionHealthResponse> {
  return apiClient.post<EngineConnectionHealthResponse>(
    `/engines-api/engines/${encodeURIComponent(engineId)}/test`,
    {},
    { credentials: 'include' },
  )
}

export async function getEngineTenancyDiagnostics(engineId: string): Promise<EngineTenancyDiagnostics> {
  return apiClient.get<EngineTenancyDiagnostics>(
    `/engines-api/engines/${encodeURIComponent(engineId)}/tenancy/diagnostics`,
    undefined,
    { credentials: 'include' },
  )
}

export async function previewEngineTenancyTransition(
  engineId: string,
  payload: EngineTenancyTransitionPreviewRequest,
): Promise<EngineTenancyTransitionPreviewResponse> {
  return apiClient.post<EngineTenancyTransitionPreviewResponse>(
    `/engines-api/engines/${encodeURIComponent(engineId)}/tenancy/preview`,
    payload,
    { credentials: 'include' },
  )
}

export async function applyEngineTenancyTransition(
  engineId: string,
  payload: EngineTenancyTransitionApplyRequest,
): Promise<EngineTenancyTransitionApplyResponse> {
  return apiClient.post<EngineTenancyTransitionApplyResponse>(
    `/engines-api/engines/${encodeURIComponent(engineId)}/tenancy/apply`,
    payload,
    { credentials: 'include' },
  )
}

export async function getEngineTenantMappings(engineId: string): Promise<EngineTenantMapping[]> {
  return apiClient.get<EngineTenantMapping[]>(
    `/engines-api/engines/${encodeURIComponent(engineId)}/tenant-mappings`,
    undefined,
    { credentials: 'include' },
  )
}

export async function upsertEngineTenantMappings(
  engineId: string,
  payload: ExternalEngineTenantMappingsUpsertRequest,
): Promise<ExternalEngineTenantMappingsUpsertResponse> {
  return apiClient.put<ExternalEngineTenantMappingsUpsertResponse>(
    `/engines-api/engines/${encodeURIComponent(engineId)}/tenant-mappings`,
    payload,
    { credentials: 'include' },
  )
}

export async function getEngineEnvironmentTags(): Promise<EnvironmentTag[]> {
  return apiClient.get<EnvironmentTag[]>('/engines-api/environment-tags', undefined, { credentials: 'include' })
}

export async function getEngineProjectTargets(engineId: string): Promise<ProjectEngineTarget[]> {
  return apiClient.get<ProjectEngineTarget[]>(
    `/engines-api/engines/${encodeURIComponent(engineId)}/project-targets`,
    undefined,
    { credentials: 'include' },
  )
}

export async function getEngineConnectionHealth(engineId: string): Promise<EngineConnectionHealthResponse | null> {
  return apiClient.get<EngineConnectionHealthResponse | null>(
    `/engines-api/engines/${encodeURIComponent(engineId)}/health`,
    undefined,
    { credentials: 'include' },
  )
}

export async function getEngineMembers(engineId: string): Promise<EngineMembersResponse> {
  return apiClient.get<EngineMembersResponse>(
    `/engines-api/engines/${encodeURIComponent(engineId)}/members`,
    undefined,
    { credentials: 'include' },
  )
}

export async function getEngineAccessRequests(engineId: string): Promise<EngineProjectAccessRequest[]> {
  return apiClient.get<EngineProjectAccessRequest[]>(
    `/engines-api/engines/${encodeURIComponent(engineId)}/access-requests`,
    undefined,
    { credentials: 'include' },
  )
}

export async function getEngineMemberCapabilities(engineId: string): Promise<EngineMemberCapabilities> {
  return apiClient.get<EngineMemberCapabilities>(
    `/engines-api/engines/${encodeURIComponent(engineId)}/members/capabilities`,
    undefined,
    { credentials: 'include' },
  )
}

export async function lookupEngineMember(
  engineId: string,
  query: { email?: string; role?: 'delegate' | 'operator' | 'deployer' },
): Promise<EngineMemberLookup> {
  return apiClient.get<EngineMemberLookup>(
    `/engines-api/engines/${encodeURIComponent(engineId)}/members/lookup`,
    query,
    { credentials: 'include' },
  )
}

export async function removeEngineMember(engineId: string, userId: string): Promise<void> {
  await apiClient.delete(
    `/engines-api/engines/${encodeURIComponent(engineId)}/members/${encodeURIComponent(userId)}`,
    { credentials: 'include' },
  )
}

export async function updateEngineMemberRole(
  engineId: string,
  userId: string,
  role: 'operator' | 'deployer',
): Promise<void> {
  await apiClient.patch<void>(
    `/engines-api/engines/${encodeURIComponent(engineId)}/members/${encodeURIComponent(userId)}`,
    { role },
    { credentials: 'include' },
  )
}

export async function assignEngineDelegate(engineId: string, email: string | null): Promise<void> {
  await apiClient.post<void>(
    `/engines-api/engines/${encodeURIComponent(engineId)}/delegate`,
    { email },
    { credentials: 'include' },
  )
}

export async function reissueManualEngineInvitation(
  engineId: string,
  invitationId: string,
): Promise<ReissuedManualEngineInvitation> {
  return apiClient.post<ReissuedManualEngineInvitation>(
    `/engines-api/engines/${encodeURIComponent(engineId)}/pending-invites/${encodeURIComponent(invitationId)}/reissue`,
    {},
    { credentials: 'include' },
  )
}

export async function approveEngineAccessRequest(engineId: string, requestId: string): Promise<void> {
  await apiClient.post<void>(
    `/engines-api/engines/${encodeURIComponent(engineId)}/access-requests/${encodeURIComponent(requestId)}/approve`,
    {},
    { credentials: 'include' },
  )
}

export async function denyEngineAccessRequest(engineId: string, requestId: string): Promise<void> {
  await apiClient.post<void>(
    `/engines-api/engines/${encodeURIComponent(engineId)}/access-requests/${encodeURIComponent(requestId)}/deny`,
    {},
    { credentials: 'include' },
  )
}

export async function addEngineMember(
  engineId: string,
  payload: AddEngineMember,
): Promise<EngineMemberAddResponse> {
  return apiClient.post<EngineMemberAddResponse>(
    `/engines-api/engines/${encodeURIComponent(engineId)}/members`,
    payload,
    { credentials: 'include' },
  )
}

export async function requestEngineProjectAccess(
  engineId: string,
  projectId: string,
): Promise<EngineProjectAccessRequestResult> {
  return apiClient.post<EngineProjectAccessRequestResult>(
    `/engines-api/engines/${encodeURIComponent(engineId)}/request-access`,
    { projectId },
    { credentials: 'include' },
  )
}

export async function createEngineDeployment(
  engineId: string,
  payload: EngineDeploymentRequest,
): Promise<EngineDeploymentResponse> {
  return apiClient.post<EngineDeploymentResponse>(
    `/engines-api/engines/${encodeURIComponent(engineId)}/deployments`,
    payload,
    { credentials: 'include' },
  )
}

export async function getEngineDeploymentReceipts(engineId: string): Promise<DeploymentReceiptView[]> {
  return apiClient.get<DeploymentReceiptView[]>(
    `/engines-api/engines/${encodeURIComponent(engineId)}/deployment-receipts`,
    undefined,
    { credentials: 'include' },
  )
}

export async function getEngineDeploymentHistory(engineId: string): Promise<DeploymentHistoryView[]> {
  return apiClient.get<DeploymentHistoryView[]>(
    `/engines-api/engines/${encodeURIComponent(engineId)}/deployment-history`,
    undefined,
    { credentials: 'include' },
  )
}

export async function getEngineDeploymentLineage(engineId: string, deploymentId: string): Promise<DeploymentLineageView> {
  return apiClient.get<DeploymentLineageView>(
    `/engines-api/engines/${encodeURIComponent(engineId)}/deployments/${encodeURIComponent(deploymentId)}/lineage`,
    undefined,
    { credentials: 'include' },
  )
}

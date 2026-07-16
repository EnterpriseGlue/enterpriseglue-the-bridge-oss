import { apiClient } from '../../../../shared/api/client'
import type { DeploymentHistoryView, DeploymentLineageView, DeploymentReceiptView } from '@enterpriseglue/shared/schemas/platform-admin/deployment-receipt.js'
import type {
  AccessibleEngineSummary,
  CreateEngineRequest,
  EngineConnectionHealthResponse,
  UpdateEngineRequest,
} from '@enterpriseglue/shared/schemas/mission-control/engine.js'
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

/**
 * Returns the authorization-filtered engine collection. This is deliberately
 * the sanitized inventory contract rather than a persistence-shaped engine.
 */
export async function getAccessibleEngines(): Promise<AccessibleEngineSummary[]> {
  return apiClient.get<AccessibleEngineSummary[]>('/engines-api/engines', undefined, { credentials: 'include' })
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

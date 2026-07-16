import { apiClient } from '../../../../shared/api/client'
import type { DeploymentHistoryView, DeploymentLineageView, DeploymentReceiptView } from '@enterpriseglue/shared/schemas/platform-admin/deployment-receipt.js'
import type { AccessibleEngineSummary, EngineConnectionHealthResponse } from '@enterpriseglue/shared/schemas/mission-control/engine.js'
import type { EnvironmentTag } from '@enterpriseglue/shared/schemas/platform-admin/environment-tag.js'
import type { ProjectEngineTarget } from '@enterpriseglue/shared/schemas/platform-admin/authz.js'

/**
 * Returns the authorization-filtered engine collection. This is deliberately
 * the sanitized inventory contract rather than a persistence-shaped engine.
 */
export async function getAccessibleEngines(): Promise<AccessibleEngineSummary[]> {
  return apiClient.get<AccessibleEngineSummary[]>('/engines-api/engines', undefined, { credentials: 'include' })
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

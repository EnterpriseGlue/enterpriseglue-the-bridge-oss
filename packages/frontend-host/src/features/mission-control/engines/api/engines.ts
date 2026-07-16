import { apiClient } from '../../../../shared/api/client'
import type { DeploymentHistoryView, DeploymentLineageView, DeploymentReceiptView } from '@enterpriseglue/shared/schemas/platform-admin/deployment-receipt.js'

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

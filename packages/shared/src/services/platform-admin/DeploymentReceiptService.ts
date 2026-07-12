import { IsNull } from 'typeorm';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { DeploymentReceipt } from '@enterpriseglue/shared/infrastructure/persistence/entities/DeploymentReceipt.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { runtimeResourceInventoryService } from './RuntimeResourceInventoryService.js';
import type { DeploymentReceiptCreate } from '@enterpriseglue/shared/schemas/platform-admin/deployment-receipt.js';

export interface RecordDeploymentReceiptInput extends DeploymentReceiptCreate {
  tenantId?: string | null;
  engineId: string;
  source: 'api_client' | 'service_account';
  sourcePrincipalId: string;
}

export interface DeploymentReceiptResult {
  receiptId: string;
  idempotent: boolean;
  inventory: { created: number; updated: number };
  materializedResourceSets: number;
}

export interface DeploymentReceiptView {
  id: string;
  projectId: string;
  engineId: string;
  engineDeploymentId: string;
  source: string;
  lineage: Record<string, string>;
  receivedAt: number;
}

function normalizedTenantWhere(tenantId?: string | null): { tenantId: string } | { tenantId: ReturnType<typeof IsNull> } {
  return tenantId?.trim() ? { tenantId: tenantId.trim() } : { tenantId: IsNull() };
}

function receiptLineage(input: RecordDeploymentReceiptInput): Record<string, string> {
  return {
    source: input.source,
    sourcePrincipalId: input.sourcePrincipalId,
    ...(input.lineage?.pipelineRunId ? { pipelineRunId: input.lineage.pipelineRunId } : {}),
    ...(input.lineage?.commitSha ? { commitSha: input.lineage.commitSha } : {}),
    ...(input.lineage?.deploymentName ? { deploymentName: input.lineage.deploymentName } : {}),
  };
}

function parseLineage(value: string): Record<string, string> {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed)
      .filter(([key, item]) => ['source', 'sourcePrincipalId', 'pipelineRunId', 'commitSha', 'deploymentName'].includes(key) && typeof item === 'string')
      .map(([key, item]) => [key, item as string]));
  } catch {
    return {};
  }
}

class DeploymentReceiptService {
  async listForEngine(engineId: string, tenantId?: string | null, limit = 100): Promise<DeploymentReceiptView[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 500);
    const repo = (await getDataSource()).getRepository(DeploymentReceipt);
    const rows = await repo.find({
      where: { ...normalizedTenantWhere(tenantId), engineId },
      order: { receivedAt: 'DESC', id: 'DESC' },
      take: safeLimit,
    });
    return rows.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      engineId: row.engineId,
      engineDeploymentId: row.engineDeploymentId,
      source: row.source,
      lineage: parseLineage(row.lineageJson),
      receivedAt: row.receivedAt,
    }));
  }

  async record(input: RecordDeploymentReceiptInput): Promise<DeploymentReceiptResult> {
    const dataSource = await getDataSource();
    const repo = dataSource.getRepository(DeploymentReceipt);
    const tenantId = input.tenantId?.trim() || null;
    const existing = await repo.findOne({
      where: { ...normalizedTenantWhere(tenantId), idempotencyKey: input.idempotencyKey },
    });

    if (existing) {
      if (existing.projectId !== input.projectId || existing.engineId !== input.engineId || existing.engineDeploymentId !== input.engineDeploymentId) {
        throw new Error('Deployment receipt idempotency key is already associated with a different deployment');
      }
      return { receiptId: existing.id, idempotent: true, inventory: { created: 0, updated: 0 }, materializedResourceSets: 0 };
    }

    const now = Date.now();
    const receiptId = generateId();
    const lineage = receiptLineage(input);
    await repo.insert({
      id: receiptId,
      tenantId,
      idempotencyKey: input.idempotencyKey,
      projectId: input.projectId,
      engineId: input.engineId,
      engineDeploymentId: input.engineDeploymentId,
      source: input.source,
      lineageJson: JSON.stringify(lineage),
      receivedAt: now,
    });

    const inventory = await runtimeResourceInventoryService.observe(input.engineId, tenantId, input.artifacts.map((artifact) => ({
      resourceKind: artifact.resourceKind,
      resourceKey: artifact.resourceKey,
      engineResourceId: artifact.engineResourceId || null,
      runtimeTenantId: artifact.runtimeTenantId || null,
      deploymentId: input.engineDeploymentId,
      projectId: input.projectId,
      fileId: artifact.fileId || null,
      version: artifact.version ?? null,
      labels: artifact.labels,
      lineage: { ...lineage, receiptId },
      source: 'deployment_receipt',
      sourceRef: receiptId,
    })));
    const materializations = await runtimeResourceInventoryService.materializeForEngine(input.engineId, tenantId);

    return { receiptId, idempotent: false, inventory, materializedResourceSets: materializations.length };
  }
}

export const deploymentReceiptService = new DeploymentReceiptService();

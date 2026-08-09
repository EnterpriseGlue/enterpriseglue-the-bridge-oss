import { IsNull } from 'typeorm';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { DeploymentReceipt } from '@enterpriseglue/shared/infrastructure/persistence/entities/DeploymentReceipt.js';
import { EngineDeployment } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineDeployment.js';
import { EngineDeploymentArtifact } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineDeploymentArtifact.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { runtimeResourceInventoryService } from './RuntimeResourceInventoryService.js';
import type {
  DeploymentReceiptCreate,
  DeploymentReceiptResponse,
  DeploymentReceiptView,
} from '@enterpriseglue/shared/schemas/platform-admin/deployment-receipt.js';

export interface RecordDeploymentReceiptInput extends DeploymentReceiptCreate {
  tenantId?: string | null;
  engineId: string;
  source: 'api_client' | 'service_account';
  sourcePrincipalId: string;
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

const LINEAGE_QUALITY_RANK: Record<string, number> = {
  discovered: 1,
  inferred: 2,
  reported: 3,
  complete: 4,
};

function mergeDeploymentLineage(existing: string | null | undefined, incoming: Record<string, string>): string {
  let current: Record<string, string> = {};
  try {
    const parsed = JSON.parse(existing || '{}') as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      current = Object.fromEntries(Object.entries(parsed as Record<string, unknown>)
        .filter(([, value]) => typeof value === 'string')
        .map(([key, value]) => [key, value as string]));
    }
  } catch {
    // Previous deployment history may predate structured lineage.
  }
  return JSON.stringify({ ...current, ...incoming });
}

function artifactIdentity(artifact: { resourceKind: string; resourceKey: string; version?: number; runtimeTenantId?: string }): string {
  return [artifact.resourceKind, artifact.resourceKey, artifact.version ?? 0, artifact.runtimeTenantId || ''].join('|');
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

  async record(input: RecordDeploymentReceiptInput): Promise<DeploymentReceiptResponse> {
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

    await this.recordDeploymentHistory(input, receiptId, lineage, now);

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

  /**
   * Receipts are not a second deployment history. They add pipeline lineage to
   * the same history record used by proxied deployments and edit-target lookup.
   */
  private async recordDeploymentHistory(
    input: RecordDeploymentReceiptInput,
    receiptId: string,
    lineage: Record<string, string>,
    now: number,
  ): Promise<void> {
    const dataSource = await getDataSource();
    const deploymentRepo = dataSource.getRepository(EngineDeployment);
    const artifactRepo = dataSource.getRepository(EngineDeploymentArtifact);
    const existing = await deploymentRepo.findOne({
      where: { engineId: input.engineId, camundaDeploymentId: input.engineDeploymentId },
    });
    const receiptLineage = { ...lineage, receiptId };
    const existingQuality = existing?.lineageQuality || 'complete';
    const lineageQuality = (LINEAGE_QUALITY_RANK[existingQuality] || 0) >= LINEAGE_QUALITY_RANK.reported
      ? existingQuality
      : 'reported';
    const deploymentId = existing?.id || generateId();

    if (existing) {
      await deploymentRepo.update(existing.id, {
        projectId: existing.projectId || input.projectId,
        gitCommitSha: existing.gitCommitSha || input.lineage?.commitSha || null,
        resourceCount: Math.max(Number(existing.resourceCount || 0), input.artifacts.length),
        lineageQuality,
        reportingPrincipalId: input.sourcePrincipalId,
        reconciledAt: now,
        lineageJson: mergeDeploymentLineage(existing.lineageJson, receiptLineage),
        updatedAt: now,
      });
    } else {
      await deploymentRepo.insert({
        id: deploymentId,
        projectId: input.projectId,
        engineId: input.engineId,
        engineName: null,
        environmentTag: null,
        engineBaseUrl: null,
        gitDeploymentId: null,
        gitCommitSha: input.lineage?.commitSha || null,
        gitCommitMessage: null,
        camundaDeploymentId: input.engineDeploymentId,
        camundaDeploymentName: input.lineage?.deploymentName || null,
        camundaDeploymentTime: null,
        deployedBy: `${input.source}:${input.sourcePrincipalId}`,
        deployedAt: now,
        enableDuplicateFiltering: false,
        deployChangedOnly: false,
        resourceCount: input.artifacts.length,
        status: 'success',
        errorMessage: null,
        rawResponse: null,
        ingestionSource: 'pipeline_receipt',
        lineageQuality: 'reported',
        reportingPrincipalId: input.sourcePrincipalId,
        reconciledAt: now,
        lineageJson: JSON.stringify(receiptLineage),
        createdAt: now,
        updatedAt: now,
      });
    }

    const existingArtifacts = existing
      ? await artifactRepo.find({ where: { engineDeploymentId: deploymentId } })
      : [];
    const existingIdentities = new Set(existingArtifacts.map((artifact) => artifactIdentity({
      resourceKind: artifact.artifactKind === 'process' ? 'process_definition' : artifact.artifactKind === 'decision' ? 'decision_definition' : artifact.artifactKind,
      resourceKey: artifact.artifactKey,
      version: artifact.artifactVersion,
      runtimeTenantId: artifact.tenantId || undefined,
    })));
    const artifacts = input.artifacts
      .filter((artifact) => !existingIdentities.has(artifactIdentity(artifact)))
      .map((artifact) => ({
        id: generateId(),
        engineDeploymentId: deploymentId,
        projectId: input.projectId,
        engineId: input.engineId,
        fileId: artifact.fileId || null,
        fileType: null,
        fileName: null,
        fileUpdatedAt: null,
        fileContentHash: null,
        fileGitCommitId: input.lineage?.commitSha || null,
        fileGitCommitMessage: null,
        resourceName: artifact.resourceKey,
        artifactKind: artifact.resourceKind === 'process_definition' ? 'process' : 'decision',
        artifactId: artifact.engineResourceId || artifact.resourceKey,
        artifactKey: artifact.resourceKey,
        artifactVersion: artifact.version ?? 0,
        tenantId: artifact.runtimeTenantId || null,
        createdAt: now,
      }));
    if (artifacts.length > 0) {
      await artifactRepo.insert(artifacts);
    }
  }
}

export const deploymentReceiptService = new DeploymentReceiptService();

import { describe, expect, it } from 'vitest';
import {
  DeploymentHistoryViewSchema,
  DeploymentLineageViewSchema,
  EngineMetadataReconciliationResultSchema,
  RuntimeResourceObservationSchema,
  ScheduledRuntimeInventoryReconciliationResultSchema,
} from '@enterpriseglue/shared/schemas/platform-admin/deployment-receipt.js';

describe('deployment ingestion contracts', () => {
  it('parses sanitized deployment history diagnostics and strips persistence-only fields', () => {
    const result = DeploymentHistoryViewSchema.parse({
      id: 'history-1', engineId: 'engine-1', engineDeploymentId: 'deployment-1', deploymentName: 'Release', deploymentTime: null,
      projectId: null, ingestionSource: 'engine_discovery', lineageQuality: 'discovered', reportingPrincipalId: null,
      deployedAt: 1700000000000, reconciledAt: 1700000001000, resourceCount: 2, status: 'success',
      lineageReadiness: 'inventory_only', lineageIssues: ['missing_project_lineage'], artifactCount: 2, linkedArtifactCount: 0, versionedArtifactCount: 0,
      rawResponse: '{"secret":"must-not-leak"}', lineageJson: '{"internal":true}',
    });

    expect(result).not.toHaveProperty('rawResponse');
    expect(result).not.toHaveProperty('lineageJson');
    expect(result.lineageReadiness).toBe('inventory_only');
  });

  it('rejects unknown lineage qualities, readiness states, and issue codes', () => {
    const base = {
      id: 'history-1', engineId: 'engine-1', engineDeploymentId: null, deploymentName: null, deploymentTime: null,
      projectId: null, ingestionSource: 'engine_discovery', lineageQuality: 'discovered', reportingPrincipalId: null,
      deployedAt: 1, reconciledAt: null, resourceCount: 0, status: 'success', lineageReadiness: 'inventory_only',
      lineageIssues: [], artifactCount: 0, linkedArtifactCount: 0, versionedArtifactCount: 0,
    };

    expect(() => DeploymentHistoryViewSchema.parse({ ...base, lineageQuality: 'guessed' })).toThrow();
    expect(() => DeploymentHistoryViewSchema.parse({ ...base, lineageReadiness: 'ready_enough' })).toThrow();
    expect(() => DeploymentHistoryViewSchema.parse({ ...base, lineageIssues: ['raw_database_error'] })).toThrow();
  });

  it('exposes only the sanitized lineage projection for an individual deployment', () => {
    const result = DeploymentLineageViewSchema.parse({
      id: 'history-1', engineId: 'engine-1', engineDeploymentId: 'deployment-1', projectId: 'project-1',
      ingestionSource: 'pipeline_receipt', lineageQuality: 'reported', reconciledAt: 1, status: 'success',
      lineageReadiness: 'version_resolution_required', lineageIssues: [], reconciliationStatus: 'reconciled',
      artifacts: [{ artifactKind: 'process', runtimeResourceId: 'payments:3', runtimeResourceKey: 'payments', runtimeResourceVersion: 3, runtimeTenantId: null, projectId: 'project-1', fileId: 'file-1', fileContentHash: 'must-not-leak' }],
      rawResponse: '{"secret":"must-not-leak"}', lineageJson: '{"internal":true}',
    });

    expect(result).not.toHaveProperty('rawResponse');
    expect(result).not.toHaveProperty('lineageJson');
    expect(result.artifacts[0]).not.toHaveProperty('fileContentHash');
  });

  it('shares strict runtime observation and reconciliation result shapes', () => {
    expect(RuntimeResourceObservationSchema.parse({ resourceKind: 'process_definition', resourceKey: 'payments', version: 3 })).toMatchObject({ resourceKey: 'payments' });
    expect(() => RuntimeResourceObservationSchema.parse({ resourceKind: 'process_definition', resourceKey: 'payments', guessedProjectId: 'project-1' })).toThrow();
    expect(EngineMetadataReconciliationResultSchema.parse({
      created: 1, updated: 2, deactivated: 0, materializedSets: 1,
      deployments: { created: 1, updated: 0, artifactsCreated: 2 },
    })).toMatchObject({ created: 1, deployments: { artifactsCreated: 2 } });
    expect(ScheduledRuntimeInventoryReconciliationResultSchema.parse({ engineId: 'engine-1', tenantId: null, status: 'failed' })).toEqual({ engineId: 'engine-1', tenantId: null, status: 'failed' });
  });
});

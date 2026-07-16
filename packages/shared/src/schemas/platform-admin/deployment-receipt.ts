import { z } from 'zod';
import { RuntimeResourceKindSchema } from './config-bundle.js';

export const DeploymentIngestionSourceSchema = z.enum(['enterpriseglue_proxy', 'pipeline_receipt', 'engine_discovery']);
export const DeploymentLineageQualitySchema = z.enum(['complete', 'reported', 'discovered', 'inferred']);
export const DeploymentLineageReadinessSchema = z.enum(['bridge_ready', 'version_resolution_required', 'validation_required', 'inventory_only', 'incomplete']);
export const DeploymentLineageIssueSchema = z.enum([
  'missing_project_lineage',
  'no_artifacts_recorded',
  'artifacts_missing_file_lineage',
  'missing_reporting_principal',
  'inference_not_validated',
]);

export const DeploymentReceiptArtifactSchema = z.object({
  resourceKind: RuntimeResourceKindSchema,
  resourceKey: z.string().min(1).max(255),
  engineResourceId: z.string().min(1).max(255).optional(),
  runtimeTenantId: z.string().min(1).max(255).optional(),
  version: z.number().int().nonnegative().optional(),
  fileId: z.string().min(1).max(255).optional(),
  labels: z.record(z.string().min(1).max(64), z.string().min(1).max(255)).optional(),
}).strict();

export const DeploymentReceiptLineageSchema = z.object({
  pipelineRunId: z.string().min(1).max(255).optional(),
  commitSha: z.string().min(1).max(255).optional(),
  deploymentName: z.string().min(1).max(255).optional(),
}).strict();

export const DeploymentReceiptCreateSchema = z.object({
  idempotencyKey: z.string().min(8).max(255),
  projectId: z.string().min(1).max(255),
  engineDeploymentId: z.string().min(1).max(255),
  artifacts: z.array(DeploymentReceiptArtifactSchema).min(1).max(500),
  lineage: DeploymentReceiptLineageSchema.optional(),
}).strict();

export const DeploymentReceiptResponseSchema = z.object({
  receiptId: z.string(),
  idempotent: z.boolean(),
  inventory: z.object({ created: z.number().int(), updated: z.number().int() }),
  materializedResourceSets: z.number().int(),
});

export const DeploymentReceiptViewSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  engineId: z.string(),
  engineDeploymentId: z.string(),
  source: z.string(),
  lineage: DeploymentReceiptLineageSchema.extend({
    source: z.string().optional(),
    sourcePrincipalId: z.string().optional(),
  }),
  receivedAt: z.number().int(),
});

export const DeploymentHistoryViewSchema = z.object({
  id: z.string(),
  engineId: z.string(),
  engineDeploymentId: z.string().nullable(),
  deploymentName: z.string().nullable(),
  deploymentTime: z.string().nullable(),
  projectId: z.string().nullable(),
  ingestionSource: DeploymentIngestionSourceSchema,
  lineageQuality: DeploymentLineageQualitySchema,
  reportingPrincipalId: z.string().nullable(),
  deployedAt: z.number(),
  reconciledAt: z.number().nullable(),
  resourceCount: z.number().int().nonnegative(),
  status: z.string(),
  lineageReadiness: DeploymentLineageReadinessSchema,
  lineageIssues: z.array(DeploymentLineageIssueSchema),
  artifactCount: z.number().int().nonnegative(),
  linkedArtifactCount: z.number().int().nonnegative(),
  versionedArtifactCount: z.number().int().nonnegative(),
});

/**
 * Safe deployment-to-runtime projection for operator diagnostics and bridge
 * resolution. It deliberately excludes raw engine responses, file contents,
 * content hashes, and commit messages retained by the persistence records.
 */
export const DeploymentLineageArtifactViewSchema = z.object({
  artifactKind: z.string().min(1).max(64),
  runtimeResourceId: z.string().nullable(),
  runtimeResourceKey: z.string().nullable(),
  runtimeResourceVersion: z.number().int().nonnegative(),
  runtimeTenantId: z.string().nullable(),
  projectId: z.string().nullable(),
  fileId: z.string().nullable(),
});

export const DeploymentLineageViewSchema = DeploymentHistoryViewSchema.pick({
  id: true,
  engineId: true,
  engineDeploymentId: true,
  projectId: true,
  ingestionSource: true,
  lineageQuality: true,
  reconciledAt: true,
  status: true,
  lineageReadiness: true,
  lineageIssues: true,
}).extend({
  reconciliationStatus: z.enum(['reconciled', 'pending']),
  artifacts: z.array(DeploymentLineageArtifactViewSchema),
});

export const RuntimeResourceObservationSchema = z.object({
  resourceKind: RuntimeResourceKindSchema,
  resourceKey: z.string().min(1),
  runtimeTenantId: z.string().nullable().optional(),
  engineResourceId: z.string().nullable().optional(),
  deploymentId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  fileId: z.string().nullable().optional(),
  version: z.number().int().nullable().optional(),
  labels: z.record(z.string(), z.string()).optional(),
  lineage: z.record(z.string(), z.unknown()).optional(),
  source: z.string().optional(),
  sourceRef: z.string().nullable().optional(),
}).strict();

export const DeploymentDiscoveryResultSchema = z.object({
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  artifactsCreated: z.number().int().nonnegative(),
  skipped: z.boolean().optional(),
});

export const EngineMetadataReconciliationResultSchema = z.object({
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  deactivated: z.number().int().nonnegative(),
  materializedSets: z.number().int().nonnegative(),
  runtimeSkipped: z.boolean().optional(),
  deployments: DeploymentDiscoveryResultSchema,
});

export const ScheduledRuntimeInventoryReconciliationResultSchema = EngineMetadataReconciliationResultSchema.omit({ deployments: true }).extend({
  engineId: z.string(),
  tenantId: z.string().nullable(),
  status: z.enum(['reconciled', 'failed']),
  created: z.number().int().nonnegative().optional(),
  updated: z.number().int().nonnegative().optional(),
  deactivated: z.number().int().nonnegative().optional(),
  materializedSets: z.number().int().nonnegative().optional(),
  deploymentsCreated: z.number().int().nonnegative().optional(),
  deploymentsUpdated: z.number().int().nonnegative().optional(),
  deploymentArtifactsCreated: z.number().int().nonnegative().optional(),
});

export type DeploymentReceiptCreate = z.infer<typeof DeploymentReceiptCreateSchema>;
export type DeploymentReceiptView = z.infer<typeof DeploymentReceiptViewSchema>;
export type DeploymentHistoryView = z.infer<typeof DeploymentHistoryViewSchema>;
export type DeploymentLineageArtifactView = z.infer<typeof DeploymentLineageArtifactViewSchema>;
export type DeploymentLineageView = z.infer<typeof DeploymentLineageViewSchema>;
export type DeploymentLineageReadiness = z.infer<typeof DeploymentLineageReadinessSchema>;
export type DeploymentLineageIssue = z.infer<typeof DeploymentLineageIssueSchema>;
export type RuntimeResourceKind = z.infer<typeof RuntimeResourceKindSchema>;
export type RuntimeResourceObservation = z.infer<typeof RuntimeResourceObservationSchema>;
export type DeploymentDiscoveryResult = z.infer<typeof DeploymentDiscoveryResultSchema>;
export type EngineMetadataReconciliationResult = z.infer<typeof EngineMetadataReconciliationResultSchema>;
export type ScheduledRuntimeInventoryReconciliationResult = z.infer<typeof ScheduledRuntimeInventoryReconciliationResultSchema>;

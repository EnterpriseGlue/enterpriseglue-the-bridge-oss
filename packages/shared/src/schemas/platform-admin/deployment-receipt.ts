import { z } from 'zod';

const RuntimeResourceKindSchema = z.enum(['process_definition', 'decision_definition']);

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

export type DeploymentReceiptCreate = z.infer<typeof DeploymentReceiptCreateSchema>;

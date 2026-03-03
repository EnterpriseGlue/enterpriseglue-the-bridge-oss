import { z } from 'zod';

// Raw schema - matches TypeORM GitDeployment entity
export const DeploymentSchemaRaw = z.object({
  id: z.string(),
  projectId: z.string(),
  repositoryId: z.string(),
  commitSha: z.string(),
  commitMessage: z.string().nullable(),
  tag: z.string().nullable(),
  deployedBy: z.string(),
  deployedAt: z.number(),
  environment: z.string().nullable(),
  status: z.string(),
  errorMessage: z.string().nullable(),
  filesChanged: z.number().nullable(),
  metadata: z.string().nullable(),
});

// Select schema (database -> API response)
export const DeploymentSelectSchema = DeploymentSchemaRaw.transform((d) => ({
  id: d.id,
  projectId: d.projectId,
  repositoryId: d.repositoryId,
  commitSha: d.commitSha,
  commitMessage: d.commitMessage,
  tag: d.tag ?? undefined,
  deployedBy: d.deployedBy,
  deployedAt: Number(d.deployedAt),
  environment: d.environment ?? undefined,
  status: d.status,
  errorMessage: d.errorMessage ?? undefined,
  filesChanged: d.filesChanged ?? undefined,
  metadata: d.metadata ?? undefined,
}));

// Insert schema (API request -> database)
export const DeploymentInsertSchema = z.object({
  id: z.string().uuid().optional(),
  commitMessage: z.string().min(1).max(500),
  environment: z.string().optional(),
  status: z.enum(['success', 'failed', 'pending']).default('success'),
});

// API-specific schemas
export const DeployRequestSchema = z.object({
  projectId: z.string().uuid(),
  message: z.string().min(1).max(500),
  environment: z.string().optional(),
  createTag: z.boolean().optional().default(false),
  tagName: z.string().optional(),
});

export const RollbackRequestSchema = z.object({
  projectId: z.string().uuid(),
  commitSha: z.string().min(7).max(40),
});

export const DeploymentResponseSchema = z.object({
  deploymentId: z.string().uuid(),
  commitSha: z.string(),
  tag: z.string().optional(),
  filesChanged: z.number(),
});

// Types
export type Deployment = z.infer<typeof DeploymentSelectSchema>;
export type DeploymentInsert = z.infer<typeof DeploymentInsertSchema>;
export type DeployRequest = z.infer<typeof DeployRequestSchema>;
export type RollbackRequest = z.infer<typeof RollbackRequestSchema>;
export type DeploymentResponse = z.infer<typeof DeploymentResponseSchema>;

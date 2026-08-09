import { z } from 'zod';

// Deployment schemas (API-only, no DB persistence)
export const DeploymentSchema = z.object({
  id: z.string(),
  name: z.string().optional().nullable(),
  source: z.string().optional().nullable(),
  deploymentTime: z.string().optional().nullable(),
  tenantId: z.string().optional().nullable(),
});

export const DeploymentResourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  deploymentId: z.string(),
});

// Request schemas
export const CreateDeploymentRequest = z.object({
  deploymentName: z.string().optional(),
  deploymentSource: z.string().optional(),
  enableDuplicateFiltering: z.boolean().optional(),
  deployChangedOnly: z.boolean().optional(),
  tenantId: z.string().optional(),
  // File data will be handled as multipart/form-data
});

/** Resources selected for a project-to-engine proxy deployment. */
export const EngineDeploymentResourcesSchema = z.object({
  fileIds: z.array(z.string()).optional(),
  folderId: z.string().optional(),
  projectId: z.string().optional(),
  recursive: z.boolean().optional(),
});

/** Options forwarded to a proxied engine deployment. */
export const EngineDeploymentOptionsSchema = z.object({
  deploymentName: z.string().optional(),
  enableDuplicateFiltering: z.boolean().optional(),
  deployChangedOnly: z.boolean().optional(),
  tenantId: z.string().optional(),
  vcsCommitId: z.string().optional(),
});

/**
 * The nested form is canonical for browser clients. Flat legacy fields remain
 * accepted by the backend during compatibility migration.
 */
export const EngineDeploymentRequestSchema = z.object({
  resources: EngineDeploymentResourcesSchema.optional(),
  options: EngineDeploymentOptionsSchema.optional(),
  deploymentName: z.string().optional(),
  enableDuplicateFiltering: z.boolean().optional(),
  deployChangedOnly: z.boolean().optional(),
  tenantId: z.string().optional(),
}).passthrough();

export const EngineDeploymentResponseSchema = z.object({
  engineId: z.string(),
  engineBaseUrl: z.string(),
  raw: z.unknown(),
});

export const DeploymentQueryParams = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  nameLike: z.string().optional(),
  source: z.string().optional(),
  tenantIdIn: z.array(z.string()).optional(),
  withoutTenantId: z.boolean().optional(),
  sortBy: z.enum(['id', 'name', 'deploymentTime', 'tenantId']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  firstResult: z.number().optional(),
  maxResults: z.number().optional(),
});

// Response schemas
export const ProcessDefinitionDiagramSchema = z.object({
  id: z.string().optional(),
  bpmn20Xml: z.string().optional(),
});

// Types
export type Deployment = z.infer<typeof DeploymentSchema>;
export type DeploymentResource = z.infer<typeof DeploymentResourceSchema>;
export type CreateDeploymentRequest = z.infer<typeof CreateDeploymentRequest>;
export type EngineDeploymentRequest = z.infer<typeof EngineDeploymentRequestSchema>;
export type EngineDeploymentResponse = z.infer<typeof EngineDeploymentResponseSchema>;
export type DeploymentQueryParams = z.infer<typeof DeploymentQueryParams>;
export type ProcessDefinitionDiagram = z.infer<typeof ProcessDefinitionDiagramSchema>;

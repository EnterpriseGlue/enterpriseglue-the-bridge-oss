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
export type DeploymentQueryParams = z.infer<typeof DeploymentQueryParams>;
export type ProcessDefinitionDiagram = z.infer<typeof ProcessDefinitionDiagramSchema>;

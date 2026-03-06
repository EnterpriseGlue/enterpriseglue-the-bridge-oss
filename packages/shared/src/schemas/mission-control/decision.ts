import { z } from 'zod';

// Decision definition schemas (API-only, no DB persistence)
export const DecisionDefinitionSchema = z.object({
  id: z.string(),
  key: z.string(),
  category: z.string().optional().nullable(),
  name: z.string().optional().nullable(),
  version: z.number(),
  resource: z.string().optional().nullable(),
  deploymentId: z.string().optional().nullable(),
  tenantId: z.string().optional().nullable(),
  decisionRequirementsDefinitionId: z.string().optional().nullable(),
  decisionRequirementsDefinitionKey: z.string().optional().nullable(),
  historyTimeToLive: z.number().optional().nullable(),
  versionTag: z.string().optional().nullable(),
});

export const DecisionDefinitionXmlSchema = z.object({
  id: z.string().optional(),
  dmnXml: z.string(),
});

// Request schemas
export const DecisionDefinitionQueryParams = z.object({
  decisionDefinitionId: z.string().optional(),
  decisionDefinitionIdIn: z.array(z.string()).optional(),
  name: z.string().optional(),
  nameLike: z.string().optional(),
  deploymentId: z.string().optional(),
  key: z.string().optional(),
  keyLike: z.string().optional(),
  category: z.string().optional(),
  categoryLike: z.string().optional(),
  version: z.number().optional(),
  latestVersion: z.boolean().optional(),
  resourceName: z.string().optional(),
  resourceNameLike: z.string().optional(),
  decisionRequirementsDefinitionId: z.string().optional(),
  decisionRequirementsDefinitionKey: z.string().optional(),
  withoutDecisionRequirementsDefinition: z.boolean().optional(),
  tenantIdIn: z.array(z.string()).optional(),
  withoutTenantId: z.boolean().optional(),
  includeDecisionDefinitionsWithoutTenantId: z.boolean().optional(),
  versionTag: z.string().optional(),
  versionTagLike: z.string().optional(),
  sortBy: z.enum(['category', 'key', 'id', 'name', 'version', 'deploymentId', 'tenantId', 'decisionRequirementsDefinitionKey']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  firstResult: z.number().optional(),
  maxResults: z.number().optional(),
});

export const EvaluateDecisionRequest = z.object({
  variables: z.record(z.object({
    value: z.any(),
    type: z.string().optional(),
  })),
});

export const DecisionEvaluationResultSchema = z.array(z.record(z.object({
  value: z.any(),
  type: z.string(),
})));

// Types
export type DecisionDefinition = z.infer<typeof DecisionDefinitionSchema>;
export type DecisionDefinitionXml = z.infer<typeof DecisionDefinitionXmlSchema>;
export type DecisionDefinitionQueryParams = z.infer<typeof DecisionDefinitionQueryParams>;
export type EvaluateDecisionRequest = z.infer<typeof EvaluateDecisionRequest>;
export type DecisionEvaluationResult = z.infer<typeof DecisionEvaluationResultSchema>;

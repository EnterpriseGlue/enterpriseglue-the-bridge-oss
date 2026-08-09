import { z } from 'zod';

export const DeployedEditTargetMappingSourceSchema = z.enum([
  'git-commit',
  'db-timestamp',
  'db-latest',
  'deployment-timestamp',
]);

const DeployedEditTargetSchema = z.object({
  canShowEditButton: z.boolean(),
  canEdit: z.boolean(),
  engineId: z.string(),
  projectId: z.string(),
  fileId: z.string(),
  engineDeploymentId: z.string().optional(),
  commitId: z.string().nullable().optional(),
  fileVersionNumber: z.number().nullable().optional(),
  mappingSource: DeployedEditTargetMappingSourceSchema.optional(),
  artifactCreatedAt: z.number().optional(),
  lineageQuality: z.enum(['complete', 'reported']).optional(),
});

export const ProcessEditTargetSchema = DeployedEditTargetSchema.extend({
  processKey: z.string(),
  processVersion: z.number(),
});

export const DecisionEditTargetSchema = DeployedEditTargetSchema.extend({
  decisionKey: z.string(),
  decisionVersion: z.number(),
});

export type ProcessEditTarget = z.infer<typeof ProcessEditTargetSchema>;
export type DecisionEditTarget = z.infer<typeof DecisionEditTargetSchema>;

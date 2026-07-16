import { z } from 'zod';

export const MigrationInstructionSchema = z.object({
  sourceActivityIds: z.array(z.string()),
  targetActivityIds: z.array(z.string()),
  updateEventTrigger: z.boolean().optional(),
});

// This is the engine-compatible plan shape returned by plan generation and
// supplied to preview, validation, and execution endpoints.
export const MigrationPlanSchema = z.object({
  sourceProcessDefinitionId: z.string(),
  targetProcessDefinitionId: z.string(),
  instructions: z.array(MigrationInstructionSchema).default([]),
  updateEventTriggers: z.boolean().optional(),
});

export const MigrationGenerateRequestSchema = z.object({
  sourceDefinitionId: z.string(),
  targetDefinitionId: z.string(),
  updateEventTriggers: z.boolean().optional(),
  overrides: z.array(z.object({
    sourceActivityIds: z.array(z.string()).optional(),
    sourceActivityId: z.string().optional(),
    targetActivityId: z.string().optional(),
    targetActivityIds: z.array(z.string()).optional(),
    updateEventTrigger: z.boolean().optional(),
  })).optional(),
});

// Migration plans retain engine-compatible shapes. These aggregate responses,
// however, are owned by EnterpriseGlue and have stable public contracts.
export const MigrationPreviewResponseSchema = z.object({
  count: z.number().int().nonnegative(),
}).strict();

export const MigrationActiveSourcesResponseSchema = z.record(
  z.string(),
  z.number().int().nonnegative(),
);

export type MigrationPreviewResponse = z.infer<typeof MigrationPreviewResponseSchema>;
export type MigrationActiveSourcesResponse = z.infer<typeof MigrationActiveSourcesResponseSchema>;
export type MigrationInstruction = z.infer<typeof MigrationInstructionSchema>;
export type MigrationPlan = z.infer<typeof MigrationPlanSchema>;
export type MigrationGenerateRequest = z.infer<typeof MigrationGenerateRequestSchema>;

import { z } from 'zod';
import { VariablesSchema } from './process.js';

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

export const MigrationExecuteRequestSchema = z.object({
  engineId: z.string().optional(),
  plan: MigrationPlanSchema,
  processInstanceIds: z.array(z.string()).optional(),
  processInstanceQuery: z.record(z.string(), z.unknown()).optional(),
  skipCustomListeners: z.boolean().optional(),
  skipIoMappings: z.boolean().optional(),
  variables: VariablesSchema.optional(),
  auditReason: z.string().min(1).max(2000),
});

export const MigrationAsyncExecuteResponseSchema = z.object({
  id: z.string(),
  camundaBatchId: z.string().optional(),
  type: z.literal('MIGRATE_INSTANCES'),
}).strict();

export const MigrationDirectExecuteResponseSchema = z.object({
  ok: z.literal(true),
}).strict();

// Validation diagnostics differ between compatible engine versions. Preserve
// extension fields while giving the wizard one stable report/list boundary.
export const MigrationValidationDiagnosticSchema = z.object({
  errorMessage: z.string().optional(),
  warningMessage: z.string().optional(),
  message: z.string().optional(),
}).passthrough();

export const MigrationValidationInstructionSchema = z.object({
  sourceActivityIds: z.array(z.string()).optional(),
  targetActivityIds: z.array(z.string()).optional(),
  targetActivityId: z.string().optional(),
  updateEventTrigger: z.boolean().optional(),
}).passthrough();

export const MigrationValidationInstructionReportSchema = z.object({
  instruction: MigrationValidationInstructionSchema.optional(),
  failures: z.array(MigrationValidationDiagnosticSchema).optional(),
  warnings: z.array(MigrationValidationDiagnosticSchema).optional(),
}).passthrough();

export const MigrationValidationResultSchema = z.object({
  instructionReports: z.array(MigrationValidationInstructionReportSchema).default([]),
}).passthrough();

// Migration plans retain engine-compatible shapes. These aggregate responses,
// however, are owned by EnterpriseGlue and have stable public contracts.
export const MigrationPreviewResponseSchema = z.object({
  count: z.number().int().nonnegative(),
}).strict();

// Preview accepts engine-specific migration-plan extensions. Validate the
// request envelope without narrowing plan payloads that adapters own.
export const MigrationPreviewRequestSchema = z.object({
  engineId: z.string(),
  plan: z.record(z.string(), z.unknown()).optional(),
  processInstanceIds: z.array(z.string()).optional(),
}).passthrough();

// Selected instances are resolved for runtime-resource authorization before
// this schema runs. Preserve compatible adapter hints while validating the
// selection the aggregation service consumes.
export const MigrationActiveSourcesRequestSchema = z.object({
  engineId: z.string(),
  processInstanceIds: z.array(z.string()).default([]),
}).passthrough();

export const MigrationActiveSourcesResponseSchema = z.record(
  z.string(),
  z.number().int().nonnegative(),
);

export type MigrationPreviewResponse = z.infer<typeof MigrationPreviewResponseSchema>;
export type MigrationPreviewRequest = z.infer<typeof MigrationPreviewRequestSchema>;
export type MigrationActiveSourcesRequest = z.infer<typeof MigrationActiveSourcesRequestSchema>;
export type MigrationActiveSourcesResponse = z.infer<typeof MigrationActiveSourcesResponseSchema>;
export type MigrationInstruction = z.infer<typeof MigrationInstructionSchema>;
export type MigrationPlan = z.infer<typeof MigrationPlanSchema>;
export type MigrationGenerateRequest = z.infer<typeof MigrationGenerateRequestSchema>;
export type MigrationExecuteRequest = z.infer<typeof MigrationExecuteRequestSchema>;
export type MigrationAsyncExecuteResponse = z.infer<typeof MigrationAsyncExecuteResponseSchema>;
export type MigrationDirectExecuteResponse = z.infer<typeof MigrationDirectExecuteResponseSchema>;
export type MigrationValidationDiagnostic = z.infer<typeof MigrationValidationDiagnosticSchema>;
export type MigrationValidationInstructionReport = z.infer<typeof MigrationValidationInstructionReportSchema>;
export type MigrationValidationResult = z.infer<typeof MigrationValidationResultSchema>;

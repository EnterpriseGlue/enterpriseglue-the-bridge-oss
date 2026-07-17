import { z } from 'zod'

// Direct runtime actions are synchronous, per-instance operations. Keep these
// request schemas descriptive rather than using them to narrow route input: the
// handlers intentionally preserve compatible engine-specific request fields.
const DirectOperationRequestBaseSchema = z.object({
  engineId: z.string(),
  // Existing direct routes treat an omitted selection as an empty selection.
  // Keep that behavior while rejecting malformed selection values.
  processInstanceIds: z.array(z.string()).default([]),
}).passthrough()

export const DirectProcessInstanceDeleteRequestSchema = DirectOperationRequestBaseSchema.extend({
  skipCustomListeners: z.boolean().optional(),
  skipIoMappings: z.boolean().optional(),
  failIfNotExists: z.boolean().optional(),
  skipSubprocesses: z.boolean().optional(),
  deleteReason: z.string().optional(),
})

export const DirectProcessInstanceSuspensionRequestSchema = DirectOperationRequestBaseSchema

export const DirectJobRetriesRequestSchema = DirectOperationRequestBaseSchema.extend({
  retries: z.number().min(0).default(1),
  onlyFailed: z.boolean().default(true),
})

export const DirectOperationFailureSchema = z.object({
  id: z.string(),
  ok: z.literal(false),
  error: z.string().optional(),
}).strict()

export const DirectOperationResultSchema = z.object({
  total: z.number().int().nonnegative(),
  succeeded: z.array(z.string()),
  failed: z.array(DirectOperationFailureSchema),
}).strict()

export type DirectProcessInstanceDeleteRequest = z.infer<typeof DirectProcessInstanceDeleteRequestSchema>
export type DirectProcessInstanceSuspensionRequest = z.infer<typeof DirectProcessInstanceSuspensionRequestSchema>
export type DirectJobRetriesRequest = z.infer<typeof DirectJobRetriesRequestSchema>
export type DirectOperationFailure = z.infer<typeof DirectOperationFailureSchema>
export type DirectOperationResult = z.infer<typeof DirectOperationResultSchema>

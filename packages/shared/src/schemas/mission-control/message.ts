import { z } from 'zod';

// Message correlation schemas (API-only, no DB persistence)
export const MessageCorrelationResultSchema = z.object({
  resultType: z.enum(['Execution', 'ProcessDefinition']),
  processInstance: z.object({
    id: z.string(),
    definitionId: z.string().optional().nullable(),
    businessKey: z.string().optional().nullable(),
    caseInstanceId: z.string().optional().nullable(),
    ended: z.boolean().optional(),
    suspended: z.boolean().optional(),
    tenantId: z.string().optional().nullable(),
  }).optional().nullable(),
  execution: z.object({
    id: z.string(),
    processInstanceId: z.string().optional().nullable(),
  }).optional().nullable(),
}).passthrough();

// Camunda returns one result per matched execution/process definition. Even a
// correlation with no enabled result uses an empty array, so preserve the
// engine's array boundary rather than collapsing it to a single object.
export const MessageCorrelationResultsSchema = z.array(MessageCorrelationResultSchema);

// Request schemas
export const CorrelateMessageRequest = z.object({
  messageName: z.string(),
  businessKey: z.string().optional(),
  tenantId: z.string().optional(),
  withoutTenantId: z.boolean().optional(),
  processInstanceId: z.string().optional(),
  correlationKeys: z.record(z.string(), z.object({
    value: z.any(),
    type: z.string().optional(),
  })).optional(),
  localCorrelationKeys: z.record(z.string(), z.object({
    value: z.any(),
    type: z.string().optional(),
  })).optional(),
  processVariables: z.record(z.string(), z.object({
    value: z.any(),
    type: z.string().optional(),
  })).optional(),
  processVariablesLocal: z.record(z.string(), z.object({
    value: z.any(),
    type: z.string().optional(),
  })).optional(),
  all: z.boolean().optional(),
  resultEnabled: z.boolean().optional(),
  variablesInResultEnabled: z.boolean().optional(),
});

// Signal schemas
export const SignalEventSchema = z.object({
  name: z.string(),
  executionId: z.string().optional(),
  variables: z.record(z.string(), z.object({
    value: z.any(),
    type: z.string().optional(),
  })).optional(),
  tenantId: z.string().optional(),
  withoutTenantId: z.boolean().optional(),
});

// Types
export type MessageCorrelationResult = z.infer<typeof MessageCorrelationResultSchema>;
export type MessageCorrelationResults = z.infer<typeof MessageCorrelationResultsSchema>;
export type CorrelateMessageRequest = z.infer<typeof CorrelateMessageRequest>;
export type SignalEvent = z.infer<typeof SignalEventSchema>;

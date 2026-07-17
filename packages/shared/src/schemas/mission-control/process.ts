import { z } from 'zod';

// Process definition schemas (API-only, no DB persistence)
export const ProcessDefinitionSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string().optional(),
  version: z.number(),
  versionTag: z.string().optional(),
  suspended: z.boolean().optional(),
});

export const ProcessDefXmlSchema = z.object({
  id: z.string().optional(),
  bpmn20Xml: z.string(),
});

// Starting an instance returns an engine-native process-instance object. The
// local API guarantees its id while preserving engine-specific fields for
// compatibility with existing callers and adapters.
export const ProcessInstanceStartResponseSchema = z.object({
  id: z.string(),
}).passthrough();

// Process instance schemas (API-only, no DB persistence)
export const RuntimeRowActionDecisionSchema = z.object({
  allowed: z.boolean(),
  reason: z.string().optional(),
});

export const ProcessInstanceRuntimeActionDecisionsSchema = z.object({
  suspension: RuntimeRowActionDecisionSchema,
  retry: RuntimeRowActionDecisionSchema,
  terminate: RuntimeRowActionDecisionSchema,
  migration: RuntimeRowActionDecisionSchema.optional(),
});

export const ProcessInstanceSchema = z.object({
  id: z.string(),
  processDefinitionKey: z.string().optional(),
  superProcessInstanceId: z.string().nullable().optional(),
  rootProcessInstanceId: z.string().nullable().optional(),
  startTime: z.string().nullable().optional(),
  endTime: z.string().nullable().optional(),
  state: z.enum(['ACTIVE', 'COMPLETED', 'CANCELED']).optional(),
  runtimeActionDecisions: ProcessInstanceRuntimeActionDecisionsSchema.optional(),
});

export const ActivityCountByActivityIdSchema = z.record(z.string(), z.number().nonnegative());

export const ActivityCountsByStateSchema = z.object({
  active: ActivityCountByActivityIdSchema,
  incidents: ActivityCountByActivityIdSchema,
  suspended: ActivityCountByActivityIdSchema,
  canceled: ActivityCountByActivityIdSchema,
  completed: ActivityCountByActivityIdSchema,
});

// Variables schema
export const VariablesSchema = z.record(z.string(), z.object({ value: z.any(), type: z.string() }));

// Activity instance schema
export const ActivityInstanceSchema = z.object({
  id: z.string(),
  activityId: z.string().optional(),
  activityName: z.string().optional(),
  endTime: z.string().nullable().optional(),
});

// Incidents are engine-native runtime rows. The common fields power the
// instance-detail UI, while passthrough retains adapter-specific diagnostics.
export const ProcessInstanceIncidentSchema = z.object({
  id: z.string(),
  incidentType: z.string().nullable().optional(),
  type: z.string().nullable().optional(),
  activityId: z.string().nullable().optional(),
  configuration: z.string().nullable().optional(),
  jobId: z.string().nullable().optional(),
  incidentMessage: z.string().nullable().optional(),
  incidentTimestamp: z.string().nullable().optional(),
}).passthrough();

export const ProcessInstanceIncidentListSchema = z.array(ProcessInstanceIncidentSchema);

// Request schemas
export const PreviewCountRequest = z.object({
  processDefinitionKey: z.string().optional(),
  processDefinitionId: z.string().optional(),
  active: z.boolean().optional(),
  suspended: z.boolean().optional(),
  withIncidents: z.boolean().optional(),
  variables: z.array(z.object({
    name: z.string(),
    operator: z.string(),
    value: z.any(),
  })).optional(),
});

// The engine-compatible request remains intentionally permissive at the route
// boundary, while every preview response has this stable public shape.
export const PreviewCountResponseSchema = z.object({
  count: z.number().int().nonnegative(),
}).strict();

// Types
export type ProcessDefinition = z.infer<typeof ProcessDefinitionSchema>;
export type ProcessDefXml = z.infer<typeof ProcessDefXmlSchema>;
export type ProcessInstanceStartResponse = z.infer<typeof ProcessInstanceStartResponseSchema>;
export type ProcessInstance = z.infer<typeof ProcessInstanceSchema>;
export type ActivityCountByActivityId = z.infer<typeof ActivityCountByActivityIdSchema>;
export type ActivityCountsByState = z.infer<typeof ActivityCountsByStateSchema>;
export type PreviewCountResponse = z.infer<typeof PreviewCountResponseSchema>;
export type Variables = z.infer<typeof VariablesSchema>;
export type ActivityInstance = z.infer<typeof ActivityInstanceSchema>;
export type ProcessInstanceIncident = z.infer<typeof ProcessInstanceIncidentSchema>;
export type ProcessInstanceIncidentList = z.infer<typeof ProcessInstanceIncidentListSchema>;

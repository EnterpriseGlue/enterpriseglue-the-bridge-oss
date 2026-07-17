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
  modify: RuntimeRowActionDecisionSchema.optional(),
  variablesUpdate: RuntimeRowActionDecisionSchema.optional(),
}).passthrough();

export const ProcessInstanceSchema = z.object({
  id: z.string(),
  processDefinitionKey: z.string().optional(),
  businessKey: z.string().optional(),
  version: z.number().optional(),
  superProcessInstanceId: z.string().nullable().optional(),
  rootProcessInstanceId: z.string().nullable().optional(),
  startTime: z.string().nullable().optional(),
  endTime: z.string().nullable().optional(),
  state: z.enum(['ACTIVE', 'SUSPENDED', 'COMPLETED', 'CANCELED', 'INCIDENT']).optional(),
  hasIncident: z.boolean().optional(),
  runtimeActionDecisions: ProcessInstanceRuntimeActionDecisionsSchema.optional(),
}).passthrough();

// Detail reads are engine-native objects as well. Keep their adapter-specific
// fields while making the identifiers consumed by Instance Detail and its
// authorization decisions explicit at the shared route boundary.
export const ProcessInstanceDetailSchema = ProcessInstanceSchema.extend({
  processDefinitionId: z.string().optional(),
  definitionId: z.string().optional(),
  processDefinitionName: z.string().optional(),
  processDefinitionVersion: z.number().optional(),
}).passthrough();

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

export interface RuntimeActivityInstanceTree {
  id?: string | null;
  activityId?: string | null;
  activityName?: string | null;
  activityType?: string | null;
  parentActivityInstanceId?: string | null;
  childActivityInstances?: RuntimeActivityInstanceTree[] | null;
  childTransitionInstances?: RuntimeActivityInstanceTree[] | null;
  executionIds?: string[] | null;
  [key: string]: unknown;
}

/** Engine-native recursive activity tree used by Instance Detail. */
export const RuntimeActivityInstanceTreeSchema: z.ZodType<RuntimeActivityInstanceTree> = z.lazy(() => z.object({
  id: z.string().nullable().optional(),
  activityId: z.string().nullable().optional(),
  activityName: z.string().nullable().optional(),
  activityType: z.string().nullable().optional(),
  parentActivityInstanceId: z.string().nullable().optional(),
  childActivityInstances: z.array(RuntimeActivityInstanceTreeSchema).nullable().optional(),
  childTransitionInstances: z.array(RuntimeActivityInstanceTreeSchema).nullable().optional(),
  executionIds: z.array(z.string()).nullable().optional(),
}).passthrough());

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

// The instance-detail job list is a narrow display view of engine-native jobs.
// Preserve diagnostic extensions and the legacy `duedate` spelling returned by
// some adapters.
export const ProcessInstanceJobSchema = z.object({
  id: z.string(),
  dueDate: z.string().nullable().optional(),
  duedate: z.string().nullable().optional(),
  retries: z.number().nullable().optional(),
  exceptionMessage: z.string().nullable().optional(),
}).passthrough();

export const ProcessInstanceJobListSchema = z.array(ProcessInstanceJobSchema);

// Failed external tasks are rendered in the instance-detail retry flow. Keep
// the fields it reads explicit and retain adapter-specific failure metadata.
export const ProcessInstanceExternalTaskSchema = z.object({
  id: z.string(),
  activityId: z.string().nullable().optional(),
  retries: z.number().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  errorDetails: z.string().nullable().optional(),
}).passthrough();

export const ProcessInstanceExternalTaskListSchema = z.array(ProcessInstanceExternalTaskSchema);

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
export type ProcessInstanceDetail = z.infer<typeof ProcessInstanceDetailSchema>;
export type ActivityCountByActivityId = z.infer<typeof ActivityCountByActivityIdSchema>;
export type ActivityCountsByState = z.infer<typeof ActivityCountsByStateSchema>;
export type PreviewCountResponse = z.infer<typeof PreviewCountResponseSchema>;
export type Variables = z.infer<typeof VariablesSchema>;
export type ActivityInstance = z.infer<typeof ActivityInstanceSchema>;
export type ProcessInstanceIncident = z.infer<typeof ProcessInstanceIncidentSchema>;
export type ProcessInstanceIncidentList = z.infer<typeof ProcessInstanceIncidentListSchema>;
export type ProcessInstanceJob = z.infer<typeof ProcessInstanceJobSchema>;
export type ProcessInstanceJobList = z.infer<typeof ProcessInstanceJobListSchema>;
export type ProcessInstanceExternalTask = z.infer<typeof ProcessInstanceExternalTaskSchema>;
export type ProcessInstanceExternalTaskList = z.infer<typeof ProcessInstanceExternalTaskListSchema>;

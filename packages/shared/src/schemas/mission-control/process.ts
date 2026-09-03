import { z } from 'zod';

// Process definition schemas (API-only, no DB persistence)
export const ProcessDefinitionSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string().optional(),
  version: z.number(),
  // Camunda-compatible engines use null when no version tag was deployed.
  versionTag: z.string().nullable().optional(),
  suspended: z.boolean().optional(),
}).passthrough();

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
  // Operaton and Camunda return JSON null when no business key was supplied.
  // Accept that engine-native value so completed-instance history remains the
  // source of truth for state, definition identity, BPMN, and variables.
  businessKey: z.string().nullable().optional(),
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

// Runtime variable values can carry engine-specific serialization metadata.
// Keep the common display and scope fields explicit without dropping adapter
// extensions after PII redaction.
export const ProcessInstanceVariableSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  type: z.string(),
  value: z.unknown(),
  /** True when the caller may inspect metadata but lacks value disclosure. */
  valueRedacted: z.boolean().optional(),
  valueInfo: z.unknown().optional(),
  processInstanceId: z.string().nullable().optional(),
  executionId: z.string().nullable().optional(),
  activityInstanceId: z.string().nullable().optional(),
  taskId: z.string().nullable().optional(),
  createTime: z.string().nullable().optional(),
}).passthrough();

export const VariablesSchema = z.record(z.string(), ProcessInstanceVariableSchema);

// EnterpriseGlue uses engineId only to resolve authorization and the target
// engine. Keep values adapter-compatible: some engines accept the direct
// variable map while established callers provide an enclosing `variables`
// object with additional serialization metadata.
export const ProcessInstanceVariablesModifyRequestSchema = z.object({
  engineId: z.string().optional(),
  modifications: z.record(z.string(), z.unknown()),
});

export const ProcessInstanceRetryRequestSchema = z.object({
  engineId: z.string().optional(),
  jobIds: z.array(z.string()).optional(),
  externalTaskIds: z.array(z.string()).optional(),
  dueDate: z.string().optional(),
  retries: z.number().int().min(0).optional(),
});

// Historic activity-instance rows power the Instance Detail execution trail.
// Keep the fields rendered by that UI explicit while retaining engine-specific
// diagnostics and adapter extensions for compatibility.
export const ActivityInstanceSchema = z.object({
  id: z.string(),
  activityId: z.string().optional(),
  activityName: z.string().nullable().optional(),
  startTime: z.string().nullable().optional(),
  endTime: z.string().nullable().optional(),
  activityType: z.string().nullable().optional(),
  activityInstanceId: z.string().nullable().optional(),
  parentActivityInstanceId: z.string().nullable().optional(),
  executionId: z.string().nullable().optional(),
  calledProcessInstanceId: z.string().nullable().optional(),
  taskId: z.string().nullable().optional(),
  durationInMillis: z.number().nullable().optional(),
  canceled: z.boolean().optional(),
  completeScope: z.boolean().optional(),
}).passthrough();

export const ActivityInstanceListSchema = z.array(ActivityInstanceSchema);

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
  engineId: z.string().optional(),
  processDefinitionKey: z.string().optional(),
  processDefinitionId: z.string().optional(),
  active: z.boolean().optional(),
  suspended: z.boolean().optional(),
  withIncident: z.boolean().optional(),
  withIncidents: z.boolean().optional(),
  variables: z.array(z.object({
    name: z.string(),
    operator: z.string(),
    value: z.any(),
  })).optional(),
}).passthrough();

// The engine-compatible request remains intentionally permissive at the route
// boundary, while every preview response has this stable public shape.
export const PreviewCountResponseSchema = z.object({
  count: z.number().int().nonnegative(),
}).strict();

// Runtime process-instance collection filters use their query-string wire
// representation so the shared route validation does not alter the
// Camunda-compatible adapter request. Unknown adapter filters remain intact.
export const ProcessInstanceCollectionQueryParamsSchema = z.object({
  engineId: z.string().optional(),
  processDefinitionKey: z.string().optional(),
  processDefinitionId: z.string().optional(),
  superProcessInstanceId: z.string().optional(),
  activityId: z.string().optional(),
  startedAfter: z.string().optional(),
  startedBefore: z.string().optional(),
  active: z.enum(['true', 'false', '1', '0']).optional(),
  suspended: z.enum(['true', 'false', '1', '0']).optional(),
  withIncidents: z.enum(['true', 'false', '1', '0']).optional(),
  completed: z.enum(['true', 'false', '1', '0']).optional(),
  canceled: z.enum(['true', 'false', '1', '0']).optional(),
  includeActionDecisions: z.enum(['true']).optional(),
  firstResult: z.coerce.number().int().nonnegative().optional(),
  maxResults: z.coerce.number().int().positive().optional(),
}).passthrough();

// Types
export type ProcessDefinition = z.infer<typeof ProcessDefinitionSchema>;
export type ProcessDefXml = z.infer<typeof ProcessDefXmlSchema>;
export type ProcessInstanceStartResponse = z.infer<typeof ProcessInstanceStartResponseSchema>;
export type ProcessInstance = z.infer<typeof ProcessInstanceSchema>;
export type ProcessInstanceDetail = z.infer<typeof ProcessInstanceDetailSchema>;
export type ActivityCountByActivityId = z.infer<typeof ActivityCountByActivityIdSchema>;
export type ActivityCountsByState = z.infer<typeof ActivityCountsByStateSchema>;
export type PreviewCountRequest = z.infer<typeof PreviewCountRequest>;
export type PreviewCountResponse = z.infer<typeof PreviewCountResponseSchema>;
export type ProcessInstanceCollectionQueryParams = z.infer<typeof ProcessInstanceCollectionQueryParamsSchema>;
export type ProcessInstanceVariable = z.infer<typeof ProcessInstanceVariableSchema>;
export type Variables = z.infer<typeof VariablesSchema>;
export type ProcessInstanceVariablesModifyRequest = z.infer<typeof ProcessInstanceVariablesModifyRequestSchema>;
export type ProcessInstanceRetryRequest = z.infer<typeof ProcessInstanceRetryRequestSchema>;
export type ActivityInstance = z.infer<typeof ActivityInstanceSchema>;
export type ActivityInstanceList = z.infer<typeof ActivityInstanceListSchema>;
export type ProcessInstanceIncident = z.infer<typeof ProcessInstanceIncidentSchema>;
export type ProcessInstanceIncidentList = z.infer<typeof ProcessInstanceIncidentListSchema>;
export type ProcessInstanceJob = z.infer<typeof ProcessInstanceJobSchema>;
export type ProcessInstanceJobList = z.infer<typeof ProcessInstanceJobListSchema>;
export type ProcessInstanceExternalTask = z.infer<typeof ProcessInstanceExternalTaskSchema>;
export type ProcessInstanceExternalTaskList = z.infer<typeof ProcessInstanceExternalTaskListSchema>;

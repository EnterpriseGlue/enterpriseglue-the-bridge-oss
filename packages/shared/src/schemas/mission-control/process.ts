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

// Process instance schemas (API-only, no DB persistence)
export const ProcessInstanceSchema = z.object({
  id: z.string(),
  processDefinitionKey: z.string().optional(),
  superProcessInstanceId: z.string().nullable().optional(),
  rootProcessInstanceId: z.string().nullable().optional(),
  startTime: z.string().nullable().optional(),
  endTime: z.string().nullable().optional(),
  state: z.enum(['ACTIVE', 'COMPLETED', 'CANCELED']).optional(),
});

// Variables schema
export const VariablesSchema = z.record(z.object({ value: z.any(), type: z.string() }));

// Activity instance schema
export const ActivityInstanceSchema = z.object({
  id: z.string(),
  activityId: z.string().optional(),
  activityName: z.string().optional(),
  endTime: z.string().nullable().optional(),
});

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

// Types
export type ProcessDefinition = z.infer<typeof ProcessDefinitionSchema>;
export type ProcessInstance = z.infer<typeof ProcessInstanceSchema>;
export type Variables = z.infer<typeof VariablesSchema>;
export type ActivityInstance = z.infer<typeof ActivityInstanceSchema>;

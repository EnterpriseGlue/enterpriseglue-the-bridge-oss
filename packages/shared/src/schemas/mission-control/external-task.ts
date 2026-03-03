import { z } from 'zod';

// External task schemas (API-only, no DB persistence)
export const ExternalTaskSchema = z.object({
  id: z.string(),
  topicName: z.string(),
  workerId: z.string().optional().nullable(),
  lockExpirationTime: z.string().optional().nullable(),
  processInstanceId: z.string().optional().nullable(),
  executionId: z.string().optional().nullable(),
  activityId: z.string().optional().nullable(),
  activityInstanceId: z.string().optional().nullable(),
  processDefinitionId: z.string().optional().nullable(),
  processDefinitionKey: z.string().optional().nullable(),
  retries: z.number().optional().nullable(),
  errorMessage: z.string().optional().nullable(),
  errorDetails: z.string().optional().nullable(),
  priority: z.number().optional(),
  suspended: z.boolean().optional(),
  tenantId: z.string().optional().nullable(),
  variables: z.record(z.object({
    value: z.any(),
    type: z.string(),
  })).optional(),
  businessKey: z.string().optional().nullable(),
});

// Request schemas
export const FetchAndLockRequest = z.object({
  workerId: z.string(),
  maxTasks: z.number().optional(),
  usePriority: z.boolean().optional(),
  asyncResponseTimeout: z.number().optional(),
  topics: z.array(z.object({
    topicName: z.string(),
    lockDuration: z.number(),
    variables: z.array(z.string()).optional(),
    localVariables: z.boolean().optional(),
    businessKey: z.string().optional(),
    processDefinitionId: z.string().optional(),
    processDefinitionIdIn: z.array(z.string()).optional(),
    processDefinitionKey: z.string().optional(),
    processDefinitionKeyIn: z.array(z.string()).optional(),
    processVariables: z.record(z.any()).optional(),
    withoutTenantId: z.boolean().optional(),
    tenantIdIn: z.array(z.string()).optional(),
  })),
});

export const CompleteExternalTaskRequest = z.object({
  workerId: z.string(),
  variables: z.record(z.object({
    value: z.any(),
    type: z.string().optional(),
  })).optional(),
  localVariables: z.record(z.object({
    value: z.any(),
    type: z.string().optional(),
  })).optional(),
});

export const ExternalTaskFailureRequest = z.object({
  workerId: z.string(),
  errorMessage: z.string().optional(),
  errorDetails: z.string().optional(),
  retries: z.number().optional(),
  retryTimeout: z.number().optional(),
});

export const ExternalTaskBpmnErrorRequest = z.object({
  workerId: z.string(),
  errorCode: z.string(),
  errorMessage: z.string().optional(),
  variables: z.record(z.object({
    value: z.any(),
    type: z.string().optional(),
  })).optional(),
});

export const ExtendLockRequest = z.object({
  workerId: z.string(),
  newDuration: z.number(),
});

export const UnlockExternalTaskRequest = z.object({
  workerId: z.string().optional(),
});

export const ExternalTaskQueryParams = z.object({
  externalTaskId: z.string().optional(),
  topicName: z.string().optional(),
  workerId: z.string().optional(),
  locked: z.boolean().optional(),
  notLocked: z.boolean().optional(),
  withRetriesLeft: z.boolean().optional(),
  noRetriesLeft: z.boolean().optional(),
  lockExpirationAfter: z.string().optional(),
  lockExpirationBefore: z.string().optional(),
  activityId: z.string().optional(),
  activityIdIn: z.array(z.string()).optional(),
  executionId: z.string().optional(),
  processInstanceId: z.string().optional(),
  processDefinitionId: z.string().optional(),
  active: z.boolean().optional(),
  suspended: z.boolean().optional(),
  priorityHigherThanOrEquals: z.number().optional(),
  priorityLowerThanOrEquals: z.number().optional(),
  sortBy: z.enum(['id', 'lockExpirationTime', 'processInstanceId', 'processDefinitionId', 'processDefinitionKey', 'tenantId', 'taskPriority']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  firstResult: z.number().optional(),
  maxResults: z.number().optional(),
});

// Types
export type ExternalTask = z.infer<typeof ExternalTaskSchema>;
export type FetchAndLockRequest = z.infer<typeof FetchAndLockRequest>;
export type CompleteExternalTaskRequest = z.infer<typeof CompleteExternalTaskRequest>;
export type ExternalTaskFailureRequest = z.infer<typeof ExternalTaskFailureRequest>;
export type ExternalTaskBpmnErrorRequest = z.infer<typeof ExternalTaskBpmnErrorRequest>;
export type ExtendLockRequest = z.infer<typeof ExtendLockRequest>;
export type UnlockExternalTaskRequest = z.infer<typeof UnlockExternalTaskRequest>;
export type ExternalTaskQueryParams = z.infer<typeof ExternalTaskQueryParams>;

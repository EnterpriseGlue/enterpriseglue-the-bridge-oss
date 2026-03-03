import { z } from 'zod';

// Job schemas (API-only, no DB persistence)
export const JobSchema = z.object({
  id: z.string(),
  jobDefinitionId: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  processInstanceId: z.string().optional().nullable(),
  executionId: z.string().optional().nullable(),
  processDefinitionId: z.string().optional().nullable(),
  processDefinitionKey: z.string().optional().nullable(),
  retries: z.number().optional().nullable(),
  exceptionMessage: z.string().optional().nullable(),
  failedActivityId: z.string().optional().nullable(),
  suspended: z.boolean().optional(),
  priority: z.number().optional(),
  tenantId: z.string().optional().nullable(),
  createTime: z.string().optional().nullable(),
});

export const JobDefinitionSchema = z.object({
  id: z.string(),
  processDefinitionId: z.string().optional().nullable(),
  processDefinitionKey: z.string().optional().nullable(),
  activityId: z.string().optional().nullable(),
  jobType: z.string().optional().nullable(),
  jobConfiguration: z.string().optional().nullable(),
  overridingJobPriority: z.number().optional().nullable(),
  suspended: z.boolean().optional(),
  tenantId: z.string().optional().nullable(),
  deploymentId: z.string().optional().nullable(),
});

// Request schemas
export const JobQueryParams = z.object({
  jobId: z.string().optional(),
  jobIds: z.array(z.string()).optional(),
  jobDefinitionId: z.string().optional(),
  processInstanceId: z.string().optional(),
  processInstanceIds: z.array(z.string()).optional(),
  executionId: z.string().optional(),
  processDefinitionId: z.string().optional(),
  processDefinitionKey: z.string().optional(),
  activityId: z.string().optional(),
  withRetriesLeft: z.boolean().optional(),
  executable: z.boolean().optional(),
  timers: z.boolean().optional(),
  messages: z.boolean().optional(),
  withException: z.boolean().optional(),
  exceptionMessage: z.string().optional(),
  noRetriesLeft: z.boolean().optional(),
  active: z.boolean().optional(),
  suspended: z.boolean().optional(),
  priorityHigherThanOrEquals: z.number().optional(),
  priorityLowerThanOrEquals: z.number().optional(),
  dueDates: z.array(z.string()).optional(),
  createTimes: z.array(z.string()).optional(),
  tenantIdIn: z.array(z.string()).optional(),
  withoutTenantId: z.boolean().optional(),
  sortBy: z.enum(['jobId', 'executionId', 'processInstanceId', 'processDefinitionId', 'processDefinitionKey', 'jobPriority', 'jobRetries', 'jobDueDate', 'tenantId']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  firstResult: z.number().optional(),
  maxResults: z.number().optional(),
});

export const JobDefinitionQueryParams = z.object({
  jobDefinitionId: z.string().optional(),
  activityIdIn: z.array(z.string()).optional(),
  processDefinitionId: z.string().optional(),
  processDefinitionKey: z.string().optional(),
  jobType: z.string().optional(),
  jobConfiguration: z.string().optional(),
  active: z.boolean().optional(),
  suspended: z.boolean().optional(),
  withOverridingJobPriority: z.boolean().optional(),
  tenantIdIn: z.array(z.string()).optional(),
  withoutTenantId: z.boolean().optional(),
  sortBy: z.enum(['jobDefinitionId', 'activityId', 'processDefinitionId', 'processDefinitionKey', 'jobType', 'jobConfiguration', 'tenantId']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  firstResult: z.number().optional(),
  maxResults: z.number().optional(),
});

export const SetJobRetriesRequest = z.object({
  retries: z.number(),
});

export const SetJobSuspensionStateRequest = z.object({
  suspended: z.boolean(),
});

export const SetJobDefinitionRetriesRequest = z.object({
  retries: z.number(),
});

export const SetJobDefinitionSuspensionStateRequest = z.object({
  suspended: z.boolean(),
  includeJobs: z.boolean().optional(),
  executionDate: z.string().optional(),
});

// Types
export type Job = z.infer<typeof JobSchema>;
export type JobDefinition = z.infer<typeof JobDefinitionSchema>;
export type JobQueryParams = z.infer<typeof JobQueryParams>;
export type JobDefinitionQueryParams = z.infer<typeof JobDefinitionQueryParams>;
export type SetJobRetriesRequest = z.infer<typeof SetJobRetriesRequest>;
export type SetJobSuspensionStateRequest = z.infer<typeof SetJobSuspensionStateRequest>;
export type SetJobDefinitionRetriesRequest = z.infer<typeof SetJobDefinitionRetriesRequest>;
export type SetJobDefinitionSuspensionStateRequest = z.infer<typeof SetJobDefinitionSuspensionStateRequest>;

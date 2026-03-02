import { z } from 'zod';

// Task schemas (API-only, no DB persistence)
export const TaskSchema = z.object({
  id: z.string(),
  name: z.string().optional().nullable(),
  assignee: z.string().optional().nullable(),
  owner: z.string().optional().nullable(),
  created: z.string().optional().nullable(),
  due: z.string().optional().nullable(),
  followUp: z.string().optional().nullable(),
  delegationState: z.enum(['PENDING', 'RESOLVED']).optional().nullable(),
  description: z.string().optional().nullable(),
  executionId: z.string().optional().nullable(),
  parentTaskId: z.string().optional().nullable(),
  priority: z.number().optional().nullable(),
  processDefinitionId: z.string().optional().nullable(),
  processInstanceId: z.string().optional().nullable(),
  taskDefinitionKey: z.string().optional().nullable(),
  caseExecutionId: z.string().optional().nullable(),
  caseInstanceId: z.string().optional().nullable(),
  caseDefinitionId: z.string().optional().nullable(),
  suspended: z.boolean().optional(),
  formKey: z.string().optional().nullable(),
  tenantId: z.string().optional().nullable(),
});

export const TaskFormSchema = z.object({
  key: z.string().optional().nullable(),
  contextPath: z.string().optional().nullable(),
  formFields: z.array(z.object({
    id: z.string(),
    label: z.string().optional().nullable(),
    type: z.string(),
    defaultValue: z.any().optional().nullable(),
    validationConstraints: z.array(z.any()).optional(),
    properties: z.record(z.any()).optional(),
  })).optional(),
});

// Request schemas
export const TaskQueryParams = z.object({
  processInstanceId: z.string().optional(),
  processDefinitionId: z.string().optional(),
  processDefinitionKey: z.string().optional(),
  assignee: z.string().optional(),
  assigneeLike: z.string().optional(),
  owner: z.string().optional(),
  candidateUser: z.string().optional(),
  candidateGroup: z.string().optional(),
  name: z.string().optional(),
  nameLike: z.string().optional(),
  description: z.string().optional(),
  descriptionLike: z.string().optional(),
  priority: z.number().optional(),
  maxPriority: z.number().optional(),
  minPriority: z.number().optional(),
  dueAfter: z.string().optional(),
  dueBefore: z.string().optional(),
  followUpAfter: z.string().optional(),
  followUpBefore: z.string().optional(),
  createdAfter: z.string().optional(),
  createdBefore: z.string().optional(),
  active: z.boolean().optional(),
  suspended: z.boolean().optional(),
  taskDefinitionKey: z.string().optional(),
  taskDefinitionKeyIn: z.array(z.string()).optional(),
  sortBy: z.enum(['instanceId', 'dueDate', 'executionId', 'assignee', 'created', 'description', 'id', 'name', 'priority']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  firstResult: z.number().optional(),
  maxResults: z.number().optional(),
});

export const ClaimTaskRequest = z.object({
  userId: z.string(),
});

export const SetAssigneeRequest = z.object({
  userId: z.string().nullable(),
});

export const CompleteTaskRequest = z.object({
  variables: z.record(z.object({
    value: z.any(),
    type: z.string().optional(),
  })).optional(),
  withVariablesInReturn: z.boolean().optional(),
});

export const TaskVariablesRequest = z.object({
  modifications: z.record(z.object({
    value: z.any(),
    type: z.string().optional(),
  })).optional(),
  deletions: z.array(z.string()).optional(),
});

// Types
export type Task = z.infer<typeof TaskSchema>;
export type TaskForm = z.infer<typeof TaskFormSchema>;
export type TaskQueryParams = z.infer<typeof TaskQueryParams>;
export type ClaimTaskRequest = z.infer<typeof ClaimTaskRequest>;
export type SetAssigneeRequest = z.infer<typeof SetAssigneeRequest>;
export type CompleteTaskRequest = z.infer<typeof CompleteTaskRequest>;
export type TaskVariablesRequest = z.infer<typeof TaskVariablesRequest>;

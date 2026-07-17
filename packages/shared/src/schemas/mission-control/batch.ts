import { z } from 'zod';

// Raw schema - matches TypeORM Batch entity
export const BatchSchemaRaw = z.object({
  id: z.string(),
  camundaBatchId: z.string().nullable(),
  type: z.string(),
  payload: z.string().nullable(),
  totalJobs: z.number().nullable(),
  jobsCreated: z.number().nullable(),
  completedJobs: z.number().nullable(),
  failedJobs: z.number().nullable(),
  remainingJobs: z.number().nullable(),
  invocationsPerBatchJob: z.number().nullable(),
  seedJobDefinitionId: z.string().nullable(),
  monitorJobDefinitionId: z.string().nullable(),
  batchJobDefinitionId: z.string().nullable(),
  status: z.string(),
  progress: z.number().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  completedAt: z.number().nullable(),
  lastError: z.string().nullable(),
  suspended: z.boolean().optional(),
});

// Batch schemas
export const BatchSchema = BatchSchemaRaw.transform((b) => ({
  id: b.id,
  camundaBatchId: b.camundaBatchId,
  type: b.type,
  payload: b.payload,
  totalJobs: b.totalJobs ?? undefined,
  jobsCreated: b.jobsCreated ?? undefined,
  completedJobs: b.completedJobs ?? undefined,
  failedJobs: b.failedJobs ?? undefined,
  remainingJobs: b.remainingJobs ?? undefined,
  invocationsPerBatchJob: b.invocationsPerBatchJob ?? undefined,
  seedJobDefinitionId: b.seedJobDefinitionId ?? undefined,
  monitorJobDefinitionId: b.monitorJobDefinitionId ?? undefined,
  batchJobDefinitionId: b.batchJobDefinitionId ?? undefined,
  status: b.status,
  progress: b.progress,
  createdBy: b.createdBy ?? undefined,
  createdAt: Number(b.createdAt ?? 0),
  updatedAt: Number(b.updatedAt ?? 0),
  completedAt: b.completedAt ? Number(b.completedAt) : undefined,
  lastError: b.lastError ?? undefined,
  suspended: b.suspended,
}));

export const BatchEngineInfoSchema = z.object({
  id: z.string().optional(),
  totalJobs: z.number().nullable().optional(),
  jobsCreated: z.number().nullable().optional(),
  completedJobs: z.number().nullable().optional(),
  failedJobs: z.number().nullable().optional(),
  remainingJobs: z.number().nullable().optional(),
  invocationsPerBatchJob: z.number().nullable().optional(),
  seedJobDefinitionId: z.string().nullable().optional(),
  monitorJobDefinitionId: z.string().nullable().optional(),
  batchJobDefinitionId: z.string().nullable().optional(),
}).passthrough();

export const BatchStatisticsSchema = z.object({
  remainingJobs: z.number().nullable().optional(),
  completedJobs: z.number().nullable().optional(),
  failedJobs: z.number().nullable().optional(),
}).passthrough();

export const BatchFailedJobDetailSchema = z.object({
  id: z.string().optional(),
  exceptionMessage: z.string().nullable().optional(),
  retries: z.number().nullable().optional(),
  jobDefinitionId: z.string().nullable().optional(),
  processInstanceId: z.string().nullable().optional(),
  executionId: z.string().nullable().optional(),
  stacktrace: z.string().nullable().optional(),
}).passthrough();

export const BatchRuntimeActionDecisionsSchema = z.object({
  suspension: z.object({ allowed: z.boolean(), reason: z.string().optional() }),
  cancel: z.object({ allowed: z.boolean(), reason: z.string().optional() }),
}).passthrough();

export const BatchDetailSchema = z.object({
  batch: BatchSchema,
  engine: BatchEngineInfoSchema.nullable().optional(),
  statistics: BatchStatisticsSchema.nullable().optional(),
  failedJobDetails: z.array(BatchFailedJobDetailSchema).optional(),
  runtimeActionDecisions: BatchRuntimeActionDecisionsSchema.optional(),
}).strict();

export const BatchInsertSchema = z.object({
  id: z.string().uuid().optional(),
  camundaBatchId: z.string().optional(),
  type: z.string(),
  payload: z.string().optional(),
  status: z.string().optional(),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
});

export const BatchOperationCreateResponseSchema = z.object({
  id: z.string(),
  camundaBatchId: z.string().optional(),
  type: z.enum([
    'DELETE_INSTANCES',
    'SUSPEND_INSTANCES',
    'ACTIVATE_INSTANCES',
    'SET_JOB_RETRIES',
  ]),
}).strict();

// Types
export type Batch = z.infer<typeof BatchSchema>;
export type BatchEngineInfo = z.infer<typeof BatchEngineInfoSchema>;
export type BatchStatistics = z.infer<typeof BatchStatisticsSchema>;
export type BatchFailedJobDetail = z.infer<typeof BatchFailedJobDetailSchema>;
export type BatchRuntimeActionDecisions = z.infer<typeof BatchRuntimeActionDecisionsSchema>;
export type BatchDetail = z.infer<typeof BatchDetailSchema>;
export type BatchOperationCreateResponse = z.infer<typeof BatchOperationCreateResponseSchema>;

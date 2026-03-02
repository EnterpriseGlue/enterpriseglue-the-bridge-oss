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
}));

export const BatchInsertSchema = z.object({
  id: z.string().uuid().optional(),
  camundaBatchId: z.string().optional(),
  type: z.string(),
  payload: z.string().optional(),
  status: z.string().optional(),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
});

// Types
export type Batch = z.infer<typeof BatchSchema>;

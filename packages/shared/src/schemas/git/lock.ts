import { z } from 'zod';

// Raw schema - matches TypeORM GitLock entity
export const LockSchemaRaw = z.object({
  id: z.string(),
  fileId: z.string(),
  userId: z.string(),
  acquiredAt: z.number(),
  expiresAt: z.number(),
  heartbeatAt: z.number(),
  released: z.boolean(),
  releasedAt: z.number().nullable(),
});

// Select schema (database -> API response)
export const LockSelectSchema = LockSchemaRaw.transform((l) => ({
  id: l.id,
  fileId: l.fileId,
  userId: l.userId,
  acquiredAt: Number(l.acquiredAt),
  expiresAt: Number(l.expiresAt),
  heartbeatAt: Number(l.heartbeatAt),
  released: l.released,
  releasedAt: l.releasedAt ? Number(l.releasedAt) : undefined,
}));

// Insert schema (API request -> database)
export const LockInsertSchema = z.object({
  id: z.string().uuid().optional(),
});

// API-specific schemas
export const AcquireLockRequestSchema = z.object({
  fileId: z.string().uuid(),
});

export const ReleaseLockRequestSchema = z.object({
  lockId: z.string().uuid(),
});

export const LockResponseSchema = z.object({
  id: z.string().uuid(),
  fileId: z.string().uuid(),
  userId: z.string().uuid(),
  acquiredAt: z.number(),
  expiresAt: z.number(),
  heartbeatAt: z.number(),
});

// Types
export type Lock = z.infer<typeof LockSelectSchema>;
export type LockInsert = z.infer<typeof LockInsertSchema>;
export type AcquireLockRequest = z.infer<typeof AcquireLockRequestSchema>;
export type ReleaseLockRequest = z.infer<typeof ReleaseLockRequestSchema>;
export type LockResponse = z.infer<typeof LockResponseSchema>;

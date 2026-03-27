import { z } from 'zod';

export const LockVisibilityStateSchema = z.enum(['visible', 'hidden']);
export const LockSessionStatusSchema = z.enum(['active', 'idle', 'hidden']);

// Raw schema - matches TypeORM GitLock entity
export const LockSchemaRaw = z.object({
  id: z.string(),
  fileId: z.string(),
  userId: z.string(),
  acquiredAt: z.number(),
  lastInteractionAt: z.number(),
  expiresAt: z.number(),
  heartbeatAt: z.number(),
  visibilityState: LockVisibilityStateSchema,
  visibilityChangedAt: z.number(),
  released: z.boolean(),
  releasedAt: z.number().nullable(),
});

// Select schema (database -> API response)
export const LockSelectSchema = LockSchemaRaw.transform((l) => ({
  id: l.id,
  fileId: l.fileId,
  userId: l.userId,
  acquiredAt: Number(l.acquiredAt),
  lastInteractionAt: Number(l.lastInteractionAt),
  expiresAt: Number(l.expiresAt),
  heartbeatAt: Number(l.heartbeatAt),
  visibilityState: l.visibilityState,
  visibilityChangedAt: Number(l.visibilityChangedAt),
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
  force: z.boolean().optional(),
  visibilityState: LockVisibilityStateSchema.optional(),
  hasInteraction: z.boolean().optional(),
});

export const ReleaseLockRequestSchema = z.object({
  lockId: z.string().uuid(),
});

export const LockHeartbeatRequestSchema = z.object({
  visibilityState: LockVisibilityStateSchema.optional(),
  hasInteraction: z.boolean().optional(),
});

export const LockHolderSchema = z.object({
  userId: z.string().uuid(),
  name: z.string(),
  acquiredAt: z.number(),
  heartbeatAt: z.number(),
  lastInteractionAt: z.number(),
  visibilityState: LockVisibilityStateSchema,
  visibilityChangedAt: z.number(),
  sessionStatus: LockSessionStatusSchema,
});

export const LockResponseSchema = z.object({
  id: z.string().uuid(),
  fileId: z.string().uuid(),
  userId: z.string().uuid(),
  acquiredAt: z.number(),
  lastInteractionAt: z.number(),
  expiresAt: z.number(),
  heartbeatAt: z.number(),
  visibilityState: LockVisibilityStateSchema,
  visibilityChangedAt: z.number(),
  sessionStatus: LockSessionStatusSchema,
  userName: z.string().optional(),
});

// Types
export type Lock = z.infer<typeof LockSelectSchema>;
export type LockInsert = z.infer<typeof LockInsertSchema>;
export type AcquireLockRequest = z.infer<typeof AcquireLockRequestSchema>;
export type ReleaseLockRequest = z.infer<typeof ReleaseLockRequestSchema>;
export type LockHeartbeatRequest = z.infer<typeof LockHeartbeatRequestSchema>;
export type LockHolder = z.infer<typeof LockHolderSchema>;
export type LockResponse = z.infer<typeof LockResponseSchema>;

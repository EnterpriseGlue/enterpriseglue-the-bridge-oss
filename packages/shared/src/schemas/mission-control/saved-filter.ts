import { z } from 'zod';

// Raw schema - matches TypeORM SavedFilter entity
export const SavedFilterSchemaRaw = z.object({
  id: z.string(),
  name: z.string(),
  engineId: z.string(),
  defKeys: z.string(),
  version: z.number().nullable(),
  active: z.boolean().nullable(),
  incidents: z.boolean().nullable(),
  completed: z.boolean().nullable(),
  canceled: z.boolean().nullable(),
  createdAt: z.number(),
});

// Transport schemas keep JSON storage details out of the API. New reads use
// numeric versions; a create response can retain a legacy string version
// until it is round-tripped through the integer persistence column.
export const SavedFilterCreateRequestSchema = z.object({
  name: z.string().min(1).max(255),
  engineId: z.string().min(1),
  defKeys: z.array(z.string()).default([]),
  version: z.string().nullable().optional(),
  active: z.boolean().default(false),
  incidents: z.boolean().default(false),
  completed: z.boolean().default(false),
  canceled: z.boolean().default(false),
});

export const SavedFilterUpdateRequestSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  engineId: z.string().min(1).optional(),
  defKeys: z.array(z.string()).optional(),
  version: z.string().nullable().optional(),
  active: z.boolean().optional(),
  incidents: z.boolean().optional(),
  completed: z.boolean().optional(),
  canceled: z.boolean().optional(),
});

export const SavedFilterResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  engineId: z.string(),
  defKeys: z.array(z.string()),
  version: z.union([z.number(), z.string()]).nullable(),
  active: z.boolean(),
  incidents: z.boolean(),
  completed: z.boolean(),
  canceled: z.boolean(),
  createdAt: z.number(),
}).strict();

/** @deprecated Use SavedFilterResponseSchema. */
export const SavedFilterSchema = SavedFilterResponseSchema;

export const SavedFilterInsertSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  engineId: z.string().uuid(),
  defKeys: z.string(),
  version: z.number().optional(),
  active: z.boolean().optional(),
  incidents: z.boolean().optional(),
  completed: z.boolean().optional(),
  canceled: z.boolean().optional(),
  createdAt: z.number().optional(),
});

// Types
export type SavedFilter = z.infer<typeof SavedFilterResponseSchema>;
export type SavedFilterCreateRequest = z.infer<typeof SavedFilterCreateRequestSchema>;
export type SavedFilterUpdateRequest = z.infer<typeof SavedFilterUpdateRequestSchema>;

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

// Saved filter schema - transformed from Raw (for API responses)
export const SavedFilterSchema = SavedFilterSchemaRaw.transform((f) => ({
  id: f.id,
  name: f.name,
  engineId: f.engineId,
  defKeys: f.defKeys,
  version: f.version ?? undefined,
  active: Boolean(f.active),
  incidents: Boolean(f.incidents),
  completed: Boolean(f.completed),
  canceled: Boolean(f.canceled),
  createdAt: Number(f.createdAt ?? 0),
}));

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
export type SavedFilter = z.infer<typeof SavedFilterSchema>;

import { z } from 'zod';

// Raw schema - matches TypeORM Version entity
export const VersionSchemaRaw = z.object({
  id: z.string(),
  fileId: z.string(),
  author: z.string().nullable(),
  message: z.string().nullable(),
  xml: z.string(),
  createdAt: z.number(),
});

// Select schema (read responses)
export const VersionSchema = VersionSchemaRaw.transform((v) => ({
  id: v.id,
  fileId: v.fileId,
  author: v.author ?? undefined,
  message: v.message,
  xml: v.xml,
  createdAt: Number(v.createdAt ?? 0),
}));

// Insert schema
export const VersionInsertSchema = z.object({
  id: z.string().uuid().optional(),
  fileId: z.string().uuid(),
  author: z.string().optional(),
  message: z.string(),
  xml: z.string(),
  createdAt: z.number().optional(),
});

// Response schemas
export const CompareVersionsResponse = z.object({
  versionA: VersionSchema.optional(),
  versionB: VersionSchema.optional(),
  diff: z.string().optional(),
});

// Types
export type Version = z.infer<typeof VersionSchema>;

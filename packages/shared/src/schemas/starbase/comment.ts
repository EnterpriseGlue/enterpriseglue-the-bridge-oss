import { z } from 'zod';

// Raw schema - matches TypeORM Comment entity
export const CommentSchemaRaw = z.object({
  id: z.string(),
  fileId: z.string(),
  author: z.string().nullable(),
  message: z.string(),
  createdAt: z.number(),
});

// Select schema (read responses)
export const CommentSchema = CommentSchemaRaw.transform((c) => ({
  id: c.id,
  author: c.author ?? undefined,
  message: c.message,
  createdAt: Number(c.createdAt ?? 0),
}));

// Insert schema
export const CommentInsertSchema = z.object({
  id: z.string().uuid().optional(),
  fileId: z.string().uuid(),
  author: z.string().optional(),
  message: z.string(),
  createdAt: z.number().optional(),
});

// Types
export type Comment = z.infer<typeof CommentSchema>;

import { z } from 'zod';

// Raw schema - matches TypeORM Project entity
export const ProjectSchemaRaw = z.object({
  id: z.string(),
  name: z.string(),
  ownerId: z.string().nullable().optional(),
  gitUrl: z.string().nullable().optional(),
  createdAt: z.number(),
  updatedAt: z.number().optional(),
});

// Select schema (read responses)
export const ProjectSchema = ProjectSchemaRaw.transform((p) => ({
  id: p.id,
  name: p.name,
  createdAt: Number(p.createdAt ?? 0),
}));

// Insert schema (request payloads)
export const ProjectInsertSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  createdAt: z.number().optional(),
});

// Request schemas
export const CreateProjectRequest = ProjectInsertSchema.pick({ name: true });
export const RenameProjectRequest = z.object({ name: z.string().min(1) });

// Types
export type Project = z.infer<typeof ProjectSchema>;
export type CreateProject = z.infer<typeof CreateProjectRequest>;

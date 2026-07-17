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

// Project Overview keeps a small compatibility projection for collaborators.
// These role labels are display data only; authorization is enforced before the
// list is assembled by the visible-project resolver.
export const ProjectOverviewMemberSchema = z.object({
  userId: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  role: z.string(),
  roles: z.array(z.string()).optional(),
  deployAllowed: z.boolean().nullable().optional(),
}).passthrough();

export const ProjectOverviewProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  foldersCount: z.number().int().nonnegative().optional(),
  filesCount: z.number().int().nonnegative().optional(),
  gitUrl: z.string().nullable().optional(),
  gitProviderType: z.string().nullable().optional(),
  gitSyncStatus: z.number().nullable().optional(),
  members: z.array(ProjectOverviewMemberSchema).optional(),
}).passthrough();

export const ProjectOverviewListSchema = z.array(ProjectOverviewProjectSchema);

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
export type ProjectOverviewMember = z.infer<typeof ProjectOverviewMemberSchema>;
export type ProjectOverviewProject = z.infer<typeof ProjectOverviewProjectSchema>;
export type ProjectOverviewList = z.infer<typeof ProjectOverviewListSchema>;
export type CreateProject = z.infer<typeof CreateProjectRequest>;

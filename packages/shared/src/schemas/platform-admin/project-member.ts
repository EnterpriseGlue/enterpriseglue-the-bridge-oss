import { z } from 'zod';

// Project roles
export const ProjectRoleSchema = z.enum(['owner', 'delegate', 'developer', 'editor', 'viewer']);

const EditableProjectRoleSchema = z.enum(['delegate', 'developer', 'editor', 'viewer']);

// User summary for member responses
export const UserSummarySchema = z.object({
  id: z.string(),
  email: z.string(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
});

// Project member schema (read responses)
export const ProjectMemberSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  userId: z.string(),
  role: ProjectRoleSchema,
  roles: z.array(ProjectRoleSchema).optional(),
  invitedById: z.string().nullable().optional(),
  joinedAt: z.number(),
  user: UserSummarySchema.optional(),
});

// Request schemas
export const AddProjectMemberRequest = z.object({
  email: z.string().email(),
  role: EditableProjectRoleSchema.optional(),
  roles: z.array(EditableProjectRoleSchema).optional(),
});

export const UpdateProjectMemberRoleRequest = z.object({
  role: EditableProjectRoleSchema.optional(),
  roles: z.array(EditableProjectRoleSchema).optional(), // Can't promote to owner
});

export const TransferProjectOwnershipRequest = z.object({
  newOwnerId: z.string().uuid(),
});

// Types
export type ProjectRole = z.infer<typeof ProjectRoleSchema>;
export type ProjectMember = z.infer<typeof ProjectMemberSchema>;
export type AddProjectMember = z.infer<typeof AddProjectMemberRequest>;

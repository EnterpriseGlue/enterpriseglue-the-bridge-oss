import { z } from 'zod';

// Project roles
export const ProjectRoleSchema = z.enum(['owner', 'delegate', 'developer', 'editor', 'viewer']);

export const EditableProjectRoleSchema = z.enum(['delegate', 'developer', 'editor', 'viewer']);

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

/**
 * Starbase's project-members collection augments a canonical member with the
 * legacy deploy-grant display state. The grant remains presentation data;
 * protected deployment routes still evaluate canonical permissions.
 */
export const ProjectMemberAccessViewSchema = ProjectMemberSchema.extend({
  deployAllowed: z.boolean().nullable().optional(),
  user: UserSummarySchema.nullable().optional(),
});

export const ProjectPendingInviteStatusSchema = z.enum(['pending', 'expired', 'onboarding']);
export const ProjectPendingInviteSchema = z.object({
  invitationId: z.string(),
  userId: z.string(),
  email: z.string().email(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  role: ProjectRoleSchema,
  roles: z.array(ProjectRoleSchema).optional(),
  status: ProjectPendingInviteStatusSchema,
  deliveryMethod: z.enum(['email', 'manual']),
  expiresAt: z.number(),
  createdAt: z.number(),
});

export const ProjectMembersResponseSchema = z.object({
  members: z.array(ProjectMemberAccessViewSchema),
  pendingInvites: z.array(ProjectPendingInviteSchema),
});

/** Candidate returned while preparing a project-member invite or direct add. */
export const ProjectMemberCandidateSchema = UserSummarySchema;
export const ProjectMemberLookupSchema = z.object({
  mode: z.enum(['invite', 'existing-member', 'direct-add']),
  user: ProjectMemberCandidateSchema.nullable().optional(),
});

/** Delivery options that the project-member invitation flow can offer. */
export const ProjectMemberCapabilitiesSchema = z.object({
  ssoRequired: z.boolean(),
  emailConfigured: z.boolean(),
});

/** Direct-add responses intentionally omit roster timestamps returned by list APIs. */
export const ProjectMemberDirectAddResponseSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  userId: z.string(),
  role: ProjectRoleSchema,
  roles: z.array(ProjectRoleSchema),
  user: UserSummarySchema,
  invited: z.literal(false),
});

export const ProjectMemberInvitationResponseSchema = z.object({
  invited: z.literal(true),
  emailSent: z.boolean(),
  emailError: z.string().optional(),
  inviteUrl: z.string().optional(),
  oneTimePassword: z.string().optional(),
});

export const ProjectMemberAddResponseSchema = z.union([
  ProjectMemberDirectAddResponseSchema,
  ProjectMemberInvitationResponseSchema,
]);

export const UpdateProjectDeployGrantRequestSchema = z.object({ allowed: z.boolean() });
export const ProjectDeployGrantResponseSchema = z.object({ allowed: z.boolean() });
export const ReissuedManualProjectInvitationSchema = z.object({
  invited: z.literal(true),
  emailSent: z.literal(false),
  inviteUrl: z.string().optional(),
  oneTimePassword: z.string().optional(),
});

// Request schemas
export const AddProjectMemberRequest = z.object({
  email: z.string().email(),
  role: EditableProjectRoleSchema.optional(),
  roles: z.array(EditableProjectRoleSchema).optional(),
  deliveryMethod: z.enum(['email', 'manual']).optional(),
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
export type EditableProjectRole = z.infer<typeof EditableProjectRoleSchema>;
export type ProjectMember = z.infer<typeof ProjectMemberSchema>;
export type ProjectMemberAccessView = z.infer<typeof ProjectMemberAccessViewSchema>;
export type ProjectPendingInviteStatus = z.infer<typeof ProjectPendingInviteStatusSchema>;
export type ProjectPendingInvite = z.infer<typeof ProjectPendingInviteSchema>;
export type ProjectMembersResponse = z.infer<typeof ProjectMembersResponseSchema>;
export type ProjectMemberCandidate = z.infer<typeof ProjectMemberCandidateSchema>;
export type ProjectMemberLookup = z.infer<typeof ProjectMemberLookupSchema>;
export type ProjectMemberCapabilities = z.infer<typeof ProjectMemberCapabilitiesSchema>;
export type ProjectMemberDirectAddResponse = z.infer<typeof ProjectMemberDirectAddResponseSchema>;
export type ProjectMemberInvitationResponse = z.infer<typeof ProjectMemberInvitationResponseSchema>;
export type ProjectMemberAddResponse = z.infer<typeof ProjectMemberAddResponseSchema>;
export type UpdateProjectDeployGrantRequest = z.infer<typeof UpdateProjectDeployGrantRequestSchema>;
export type ProjectDeployGrantResponse = z.infer<typeof ProjectDeployGrantResponseSchema>;
export type ReissuedManualProjectInvitation = z.infer<typeof ReissuedManualProjectInvitationSchema>;
export type AddProjectMember = z.infer<typeof AddProjectMemberRequest>;
export type UpdateProjectMemberRole = z.infer<typeof UpdateProjectMemberRoleRequest>;

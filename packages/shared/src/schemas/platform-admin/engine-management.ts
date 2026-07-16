import { z } from 'zod';
import { UserSummarySchema } from './project-member.js';
import { EngineAuthTypeSchema, EngineConnectionModeSchema } from '../mission-control/engine.js';

// Engine roles
export const EngineRoleSchema = z.enum(['owner', 'delegate', 'operator', 'deployer', 'custom']);

// Engine member schema (read responses)
export const EngineMemberSchema = z.object({
  id: z.string(),
  engineId: z.string(),
  userId: z.string(),
  role: z.string(),
  grantedById: z.string().nullable().optional(),
  createdAt: z.number(),
  user: UserSummarySchema.nullable().optional(),
});

export const PendingEngineInviteSchema = z.object({
  invitationId: z.string(),
  userId: z.string(),
  email: z.string().email(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  role: z.enum(['operator', 'deployer']),
  status: z.enum(['pending', 'expired', 'onboarding']),
  deliveryMethod: z.enum(['email', 'manual']),
  expiresAt: z.number(),
  createdAt: z.number(),
});

export const EngineMembersResponseSchema = z.object({
  members: z.array(EngineMemberSchema),
  pendingInvites: z.array(PendingEngineInviteSchema),
});

/**
 * A pending project-to-engine access request. The API deliberately exposes
 * only the request record: project and requester display details are resolved
 * by separately authorized views rather than leaking relation data here.
 */
export const EngineProjectAccessRequestStatusSchema = z.enum(['pending', 'approved', 'denied']);
export const EngineProjectAccessRequestSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  engineId: z.string(),
  requestedById: z.string(),
  status: EngineProjectAccessRequestStatusSchema,
  createdAt: z.number(),
});

export const EngineMemberCandidateSchema = UserSummarySchema;
export const EngineMemberLookupSchema = z.object({
  mode: z.enum(['invite', 'existing-member', 'direct-add', 'direct-add-only']),
  user: EngineMemberCandidateSchema.nullable().optional(),
});

export const EngineMemberCapabilitiesSchema = z.object({
  ssoRequired: z.boolean(),
  emailConfigured: z.boolean(),
});

/** Direct member adds return assignment data, not an EngineMember roster row. */
export const EngineMemberDirectAddResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  role: z.enum(['operator', 'deployer']),
  user: UserSummarySchema,
  invited: z.literal(false),
});

export const EngineMemberInvitationResponseSchema = z.object({
  invited: z.literal(true),
  emailSent: z.boolean(),
  emailError: z.string().optional(),
  inviteUrl: z.string().optional(),
  oneTimePassword: z.string().optional(),
});

export const EngineMemberAddResponseSchema = z.union([
  EngineMemberDirectAddResponseSchema,
  EngineMemberInvitationResponseSchema,
]);

export const ReissuedManualEngineInvitationSchema = z.object({
  invited: z.literal(true),
  emailSent: z.literal(false),
  inviteUrl: z.string().optional(),
  oneTimePassword: z.string().optional(),
});

export const EngineRuntimeAccessScopeSchema = z.enum(['engine_wide', 'resource_aware']);
export const EngineDeploymentIntegrationSchema = z.enum(['enterpriseglue_proxy', 'direct_engine']);
export const EngineEndpointAuthenticationSummarySchema = z.object({
  type: EngineAuthTypeSchema.nullable(),
  credentialsConfigured: z.boolean(),
  oauthTokenEndpointConfigured: z.boolean(),
  oauthScopesConfigured: z.boolean(),
  oauthAudienceConfigured: z.boolean(),
});

/**
 * Accountable contacts are governance metadata. They are never an
 * authorization input; `role` below is the evaluator-derived effective role.
 */
export const EngineGovernanceMetadataSchema = z.object({
  accountableOwnerId: z.string().nullable(),
  accountableDelegateId: z.string().nullable(),
});

// Engine with details (for my-engines endpoint)
export const EngineWithDetailsSchema = z.object({
  engine: z.object({
    id: z.string(),
    name: z.string(),
    baseUrl: z.string(),
    type: z.string().nullable().optional(),
    authType: z.string().nullable().optional(),
    connectionMode: EngineConnectionModeSchema,
    runtimeAccessScope: EngineRuntimeAccessScopeSchema,
    deploymentIntegration: EngineDeploymentIntegrationSchema,
    endpointAuthentication: EngineEndpointAuthenticationSummarySchema,
    governance: EngineGovernanceMetadataSchema,
    /** @deprecated Use `governance.accountableOwnerId`. */
    ownerId: z.string().nullable().optional(),
    /** @deprecated Use `governance.accountableDelegateId`. */
    delegateId: z.string().nullable().optional(),
    environmentTagId: z.string().nullable().optional(),
    environmentLocked: z.boolean().optional(),
    version: z.string().nullable().optional(),
    createdAt: z.number(),
    updatedAt: z.number(),
  }),
  role: EngineRoleSchema,
  environmentTag: z.object({
    id: z.string(),
    name: z.string(),
    color: z.string(),
    manualDeployAllowed: z.boolean(),
  }).nullable().optional(),
});

// Request schemas
export const AddEngineMemberRequest = z.object({
  email: z.string().email(),
  role: z.enum(['operator', 'deployer']),
  deliveryMethod: z.enum(['email', 'manual']).optional(),
});

export const UpdateEngineMemberRoleRequest = z.object({
  role: z.enum(['operator', 'deployer']),
});

export const AssignDelegateRequest = z.object({
  email: z.string().email().nullable(),
});

export const TransferEngineOwnershipRequest = z.object({
  newOwnerEmail: z.string().email(),
});

export const SetEnvironmentRequest = z.object({
  environmentTagId: z.string(),
});

export const EngineEnvironmentUpdateResponseSchema = z.object({
  message: z.literal('Environment tag updated'),
});

export const SetLockedRequest = z.object({
  locked: z.boolean(),
});

export const RequestAccessRequest = z.object({
  projectId: z.string().uuid(),
});

export const EngineProjectAccessRequestResultSchema = z.object({
  status: z.string(),
  autoApproved: z.boolean().optional(),
  requestId: z.string().optional(),
});

export const EngineRoleResponse = z.object({
  role: EngineRoleSchema.nullable(),
});

// Types
export type EngineRole = z.infer<typeof EngineRoleSchema>;
export type EngineMember = z.infer<typeof EngineMemberSchema>;
export type PendingEngineInvite = z.infer<typeof PendingEngineInviteSchema>;
export type EngineMembersResponse = z.infer<typeof EngineMembersResponseSchema>;
export type EngineProjectAccessRequestStatus = z.infer<typeof EngineProjectAccessRequestStatusSchema>;
export type EngineProjectAccessRequest = z.infer<typeof EngineProjectAccessRequestSchema>;
export type EngineMemberCandidate = z.infer<typeof EngineMemberCandidateSchema>;
export type EngineMemberLookup = z.infer<typeof EngineMemberLookupSchema>;
export type EngineMemberCapabilities = z.infer<typeof EngineMemberCapabilitiesSchema>;
export type EngineMemberDirectAddResponse = z.infer<typeof EngineMemberDirectAddResponseSchema>;
export type EngineMemberInvitationResponse = z.infer<typeof EngineMemberInvitationResponseSchema>;
export type EngineMemberAddResponse = z.infer<typeof EngineMemberAddResponseSchema>;
export type ReissuedManualEngineInvitation = z.infer<typeof ReissuedManualEngineInvitationSchema>;
export type EngineWithDetails = z.infer<typeof EngineWithDetailsSchema>;
export type EngineEndpointAuthenticationSummary = z.infer<typeof EngineEndpointAuthenticationSummarySchema>;
export type EngineGovernanceMetadata = z.infer<typeof EngineGovernanceMetadataSchema>;
export type EngineEnvironmentUpdateResponse = z.infer<typeof EngineEnvironmentUpdateResponseSchema>;
export type AddEngineMember = z.infer<typeof AddEngineMemberRequest>;
export type EngineProjectAccessRequestResult = z.infer<typeof EngineProjectAccessRequestResultSchema>;

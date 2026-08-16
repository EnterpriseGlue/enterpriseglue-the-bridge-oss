import { z } from 'zod';

export const UserDirectoryStatusSchema = z.enum(['invited', 'active', 'locked', 'deactivated']);
export const UserAuthenticationSourceSchema = z.enum(['none', 'local', 'oidc', 'saml', 'ldap', 'recovery']);
export const UserProvisioningSourceSchema = z.enum(['none', 'jit', 'scim', 'ldap']);
export const UserFieldOwnershipSchema = z.enum(['application', 'directory']);

/** Backward-compatible `/api/users` contracts shared by routes and OpenAPI. */
export const PlatformUserCreateRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  firstName: z.string().trim().max(255).optional(),
  lastName: z.string().trim().max(255).optional(),
  role: z.enum(['admin', 'user']).optional(),
  platformRole: z.enum(['admin', 'user']).optional(),
  sendEmail: z.boolean().default(true),
}).strict();

export const PlatformUserUpdateRequestSchema = z.object({
  firstName: z.string().trim().max(255).optional(),
  lastName: z.string().trim().max(255).optional(),
  role: z.enum(['admin', 'user']).optional(),
  platformRole: z.enum(['admin', 'user']).optional(),
  isActive: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'Provide at least one user change');

export const PlatformUserResponseSchema = z.object({
  id: z.string().min(1),
  email: z.string().email().max(320),
  firstName: z.string().max(255).nullable(),
  lastName: z.string().max(255).nullable(),
  platformRole: z.enum(['admin', 'user']),
  authProvider: z.string().min(1).max(128),
  isActive: z.boolean(),
  isEmailVerified: z.boolean(),
  mustResetPassword: z.boolean(),
  adminStatus: z.enum(['pending', 'active', 'inactive']),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  lastLoginAt: z.number().int().nonnegative().nullable(),
  createdByUserId: z.string().nullable(),
  failedLoginAttempts: z.number().int().nonnegative().optional(),
  lockedUntil: z.number().int().nonnegative().nullable().optional(),
}).strict();

export const PlatformUserCreateResponseSchema = z.object({
  user: PlatformUserResponseSchema,
  inviteUrl: z.string().url().optional(),
  oneTimePassword: z.string().min(1).max(1024).optional(),
  emailSent: z.boolean(),
  emailError: z.string().max(1000).optional(),
}).strict();

export const UserOperationMessageSchema = z.object({ message: z.string().min(1).max(1000) }).strict();

export const UserDirectoryQuerySchema = z.object({
  search: z.string().trim().min(1).max(320).optional(),
  status: UserDirectoryStatusSchema.optional(),
  authenticationSource: UserAuthenticationSourceSchema.optional(),
  provisioningSource: UserProvisioningSourceSchema.optional(),
  provisioningDirectoryKey: z.string().min(1).max(128).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
}).strict();

export const UserDirectorySummarySchema = z.object({
  id: z.string().min(1),
  email: z.string().email().max(320),
  firstName: z.string().max(255).nullable(),
  lastName: z.string().max(255).nullable(),
  displayName: z.string().max(512),
  status: UserDirectoryStatusSchema,
  platformRole: z.string().min(1).max(128),
  authenticationSources: z.array(UserAuthenticationSourceSchema).min(1),
  provisioningSource: UserProvisioningSourceSchema,
  provisioningDirectoryKey: z.string().max(128).nullable(),
  lastSignInAt: z.number().int().nonnegative().nullable(),
  lastProvisionedAt: z.number().int().nonnegative().nullable(),
  provisioningHealth: z.enum(['healthy', 'warning', 'failed', 'not_applicable']),
}).strict();

export const UserDirectoryListResponseSchema = z.object({
  items: z.array(UserDirectorySummarySchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
}).strict();

export const UserLinkedIdentitySchema = z.object({
  id: z.string().min(1),
  sourceType: z.enum(['identity_provider', 'provisioning_directory']),
  sourceKey: z.string().min(1).max(128),
  sourceName: z.string().min(1).max(255),
  externalSubject: z.string().min(1).max(2000),
  status: z.enum(['active', 'inactive', 'unlinked', 'archived']),
  linkedAt: z.number().int().nonnegative(),
  lastSeenAt: z.number().int().nonnegative().nullable(),
}).strict();

export const UserFieldOwnershipRecordSchema = z.object({
  field: z.enum(['email', 'firstName', 'lastName', 'displayName', 'active']),
  owner: UserFieldOwnershipSchema,
  sourceKey: z.string().max(128).nullable(),
}).strict();

export const UserIdentityContextSchema = z.object({
  user: UserDirectorySummarySchema,
  linkedIdentities: z.array(UserLinkedIdentitySchema),
  fieldOwnership: z.array(UserFieldOwnershipRecordSchema),
  recoveryAdministrator: z.boolean(),
}).strict();

export const UserAccessLineageSchema = z.object({
  sourceType: z.enum(['manual', 'directory_mapping', 'configuration', 'api', 'provider_mapping']),
  sourceId: z.string().max(255).nullable(),
  sourceName: z.string().max(512).nullable(),
  assignmentType: z.enum(['platform_role', 'group', 'role', 'resource']),
  assignmentId: z.string().min(1).max(255),
  assignmentName: z.string().min(1).max(512),
  active: z.boolean(),
}).strict();

export const UserEffectiveAccessResponseSchema = z.object({
  userId: z.string().min(1),
  platformRole: z.string().min(1).max(128),
  lineage: z.array(UserAccessLineageSchema),
  evaluatedAt: z.number().int().nonnegative(),
}).strict();

export const UserSessionSummarySchema = z.object({
  id: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  lastUsedAt: z.number().int().nonnegative().nullable(),
  expiresAt: z.number().int().nonnegative(),
  revokedAt: z.number().int().nonnegative().nullable(),
  authenticationSource: UserAuthenticationSourceSchema,
  ipAddress: z.string().max(128).nullable(),
  userAgent: z.string().max(1000).nullable(),
}).strict();

export const UserSessionsResponseSchema = z.object({
  userId: z.string().min(1),
  sessions: z.array(UserSessionSummarySchema),
}).strict();

export const UserAuditSummarySchema = z.object({
  id: z.string().min(1),
  action: z.string().min(1).max(255),
  outcome: z.enum(['success', 'failure', 'denied']),
  actorId: z.string().max(255).nullable(),
  sourceType: z.string().max(128).nullable(),
  reason: z.string().max(1000).nullable(),
  occurredAt: z.number().int().nonnegative(),
}).strict();

export const UserAuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
}).strict();

export const UserAuditResponseSchema = z.object({
  userId: z.string().min(1),
  events: z.array(UserAuditSummarySchema),
}).strict();

const UserLifecycleReasonSchema = z.string().trim().min(3).max(500);
export const UserDeactivateRequestSchema = z.object({ reason: UserLifecycleReasonSchema }).strict();
export const UserReactivateRequestSchema = z.object({ reason: UserLifecycleReasonSchema }).strict();
export const UserRevokeSessionsRequestSchema = z.object({ reason: UserLifecycleReasonSchema }).strict();
export const UserLifecycleMutationResponseSchema = z.object({
  userId: z.string().min(1),
  status: UserDirectoryStatusSchema,
  authSessionVersion: z.number().int().nonnegative(),
  changedAt: z.number().int().nonnegative(),
}).strict();

export type UserDirectorySummary = z.infer<typeof UserDirectorySummarySchema>;
export type UserDirectoryListResponse = z.infer<typeof UserDirectoryListResponseSchema>;
export type UserIdentityContext = z.infer<typeof UserIdentityContextSchema>;
export type UserEffectiveAccessResponse = z.infer<typeof UserEffectiveAccessResponseSchema>;
export type UserSessionsResponse = z.infer<typeof UserSessionsResponseSchema>;
export type UserAuditResponse = z.infer<typeof UserAuditResponseSchema>;
export type UserLifecycleMutationResponse = z.infer<typeof UserLifecycleMutationResponseSchema>;
export type PlatformUserCreateRequest = z.infer<typeof PlatformUserCreateRequestSchema>;
export type PlatformUserUpdateRequest = z.infer<typeof PlatformUserUpdateRequestSchema>;
export type PlatformUserResponse = z.infer<typeof PlatformUserResponseSchema>;

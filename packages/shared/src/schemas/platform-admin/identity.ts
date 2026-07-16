import { z } from 'zod';

/** Provider-neutral contracts shared by adapters, mapping services, and API schemas. */
export const IdentityProviderProtocolSchema = z.enum(['oidc', 'saml', 'ldap']);
export const ExternalEntitlementTypeSchema = z.enum(['group', 'role', 'scope', 'attribute', 'authenticated']);

export const ExternalEntitlementSchema = z.object({
  type: ExternalEntitlementTypeSchema,
  externalId: z.string().min(1).max(2000),
  displayName: z.string().min(1).max(2000).optional(),
  value: z.string().min(1).max(2000).optional(),
}).strict();

export const ProviderIdentityInputSchema = z.object({
  providerKey: z.string().min(1).max(160),
  subjectId: z.string().min(1).max(2000),
  claims: z.record(z.string(), z.unknown()),
  username: z.string().min(1).max(320).nullable().optional(),
  email: z.string().min(1).max(320).nullable().optional(),
  directoryTenantId: z.string().min(1).max(2000).nullable().optional(),
  observedAt: z.number().int().nonnegative().optional(),
}).strict();

export const NormalizedExternalIdentitySchema = z.object({
  providerKey: z.string().min(1).max(160),
  providerType: IdentityProviderProtocolSchema,
  subjectId: z.string().min(1).max(2000),
  username: z.string().min(1).max(320).optional(),
  email: z.string().min(1).max(320).optional(),
  directoryTenantId: z.string().min(1).max(2000).optional(),
  entitlements: z.array(ExternalEntitlementSchema),
  observedAt: z.number().int().nonnegative(),
}).strict();

/** Provider-neutral persisted configuration, without resolved secret values. */
export const IdentityProviderRecordSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().nullable(),
  key: z.string().min(1).max(128),
  providerKeyIdentity: z.string().min(1),
  protocol: IdentityProviderProtocolSchema,
  isEnabled: z.boolean(),
  authenticationMode: z.enum(['direct', 'claims_only']),
  directoryTenantId: z.string().nullable(),
  configurationJson: z.string(),
  syncJson: z.string(),
  ownershipMode: z.string().min(1).max(64),
  sourceRef: z.string().nullable(),
  sourceHash: z.string().nullable(),
  lastAppliedAt: z.number().int().nonnegative().nullable(),
  driftStatus: z.string().nullable(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
}).strict();

/** Immutable provider-to-local-account link; `subjectId` is the external directory identity. */
export const ExternalIdentitySchema = z.object({
  id: z.string().min(1),
  identityKey: z.string().min(1),
  tenantId: z.string().nullable(),
  providerId: z.string().min(1),
  providerType: IdentityProviderProtocolSchema,
  subjectId: z.string().min(1).max(2000),
  directoryTenantId: z.string().nullable(),
  userId: z.string().min(1),
  emailHint: z.string().nullable(),
  status: z.enum(['active', 'deactivated', 'archived']),
  linkedAt: z.number().int().nonnegative(),
  lastSeenAt: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
}).strict();

/** Sanitized external snapshot used for reconciliation, never a protocol payload. */
export const ExternalIdentitySnapshotSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().nullable(),
  providerId: z.string().min(1),
  providerType: IdentityProviderProtocolSchema,
  providerSubject: z.string().min(1).max(2000),
  subjectClaim: z.string().nullable(),
  providerTenantId: z.string().nullable(),
  userId: z.string().min(1),
  email: z.string().nullable(),
  displayName: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  groupsJson: z.string(),
  rolesJson: z.string(),
  claimsJson: z.string(),
  providerStatus: z.string().min(1),
  lastSeenAt: z.number().int().nonnegative(),
  lastProviderCheckAt: z.number().int().nonnegative().nullable(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
}).strict();

export const IdentityEntitlementMappingRecordSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().nullable(),
  providerId: z.string().min(1),
  configKey: z.string().nullable(),
  configKeyIdentity: z.string().nullable(),
  sourceRef: z.string().nullable(),
  sourceHash: z.string().nullable(),
  lastAppliedAt: z.number().int().nonnegative().nullable(),
  driftStatus: z.string().nullable(),
  entitlementType: ExternalEntitlementTypeSchema,
  externalId: z.string().nullable(),
  matchOperator: z.enum(['exact', 'contains', 'exists']),
  targetGroupId: z.string().min(1),
  syncMode: z.enum(['additive', 'authoritative']),
  isActive: z.boolean(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
}).strict();

export const IdentitySyncRunSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().nullable(),
  providerId: z.string().nullable(),
  userId: z.string().nullable(),
  trigger: z.enum(['login', 'scheduled', 'manual', 'mapping_change', 'engine_change']),
  status: z.enum(['running', 'success', 'failed']),
  startedAt: z.number().int().nonnegative(),
  completedAt: z.number().int().nonnegative().nullable(),
  groupMembershipsCreated: z.number().int().nonnegative(),
  groupMembershipsUpdated: z.number().int().nonnegative(),
  groupMembershipsRemoved: z.number().int().nonnegative(),
  assignmentsCreated: z.number().int().nonnegative(),
  assignmentsUpdated: z.number().int().nonnegative(),
  assignmentsRemoved: z.number().int().nonnegative(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  details: z.string(),
}).strict();

export const IdentitySyncEventSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().nullable(),
  providerId: z.string().nullable(),
  runId: z.string().min(1),
  severity: z.enum(['info', 'warning', 'error']),
  type: z.string().min(1),
  userId: z.string().nullable(),
  mappingType: z.string().nullable(),
  mappingId: z.string().nullable(),
  resourceType: z.string().nullable(),
  resourceId: z.string().nullable(),
  message: z.string(),
  details: z.string(),
  createdAt: z.number().int().nonnegative(),
}).strict();

/** A bounded, sanitized diagnostic event; it never represents raw provider data. */
export const IdentitySyncDiagnosticSchema = z.object({
  providerKey: z.string().min(1).max(160),
  runId: z.string().min(1).max(160).nullable().optional(),
  status: z.enum(['running', 'success', 'failed']),
  code: z.string().min(1).max(128).nullable().optional(),
  message: z.string().min(1).max(1000).nullable().optional(),
  occurredAt: z.number().int().nonnegative(),
}).strict();

export type IdentityProviderType = z.infer<typeof IdentityProviderProtocolSchema>;
export type ExternalEntitlementType = z.infer<typeof ExternalEntitlementTypeSchema>;
export type ExternalEntitlement = z.infer<typeof ExternalEntitlementSchema>;
export type ProviderIdentityInput = z.infer<typeof ProviderIdentityInputSchema>;
export type NormalizedExternalIdentity = z.infer<typeof NormalizedExternalIdentitySchema>;
export type IdentityProviderRecord = z.infer<typeof IdentityProviderRecordSchema>;
export type ExternalIdentity = z.infer<typeof ExternalIdentitySchema>;
export type ExternalIdentitySnapshot = z.infer<typeof ExternalIdentitySnapshotSchema>;
export type IdentityEntitlementMappingRecord = z.infer<typeof IdentityEntitlementMappingRecordSchema>;
export type IdentitySyncRun = z.infer<typeof IdentitySyncRunSchema>;
export type IdentitySyncEvent = z.infer<typeof IdentitySyncEventSchema>;
export type IdentitySyncDiagnostic = z.infer<typeof IdentitySyncDiagnosticSchema>;

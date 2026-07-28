import { z } from 'zod';

/** Provider-neutral contracts shared by adapters, mapping services, and API schemas. */
export const IdentityProviderProtocolSchema = z.enum(['oidc', 'saml', 'ldap']);
export const IdentityProviderAuthenticationModeSchema = z.enum(['direct', 'claims_only']);

/**
 * Provider credentials and trust material are always resolved by the shared
 * secret resolver. API and configuration-bundle contracts may carry only an
 * opaque reference, never a secret value.
 */
export const IdentityProviderSecretReferenceSchema = z.string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z][A-Za-z0-9_.:/-]*$/, 'Secret references must be opaque identifiers');

/**
 * Sign-in reconciliation is a security boundary: a browser session is issued
 * only after the provider's fresh identity evidence has updated the local
 * entitlement snapshot and authoritative mapped memberships.
 */
export const IdentityProviderSyncConfigurationSchema = z.object({
  triggers: z.array(z.enum(['login', 'scheduled', 'manual']))
    .min(1)
    .refine((triggers) => triggers.includes('login'), 'Sign-in reconciliation is mandatory'),
  intervalSeconds: z.number().int().min(60).max(86_400).optional(),
  requiredForLogin: z.literal(true).default(true),
  incompleteEntitlements: z.enum(['fail_closed', 'preserve_previous']).default('fail_closed'),
  connectorCapability: z.enum(['claim_only', 'ldap_directory', 'scim', 'graph']).default('claim_only'),
  scheduled: z.boolean().default(false),
}).strict();

/**
 * Repairs pre-mandatory persisted records while preserving their optional
 * scheduled/manual settings. Request and bundle schemas remain strict; this
 * helper is only for safely reading older stored JSON during an update.
 */
export function normalizeIdentityProviderSyncForMandatoryLogin(value: unknown): Record<string, unknown> {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const triggers = Array.isArray(source.triggers)
    ? source.triggers.filter((trigger): trigger is 'login' | 'scheduled' | 'manual' => trigger === 'login' || trigger === 'scheduled' || trigger === 'manual')
    : [];
  return {
    ...source,
    triggers: ['login', ...triggers.filter((trigger) => trigger !== 'login')],
    requiredForLogin: true,
  };
}

const IdentityProviderAuthorizationConfigurationSchema = z.object({
  // This is optional in a protocol configuration because config bundles keep
  // it at the provider root and apply it when persisting the provider.  A
  // default here would add the key back to exported nested protocol settings
  // and make an export/diff round trip report a spurious update.
  allowVerifiedEmailLinking: z.boolean().optional(),
  authorizationAttributeKeys: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/)).max(20).optional(),
});

export const OidcIdentityProviderConfigurationSchema = IdentityProviderAuthorizationConfigurationSchema.extend({
  issuerUrl: z.string().url(),
  clientId: z.string().min(1).max(255),
  clientSecretRef: IdentityProviderSecretReferenceSchema.optional(),
  callbackUrl: z.string().url(),
  scopes: z.array(z.string().min(1).max(255)).min(1),
  groupClaim: z.string().min(1).max(255).optional(),
  expectedAudience: z.string().min(1).max(2000).optional(),
}).strict();

export const SamlIdentityProviderConfigurationSchema = IdentityProviderAuthorizationConfigurationSchema.extend({
  metadataUrl: z.string().url().optional(),
  metadataXmlRef: IdentityProviderSecretReferenceSchema.optional(),
  entityId: z.string().min(1).max(2000),
  callbackUrl: z.string().url(),
  ssoUrl: z.string().url(),
  nameIdAttribute: z.string().min(1).max(255),
  emailAttribute: z.string().min(1).max(255).optional(),
  groupAttribute: z.string().min(1).max(255).optional(),
  signingCertificateRef: IdentityProviderSecretReferenceSchema,
  signatureAlgorithm: z.enum(['sha256', 'sha512']).default('sha256'),
}).strict();

export const LdapIdentityProviderConfigurationSchema = IdentityProviderAuthorizationConfigurationSchema.extend({
  url: z.string().url().refine((url) => url.startsWith('ldaps://'), 'LDAP URLs must use LDAPS'),
  bindDn: z.string().min(1).max(2000),
  bindPasswordRef: IdentityProviderSecretReferenceSchema,
  userBaseDn: z.string().min(1).max(2000),
  userSearchFilter: z.string().min(1).max(2000),
  userEnumerationFilter: z.string().min(1).max(2000).default('(objectClass=person)'),
  pageSize: z.number().int().min(1).max(1000).default(200),
  subjectAttribute: z.string().min(1).max(255).default('entryUUID'),
  emailAttribute: z.string().min(1).max(255).default('mail'),
  groupBaseDn: z.string().min(1).max(2000),
  groupIdAttribute: z.string().min(1).max(255),
  membershipMode: z.enum(['memberOf', 'group_search']),
  nestedGroups: z.boolean().default(false),
  tlsTrustRef: IdentityProviderSecretReferenceSchema.optional(),
}).strict();
export const ExternalEntitlementTypeSchema = z.enum(['group', 'role', 'scope', 'attribute', 'authenticated']);
/** Scopes are protocol metadata, not human authorization inputs. */
export const HumanIdentityEntitlementTypeSchema = z.enum(['group', 'role', 'attribute', 'authenticated']);
export const IdentityEntitlementMatchOperatorSchema = z.enum(['exact', 'contains', 'exists']);
export const IdentityEntitlementSyncModeSchema = z.enum(['additive', 'authoritative']);

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
  authenticationMode: IdentityProviderAuthenticationModeSchema,
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
  status: z.enum(['active', 'deactivated', 'archived', 'unlinked']),
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
  ownershipMode: z.enum(['manual', 'config_locked', 'config_warn']),
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
export type IdentityProviderAuthenticationMode = z.infer<typeof IdentityProviderAuthenticationModeSchema>;
export type ExternalEntitlementType = z.infer<typeof ExternalEntitlementTypeSchema>;
export type HumanIdentityEntitlementType = z.infer<typeof HumanIdentityEntitlementTypeSchema>;
export type IdentityEntitlementMatchOperator = z.infer<typeof IdentityEntitlementMatchOperatorSchema>;
export type IdentityEntitlementSyncMode = z.infer<typeof IdentityEntitlementSyncModeSchema>;
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

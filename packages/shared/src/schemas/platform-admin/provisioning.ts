import { z } from 'zod';
import { IdentityProviderSecretReferenceSchema } from './identity.js';

/** Canonical identifier used in URLs, configuration, audit events, and SCIM credentials. */
export const IdentityProvisioningDirectoryKeySchema = z.string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9._-]*$/, 'Use a lowercase key beginning with a letter');

export const IdentityProvisioningDirectoryStatusSchema = z.enum(['active', 'disabled', 'archived']);
export const IdentityProvisioningDirectoryOwnershipSchema = z.enum(['manual', 'config_locked', 'config_warn']);
export const IdentityProvisioningDirectoryTypeSchema = z.literal('scim_v2');

export const IdentityProvisioningDirectoryCreateSchema = z.object({
  key: IdentityProvisioningDirectoryKeySchema,
  displayName: z.string().trim().min(1).max(255),
  description: z.string().trim().max(1000).nullable().optional(),
  identityProviderKey: z.string().trim().min(1).max(128).nullable().optional(),
  isEnabled: z.boolean().default(false),
  authoritative: z.literal(true).default(true),
}).strict();

export const IdentityProvisioningDirectoryUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  identityProviderKey: z.string().trim().min(1).max(128).nullable().optional(),
  isEnabled: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'Provide at least one provisioning-directory change');

export const IdentityProvisioningDirectoryQuerySchema = z.object({
  status: IdentityProvisioningDirectoryStatusSchema.optional(),
  identityProviderKey: z.string().trim().min(1).max(128).optional(),
  search: z.string().trim().min(1).max(255).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
}).strict();

export const IdentityProvisioningDirectoryRecordSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().nullable(),
  key: IdentityProvisioningDirectoryKeySchema,
  directoryKeyIdentity: z.string().min(1).max(128),
  displayName: z.string().min(1).max(255),
  description: z.string().max(1000).nullable(),
  type: IdentityProvisioningDirectoryTypeSchema,
  identityProviderKey: z.string().max(128).nullable(),
  authoritative: z.literal(true),
  status: IdentityProvisioningDirectoryStatusSchema,
  ownershipMode: IdentityProvisioningDirectoryOwnershipSchema,
  sourceRef: z.string().max(512).nullable(),
  sourceHash: z.string().max(128).nullable(),
  /** External resolver reference only; never a resolved credential or hash. */
  credentialSecretRef: IdentityProviderSecretReferenceSchema.nullable(),
  lastAppliedAt: z.number().int().nonnegative().nullable(),
  driftStatus: z.enum(['in_sync', 'drifted', 'unknown']).nullable(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  archivedAt: z.number().int().nonnegative().nullable(),
}).strict();

export const IdentityProvisioningDirectoryListResponseSchema = z.object({
  items: z.array(IdentityProvisioningDirectoryRecordSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive().max(200),
  offset: z.number().int().nonnegative(),
}).strict();

/** Configuration bundles may contain a resolver reference, never a bearer token or hash. */
export const IdentityProvisioningDirectoryConfigSchema = z.object({
  key: IdentityProvisioningDirectoryKeySchema,
  displayName: z.string().trim().min(1).max(255),
  description: z.string().trim().max(1000).nullable().optional(),
  identityProviderKey: z.string().trim().min(1).max(128).nullable().optional(),
  enabled: z.boolean().default(false),
  authoritative: z.literal(true).default(true),
  credentialSecretRef: IdentityProviderSecretReferenceSchema.optional(),
}).strict();

export const IdentityProvisioningCredentialCreateSchema = z.object({
  name: z.string().trim().min(1).max(255),
  expiresAt: z.number().int().positive().nullable().optional(),
}).strict();

export const IdentityProvisioningCredentialRotateSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  expiresAt: z.number().int().positive().nullable().optional(),
  overlapSeconds: z.number().int().min(0).max(86_400).default(3600),
}).strict();

/** Durable operation key for reveal-once credential issuance. */
export const IdentityProvisioningIdempotencyKeySchema = z.string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/, 'Use letters, numbers, dot, underscore, colon, or hyphen');

export const IdentityProvisioningCredentialStatusSchema = z.enum(['active', 'overlap', 'expired', 'revoked']);

/** Public credential metadata deliberately excludes token values and token hashes. */
export const IdentityProvisioningCredentialMetadataSchema = z.object({
  id: z.string().min(1),
  directoryId: z.string().min(1),
  name: z.string().min(1).max(255),
  fingerprint: z.string().min(8).max(128),
  status: IdentityProvisioningCredentialStatusSchema,
  createdAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative().nullable(),
  overlapEndsAt: z.number().int().nonnegative().nullable(),
  lastUsedAt: z.number().int().nonnegative().nullable(),
  revokedAt: z.number().int().nonnegative().nullable(),
}).strict();

export const IdentityProvisioningCredentialIssuedSchema = z.object({
  credential: IdentityProvisioningCredentialMetadataSchema,
  token: z.string().min(32).max(4096),
  /** OAuth 2.0 client identifier; the reveal-once token is also the client secret. */
  clientId: z.string().min(8).max(255),
  tokenEndpointPath: z.string().regex(/^\/scim\/v2\/[a-z][a-z0-9._-]*\/oauth\/token$/),
}).strict();

export const ScimOAuthTokenRequestSchema = z.object({
  grant_type: z.literal('client_credentials'),
  scope: z.string().trim().max(512).optional(),
  client_id: z.string().min(8).max(255).optional(),
  client_secret: z.string().min(32).max(4096).optional(),
}).strict();

export const ScimOAuthTokenResponseSchema = z.object({
  access_token: z.string().min(32).max(8192),
  token_type: z.literal('Bearer'),
  expires_in: z.number().int().min(60).max(3600),
  scope: z.literal('scim'),
}).strict();

export const IdentityProvisioningCredentialListResponseSchema = z.object({
  items: z.array(IdentityProvisioningCredentialMetadataSchema),
}).strict();

export const IdentityProvisioningDirectoryTestResponseSchema = z.object({
  status: z.enum(['ready', 'attention_required']),
  directoryStatus: IdentityProvisioningDirectoryStatusSchema,
  activeCredentialCount: z.number().int().nonnegative(),
  endpointPath: z.string().regex(/^\/scim\/v2\/[a-z][a-z0-9._-]*$/),
}).strict();

export const IdentityProvisioningDiagnosticStatusSchema = z.enum(['accepted', 'success', 'partial', 'failed']);
export const IdentityProvisioningDiagnosticSchema = z.object({
  id: z.string().min(1),
  directoryId: z.string().min(1),
  requestId: z.string().min(1).max(128),
  eventType: z.string().min(1).max(128),
  resourceType: z.enum(['Directory', 'User', 'Group', 'Credential', 'Session']).nullable(),
  resourceId: z.string().max(255).nullable(),
  userId: z.string().max(255).nullable(),
  status: IdentityProvisioningDiagnosticStatusSchema,
  code: z.string().max(128).nullable(),
  message: z.string().max(1000).nullable(),
  occurredAt: z.number().int().nonnegative(),
}).strict();

export const IdentityProvisioningDiagnosticsQuerySchema = z.object({
  status: IdentityProvisioningDiagnosticStatusSchema.optional(),
  resourceType: z.enum(['Directory', 'User', 'Group', 'Credential', 'Session']).optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
}).strict();

export const IdentityProvisioningDiagnosticsListResponseSchema = z.object({
  items: z.array(IdentityProvisioningDiagnosticSchema),
}).strict();

export type IdentityProvisioningDirectoryCreate = z.infer<typeof IdentityProvisioningDirectoryCreateSchema>;
export type IdentityProvisioningDirectoryUpdate = z.infer<typeof IdentityProvisioningDirectoryUpdateSchema>;
export type IdentityProvisioningDirectoryRecord = z.infer<typeof IdentityProvisioningDirectoryRecordSchema>;
export type IdentityProvisioningDirectoryListResponse = z.infer<typeof IdentityProvisioningDirectoryListResponseSchema>;
export type IdentityProvisioningDirectoryConfig = z.infer<typeof IdentityProvisioningDirectoryConfigSchema>;
export type IdentityProvisioningCredentialMetadata = z.infer<typeof IdentityProvisioningCredentialMetadataSchema>;
export type IdentityProvisioningCredentialIssued = z.infer<typeof IdentityProvisioningCredentialIssuedSchema>;
export type IdentityProvisioningCredentialListResponse = z.infer<typeof IdentityProvisioningCredentialListResponseSchema>;
export type IdentityProvisioningDirectoryTestResponse = z.infer<typeof IdentityProvisioningDirectoryTestResponseSchema>;
export type IdentityProvisioningDiagnostic = z.infer<typeof IdentityProvisioningDiagnosticSchema>;
export type IdentityProvisioningDiagnosticsListResponse = z.infer<typeof IdentityProvisioningDiagnosticsListResponseSchema>;

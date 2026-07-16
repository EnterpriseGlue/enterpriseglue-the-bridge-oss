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
export type IdentitySyncDiagnostic = z.infer<typeof IdentitySyncDiagnosticSchema>;

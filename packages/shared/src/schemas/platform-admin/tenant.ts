import { z } from 'zod';

// v0.16.2 compatibility schemas. Keep these public names stable for EE and
// plugin consumers while native pooled-tenancy APIs use the explicit Native*
// contracts below.
export const TenantSchemaRaw = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  status: z.string(),
  createdByUserId: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const TenantSchema = TenantSchemaRaw.transform((tenant) => ({
  id: tenant.id,
  name: tenant.name,
  slug: tenant.slug,
  status: tenant.status as 'active' | 'inactive' | 'suspended',
  createdByUserId: tenant.createdByUserId ?? undefined,
  createdAt: Number(tenant.createdAt),
  updatedAt: Number(tenant.updatedAt),
}));

export const TenantInsertSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
  status: z.enum(['active', 'inactive', 'suspended']).optional(),
});

export const TenantSettingsSchemaRaw = z.object({
  tenantId: z.string(),
  inviteAllowAllDomains: z.boolean(),
  inviteAllowedDomains: z.string().nullable(),
  emailSendConfigId: z.string().nullable(),
  logoUrl: z.string().nullable(),
  logoTitle: z.string().nullable(),
  logoScale: z.number().nullable(),
  titleFontUrl: z.string().nullable(),
  titleFontWeight: z.string().nullable(),
  titleFontSize: z.string().nullable(),
  titleVerticalOffset: z.string().nullable(),
  menuAccentColor: z.string().nullable(),
  updatedAt: z.number(),
  updatedByUserId: z.string().nullable(),
});

export const TenantSettingsSchema = TenantSettingsSchemaRaw.transform((settings) => ({
  tenantId: settings.tenantId,
  inviteAllowAllDomains: settings.inviteAllowAllDomains,
  inviteAllowedDomains: settings.inviteAllowedDomains,
  emailSendConfigId: settings.emailSendConfigId ?? undefined,
  logoUrl: settings.logoUrl ?? undefined,
  logoTitle: settings.logoTitle ?? undefined,
  logoScale: settings.logoScale ?? undefined,
  titleFontUrl: settings.titleFontUrl ?? undefined,
  titleFontWeight: settings.titleFontWeight ?? undefined,
  titleFontSize: settings.titleFontSize ?? undefined,
  titleVerticalOffset: settings.titleVerticalOffset ?? undefined,
  menuAccentColor: settings.menuAccentColor ?? undefined,
  updatedAt: Number(settings.updatedAt),
  updatedByUserId: settings.updatedByUserId ?? undefined,
}));

export const TenantMembershipSchemaRaw = z.object({
  id: z.string(),
  tenantId: z.string(),
  userId: z.string(),
  role: z.string(),
  createdAt: z.number(),
});

export const TenantMembershipSchema = TenantMembershipSchemaRaw.transform((membership) => ({
  id: membership.id,
  tenantId: membership.tenantId,
  userId: membership.userId,
  role: membership.role as 'owner' | 'admin' | 'member',
  createdAt: Number(membership.createdAt),
}));

export const TenantMembershipInsertSchema = z.object({
  id: z.string().uuid().optional(),
  tenantId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.enum(['owner', 'admin', 'member']).optional(),
});

export const TenantStatusSchema = z.enum(['active', 'suspended', 'deleting']);
export const TenantSlugSchema = z.string().min(1).max(63).regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);

export const NativeTenantSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  slug: TenantSlugSchema,
  status: TenantStatusSchema,
  placementKey: z.string().nullable(),
  placementEpoch: z.coerce.number().int().positive(),
  createdByUserId: z.string().nullable(),
  createdAt: z.coerce.number().int().nonnegative(),
  updatedAt: z.coerce.number().int().nonnegative(),
});

export const TenantCreateRequestSchema = z.object({
  name: z.string().trim().min(1).max(160),
  slug: TenantSlugSchema,
  ownerUserId: z.string().min(1),
  placementKey: z.string().trim().min(1).max(160).optional(),
});

export const TenantUpdateRequestSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  status: TenantStatusSchema.optional(),
  placementKey: z.string().trim().min(1).max(160).optional(),
  expectedPlacementEpoch: z.number().int().positive().optional(),
}).refine((value) => Object.keys(value).length > 0, 'At least one tenant field is required');

export const TenantWorkloadCreateRequestSchema = z.object({
  name: z.string().trim().min(1).max(160),
  slug: TenantSlugSchema,
  ownerUserId: z.string().min(1).nullable().optional(),
  placementKey: z.string().trim().min(1).max(160).optional(),
}).strict();

export const TenantWorkloadEpochRequestSchema = z.object({
  expectedPlacementEpoch: z.number().int().positive(),
}).strict();

export const TenantWorkloadAliasReconcileRequestSchema = z.object({
  aliases: z.array(z.string().trim().min(1).max(253)).max(100),
  expectedPlacementEpoch: z.number().int().positive(),
}).strict();

export const TenantWorkloadSecretBreakGlassRequestSchema = z.object({
  providerKey: z.string().min(1).max(128),
  purpose: z.enum([
    'oidc.client_secret',
    'saml.metadata_xml',
    'saml.idp_signing_certificate',
    'saml.request_signing_private_key',
    'saml.request_signing_certificate',
    'ldap.bind_password',
    'ldap.tls_trust_certificate',
  ]),
  reference: z.string().min(1).max(512),
  expectedPlacementEpoch: z.number().int().positive(),
  enableProvider: z.boolean().default(false),
  confirmation: z.literal('SET_TENANT_SECRET_BREAK_GLASS_REFERENCE'),
}).strict();

export const TenantWorkloadReceiptPayloadSchema = z.object({
  schemaVersion: z.literal('tenant-workload-receipt.enterpriseglue.io/v1'),
  issuer: z.string().min(1),
  audience: z.string().min(1),
  operationId: z.string().min(1),
  command: z.enum(['create', 'suspend', 'resume', 'reconcile_aliases', 'set_secret_reference_break_glass']),
  actorId: z.string().min(1),
  tenantId: z.string().min(1),
  tenantSlug: TenantSlugSchema,
  tenantStatus: TenantStatusSchema,
  placementEpoch: z.number().int().positive(),
  routingAliases: z.array(z.string().min(1)),
  correlationId: z.string().min(8).max(160),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  idempotencyKeyHash: z.string().regex(/^[a-f0-9]{64}$/),
  issuedAt: z.number().int().positive(),
}).strict();

export const SignedTenantWorkloadReceiptSchema = z.object({
  payload: TenantWorkloadReceiptPayloadSchema,
  signature: z.object({
    algorithm: z.literal('ES256'),
    keyId: z.string().min(1).max(160),
    value: z.string().min(1),
  }).strict(),
  idempotent: z.boolean(),
}).strict();

export const NativeTenantMembershipSchema = z.object({
  tenantId: z.string().min(1),
  tenantSlug: TenantSlugSchema,
  tenantName: z.string().min(1),
  tenantStatus: TenantStatusSchema,
  role: z.enum(['admin', 'member']),
});

export const TenantMemberSchema = z.object({
  userId: z.string().min(1),
  email: z.string().email(),
  role: z.enum(['admin', 'member']),
});

export const TenantMemberUpsertRequestSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(['admin', 'member']).default('member'),
});

export const TenantLoginPolicySchema = z.object({
  localPasswordMode: z.enum(['auto', 'enabled', 'disabled']),
  providerSelectionMode: z.enum(['auto_redirect_single', 'chooser', 'progressive']),
});

export const TenantDomainSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  hostname: z.string().min(1),
  status: z.enum(['pending', 'verified', 'disabled']),
  verifiedAt: z.coerce.number().int().nonnegative().nullable(),
  createdAt: z.coerce.number().int().nonnegative(),
  updatedAt: z.coerce.number().int().nonnegative(),
});

export const TenantDomainCreateRequestSchema = z.object({ hostname: z.string().trim().min(1).max(253) });
export const TenantDomainVerifyRequestSchema = z.object({ verificationToken: z.string().min(32).max(256) });

export const TenantDiscoveryEmailDomainSchema = z.string().trim().toLowerCase().min(3).max(253)
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, 'Use a DNS email domain such as example.com');

export const TenantDiscoveryDomainSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  domain: TenantDiscoveryEmailDomainSchema,
  status: z.enum(['pending', 'verified', 'disabled']),
  verifiedAt: z.coerce.number().int().nonnegative().nullable(),
  createdAt: z.coerce.number().int().nonnegative(),
  updatedAt: z.coerce.number().int().nonnegative(),
});

export const TenantDiscoveryDomainCreateRequestSchema = z.object({ domain: TenantDiscoveryEmailDomainSchema });
export const TenantDiscoveryDomainVerifyRequestSchema = z.object({ verificationToken: z.string().min(32).max(256) });

export const TenantDiscoveryRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
});

export const TenantDiscoveryResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('resolved'),
    tenantSlug: TenantSlugSchema,
    loginPath: z.string().regex(/^\/t\/[a-z0-9-]+\/login$/),
  }),
  z.object({
    status: z.literal('verification_sent'),
    message: z.string().min(1),
  }),
]).superRefine((value, context) => {
  if (value.status === 'resolved' && value.loginPath !== `/t/${value.tenantSlug}/login`) {
    context.addIssue({ code: 'custom', path: ['loginPath'], message: 'Login path must match the resolved tenant slug' });
  }
});

export const TenantDiscoveryExchangeRequestSchema = z.object({
  token: z.string().min(32).max(512),
});

export const TenantDiscoveryExchangeResponseSchema = z.object({
  tenants: z.array(NativeTenantMembershipSchema),
});

export const TenancyCapabilitiesSchema = z.object({
  mode: z.enum(['single', 'pooled']),
  rootTenantAliasesEnabled: z.boolean(),
  tenantScopedLoginRequired: z.boolean(),
  databaseIsolation: z.enum(['application', 'postgres_rls']),
  customDomainsEnabled: z.boolean(),
  organizationDiscoveryEnabled: z.boolean().default(false),
  signedPlacementAssertionsEnabled: z.boolean(),
  placementAssertionVersions: z.array(z.enum(['v1', 'v2'])).default([]),
  placementV2Required: z.boolean().default(false),
  workloadTenantLifecycleEnabled: z.boolean().default(false),
  tenantSecretBrokerEnabled: z.boolean().default(false),
  tenantSecretWriteOnlyAdminEnabled: z.boolean().default(false),
  tenantSecretBreakGlassEnabled: z.boolean().default(false),
  shardId: z.string().nullable().default(null),
  workloadReceipt: z.object({
    algorithm: z.literal('ES256'),
    keyId: z.string().min(1),
    issuer: z.string().min(1),
  }).nullable().default(null),
});

export type Tenant = z.infer<typeof TenantSchema>;
export type TenantSettings = z.infer<typeof TenantSettingsSchema>;
export type TenantMembership = z.infer<typeof TenantMembershipSchema>;
export type NativeTenantContract = z.infer<typeof NativeTenantSchema>;
export type TenantCreateRequest = z.infer<typeof TenantCreateRequestSchema>;
export type TenantUpdateRequest = z.infer<typeof TenantUpdateRequestSchema>;
export type NativeTenantMembership = z.infer<typeof NativeTenantMembershipSchema>;
export type TenantLoginPolicyContract = z.infer<typeof TenantLoginPolicySchema>;
export type TenantDiscoveryDomainContract = z.infer<typeof TenantDiscoveryDomainSchema>;
export type TenantDiscoveryResponse = z.infer<typeof TenantDiscoveryResponseSchema>;

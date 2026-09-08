import { describe, expect, it } from 'vitest';
import {
  TenantCreateRequestSchema,
  TenantDiscoveryDomainCreateRequestSchema,
  TenantDiscoveryResponseSchema,
  TenantLoginPolicySchema,
  TenantMembershipSchema,
  PlatformCloudIdentityClaimsSchema,
  PlatformCloudIdentityRequestSchema,
  PlatformCloudIdentityResponseSchema,
  TenantSchema,
  TenantSettingsSchema,
  TenancyCapabilitiesSchema,
  TenantWorkloadSecretBreakGlassRequestSchema,
} from '@enterpriseglue/shared/schemas/platform-admin/tenant.js';

describe('native tenant contracts', () => {
  it('keeps tenant slugs canonical and bounded', () => {
    expect(TenantCreateRequestSchema.parse({ name: 'Customer One', slug: 'customer-one', ownerUserId: 'user-1' }).slug).toBe('customer-one');
    expect(() => TenantCreateRequestSchema.parse({ name: 'Customer', slug: 'Customer_One', ownerUserId: 'user-1' })).toThrow();
  });

  it('accepts independent tenant login policy and explicit pooled capabilities', () => {
    expect(TenantLoginPolicySchema.parse({ localPasswordMode: 'disabled', providerSelectionMode: 'chooser' })).toEqual({
      localPasswordMode: 'disabled', providerSelectionMode: 'chooser',
    });
    expect(TenancyCapabilitiesSchema.parse({
      mode: 'pooled', rootTenantAliasesEnabled: false, tenantScopedLoginRequired: true,
      databaseIsolation: 'postgres_rls', customDomainsEnabled: true, signedPlacementAssertionsEnabled: true,
    })).toMatchObject({
      mode: 'pooled',
      tenantSecretBrokerEnabled: false,
      tenantSecretWriteOnlyAdminEnabled: false,
      tenantSecretBreakGlassEnabled: false,
    });
  });

  it('requires explicit confirmation and keeps workload recovery disabled by default', () => {
    expect(TenantWorkloadSecretBreakGlassRequestSchema.parse({
      providerKey: 'alpha-oidc',
      purpose: 'oidc.client_secret',
      reference: 'ref:env://EG_ALPHA_OIDC_CLIENT_SECRET',
      expectedPlacementEpoch: 7,
      confirmation: 'SET_TENANT_SECRET_BREAK_GLASS_REFERENCE',
    })).toMatchObject({ providerKey: 'alpha-oidc', enableProvider: false });
    expect(() => TenantWorkloadSecretBreakGlassRequestSchema.parse({
      providerKey: 'alpha-oidc', purpose: 'oidc.client_secret', reference: 'ref:env://EG_ALPHA_OIDC_CLIENT_SECRET',
      expectedPlacementEpoch: 7, confirmation: 'YES',
    })).toThrow();
  });

  it('keeps platform Cloud identity requests action-specific and assertions short lived', () => {
    expect(PlatformCloudIdentityRequestSchema.parse({ action: 'platform.tenants.self_create' }))
      .toEqual({ action: 'platform.tenants.self_create' });
    expect(PlatformCloudIdentityRequestSchema.parse({ action: 'platform.tenants.read' }))
      .toEqual({ action: 'platform.tenants.read' });
    expect(PlatformCloudIdentityResponseSchema.parse({
      token: 'a'.repeat(32), expiresIn: 90, action: 'platform.tenants.manage',
    }).expiresIn).toBe(90);
    expect(PlatformCloudIdentityClaimsSchema.parse({
      schemaVersion: 'platform-cloud-identity.enterpriseglue.io/v1',
      iss: 'regional-shard-01', aud: 'enterpriseglue-cloud-platform', sub: 'user:user-1',
      jti: `pci_${'a'.repeat(32)}`, shardId: 'regional-shard-01', action: 'platform.tenants.read',
      iat: 1_800_000_000, nbf: 1_799_999_998, exp: 1_800_000_090,
    }).action).toBe('platform.tenants.read');
    expect(() => PlatformCloudIdentityRequestSchema.parse({ action: 'platform.tenants.manage', tenantId: 'tenant-a' })).toThrow();
    expect(() => PlatformCloudIdentityRequestSchema.parse({ action: 'platform.authz.roles.manage' })).toThrow();
    expect(() => PlatformCloudIdentityClaimsSchema.parse({
      schemaVersion: 'platform-cloud-identity.enterpriseglue.io/v1',
      iss: 'regional-shard-01', aud: 'enterpriseglue-cloud-platform', sub: 'user:user-1',
      jti: `pci_${'a'.repeat(32)}`, shardId: 'regional-shard-01', action: 'platform.tenants.read',
      iat: 1_800_000_000, nbf: 1_799_999_998, exp: 1_800_000_091,
    })).toThrow('exp must be exactly 90 seconds after iat');
    expect(() => PlatformCloudIdentityClaimsSchema.parse({
      schemaVersion: 'platform-cloud-identity.enterpriseglue.io/v1',
      iss: 'regional-shard-01', aud: 'enterpriseglue-cloud-platform', sub: 'user:user-1',
      jti: `pci_${'a'.repeat(32)}`, shardId: 'regional-shard-01', action: 'platform.tenants.read',
      iat: 1_800_000_000, nbf: 1_799_999_999, exp: 1_800_000_090,
    })).toThrow('nbf must be exactly two seconds before iat');
  });

  it('keeps work-email discovery separate from tenant authority', () => {
    expect(TenantDiscoveryDomainCreateRequestSchema.parse({ domain: 'Acme.Example' })).toEqual({ domain: 'acme.example' });
    expect(TenantDiscoveryResponseSchema.parse({
      status: 'resolved', tenantSlug: 'acme', loginPath: '/t/acme/login',
    })).toMatchObject({ status: 'resolved', tenantSlug: 'acme' });
    expect(() => TenantDiscoveryResponseSchema.parse({
      status: 'resolved', tenantSlug: 'acme', loginPath: '/t/bravo/login',
    })).toThrow('Login path must match');
  });

  it('preserves the v0.16.2 public tenant schema exports', () => {
    expect(TenantSchema.parse({
      id: 'tenant-1', name: 'Legacy tenant', slug: 'legacy', status: 'inactive',
      createdByUserId: null, createdAt: 1, updatedAt: 2,
    })).toEqual({
      id: 'tenant-1', name: 'Legacy tenant', slug: 'legacy', status: 'inactive',
      createdByUserId: undefined, createdAt: 1, updatedAt: 2,
    });
    expect(TenantMembershipSchema.parse({
      id: 'membership-1', tenantId: 'tenant-1', userId: 'user-1', role: 'owner', createdAt: 1,
    }).role).toBe('owner');
    expect(TenantSettingsSchema.parse({
      tenantId: 'tenant-1', inviteAllowAllDomains: false, inviteAllowedDomains: null,
      emailSendConfigId: null, logoUrl: null, logoTitle: null, logoScale: null,
      titleFontUrl: null, titleFontWeight: null, titleFontSize: null,
      titleVerticalOffset: null, menuAccentColor: null, updatedAt: 1, updatedByUserId: null,
    }).tenantId).toBe('tenant-1');
  });
});

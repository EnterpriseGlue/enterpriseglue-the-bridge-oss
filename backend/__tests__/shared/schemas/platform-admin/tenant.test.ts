import { describe, expect, it } from 'vitest';
import {
  TenantCreateRequestSchema,
  TenantDiscoveryDomainCreateRequestSchema,
  TenantDiscoveryResponseSchema,
  TenantLoginPolicySchema,
  TenantMembershipSchema,
  TenantSchema,
  TenantSettingsSchema,
  TenancyCapabilitiesSchema,
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
    }).mode).toBe('pooled');
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

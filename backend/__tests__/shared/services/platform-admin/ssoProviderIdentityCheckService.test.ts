import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { ssoProviderIdentityCheckService } from '@enterpriseglue/shared/services/platform-admin/SsoProviderIdentityCheckService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));

function identity(providerId: string, providerType: string) {
  return {
    id: 'identity-1', tenantId: 'tenant-a', providerId, providerType,
    providerSubject: 'subject-1', subjectClaim: 'sub', providerTenantId: null,
    userId: 'user-1', email: 'snapshot@example.com', displayName: 'User Example',
    firstName: null, lastName: null, lastSeenAt: 12345,
  } as any;
}

describe('ssoProviderIdentityCheckService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['oidc-provider', 'oidc', 'mandatory_verified_sign_in'],
    ['entra-provider', 'microsoft', 'mandatory_verified_sign_in'],
    ['saml-provider', 'saml', 'mandatory_verified_sign_in'],
    ['ldap-provider', 'ldap', 'ldap_authoritative_reconciliation'],
  ])('keeps background identity checks unsupported for %s without making an implicit outbound request', async (providerId, providerType, authority) => {
    await expect(ssoProviderIdentityCheckService.checkIdentity(identity(providerId, providerType))).resolves.toMatchObject({
      status: 'unsupported',
      reason: expect.stringContaining('does not support a live background identity check'),
      details: { providerId, providerType, authority },
    });
    expect(getDataSource).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('keeps background group checks unsupported without contacting Microsoft Graph or another directory API', async () => {
    await expect(ssoProviderIdentityCheckService.checkGroup({
      providerId: 'entra-provider', providerType: 'microsoft', groupClaimValue: 'operations',
    })).resolves.toMatchObject({
      status: 'unsupported',
      reason: expect.stringContaining('does not support a live background group check'),
      details: { providerId: 'entra-provider', providerType: 'microsoft', groupClaimValue: 'operations' },
    });
    expect(getDataSource).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['OIDC', 'oidc-provider', 'oidc'],
    ['Microsoft Entra ID', 'entra-provider', 'microsoft'],
    ['SAML', 'saml-provider', 'saml'],
  ])('replays %s claims only from the latest normalized sign-in snapshot', async (label, providerId, providerType) => {
    const result = await ssoProviderIdentityCheckService.refreshClaims(identity(providerId, providerType), {
      groups: ['Ops', 'Deployers', 'Ops', ''], roles: ['operator', 'operator'], department: 'Finance',
    });

    expect(result).toMatchObject({
      status: 'refreshed',
      reason: `${label} claims refreshed from the latest normalized login snapshot`,
      claims: { email: 'snapshot@example.com', groups: ['Ops', 'Deployers'], roles: ['operator'], department: 'Finance' },
      details: {
        providerId, providerType, refreshMode: 'normalized_identity_snapshot', liveRefreshSupported: false,
        groupsCount: 2, rolesCount: 1, lastSeenAt: 12345,
      },
    });
    expect(getDataSource).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('does not treat a stored LDAP snapshot as a live refresh', async () => {
    await expect(ssoProviderIdentityCheckService.refreshClaims(identity('ldap-provider', 'ldap'), { groups: ['Ops'] })).resolves.toMatchObject({
      status: 'unsupported', reason: expect.stringContaining('does not support stored claim replay'),
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

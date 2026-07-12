import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { SsoProvider } from '@enterpriseglue/shared/db/entities/index.js';
import { ssoProviderIdentityCheckService } from '@enterpriseglue/shared/services/platform-admin/SsoProviderIdentityCheckService.js';

vi.mock('@enterpriseglue/shared/config/index.js', () => ({
  config: {
    microsoftClientId: undefined,
    microsoftClientSecret: undefined,
    microsoftTenantId: undefined,
  },
}));

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

function identity(overrides: Record<string, unknown> = {}) {
  return {
    id: 'identity-1',
    tenantId: 'tenant-a',
    providerId: 'microsoft',
    providerType: 'microsoft',
    providerSubject: '00000000-0000-0000-0000-000000000001',
    subjectClaim: 'oid',
    providerTenantId: null,
    userId: 'user-1',
    email: 'user@example.com',
    displayName: 'User Example',
    firstName: null,
    lastName: null,
    ...overrides,
  } as any;
}

function response(overrides: Record<string, unknown>) {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({}),
    ...overrides,
  } as any;
}

describe('ssoProviderIdentityCheckService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns unsupported for providers without a live identity checker', async () => {
    const result = await ssoProviderIdentityCheckService.checkIdentity(identity({
      providerId: 'saml-provider',
      providerType: 'saml',
      providerSubject: 'name-id-1',
      subjectClaim: 'nameID',
    }));

    expect(result).toMatchObject({
      status: 'unsupported',
      reason: expect.stringContaining('does not support live identity checks'),
    });
    expect(getDataSource).not.toHaveBeenCalled();
  });

  it.each([
    ['SAML', 'saml-provider', 'saml'],
    ['OIDC', 'oidc-provider', 'oidc'],
    ['Google', 'google', 'google'],
  ])('refreshes %s claims from the latest normalized login snapshot', async (label, providerId, providerType) => {
    const result = await ssoProviderIdentityCheckService.refreshClaims(identity({
      providerId,
      providerType,
      providerSubject: 'subject-1',
      subjectClaim: 'sub',
      email: 'snapshot@example.com',
      lastSeenAt: 12345,
    }), {
      groups: ['Ops', 'Deployers', 'Ops', ''],
      roles: ['operator', 'operator'],
      department: 'Finance',
    });

    expect(result).toMatchObject({
      status: 'refreshed',
      reason: `${label} claims refreshed from the latest normalized login snapshot`,
      claims: {
        email: 'snapshot@example.com',
        groups: ['Ops', 'Deployers'],
        roles: ['operator'],
        department: 'Finance',
      },
      details: {
        providerId,
        providerType,
        refreshMode: 'normalized_identity_snapshot',
        liveRefreshSupported: false,
        groupsCount: 2,
        rolesCount: 1,
        lastSeenAt: 12345,
      },
    });
    expect(getDataSource).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('returns unsupported when Microsoft client credentials are unavailable', async () => {
    const findOne = vi.fn().mockResolvedValue(null);
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === SsoProvider) return { findOne };
        throw new Error('Unexpected repository');
      },
    });

    const result = await ssoProviderIdentityCheckService.checkIdentity(identity());

    expect(result).toMatchObject({
      status: 'unsupported',
      reason: expect.stringContaining('requires client id, client secret, and tenant id'),
      details: expect.objectContaining({
        hasClientId: false,
        hasClientSecret: false,
        hasTenantId: false,
      }),
    });
    expect(findOne).toHaveBeenCalledTimes(2);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('returns active Microsoft profile details when Graph finds an enabled user', async () => {
    const findOne = vi.fn().mockResolvedValue({
      id: 'microsoft',
      type: 'microsoft',
      clientId: 'client-1',
      clientSecretEnc: `enc:${Buffer.from('secret-1').toString('base64')}`,
      tenantId: 'tenant-1',
    });
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === SsoProvider) return { findOne };
        throw new Error('Unexpected repository');
      },
    });
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(response({
        json: vi.fn().mockResolvedValue({ access_token: 'token-1' }),
      }))
      .mockResolvedValueOnce(response({
        json: vi.fn().mockResolvedValue({
          id: '00000000-0000-0000-0000-000000000001',
          accountEnabled: true,
          mail: 'new@example.com',
          displayName: 'New Example',
          givenName: 'New',
          surname: 'Example',
        }),
      }));

    const result = await ssoProviderIdentityCheckService.checkIdentity(identity());

    expect(result).toMatchObject({
      status: 'active',
      reason: 'Microsoft Graph user is active',
      profile: {
        email: 'new@example.com',
        displayName: 'New Example',
        firstName: 'New',
        lastName: 'Example',
      },
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1.0/users/00000000-0000-0000-0000-000000000001'),
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ authorization: 'Bearer token-1' }),
      }),
    );
  });

  it('returns deleted when Microsoft Graph user lookup returns 404', async () => {
    const findOne = vi.fn().mockResolvedValue({
      id: 'microsoft',
      type: 'microsoft',
      clientId: 'client-1',
      clientSecretEnc: 'secret-1',
      tenantId: 'tenant-1',
    });
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === SsoProvider) return { findOne };
        throw new Error('Unexpected repository');
      },
    });
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(response({
        json: vi.fn().mockResolvedValue({ access_token: 'token-1' }),
      }))
      .mockResolvedValueOnce(response({
        ok: false,
        status: 404,
      }));

    const result = await ssoProviderIdentityCheckService.checkIdentity(identity());

    expect(result).toMatchObject({
      status: 'deleted',
      reason: 'Microsoft Graph user lookup returned 404',
    });
  });

  it('resolves Microsoft group checks by exact display name when claim value is not an object id', async () => {
    const findOne = vi.fn().mockResolvedValue({
      id: 'microsoft',
      type: 'microsoft',
      clientId: 'client-1',
      clientSecretEnc: 'secret-1',
      tenantId: 'tenant-1',
    });
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === SsoProvider) return { findOne };
        throw new Error('Unexpected repository');
      },
    });
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(response({
        json: vi.fn().mockResolvedValue({ access_token: 'token-1' }),
      }))
      .mockResolvedValueOnce(response({
        json: vi.fn().mockResolvedValue({
          value: [{ id: 'group-1', displayName: 'Operations' }],
        }),
      }));

    const result = await ssoProviderIdentityCheckService.checkGroup({
      providerId: 'microsoft',
      groupClaimValue: 'Operations',
    });

    expect(result).toMatchObject({
      status: 'active',
      reason: 'Microsoft Graph group displayName lookup matched one group',
      details: {
        lookupMode: 'displayName',
        displayName: 'Operations',
        matchesCount: 1,
      },
      group: {
        id: 'group-1',
        displayName: 'Operations',
      },
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1.0/groups?'),
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ authorization: 'Bearer token-1' }),
      }),
    );
    expect(String(vi.mocked(globalThis.fetch).mock.calls[1][0])).toContain('displayName+eq+%27Operations%27');
  });

  it('returns deleted when Microsoft display-name group lookup has no exact matches', async () => {
    const findOne = vi.fn().mockResolvedValue({
      id: 'microsoft',
      type: 'microsoft',
      clientId: 'client-1',
      clientSecretEnc: 'secret-1',
      tenantId: 'tenant-1',
    });
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === SsoProvider) return { findOne };
        throw new Error('Unexpected repository');
      },
    });
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(response({
        json: vi.fn().mockResolvedValue({ access_token: 'token-1' }),
      }))
      .mockResolvedValueOnce(response({
        json: vi.fn().mockResolvedValue({ value: [] }),
      }));

    const result = await ssoProviderIdentityCheckService.checkGroup({
      providerId: 'microsoft',
      groupClaimValue: 'Missing Operations',
    });

    expect(result).toMatchObject({
      status: 'deleted',
      reason: 'Microsoft Graph group displayName lookup returned no exact matches',
      details: {
        lookupMode: 'displayName',
        displayName: 'Missing Operations',
        matchesCount: 0,
      },
    });
  });

  it('returns unknown when Microsoft display-name group lookup is ambiguous', async () => {
    const findOne = vi.fn().mockResolvedValue({
      id: 'microsoft',
      type: 'microsoft',
      clientId: 'client-1',
      clientSecretEnc: 'secret-1',
      tenantId: 'tenant-1',
    });
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === SsoProvider) return { findOne };
        throw new Error('Unexpected repository');
      },
    });
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(response({
        json: vi.fn().mockResolvedValue({ access_token: 'token-1' }),
      }))
      .mockResolvedValueOnce(response({
        json: vi.fn().mockResolvedValue({
          value: [
            { id: 'group-1', displayName: 'Operations' },
            { id: 'group-2', displayName: 'Operations' },
          ],
        }),
      }));

    const result = await ssoProviderIdentityCheckService.checkGroup({
      providerId: 'microsoft',
      groupClaimValue: 'Operations',
    });

    expect(result).toMatchObject({
      status: 'unknown',
      reason: 'Microsoft Graph group displayName lookup returned multiple matches',
      details: {
        lookupMode: 'displayName',
        displayName: 'Operations',
        matchesCount: 2,
      },
    });
  });

  it('returns deleted when Microsoft Graph group lookup returns 404', async () => {
    const findOne = vi.fn().mockResolvedValue({
      id: 'microsoft',
      type: 'microsoft',
      clientId: 'client-1',
      clientSecretEnc: 'secret-1',
      tenantId: 'tenant-1',
    });
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === SsoProvider) return { findOne };
        throw new Error('Unexpected repository');
      },
    });
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(response({
        json: vi.fn().mockResolvedValue({ access_token: 'token-1' }),
      }))
      .mockResolvedValueOnce(response({
        ok: false,
        status: 404,
      }));

    const result = await ssoProviderIdentityCheckService.checkGroup({
      providerId: 'microsoft',
      groupClaimValue: '00000000-0000-0000-0000-000000000123',
    });

    expect(result).toMatchObject({
      status: 'deleted',
      reason: 'Microsoft Graph group lookup returned 404',
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1.0/groups/00000000-0000-0000-0000-000000000123'),
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ authorization: 'Bearer token-1' }),
      }),
    );
  });

  it('refreshes Microsoft group and app-role claims through Graph', async () => {
    const findOne = vi.fn().mockResolvedValue({
      id: 'microsoft',
      type: 'microsoft',
      clientId: 'client-1',
      clientSecretEnc: 'secret-1',
      tenantId: 'tenant-1',
    });
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === SsoProvider) return { findOne };
        throw new Error('Unexpected repository');
      },
    });
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(response({
        json: vi.fn().mockResolvedValue({ access_token: 'token-1' }),
      }))
      .mockResolvedValueOnce(response({
        json: vi.fn().mockResolvedValue({
          value: [
            '00000000-0000-0000-0000-000000000123',
            '00000000-0000-0000-0000-000000000456',
            '00000000-0000-0000-0000-000000000123',
          ],
        }),
      }))
      .mockResolvedValueOnce(response({
        json: vi.fn().mockResolvedValue({
          value: [{
            id: 'service-principal-1',
            appRoles: [
              { id: 'role-id-1', value: 'operator' },
              { id: 'role-id-2', value: 'deployer' },
              { id: 'role-disabled', value: null },
            ],
          }],
        }),
      }))
      .mockResolvedValueOnce(response({
        json: vi.fn().mockResolvedValue({
          value: [
            { resourceId: 'service-principal-1', appRoleId: 'role-id-2' },
            { resourceId: 'service-principal-1', appRoleId: 'role-id-1' },
            { resourceId: 'service-principal-1', appRoleId: 'role-id-2' },
            { resourceId: 'other-service-principal', appRoleId: 'role-id-1' },
          ],
        }),
      }));

    const result = await ssoProviderIdentityCheckService.refreshClaims(identity(), {
      email: 'user@example.com',
      groups: ['old-group'],
      roles: ['deployer'],
    });

    expect(result).toMatchObject({
      status: 'refreshed',
      reason: 'Microsoft Graph member groups and app roles refreshed',
      claims: {
        email: 'user@example.com',
        groups: [
          '00000000-0000-0000-0000-000000000123',
          '00000000-0000-0000-0000-000000000456',
        ],
        roles: ['deployer', 'operator'],
      },
      details: {
        groupsCount: 2,
        rolesCount: 2,
        rolesRefreshStatus: 'refreshed',
        rolesRefreshReason: 'Microsoft Graph user app-role assignments refreshed',
        preservedRolesCount: 0,
        servicePrincipalId: 'service-principal-1',
        appRoleAssignmentsCount: 4,
        matchedAppRoleAssignmentsCount: 2,
      },
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1.0/users/00000000-0000-0000-0000-000000000001/getMemberGroups'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer token-1',
          'content-type': 'application/json',
        }),
        body: JSON.stringify({ securityEnabledOnly: false }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1.0/servicePrincipals?'),
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ authorization: 'Bearer token-1' }),
      }),
    );
    expect(String(vi.mocked(globalThis.fetch).mock.calls[2][0])).toContain('appId+eq+%27client-1%27');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1.0/users/00000000-0000-0000-0000-000000000001/appRoleAssignments'),
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ authorization: 'Bearer token-1' }),
      }),
    );
  });

  it('preserves Microsoft roles when app-role lookup is unavailable', async () => {
    const findOne = vi.fn().mockResolvedValue({
      id: 'microsoft',
      type: 'microsoft',
      clientId: 'client-1',
      clientSecretEnc: 'secret-1',
      tenantId: 'tenant-1',
    });
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === SsoProvider) return { findOne };
        throw new Error('Unexpected repository');
      },
    });
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(response({
        json: vi.fn().mockResolvedValue({ access_token: 'token-1' }),
      }))
      .mockResolvedValueOnce(response({
        json: vi.fn().mockResolvedValue({
          value: ['00000000-0000-0000-0000-000000000123'],
        }),
      }))
      .mockResolvedValueOnce(response({
        ok: false,
        status: 403,
      }));

    const result = await ssoProviderIdentityCheckService.refreshClaims(identity(), {
      email: 'user@example.com',
      groups: ['old-group'],
      roles: ['deployer', 'operator'],
    });

    expect(result).toMatchObject({
      status: 'refreshed',
      reason: 'Microsoft Graph member groups refreshed',
      claims: {
        email: 'user@example.com',
        groups: ['00000000-0000-0000-0000-000000000123'],
        roles: ['deployer', 'operator'],
      },
      details: {
        groupsCount: 1,
        rolesCount: 2,
        rolesRefreshStatus: 'unknown',
        rolesRefreshReason: 'Microsoft Graph app-role service principal lookup failed with HTTP 403',
        preservedRolesCount: 2,
        rolesLookupStatus: 403,
      },
    });
  });
});

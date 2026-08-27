import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EntityManager } from 'typeorm';
import { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { identityProviderService } from '@enterpriseglue/shared/services/platform-admin/IdentityProviderService.js';
import { secretResolver } from '@enterpriseglue/shared/services/platform-admin/SecretResolver.js';
import { tenantIdentityProviderSecretService } from '@enterpriseglue/shared/services/platform-admin/TenantIdentityProviderSecretService.js';

function provider(overrides: Partial<IdentityProvider> = {}): IdentityProvider {
  return Object.assign(new IdentityProvider(), {
    id: 'provider-1',
    tenantId: 'tenant-alpha',
    key: 'alpha-oidc',
    displayName: 'Alpha OIDC',
    organization: null,
    displayOrder: 0,
    isPreferred: true,
    loginDomainsJson: '["alpha.example"]',
    providerKeyIdentity: 'tenant-alpha:alpha-oidc',
    protocol: 'oidc',
    isEnabled: false,
    authenticationMode: 'direct',
    directoryTenantId: null,
    configurationJson: JSON.stringify({
      issuerUrl: 'https://login.alpha.example',
      clientId: 'alpha-client',
      clientSecretRef: 'ref:tenant-secret://v1/tenant-alpha/oidc.client_secret/version-1',
    }),
    syncJson: JSON.stringify({ triggers: ['login'], requiredForLogin: true, incompleteEntitlements: 'fail_closed' }),
    ownershipMode: 'manual',
    sourceRef: null,
    sourceHash: null,
    lastAppliedAt: null,
    driftStatus: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  });
}

function manager(findOne: ReturnType<typeof vi.fn>): EntityManager {
  return {
    getRepository: vi.fn(() => ({ findOne })),
  } as unknown as EntityManager;
}

describe('TenantIdentityProviderSecretService break-glass recovery', () => {
  afterEach(() => vi.restoreAllMocks());

  it('replaces only the selected tenant provider reference after checking local availability', async () => {
    const current = provider();
    const findOne = vi.fn(async () => current);
    vi.spyOn(secretResolver, 'checkExternalReference').mockReturnValue({ available: true });
    const upsert = vi.spyOn(identityProviderService, 'upsert').mockResolvedValue(current);

    await tenantIdentityProviderSecretService.setBreakGlassReference({
      tenantId: 'tenant-alpha',
      providerKey: 'alpha-oidc',
      purpose: 'oidc.client_secret',
      reference: 'ref:env://EG_ALPHA_OIDC_CLIENT_SECRET',
      enableProvider: true,
      store: manager(findOne),
    });

    expect(findOne).toHaveBeenCalledWith({ where: { providerKeyIdentity: 'tenant-alpha:alpha-oidc' } });
    expect(secretResolver.checkExternalReference).toHaveBeenCalledWith('env://EG_ALPHA_OIDC_CLIENT_SECRET');
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-alpha',
      key: 'alpha-oidc',
      isEnabled: true,
      configuration: expect.objectContaining({ clientSecretRef: 'ref:env://EG_ALPHA_OIDC_CLIENT_SECRET' }),
    }), expect.anything());
    expect(JSON.stringify(upsert.mock.calls[0])).not.toContain('version-1');
  });

  it('cannot target another tenant and never falls back to a platform provider lookup', async () => {
    const findOne = vi.fn(async () => null);
    vi.spyOn(secretResolver, 'checkExternalReference').mockReturnValue({ available: true });
    const upsert = vi.spyOn(identityProviderService, 'upsert');

    await expect(tenantIdentityProviderSecretService.setBreakGlassReference({
      tenantId: 'tenant-bravo',
      providerKey: 'alpha-oidc',
      purpose: 'oidc.client_secret',
      reference: 'ref:docker://bravo-oidc-secret',
      enableProvider: false,
      store: manager(findOne),
    })).rejects.toMatchObject({ statusCode: 404 });

    expect(findOne).toHaveBeenCalledWith({ where: { providerKeyIdentity: 'tenant-bravo:alpha-oidc' } });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('rejects broker references and unavailable local references before changing provider state', async () => {
    const findOne = vi.fn(async () => provider());
    const store = manager(findOne);
    const upsert = vi.spyOn(identityProviderService, 'upsert');

    await expect(tenantIdentityProviderSecretService.setBreakGlassReference({
      tenantId: 'tenant-alpha', providerKey: 'alpha-oidc', purpose: 'oidc.client_secret',
      reference: 'ref:tenant-secret://v1/tenant-alpha/oidc.client_secret/version-2',
      enableProvider: false, store,
    })).rejects.toMatchObject({ statusCode: 400 });

    vi.spyOn(secretResolver, 'checkExternalReference').mockReturnValue({ available: false, reason: 'environment_variable_missing' });
    await expect(tenantIdentityProviderSecretService.setBreakGlassReference({
      tenantId: 'tenant-alpha', providerKey: 'alpha-oidc', purpose: 'oidc.client_secret',
      reference: 'ref:env://EG_MISSING_SECRET', enableProvider: false, store,
    })).rejects.toMatchObject({ statusCode: 503 });

    expect(findOne).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });
});

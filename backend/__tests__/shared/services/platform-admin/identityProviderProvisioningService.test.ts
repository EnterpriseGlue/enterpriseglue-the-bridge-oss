import { beforeEach, describe, expect, it, vi } from 'vitest';

const stores = vi.hoisted(() => ({
  externalIdentity: { findOne: vi.fn() },
  user: { findOneBy: vi.fn(), insert: vi.fn(), update: vi.fn() },
}));
const manager = vi.hoisted(() => ({
  getRepository: vi.fn(),
}));
const ssoNormalizedIdentityService = vi.hoisted(() => ({ upsertIdentityWithManager: vi.fn() }));
const identityEntitlementMappingService = vi.hoisted(() => ({ syncMembershipsInStore: vi.fn() }));
const adapter = vi.hoisted(() => ({ normalizeIdentity: vi.fn() }));

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(async () => ({ transaction: async (callback: (transactionManager: typeof manager) => unknown) => callback(manager) })),
}));
vi.mock('@enterpriseglue/shared/services/platform-admin/SsoNormalizedIdentityService.js', () => ({ ssoNormalizedIdentityService }));
vi.mock('@enterpriseglue/shared/services/platform-admin/IdentityEntitlementMappingService.js', () => ({ identityEntitlementMappingService }));
vi.mock('@enterpriseglue/shared/services/platform-admin/IdentityProviderAdapter.js', () => ({ getIdentityProviderAdapter: vi.fn(() => adapter) }));

import { identityProviderProvisioningService } from '@enterpriseglue/shared/services/platform-admin/IdentityProviderProvisioningService.js';

describe('IdentityProviderProvisioningService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    manager.getRepository.mockImplementation((entity: { name: string }) => entity.name === 'ExternalIdentity' ? stores.externalIdentity : stores.user);
    stores.externalIdentity.findOne.mockResolvedValue(null);
    stores.user.findOneBy.mockResolvedValue(null);
    stores.user.insert.mockResolvedValue(undefined);
    ssoNormalizedIdentityService.upsertIdentityWithManager.mockResolvedValue({ id: 'snapshot-1', created: true });
    adapter.normalizeIdentity.mockReturnValue({ providerKey: 'provider-1', providerType: 'oidc', subjectId: 'subject-1', entitlements: [{ type: 'group', externalId: 'team-a' }], observedAt: 1 });
    identityEntitlementMappingService.syncMembershipsInStore.mockResolvedValue({ created: 1, removed: 0 });
  });

  it('synchronizes provider-managed group memberships from the normalized identity in the provisioning transaction', async () => {
    const provider = { id: 'provider-1', tenantId: 'tenant-1', directoryTenantId: 'directory-1' } as any;
    await identityProviderProvisioningService.provisionLdapUser(provider, {
      subjectId: 'subject-1',
      email: 'person@example.test',
      claims: { sub: 'subject-1', email: 'person@example.test', groups: ['team-a'] },
    });

    expect(adapter.normalizeIdentity).toHaveBeenCalledWith(expect.objectContaining({
      providerKey: 'provider-1',
      subjectId: 'subject-1',
      directoryTenantId: 'directory-1',
    }));
    expect(identityEntitlementMappingService.syncMembershipsInStore).toHaveBeenCalledWith(
      manager,
      expect.any(String),
      'tenant-1',
      expect.objectContaining({ entitlements: [{ type: 'group', externalId: 'team-a' }] }),
    );
  });
});

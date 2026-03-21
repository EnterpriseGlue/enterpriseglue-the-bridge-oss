import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { provisionSamlUser, type SamlUserInfo } from '@enterpriseglue/shared/services/saml.js';
import { ssoProviderService } from '@enterpriseglue/shared/services/platform-admin/SsoProviderService.js';
import { ssoClaimsMappingService } from '@enterpriseglue/shared/services/platform-admin/SsoClaimsMappingService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/SsoProviderService.js', () => ({
  ssoProviderService: {
    getProvider: vi.fn(),
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/SsoClaimsMappingService.js', () => ({
  ssoClaimsMappingService: {
    resolveRoleFromClaims: vi.fn(),
  },
}));

describe('saml service - provisionSamlUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns authProvider as saml when user exists by entraId', async () => {
    const existingUser = {
      id: 'user-1',
      email: 'old@example.com',
      authProvider: 'local',
      platformRole: 'user',
      firstName: 'Old',
      lastName: 'Name',
      entraId: 'oid-123',
      entraEmail: 'old@example.com',
    };

    const userRepo = {
      findOneBy: vi.fn().mockResolvedValue(existingUser),
      update: vi.fn().mockResolvedValue(undefined),
      insert: vi.fn(),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: vi.fn().mockReturnValue(userRepo),
    });

    (ssoProviderService.getProvider as unknown as Mock).mockResolvedValue({
      id: 'provider-saml-1',
      defaultRole: 'user',
    });

    (ssoClaimsMappingService.resolveRoleFromClaims as unknown as Mock).mockResolvedValue('user');

    const userInfo: SamlUserInfo = {
      email: 'saml-user@example.com',
      oid: 'oid-123',
      groups: ['eng'],
      roles: ['dev'],
      customClaims: {},
      given_name: 'Saml',
      family_name: 'User',
    };

    const result = await provisionSamlUser(userInfo, 'provider-saml-1');

    expect(userRepo.update).toHaveBeenCalledWith(
      { id: 'user-1' },
      expect.objectContaining({ authProvider: 'saml', email: 'saml-user@example.com' })
    );
    expect(result).toEqual(expect.objectContaining({ authProvider: 'saml' }));
  });
});

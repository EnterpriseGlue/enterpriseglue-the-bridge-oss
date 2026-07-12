import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { identityProviderService } from '@enterpriseglue/shared/services/platform-admin/IdentityProviderService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));

describe('identityProviderService', () => {
  const findOne = vi.fn(); const insert = vi.fn(); const update = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks(); findOne.mockResolvedValue(null); insert.mockResolvedValue(undefined);
    (getDataSource as any).mockResolvedValue({ getRepository: (entity: unknown) => {
      if (entity === IdentityProvider) return { findOne, insert, update, find: vi.fn() };
      throw new Error('Unexpected repository');
    }});
  });
  it('creates OIDC providers with secret references only', async () => {
    const provider = await identityProviderService.upsert({ key: 'entra', protocol: 'oidc', configuration: { issuerUrl: 'https://login.example.test', clientId: 'client', clientSecretRef: 'EG_ENTRA_SECRET' } });
    expect(provider.key).toBe('entra');
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ protocol: 'oidc', configurationJson: expect.stringContaining('clientSecretRef') }));
  });
  it('rejects raw secrets and non-LDAPS LDAP endpoints', async () => {
    await expect(identityProviderService.upsert({ key: 'bad', protocol: 'oidc', configuration: { issuerUrl: 'https://idp.test', clientId: 'x', clientSecret: 'raw' } })).rejects.toThrow('secret references');
    await expect(identityProviderService.upsert({ key: 'ldap', protocol: 'ldap', configuration: { url: 'ldap://directory.test' } })).rejects.toThrow('ldaps://');
  });
});

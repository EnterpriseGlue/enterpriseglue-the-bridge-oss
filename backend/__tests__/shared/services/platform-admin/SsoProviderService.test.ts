import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { ssoProviderService } from '@enterpriseglue/shared/services/platform-admin/SsoProviderService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

describe('SsoProviderService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks enabling SAML provider on create when required fields are missing', async () => {
    const insert = vi.fn();

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: () => ({ insert }),
    });

    await expect(
      ssoProviderService.createProvider({
        name: 'Entra SAML',
        type: 'saml',
        enabled: true,
        entityId: 'https://sp.example.com/saml',
        ssoUrl: 'https://login.microsoftonline.com/test/saml2',
      })
    ).rejects.toMatchObject({
      message: expect.stringContaining('Cannot enable SAML provider'),
      statusCode: 400,
    });

    expect(insert).not.toHaveBeenCalled();
  });

  it('blocks enabling SAML provider on toggle when provider is incomplete', async () => {
    const findOneBy = vi.fn().mockResolvedValue({
      id: 'provider-1',
      type: 'saml',
      entityId: null,
      ssoUrl: 'https://login.microsoftonline.com/test/saml2',
      certificateEnc: null,
    });
    const update = vi.fn();

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: () => ({ findOneBy, update }),
    });

    await expect(ssoProviderService.toggleProvider('provider-1', true)).rejects.toMatchObject({
      message: expect.stringContaining('Cannot enable SAML provider'),
      statusCode: 400,
    });

    expect(update).not.toHaveBeenCalled();
  });

  it('allows enabling SAML provider on update when required fields already exist', async () => {
    const findOneBy = vi.fn().mockResolvedValue({
      id: 'provider-2',
      type: 'saml',
      enabled: false,
      entityId: 'https://sp.example.com/saml',
      ssoUrl: 'https://login.microsoftonline.com/test/saml2',
      certificateEnc: 'enc:dGVzdA==',
    });
    const update = vi.fn();

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: () => ({ findOneBy, update }),
    });

    await expect(ssoProviderService.updateProvider('provider-2', { enabled: true })).resolves.toBeUndefined();

    expect(update).toHaveBeenCalledWith({ id: 'provider-2' }, expect.objectContaining({ enabled: true }));
  });

  it('stores provider credentials as opaque ciphertext and redacts them from public reads', async () => {
    const clientSecret = 'oidc-client-secret-sentinel';
    const certificate = 'saml-certificate-sentinel';
    const insert = vi.fn();
    const find = vi.fn();

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: () => ({ insert, find }),
    });

    await ssoProviderService.createProvider({
      name: 'OIDC',
      type: 'oidc',
      clientId: 'client-id',
      clientSecret,
      certificate,
    });

    const persisted = insert.mock.calls[0]?.[0];
    expect(persisted).toEqual(expect.objectContaining({
      clientSecretEnc: expect.stringMatching(/^v2:/),
      certificateEnc: expect.stringMatching(/^v2:/),
    }));
    expect(JSON.stringify(persisted)).not.toContain(clientSecret);
    expect(JSON.stringify(persisted)).not.toContain(certificate);

    find.mockResolvedValue([{ ...persisted, id: 'provider-1' }]);
    const publicProviders = await ssoProviderService.getAllProviders();
    expect(publicProviders[0]).toEqual(expect.objectContaining({
      hasClientSecret: true,
      hasCertificate: true,
    }));
    expect(JSON.stringify(publicProviders)).not.toContain(clientSecret);
    expect(JSON.stringify(publicProviders)).not.toContain(certificate);
    expect(JSON.stringify(publicProviders)).not.toContain(persisted.clientSecretEnc);
    expect(JSON.stringify(publicProviders)).not.toContain(persisted.certificateEnc);
  });

  it('rejects SHA-1 for legacy SAML provider create and update paths', async () => {
    const insert = vi.fn();
    const findOneBy = vi.fn().mockResolvedValue({
      id: 'provider-1', type: 'saml', enabled: false, signatureAlgorithm: 'sha256',
    });
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: () => ({ insert, findOneBy, update: vi.fn() }),
    });

    await expect(ssoProviderService.createProvider({ name: 'Legacy SAML', type: 'saml', signatureAlgorithm: 'sha1' as never }))
      .rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('sha256 or sha512') });
    await expect(ssoProviderService.updateProvider('provider-1', { signatureAlgorithm: 'sha1' as never }))
      .rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('sha256 or sha512') });
    expect(insert).not.toHaveBeenCalled();
  });
});

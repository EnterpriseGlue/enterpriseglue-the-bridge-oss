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
});

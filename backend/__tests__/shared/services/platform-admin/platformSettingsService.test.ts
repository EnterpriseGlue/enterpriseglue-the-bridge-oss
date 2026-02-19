import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { PlatformSettingsService } from '../../../../src/shared/services/platform-admin/PlatformSettingsService.js';
import { getDataSource } from '../../../../src/shared/db/data-source.js';
import { PlatformSettings } from '../../../../src/shared/db/entities/PlatformSettings.js';
import { encrypt, isEncrypted, safeDecrypt } from '../../../../src/shared/services/encryption.js';

vi.mock('@shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@shared/services/encryption.js', () => ({
  encrypt: vi.fn((value: string) => `enc:${value}`),
  isEncrypted: vi.fn((value: string) => value.startsWith('v2:') || value.startsWith('enc:')),
  safeDecrypt: vi.fn((value: string) => value.startsWith('enc:') ? value.slice(4) : value),
}));

describe('PlatformSettingsService', () => {
  const service = new PlatformSettingsService();

  beforeEach(() => {
    vi.clearAllMocks();
    (encrypt as unknown as Mock).mockImplementation((value: string) => `enc:${value}`);
    (isEncrypted as unknown as Mock).mockImplementation((value: string) => value.startsWith('v2:') || value.startsWith('enc:'));
    (safeDecrypt as unknown as Mock).mockImplementation((value: string) => value.startsWith('enc:') ? value.slice(4) : value);
  });

  it('returns defaults when settings missing', async () => {
    const repo = {
      findOneBy: vi.fn().mockResolvedValue(null),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === PlatformSettings) return repo;
        throw new Error('Unexpected repository');
      },
    });

    const settings = await service.get();
    expect(settings.syncPushEnabled).toBe(true);
    expect(settings.inviteAllowAllDomains).toBe(true);
    expect(settings.defaultDeployRoles).toContain('owner');
  });

  it('inserts new settings when absent', async () => {
    const repo = {
      findOneBy: vi.fn().mockResolvedValue(null),
      insert: vi.fn(),
      update: vi.fn(),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === PlatformSettings) return repo;
        throw new Error('Unexpected repository');
      },
    });

    await service.update({ syncPullEnabled: true }, 'admin-1');
    expect(repo.insert).toHaveBeenCalled();
    (expect(repo.update) as any).not.toHaveBeenCalled();
  });

  it('updates existing settings', async () => {
    const repo = {
      findOneBy: vi.fn().mockResolvedValue({ id: 'default' }),
      insert: vi.fn(),
      update: vi.fn(),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === PlatformSettings) return repo;
        throw new Error('Unexpected repository');
      },
    });

    await service.update({ syncPullEnabled: true }, 'admin-1');
    expect(repo.update).toHaveBeenCalledWith({ id: 'default' }, expect.objectContaining({
      syncPullEnabled: true,
      updatedById: 'admin-1',
    }));
    (expect(repo.insert) as any).not.toHaveBeenCalled();
  });

  it('masks pii auth token in get() response', async () => {
    const repo = {
      findOneBy: vi.fn().mockResolvedValue({
        id: 'default',
        defaultEnvironmentTagId: null,
        syncPushEnabled: true,
        syncPullEnabled: false,
        defaultDeployRoles: JSON.stringify(['owner']),
        inviteAllowAllDomains: true,
        inviteAllowedDomains: JSON.stringify([]),
        piiRegexEnabled: true,
        piiExternalProviderEnabled: true,
        piiExternalProviderType: 'presidio',
        piiExternalProviderEndpoint: 'https://presidio.local',
        piiExternalProviderAuthHeader: 'Authorization',
        piiExternalProviderAuthToken: 'enc:secret-token',
        piiExternalProviderProjectId: null,
        piiExternalProviderRegion: null,
        piiRedactionStyle: '<TYPE>',
        piiScopes: JSON.stringify(['logs']),
        piiMaxPayloadSizeBytes: 1024,
      }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === PlatformSettings) return repo;
        throw new Error('Unexpected repository');
      },
    });

    const settings = await service.get();
    expect(settings.piiExternalProviderAuthToken).toBeNull();
  });

  it('returns decrypted pii auth token from getWithSecrets()', async () => {
    const repo = {
      findOneBy: vi.fn().mockResolvedValue({
        id: 'default',
        defaultEnvironmentTagId: null,
        syncPushEnabled: true,
        syncPullEnabled: false,
        defaultDeployRoles: JSON.stringify(['owner']),
        inviteAllowAllDomains: true,
        inviteAllowedDomains: JSON.stringify([]),
        piiRegexEnabled: true,
        piiExternalProviderEnabled: true,
        piiExternalProviderType: 'presidio',
        piiExternalProviderEndpoint: 'https://presidio.local',
        piiExternalProviderAuthHeader: 'Authorization',
        piiExternalProviderAuthToken: 'enc:secret-token',
        piiExternalProviderProjectId: null,
        piiExternalProviderRegion: null,
        piiRedactionStyle: '<TYPE>',
        piiScopes: JSON.stringify(['logs']),
        piiMaxPayloadSizeBytes: 1024,
      }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === PlatformSettings) return repo;
        throw new Error('Unexpected repository');
      },
    });

    const settings = await service.getWithSecrets();
    expect(safeDecrypt).toHaveBeenCalledWith('enc:secret-token');
    expect(settings.piiExternalProviderAuthToken).toBe('secret-token');
  });

  it('encrypts pii auth token before updating existing settings', async () => {
    const repo = {
      findOneBy: vi.fn().mockResolvedValue({ id: 'default' }),
      insert: vi.fn(),
      update: vi.fn(),
    };

    (isEncrypted as unknown as Mock).mockReturnValue(false);

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === PlatformSettings) return repo;
        throw new Error('Unexpected repository');
      },
    });

    await service.update({ piiExternalProviderAuthToken: 'plain-token' }, 'admin-1');

    expect(encrypt).toHaveBeenCalledWith('plain-token');
    expect(repo.update).toHaveBeenCalledWith(
      { id: 'default' },
      expect.objectContaining({ piiExternalProviderAuthToken: 'enc:plain-token' })
    );
  });
});

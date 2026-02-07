import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { PlatformSettingsService } from '../../../../src/shared/services/platform-admin/PlatformSettingsService.js';
import { getDataSource } from '../../../../src/shared/db/data-source.js';
import { PlatformSettings } from '../../../../src/shared/db/entities/PlatformSettings.js';

vi.mock('@shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

describe('PlatformSettingsService', () => {
  const service = new PlatformSettingsService();

  beforeEach(() => {
    vi.clearAllMocks();
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
});

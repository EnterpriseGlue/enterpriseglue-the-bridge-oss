import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { PlatformSettings } from '@enterpriseglue/shared/infrastructure/persistence/entities/PlatformSettings.js';
import { PlatformBrandingService } from '@enterpriseglue/shared/services/platform-admin/PlatformBrandingService.js';
import { platformSettingsService } from '@enterpriseglue/shared/services/platform-admin/PlatformSettingsService.js';
import { platformSettingsSectionOwnershipService } from '@enterpriseglue/shared/services/platform-admin/PlatformSettingsSectionOwnershipService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));

const service = new PlatformBrandingService();

function repository(row: any = null) {
  return {
    findOneBy: vi.fn().mockResolvedValue(row),
    update: vi.fn().mockResolvedValue({ affected: 1 }),
  };
}

function storeWith(repo: ReturnType<typeof repository>) {
  return {
    getRepository: vi.fn((entity: unknown) => {
      if (entity === PlatformSettings) return repo;
      throw new Error('Unexpected repository');
    }),
  } as any;
}

describe('PlatformBrandingService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns persisted branding with its configuration ownership', async () => {
    const repo = repository({
      logoUrl: 'https://assets.example.com/logo.svg', loginLogoUrl: '', loginTitleVerticalOffset: 4,
      loginTitleColor: '#161616', logoTitle: 'Headless', logoScale: 115, titleFontUrl: '',
      titleFontWeight: '700', titleFontSize: 16, titleVerticalOffset: 2,
      menuAccentColor: '#0f62fe', faviconUrl: 'https://assets.example.com/favicon.ico',
    });
    const store = storeWith(repo);
    vi.spyOn(platformSettingsSectionOwnershipService, 'list').mockResolvedValue([
      { section: 'pii' },
      { section: 'branding', ownershipMode: 'config_locked', sourceRef: 'config_bundle:headless' },
    ] as any);

    await expect(service.get(store)).resolves.toEqual(expect.objectContaining({
      logoTitle: 'Headless', logoScale: 115, titleFontWeight: '700',
      ownership: expect.objectContaining({ section: 'branding', ownershipMode: 'config_locked' }),
    }));
    expect(store.getRepository).toHaveBeenCalledWith(PlatformSettings);
  });

  it('returns stable defaults when settings and ownership are absent', async () => {
    const store = storeWith(repository(null));
    vi.spyOn(platformSettingsSectionOwnershipService, 'list').mockResolvedValue([]);
    await expect(service.get(store)).resolves.toMatchObject({
      logoUrl: null, loginLogoUrl: null, loginTitleVerticalOffset: 0, logoTitle: null,
      logoScale: 100, titleFontWeight: '600', titleFontSize: 14,
      titleVerticalOffset: 0, menuAccentColor: null, ownership: null,
    });
  });

  it('runs ordinary updates transactionally, claims the section, and seeds missing settings', async () => {
    const repo = repository(null);
    const manager = storeWith(repo);
    const root = {
      transaction: vi.fn(async (callback: (value: any) => unknown) => callback(manager)),
    };
    (getDataSource as Mock).mockResolvedValue(root);
    const manualClaim = vi.spyOn(platformSettingsSectionOwnershipService, 'claimManualMutation').mockResolvedValue();
    const seed = vi.spyOn(platformSettingsService, 'update').mockResolvedValue({} as any);

    await service.update({ logoTitle: 'Portal title', logoUrl: undefined }, 'user-1');

    expect(root.transaction).toHaveBeenCalledOnce();
    expect(manualClaim).toHaveBeenCalledWith(manager, ['branding']);
    expect(seed).toHaveBeenCalledWith({}, 'user-1', { store: manager, bypassOwnership: true });
    expect(repo.update).toHaveBeenCalledWith(
      { id: 'default' },
      expect.objectContaining({ logoTitle: 'Portal title', updatedById: 'user-1' }),
    );
    expect(repo.update.mock.calls[0]![1]).not.toHaveProperty('logoUrl');
  });

  it('claims exact configuration provenance and bypasses a manual claim', async () => {
    const repo = repository({ id: 'default' });
    const manager = storeWith(repo);
    const configClaim = vi.spyOn(platformSettingsSectionOwnershipService, 'claimConfiguration').mockResolvedValue();
    const manualClaim = vi.spyOn(platformSettingsSectionOwnershipService, 'claimManualMutation').mockResolvedValue();
    const sectionOwnership = {
      scopeKey: 'tenant-a', sourceRef: 'config_bundle:headless', ownershipMode: 'config_warn' as const,
      sourceHash: 'hash-1', appliedAt: 20, expectedGeneration: 3,
    };

    await service.update({ menuAccentColor: '#0f62fe' }, 'machine-1', { store: manager, sectionOwnership });

    expect(configClaim).toHaveBeenCalledWith(manager, { sections: ['branding'], ...sectionOwnership });
    expect(manualClaim).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalledWith(
      { id: 'default' },
      expect.objectContaining({ menuAccentColor: '#0f62fe', updatedById: 'machine-1' }),
    );
  });

  it('supports explicit ownership bypass and resets every branding field', async () => {
    const repo = repository({ id: 'default' });
    const manager = storeWith(repo);
    const manualClaim = vi.spyOn(platformSettingsSectionOwnershipService, 'claimManualMutation').mockResolvedValue();

    await service.update({ logoScale: 90 }, 'system', { store: manager, bypassOwnership: true });
    expect(manualClaim).not.toHaveBeenCalled();

    await service.reset('user-2', manager);
    expect(manualClaim).toHaveBeenCalledWith(manager, ['branding']);
    expect(repo.update).toHaveBeenLastCalledWith({ id: 'default' }, expect.objectContaining({
      logoUrl: null, loginLogoUrl: null, logoScale: 100, titleFontWeight: '600',
      titleFontSize: 14, menuAccentColor: null, faviconUrl: null, updatedById: 'user-2',
    }));
  });
});

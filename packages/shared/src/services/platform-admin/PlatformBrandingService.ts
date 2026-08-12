import type { DataSource, EntityManager } from 'typeorm';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { PlatformSettings } from '@enterpriseglue/shared/infrastructure/persistence/entities/PlatformSettings.js';
import type { PlatformBranding, UpdatePlatformBrandingRequest } from '@enterpriseglue/shared/schemas/platform-admin/platform-settings.js';
import { platformSettingsService } from './PlatformSettingsService.js';
import { platformSettingsSectionOwnershipService } from './PlatformSettingsSectionOwnershipService.js';

type Store = DataSource | EntityManager;

const DEFAULT_BRANDING: Omit<PlatformBranding, 'ownership'> = {
  logoUrl: null,
  loginLogoUrl: null,
  loginTitleVerticalOffset: 0,
  loginTitleColor: null,
  logoTitle: null,
  logoScale: 100,
  titleFontUrl: null,
  titleFontWeight: '600',
  titleFontSize: 14,
  titleVerticalOffset: 0,
  menuAccentColor: null,
  faviconUrl: null,
};

export class PlatformBrandingService {
  async get(store?: Store): Promise<PlatformBranding> {
    const dataSource = store || await getDataSource();
    const row = await dataSource.getRepository(PlatformSettings).findOneBy({ id: 'default' });
    const ownership = (await platformSettingsSectionOwnershipService.list(dataSource))
      .find((entry) => entry.section === 'branding') || null;
    return {
      logoUrl: row?.logoUrl || null,
      loginLogoUrl: row?.loginLogoUrl || null,
      loginTitleVerticalOffset: row?.loginTitleVerticalOffset ?? 0,
      loginTitleColor: row?.loginTitleColor || null,
      logoTitle: row?.logoTitle || null,
      logoScale: row?.logoScale ?? 100,
      titleFontUrl: row?.titleFontUrl || null,
      titleFontWeight: row?.titleFontWeight || '600',
      titleFontSize: row?.titleFontSize ?? 14,
      titleVerticalOffset: row?.titleVerticalOffset ?? 0,
      menuAccentColor: row?.menuAccentColor || null,
      faviconUrl: row?.faviconUrl || null,
      ownership,
    };
  }

  async update(
    data: UpdatePlatformBrandingRequest,
    updatedById: string,
    options?: {
      store?: Store;
      bypassOwnership?: boolean;
      sectionOwnership?: {
        scopeKey: string;
        sourceRef: string;
        ownershipMode: 'manual' | 'config_locked' | 'config_warn';
        sourceHash: string;
        appliedAt: number;
        expectedGeneration?: number;
      };
    },
  ): Promise<void> {
    if (!options?.store) {
      const root = await getDataSource();
      await root.transaction((manager) => this.update(data, updatedById, { ...options, store: manager }));
      return;
    }
    const store = options.store;
    if (options.sectionOwnership) {
      await platformSettingsSectionOwnershipService.claimConfiguration(store, {
        sections: ['branding'],
        ...options.sectionOwnership,
      });
    } else if (!options.bypassOwnership) {
      await platformSettingsSectionOwnershipService.claimManualMutation(store, ['branding']);
    }
    const repo = store.getRepository(PlatformSettings);
    if (!await repo.findOneBy({ id: 'default' })) {
      await platformSettingsService.update({}, updatedById, { store, bypassOwnership: true });
    }
    const update: Record<string, unknown> = { updatedAt: Date.now(), updatedById };
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) update[key] = value;
    }
    await repo.update({ id: 'default' }, update);
  }

  async reset(updatedById: string, store?: Store): Promise<void> {
    await this.update(DEFAULT_BRANDING, updatedById, { ...(store ? { store } : {}) });
  }
}

export const platformBrandingService = new PlatformBrandingService();

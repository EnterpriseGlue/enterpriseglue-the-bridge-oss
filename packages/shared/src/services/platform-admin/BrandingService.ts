import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { PlatformSettings } from '@enterpriseglue/shared/db/entities/PlatformSettings.js';
import type {
  PublicPlatformBranding,
  UpdatePlatformBrandingRequest,
} from '@enterpriseglue/shared/schemas/platform-admin/platform-settings.js';

export type PlatformBranding = PublicPlatformBranding;

const BRANDING_DEFAULTS: PlatformBranding = {
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
  ssoAutoRedirectSingleProvider: false,
};

class BrandingService {
  async get(): Promise<PlatformBranding> {
    const dataSource = await getDataSource();
    const repo = dataSource.getRepository(PlatformSettings);
    const row = await repo.findOne({ where: { id: 'default' } });

    if (!row) {
      return { ...BRANDING_DEFAULTS };
    }

    return {
      logoUrl: row.logoUrl || null,
      loginLogoUrl: row.loginLogoUrl || null,
      loginTitleVerticalOffset: row.loginTitleVerticalOffset ?? 0,
      loginTitleColor: row.loginTitleColor || null,
      logoTitle: row.logoTitle || null,
      logoScale: row.logoScale ?? 100,
      titleFontUrl: row.titleFontUrl || null,
      titleFontWeight: row.titleFontWeight ?? '600',
      titleFontSize: row.titleFontSize ?? 14,
      titleVerticalOffset: row.titleVerticalOffset ?? 0,
      menuAccentColor: row.menuAccentColor || null,
      faviconUrl: row.faviconUrl || null,
      ssoAutoRedirectSingleProvider: (row as any).ssoAutoRedirectSingleProvider ?? false,
    };
  }

  async update(input: UpdatePlatformBrandingRequest, updatedById: string): Promise<void> {
    const dataSource = await getDataSource();
    const repo = dataSource.getRepository(PlatformSettings);
    const now = Date.now();

    await repo.update({ id: 'default' }, {
      logoUrl: input.logoUrl,
      loginLogoUrl: input.loginLogoUrl,
      loginTitleVerticalOffset: input.loginTitleVerticalOffset ?? 0,
      loginTitleColor: input.loginTitleColor ?? null,
      logoTitle: input.logoTitle,
      logoScale: input.logoScale ?? 100,
      titleFontUrl: input.titleFontUrl,
      titleFontWeight: input.titleFontWeight ?? '600',
      titleFontSize: input.titleFontSize ?? 14,
      titleVerticalOffset: input.titleVerticalOffset ?? 0,
      menuAccentColor: input.menuAccentColor,
      faviconUrl: input.faviconUrl,
      updatedAt: now,
      updatedById,
    });
  }

  async reset(updatedById: string): Promise<void> {
    const dataSource = await getDataSource();
    const repo = dataSource.getRepository(PlatformSettings);
    const now = Date.now();

    await repo.update({ id: 'default' }, {
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
      updatedAt: now,
      updatedById,
    });
  }
}

export const brandingService = new BrandingService();

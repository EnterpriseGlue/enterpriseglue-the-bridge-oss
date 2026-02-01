/**
 * Platform Branding Routes
 */

import { Router } from 'express';
import { apiLimiter } from '@shared/middleware/rateLimiter.js';
import { logger } from '@shared/utils/logger.js';
import { z } from 'zod';
import { validateBody, validateParams } from '@shared/middleware/validate.js';
import { asyncHandler, Errors } from '@shared/middleware/errorHandler.js';
import { requirePermission } from '@shared/middleware/requirePermission.js';
import { logAudit } from '@shared/services/audit.js';
import { getDataSource } from '@shared/db/data-source.js';
// TenantSettings removed - multi-tenancy is EE-only
import { PlatformSettings } from '@shared/db/entities/PlatformSettings.js';
import { PlatformPermissions } from '@shared/services/platform-admin/permissions.js';

const router = Router();

// Disable OSS platform branding endpoints when EE plugin is active
router.use((req, _res, next) => {
  if (req.app?.locals?.enterprisePluginLoaded) {
    const err = Errors.notFound('Branding endpoint');
    return next(err);
  }
  return next();
});

const tenantIdParamsSchema = z.object({ tenantId: z.string().min(1) });

const updatePlatformBrandingSchema = z.object({
  logoUrl: z.string().nullable().optional(),
  loginLogoUrl: z.string().nullable().optional(),
  loginTitleVerticalOffset: z.number().min(-50).max(50).optional(),
  loginTitleColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().optional(),
  logoTitle: z.string().nullable().optional(),
  logoScale: z.number().min(50).max(200).optional(),
  titleFontUrl: z.string().nullable().optional(),
  titleFontWeight: z.string().optional(),
  titleFontSize: z.number().min(10).max(32).optional(),
  titleVerticalOffset: z.number().min(-20).max(20).optional(),
  menuAccentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().optional(),
  faviconUrl: z.string().nullable().optional(),
});

const updateTenantBrandingSchema = z.object({
  logoUrl: z.string().nullable().optional(),
  logoTitle: z.string().nullable().optional(),
  logoScale: z.number().min(50).max(200).optional(),
  titleFontUrl: z.string().nullable().optional(),
  titleFontWeight: z.string().optional(),
  titleFontSize: z.number().min(10).max(32).optional(),
  titleVerticalOffset: z.number().min(-20).max(20).optional(),
  menuAccentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().optional(),
});

// ============ Platform Branding ============

/**
 * GET /api/platform-admin/admin/branding
 * Get platform branding settings
 * ✨ Migrated to TypeORM
 */
router.get('/', apiLimiter, requirePermission({ permission: PlatformPermissions.SETTINGS_MANAGE }), asyncHandler(async (_req, res) => {
  try {
    const dataSource = await getDataSource();
    const platformSettingsRepo = dataSource.getRepository(PlatformSettings);
    const row = await platformSettingsRepo.findOne({ where: { id: 'default' } });

    if (!row) {
      return res.json({
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
      });
    }

    res.json({
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
    });
  } catch (error) {
    logger.error('Get platform branding error:', error);
    throw Errors.internal('Failed to get platform branding');
  }
}));

/**
 * PUT /api/platform-admin/admin/branding
 * Update platform branding settings
 * ✨ Migrated to TypeORM
 */
router.put(
  '/',
  requirePermission({ permission: PlatformPermissions.SETTINGS_MANAGE }),
  validateBody(updatePlatformBrandingSchema),
  asyncHandler(async (req, res) => {
    try {
      const dataSource = await getDataSource();
      const platformSettingsRepo = dataSource.getRepository(PlatformSettings);
      const now = Date.now();

      await platformSettingsRepo.update({ id: 'default' }, {
        logoUrl: req.body.logoUrl,
        loginLogoUrl: req.body.loginLogoUrl,
        loginTitleVerticalOffset: req.body.loginTitleVerticalOffset ?? 0,
        loginTitleColor: req.body.loginTitleColor ?? null,
        logoTitle: req.body.logoTitle,
        logoScale: req.body.logoScale ?? 100,
        titleFontUrl: req.body.titleFontUrl,
        titleFontWeight: req.body.titleFontWeight ?? '600',
        titleFontSize: req.body.titleFontSize ?? 14,
        titleVerticalOffset: req.body.titleVerticalOffset ?? 0,
        menuAccentColor: req.body.menuAccentColor,
        faviconUrl: req.body.faviconUrl,
        updatedAt: now,
        updatedById: req.user!.userId,
      });

      await logAudit({
        action: 'admin.branding.update',
        userId: req.user!.userId,
        resourceType: 'platform_branding',
        resourceId: 'default',
        details: req.body,
        ipAddress: req.headers['x-forwarded-for'] as string || req.socket?.remoteAddress,
        userAgent: req.headers['user-agent'],
      });

      res.json({ success: true });
    } catch (error) {
      logger.error('Update platform branding error:', error);
      throw Errors.internal('Failed to update platform branding');
    }
  })
);

/**
 * DELETE /api/platform-admin/admin/branding
 * Reset platform branding to defaults
 * ✨ Migrated to TypeORM
 */
router.delete('/', apiLimiter, asyncHandler(async (req, res) => {
  try {
    const dataSource = await getDataSource();
    const platformSettingsRepo = dataSource.getRepository(PlatformSettings);
    const now = Date.now();

    await platformSettingsRepo.update({ id: 'default' }, {
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
      updatedById: req.user!.userId,
    });

    res.json({ success: true });
  } catch (error) {
    logger.error('Reset platform branding error:', error);
    throw Errors.internal('Failed to reset platform branding');
  }
}));

// Tenant branding routes removed - multi-tenancy is EE-only
// Tenant branding is available in the Enterprise Edition

export default router;

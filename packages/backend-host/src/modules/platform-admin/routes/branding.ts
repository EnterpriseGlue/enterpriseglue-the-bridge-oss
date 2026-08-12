/**
 * Platform Branding Routes
 */

import { Router } from 'express';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { z } from 'zod';
import { validateBody, validateParams } from '@enterpriseglue/shared/middleware/validate.js';
import { asyncHandler, AppError, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { requirePermission } from '@enterpriseglue/shared/middleware/requirePermission.js';
import { logAudit } from '@enterpriseglue/shared/services/audit.js';
import { platformBrandingService } from '@enterpriseglue/shared/services/platform-admin/PlatformBrandingService.js';
import { PlatformPermissions } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import {
  PlatformBrandingSchema,
  UpdatePlatformBrandingRequestSchema,
} from '@enterpriseglue/shared/schemas/platform-admin/platform-settings.js';

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
    res.json(PlatformBrandingSchema.parse(await platformBrandingService.get()));
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
  validateBody(UpdatePlatformBrandingRequestSchema),
  asyncHandler(async (req, res) => {
    try {
      await platformBrandingService.update(req.body, req.user!.userId);

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
      if (error instanceof AppError) throw error;
      throw Errors.internal('Failed to update platform branding');
    }
  })
);

/**
 * DELETE /api/platform-admin/admin/branding
 * Reset platform branding to defaults
 * ✨ Migrated to TypeORM
 */
router.delete('/', apiLimiter, requirePermission({ permission: PlatformPermissions.SETTINGS_MANAGE }), asyncHandler(async (req, res) => {
  try {
    await platformBrandingService.reset(req.user!.userId);

    res.json({ success: true });
  } catch (error) {
    logger.error('Reset platform branding error:', error);
    if (error instanceof AppError) throw error;
    throw Errors.internal('Failed to reset platform branding');
  }
}));

// Tenant branding routes removed - multi-tenancy is EE-only
// Tenant branding is available in the Enterprise Edition

export default router;

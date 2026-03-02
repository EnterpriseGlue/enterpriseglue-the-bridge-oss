/**
 * Platform Settings Routes
 */

import { Router } from 'express';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { validateBody } from '@enterpriseglue/shared/middleware/validate.js';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { requirePermission } from '@enterpriseglue/shared/middleware/requirePermission.js';
import { platformSettingsService } from '@enterpriseglue/shared/services/platform-admin/index.js';
import { logAudit } from '@enterpriseglue/shared/services/audit.js';
import { PlatformPermissions } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import { UpdatePlatformSettingsRequest } from '@enterpriseglue/shared/schemas/platform-admin/platform-settings.js';

const router = Router();

// Disable OSS platform settings endpoints when EE plugin is active
router.use((req, _res, next) => {
  if (req.app?.locals?.enterprisePluginLoaded) {
    const err = Errors.notFound('Settings endpoint');
    return next(err);
  }
  return next();
});

const updateSettingsSchema = UpdatePlatformSettingsRequest;

/**
 * GET /api/platform-admin/admin/settings
 * Get platform settings
 */
router.get('/', apiLimiter, requirePermission({ permission: PlatformPermissions.SETTINGS_MANAGE }), asyncHandler(async (req, res) => {
  try {
    const settings = await platformSettingsService.get();
    res.json(settings);
  } catch (error) {
    logger.error('Get platform settings error:', error);
    throw Errors.internal('Failed to get platform settings');
  }
}));

/**
 * PUT /api/platform-admin/admin/settings
 * Update platform settings
 */
router.put(
  '/',
  requirePermission({ permission: PlatformPermissions.SETTINGS_MANAGE }),
  validateBody(updateSettingsSchema),
  asyncHandler(async (req, res) => {
    try {
      await platformSettingsService.update(req.body, req.user!.userId);
      
      await logAudit({
        action: 'admin.settings.update',
        userId: req.user!.userId,
        resourceType: 'platform_settings',
        resourceId: 'default',
        details: req.body,
        ipAddress: req.headers['x-forwarded-for'] as string || req.socket?.remoteAddress,
        userAgent: req.headers['user-agent'],
      });

      res.json({ success: true });
    } catch (error) {
      logger.error('Update platform settings error:', error);
      throw Errors.internal('Failed to update platform settings');
    }
  })
);

export default router;

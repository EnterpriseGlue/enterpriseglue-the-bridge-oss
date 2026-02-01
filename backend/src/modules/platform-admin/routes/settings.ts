/**
 * Platform Settings Routes
 */

import { Router } from 'express';
import { apiLimiter } from '@shared/middleware/rateLimiter.js';
import { logger } from '@shared/utils/logger.js';
import { z } from 'zod';
import { validateBody } from '@shared/middleware/validate.js';
import { asyncHandler, Errors } from '@shared/middleware/errorHandler.js';
import { requirePermission } from '@shared/middleware/requirePermission.js';
import { platformSettingsService } from '@shared/services/platform-admin/index.js';
import { logAudit } from '@shared/services/audit.js';
import { PlatformPermissions } from '@shared/services/platform-admin/permissions.js';

const router = Router();

// Disable OSS platform settings endpoints when EE plugin is active
router.use((req, _res, next) => {
  if (req.app?.locals?.enterprisePluginLoaded) {
    const err = Errors.notFound('Settings endpoint');
    return next(err);
  }
  return next();
});

const updateSettingsSchema = z.object({
  defaultEnvironmentTagId: z.string().nullable().optional(),
  syncPushEnabled: z.boolean().optional(),
  syncPullEnabled: z.boolean().optional(),
  syncBothEnabled: z.boolean().optional(),
  gitProjectTokenSharingEnabled: z.boolean().optional(),
  defaultDeployRoles: z.array(z.string()).optional(),
  inviteAllowAllDomains: z.boolean().optional(),
  inviteAllowedDomains: z.array(z.string()).optional(),
});

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

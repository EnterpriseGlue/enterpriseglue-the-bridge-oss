import { Router } from 'express';
import { apiLimiter } from '@shared/middleware/rateLimiter.js';
import { asyncHandler } from '@shared/middleware/errorHandler.js';
import { logger } from '@shared/utils/logger.js';
import { z } from 'zod';
import { requireAuth } from '@shared/middleware/auth.js';
import { validateBody } from '@shared/middleware/validate.js';
import { getDataSource } from '@shared/db/data-source.js';
import { User } from '@shared/db/entities/User.js';
import { PlatformSettings } from '@shared/db/entities/PlatformSettings.js';
import { logAudit, AuditActions } from '@shared/services/audit.js';
import { buildUserCapabilities } from '@shared/services/capabilities.js';
import { config } from '@shared/config/index.js';

const router = Router();

/**
 * GET /api/auth/me
 * Get current user profile
 */
router.get('/api/auth/me', apiLimiter, requireAuth, asyncHandler(async (req, res) => {
  const dataSource = await getDataSource();
  const userRepo = dataSource.getRepository(User);
  
  const user = await userRepo.findOneBy({ id: req.user!.userId });

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const capabilities = await buildUserCapabilities({
    userId: user.id,
    platformRole: user.platformRole,
  });

  const isAdminVerificationExempt =
    config.adminEmailVerificationExempt &&
    user.email.toLowerCase() === config.adminEmail.toLowerCase() &&
    user.createdByUserId === null;
  const isEmailVerified = Boolean(user.isEmailVerified) || isAdminVerificationExempt;

  res.json({
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    platformRole: user.platformRole || 'user',
    capabilities,
    isActive: Boolean(user.isActive),
    isEmailVerified,
    mustResetPassword: Boolean(user.mustResetPassword),
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  });
}));

const updateProfileSchema = z.object({
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
});

/**
 * PATCH /api/auth/me
 * Update current user profile (firstName, lastName)
 */
router.patch('/api/auth/me', apiLimiter, requireAuth, validateBody(updateProfileSchema), asyncHandler(async (req, res) => {
  const dataSource = await getDataSource();
  const userRepo = dataSource.getRepository(User);
  const userId = req.user!.userId;
  const { firstName, lastName } = req.body;
  const now = Date.now();

  // Build update object with only provided fields
  const updates: any = { updatedAt: now };
  if (firstName !== undefined) updates.firstName = firstName || null;
  if (lastName !== undefined) updates.lastName = lastName || null;

  await userRepo.update({ id: userId }, updates);

  // Fetch updated user
  const user = await userRepo.findOneBy({ id: userId });

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  await logAudit({
    action: AuditActions.USER_UPDATE,
    userId,
    resourceType: 'user',
    resourceId: userId,
    details: { updated: Object.keys(req.body) },
    ipAddress: req.headers['x-forwarded-for'] as string || req.socket?.remoteAddress,
    userAgent: req.headers['user-agent'],
  });

  const capabilities = await buildUserCapabilities({
    userId: user.id,
    platformRole: user.platformRole,
  });

  res.json({
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    platformRole: user.platformRole || 'user',
    capabilities,
    isActive: Boolean(user.isActive),
    isEmailVerified: Boolean(user.isEmailVerified),
    mustResetPassword: Boolean(user.mustResetPassword),
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  });
}));

/**
 * GET /api/auth/branding
 * Get platform branding for header display (public for authenticated users)
 * Uses platform-wide branding from platform_settings
 */
router.get('/api/auth/branding', apiLimiter, async (_req, res) => {
  try {
    const dataSource = await getDataSource();
    const settingsRepo = dataSource.getRepository(PlatformSettings);

    const settings = await settingsRepo.findOneBy({ id: 'default' });

    if (!settings) {
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
      logoUrl: settings.logoUrl || null,
      loginLogoUrl: settings.loginLogoUrl || null,
      loginTitleVerticalOffset: settings.loginTitleVerticalOffset ?? 0,
      loginTitleColor: settings.loginTitleColor || null,
      logoTitle: settings.logoTitle || null,
      logoScale: settings.logoScale ?? 100,
      titleFontUrl: settings.titleFontUrl || null,
      titleFontWeight: settings.titleFontWeight ?? '600',
      titleFontSize: settings.titleFontSize ?? 14,
      titleVerticalOffset: settings.titleVerticalOffset ?? 0,
      menuAccentColor: settings.menuAccentColor || null,
      faviconUrl: settings.faviconUrl || null,
    });
  } catch (error) {
    logger.error('Get branding error:', error);
    res.status(500).json({ error: 'Failed to get branding' });
  }
});

/**
 * GET /api/auth/platform-settings
 * Get platform settings needed for authenticated UI (non-admin)
 */
router.get('/api/auth/platform-settings', apiLimiter, requireAuth, async (_req, res) => {
  try {
    const dataSource = await getDataSource();
    const settingsRepo = dataSource.getRepository(PlatformSettings);

    const settings = await settingsRepo.findOneBy({ id: 'default' });

    if (!settings) {
      return res.json({
        syncPushEnabled: true,
        syncPullEnabled: false,
        syncBothEnabled: false,
        gitProjectTokenSharingEnabled: false,
        defaultDeployRoles: ['owner', 'delegate', 'operator', 'deployer'],
      });
    }

    const defaultDeployRoles = (() => {
      try {
        const raw = settings.defaultDeployRoles;
        return JSON.parse(String(raw || '[]'));
      } catch {
        return ['owner', 'delegate', 'operator', 'deployer'];
      }
    })();

    res.json({
      syncPushEnabled: settings.syncPushEnabled ?? true,
      syncPullEnabled: settings.syncPullEnabled ?? false,
      syncBothEnabled: settings.syncBothEnabled ?? false,
      gitProjectTokenSharingEnabled: settings.gitProjectTokenSharingEnabled ?? false,
      defaultDeployRoles,
    });
  } catch (error) {
    logger.error('Get platform settings error:', error);
    res.status(500).json({ error: 'Failed to get platform settings' });
  }
});

export default router;

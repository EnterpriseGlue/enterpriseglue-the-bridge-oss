/**
 * Setup Status API Routes
 * Check if the platform has been configured (first-run detection)
 * 
 * Note: In OSS single-tenant mode, tenant checks are skipped.
 * Multi-tenancy is an EE-only feature.
 */

import { Router } from 'express';
import { apiLimiter } from '@shared/middleware/rateLimiter.js';
import { asyncHandler, Errors } from '@shared/middleware/errorHandler.js';
import { requireAuth } from '@shared/middleware/auth.js';
import { getDataSource } from '@shared/db/data-source.js';
import { User } from '@shared/db/entities/User.js';
import { EmailSendConfig } from '@shared/db/entities/EmailSendConfig.js';

const router = Router();

interface SetupStatus {
  isConfigured: boolean;
  checks: {
    hasDefaultTenant: boolean;
    hasAdminUser: boolean;
    hasEmailConfig: boolean;
  };
  requiredActions: string[];
}

/**
 * GET /api/admin/setup-status
 * Check if the platform has been configured
 * Returns setup status and any required actions
 */
router.get('/api/admin/setup-status', apiLimiter, requireAuth, asyncHandler(async (req, res) => {
  const dataSource = await getDataSource();
  const userRepo = dataSource.getRepository(User);
  const emailConfigRepo = dataSource.getRepository(EmailSendConfig);

  // OSS single-tenant mode: tenant is always considered present
  const hasDefaultTenant = true;

  // Check if at least one admin user exists
  const hasAdminUser = await userRepo.count({ where: { platformRole: 'admin' } }) > 0;

  // Check if email config exists (optional but recommended)
  const hasEmailConfig = await emailConfigRepo.count() > 0;

  // Build required actions list
  const requiredActions: string[] = [];
  if (!hasAdminUser) {
    requiredActions.push('Configure admin user');
  }

  // Platform is configured if we have an admin user
  const isConfigured = hasAdminUser;

  const status: SetupStatus = {
    isConfigured,
    checks: {
      hasDefaultTenant,
      hasAdminUser,
      hasEmailConfig,
    },
    requiredActions,
  };

  res.json(status);
}));

/**
 * POST /api/admin/mark-setup-complete
 * Mark the platform as configured (stores flag to skip wizard)
 */
router.post('/api/admin/mark-setup-complete', apiLimiter, requireAuth, asyncHandler(async (req, res) => {
  // Only admins can mark setup as complete
  if (req.user?.platformRole !== 'admin') {
    throw Errors.forbidden('Only platform admins can mark setup as complete');
  }

  // Store a flag in platform_settings or similar
  // For now, we just return success - the status check will determine if configured
  res.json({ success: true, message: 'Setup marked as complete' });
}));

export default router;

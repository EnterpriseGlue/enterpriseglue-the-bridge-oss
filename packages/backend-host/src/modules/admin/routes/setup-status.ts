/**
 * Setup Status API Routes
 * Check if the platform has been configured (first-run detection)
 * 
 * Note: In OSS single-tenant mode, tenant checks are skipped.
 * Multi-tenancy is an EE-only feature.
 */

import { Router } from 'express';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { asyncHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { requireAction } from '@enterpriseglue/shared/middleware/requireAction.js';
import { setupStatusService } from '@enterpriseglue/shared/services/admin/SetupStatusService.js';

const router = Router();

/**
 * GET /api/admin/setup-status
 * Check if the platform has been configured
 * Returns setup status and any required actions
 */
router.get('/api/admin/setup-status', apiLimiter, requireAuth, requireAction('platform.settings.read'), asyncHandler(async (req, res) => {
  res.json(await setupStatusService.getSetupStatus());
}));

/**
 * POST /api/admin/mark-setup-complete
 * Mark the platform as configured (stores flag to skip wizard)
 */
router.post('/api/admin/mark-setup-complete', apiLimiter, requireAuth, requireAction('platform.settings.manage'), asyncHandler(async (req, res) => {
  // Store a flag in platform_settings or similar
  // For now, we just return success - the status check will determine if configured
  res.json({ success: true, message: 'Setup marked as complete' });
}));

export default router;

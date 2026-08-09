import { Router } from 'express';
import { asyncHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { apiLimiter, identityFlowLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { resolveTenantContext } from '@enterpriseglue/shared/middleware/tenant.js';
import { loginMethodService } from '@enterpriseglue/shared/services/platform-admin/LoginMethodService.js';

const router = Router();

/**
 * GET /api/t/:tenantSlug/auth/sso-config
 * Returns tenant SSO enforcement configuration
 *
 * OSS single-tenant mode: derives ssoRequired from enabled direct
 * provider-neutral identity providers. Full tenant-based SSO enforcement is
 * an EE-only feature.
 */
router.get('/api/t/:tenantSlug/auth/sso-config', apiLimiter, identityFlowLimiter, resolveTenantContext({ required: true }), asyncHandler(async (req, res) => {
  const tenantSlug = String(req.params.tenantSlug || '').trim();
  if (!tenantSlug) {
    return res.status(400).json({ error: 'Tenant slug is required' });
  }

  const ssoRequired = !await loginMethodService.ordinaryLocalPasswordEnabled(req.tenant?.tenantId || null);

  return res.json({ ssoRequired });
}));

export default router;

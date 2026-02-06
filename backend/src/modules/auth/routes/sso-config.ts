import { Router } from 'express';
import { asyncHandler } from '@shared/middleware/errorHandler.js';
import { getDataSource } from '@shared/db/data-source.js';
import { SsoProvider } from '@shared/db/entities/SsoProvider.js';

const router = Router();

/**
 * GET /api/t/:tenantSlug/auth/sso-config
 * Returns tenant SSO enforcement configuration
 *
 * OSS single-tenant mode: derives ssoRequired from whether any SSO providers
 * are enabled. Full tenant-based SSO enforcement is an EE-only feature.
 */
router.get('/api/t/:tenantSlug/auth/sso-config', asyncHandler(async (req, res) => {
  const tenantSlug = String(req.params.tenantSlug || '').trim();
  if (!tenantSlug) {
    return res.status(400).json({ error: 'Tenant slug is required' });
  }

  const dataSource = await getDataSource();
  const ssoProviderRepo = dataSource.getRepository(SsoProvider);

  // In OSS single-tenant mode, SSO is considered required if any SSO provider is enabled
  const enabledCount = await ssoProviderRepo.count({ where: { enabled: true } });
  const ssoRequired = enabledCount > 0;

  return res.json({ ssoRequired });
}));

export default router;

import { Router } from 'express';
import { asyncHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';

const router = Router();

/**
 * GET /api/t/:tenantSlug/auth/sso-config
 * Returns tenant SSO enforcement configuration
 *
 * OSS single-tenant mode: derives ssoRequired from enabled direct
 * provider-neutral identity providers. Full tenant-based SSO enforcement is
 * an EE-only feature.
 */
router.get('/api/t/:tenantSlug/auth/sso-config', asyncHandler(async (req, res) => {
  const tenantSlug = String(req.params.tenantSlug || '').trim();
  if (!tenantSlug) {
    return res.status(400).json({ error: 'Tenant slug is required' });
  }

  const dataSource = await getDataSource();
  const identityProviderRepo = dataSource.getRepository(IdentityProvider);
  const directIdentityProviderCount = await identityProviderRepo.count({ where: { isEnabled: true, authenticationMode: 'direct' } });
  const ssoRequired = directIdentityProviderCount > 0;

  return res.json({ ssoRequired });
}));

export default router;

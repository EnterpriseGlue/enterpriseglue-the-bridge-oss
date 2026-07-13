import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { requireAction } from '@enterpriseglue/shared/middleware/requireAction.js';
import { asyncHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { validateBody } from '@enterpriseglue/shared/middleware/validate.js';
import { identityProviderService } from '@enterpriseglue/shared/services/platform-admin/IdentityProviderService.js';
import { ldapReconciliationService } from '@enterpriseglue/shared/services/platform-admin/LdapReconciliationService.js';
import { ssoNormalizedIdentityService } from '@enterpriseglue/shared/services/platform-admin/SsoNormalizedIdentityService.js';
import { ssoSyncDiagnosticsService } from '@enterpriseglue/shared/services/platform-admin/SsoSyncDiagnosticsService.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { logAudit } from '@enterpriseglue/shared/services/audit.js';

const router = Router();
const schema = z.object({ key: z.string().min(1).max(128), protocol: z.enum(['oidc', 'saml', 'ldap']), isEnabled: z.boolean().optional(), authenticationMode: z.enum(['direct', 'claims_only']).optional(), directoryTenantId: z.string().optional().nullable(), configuration: z.record(z.string(), z.unknown()), sync: z.record(z.string(), z.unknown()).optional(), ownershipMode: z.string().max(64).optional(), sourceRef: z.string().optional().nullable() });

const providerKeySchema = z.string().min(1).max(128);
const replayMembershipsSchema = z.object({ limit: z.number().int().min(1).max(5000).optional() });

router.get('/api/identity/providers', requireAuth, requireAction('platform.sso.providers.read'), asyncHandler(async (req, res) => {
  res.json(await identityProviderService.list(req.tenant?.tenantId || null));
}));
router.get('/api/identity/providers/:key', requireAuth, requireAction('platform.sso.providers.read'), asyncHandler(async (req, res) => {
  const provider = await identityProviderService.getByKey(providerKeySchema.parse(req.params.key), req.tenant?.tenantId || null);
  if (!provider) throw Errors.notFound('Identity provider not found');
  res.json(provider);
}));
router.post('/api/identity/providers', requireAuth, requireAction('platform.sso.providers.manage'), validateBody(schema), asyncHandler(async (req, res) => {
  const provider = await identityProviderService.upsert({ ...req.body, tenantId: req.tenant?.tenantId || null });
  await logAudit({
    action: 'identity.provider.create', userId: req.user!.userId, resourceType: 'identity_provider', resourceId: provider.id,
    details: { key: provider.key, protocol: provider.protocol, isEnabled: provider.isEnabled },
  });
  res.status(201).json(provider);
}));
router.put('/api/identity/providers/:key', requireAuth, requireAction('platform.sso.providers.manage'), validateBody(schema.omit({ key: true }).partial()), asyncHandler(async (req, res) => {
  const key = providerKeySchema.parse(req.params.key);
  const existing = await identityProviderService.getByKey(key, req.tenant?.tenantId || null);
  if (!existing) throw Errors.notFound('Identity provider not found');
  const provider = await identityProviderService.upsert({
    key: existing.key, protocol: existing.protocol as 'oidc' | 'saml' | 'ldap', configuration: JSON.parse(existing.configurationJson),
    ...req.body, tenantId: req.tenant?.tenantId || null,
  });
  await logAudit({
    action: 'identity.provider.update', userId: req.user!.userId, resourceType: 'identity_provider', resourceId: provider.id,
    details: { key: provider.key, changedFields: Object.keys(req.body) },
  });
  res.json(provider);
}));
router.post('/api/identity/providers/:key/reconcile', requireAuth, requireAction('platform.sso.providers.manage'), asyncHandler(async (req, res) => {
  const key = providerKeySchema.parse(req.params.key);
  const provider = await identityProviderService.getByKey(key, req.tenant?.tenantId || null);
  if (!provider) throw Errors.notFound('Identity provider not found');
  if (provider.protocol !== 'ldap') throw Errors.validation('Manual reconciliation is currently available only for LDAP directory providers');
  const result = await ldapReconciliationService.reconcileProvider(key, req.tenant?.tenantId || null, 'manual');
  await logAudit({ action: 'identity.provider.reconcile', userId: req.user!.userId, resourceType: 'identity_provider', resourceId: provider.id, details: { key: provider.key, protocol: provider.protocol, ...result } });
  res.json(result);
}));
router.post('/api/identity/providers/:key/replay-memberships', requireAuth, requireAction('platform.sso.providers.manage'), asyncHandler(async (req, res) => {
  const key = providerKeySchema.parse(req.params.key);
  const input = replayMembershipsSchema.parse(req.body || {});
  const provider = await identityProviderService.getByKey(key, req.tenant?.tenantId || null);
  if (!provider) throw Errors.notFound('Identity provider not found');
  const tenantId = req.tenant?.tenantId || null;
  const runId = await ssoSyncDiagnosticsService.startRun({ tenantId, providerId: provider.id, trigger: 'manual', details: { source: 'identity_provider_membership_replay' } });
  try {
    const result = await ssoNormalizedIdentityService.replayMemberships({ tenantId, providerIds: [provider.id], limit: input.limit });
    await ssoSyncDiagnosticsService.completeRun(runId, { tenantId, providerId: provider.id, groupMembershipsCreated: result.created, groupMembershipsRemoved: result.removed, details: { source: 'identity_provider_membership_replay', ...result } });
    await logAudit({ action: 'identity.provider.memberships.replay', userId: req.user!.userId, resourceType: 'identity_provider', resourceId: provider.id, details: { key: provider.key, protocol: provider.protocol, runId, ...result } });
    res.json({ ...result, runId });
  } catch (error) {
    await ssoSyncDiagnosticsService.failRun(runId, error, { tenantId, providerId: provider.id, details: { source: 'identity_provider_membership_replay' } });
    throw error;
  }
}));
router.delete('/api/identity/providers/:key', requireAuth, requireAction('platform.sso.providers.manage'), asyncHandler(async (req, res) => {
  const key = providerKeySchema.parse(req.params.key);
  const existing = await identityProviderService.getByKey(key, req.tenant?.tenantId || null);
  if (!existing) throw Errors.notFound('Identity provider not found');
  await identityProviderService.archive(key, req.tenant?.tenantId || null);
  await logAudit({
    action: 'identity.provider.archive', userId: req.user!.userId, resourceType: 'identity_provider', resourceId: existing.id,
    details: { key: existing.key, protocol: existing.protocol },
  });
  res.status(204).send();
}));
export default router;

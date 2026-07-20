import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { requireAction } from '@enterpriseglue/shared/middleware/requireAction.js';
import { asyncHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { validateBody, validateQuery } from '@enterpriseglue/shared/middleware/validate.js';
import { identityProviderService } from '@enterpriseglue/shared/services/platform-admin/IdentityProviderService.js';
import { externalIdentityService } from '@enterpriseglue/shared/services/platform-admin/ExternalIdentityService.js';
import { ldapReconciliationService } from '@enterpriseglue/shared/services/platform-admin/LdapReconciliationService.js';
import { ssoNormalizedIdentityService } from '@enterpriseglue/shared/services/platform-admin/SsoNormalizedIdentityService.js';
import { ssoSyncDiagnosticsService } from '@enterpriseglue/shared/services/platform-admin/SsoSyncDiagnosticsService.js';
import { directLdapIdentityService } from '@enterpriseglue/shared/services/platform-admin/DirectLdapIdentityService.js';
import { genericOidcService } from '@enterpriseglue/shared/services/platform-admin/GenericOidcService.js';
import { samlMetadataService } from '@enterpriseglue/shared/services/platform-admin/SamlMetadataService.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { logAudit } from '@enterpriseglue/shared/services/audit.js';
import { identityAdminLimiter, reconciliationLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { identityAdminJsonPayloadLimit } from '@enterpriseglue/shared/middleware/requestSizeLimit.js';
import {
  IdentityProviderMembershipReplayRequestSchema,
  IdentityProviderRequestSchema,
  IdentityProviderSyncEventsQuerySchema,
  IdentityProviderSyncRunsQuerySchema,
  IdentityProviderUpdateSchema,
  IdentityProviderExternalIdentityUnlinkRequestSchema,
} from '@enterpriseglue/shared/schemas/platform-admin/authz.js';

const router = Router();
const providerKeySchema = z.string().min(1).max(128);

router.get('/api/identity/providers', requireAuth, identityAdminLimiter, requireAction('platform.sso.providers.read'), asyncHandler(async (req, res) => {
  res.json(await identityProviderService.list(req.tenant?.tenantId || null));
}));
// Keep retired legacy migration paths from being interpreted as provider keys
// by the generic route below.
router.all([
  '/api/identity/providers/environment-migration-drafts',
  '/api/identity/providers/migration-readiness',
  '/api/identity/providers/legacy-migration-draft/:legacyProviderId',
  '/api/identity/providers/legacy-cutover',
], (_req, res) => res.status(404).end());
router.post('/api/identity/providers/:key/external-identities/unlink', requireAuth, identityAdminLimiter, requireAction('platform.sso.providers.manage'), identityAdminJsonPayloadLimit, validateBody(IdentityProviderExternalIdentityUnlinkRequestSchema), asyncHandler(async (req, res) => {
  const provider = await identityProviderService.getByKey(providerKeySchema.parse(req.params.key), req.tenant?.tenantId || null);
  if (!provider) throw Errors.notFound('Identity provider not found');
  const cleanup = await externalIdentityService.unlink({
    tenantId: req.tenant?.tenantId || null,
    providerId: provider.id,
    subjectId: req.body.subjectId,
    userId: req.body.userId,
  });
  await logAudit({
    action: 'identity.provider.external_identity_unlinked',
    userId: req.user!.userId,
    resourceType: 'external_identity',
    resourceId: cleanup.identityId,
    details: { providerKey: provider.key, targetUserId: req.body.userId, cleanup },
  });
  res.json({ ...cleanup, recovery: 'verified_sign_in_required' });
}));
router.get('/api/identity/providers/:key', requireAuth, identityAdminLimiter, requireAction('platform.sso.providers.read'), asyncHandler(async (req, res) => {
  const provider = await identityProviderService.getByKey(providerKeySchema.parse(req.params.key), req.tenant?.tenantId || null);
  if (!provider) throw Errors.notFound('Identity provider not found');
  res.json(provider);
}));
router.get('/api/identity/providers/:key/sync-runs', requireAuth, identityAdminLimiter, requireAction('platform.sso.providers.read'), validateQuery(IdentityProviderSyncRunsQuerySchema), asyncHandler(async (req, res) => {
  const provider = await identityProviderService.getByKey(providerKeySchema.parse(req.params.key), req.tenant?.tenantId || null);
  if (!provider) throw Errors.notFound('Identity provider not found');
  res.json(await ssoSyncDiagnosticsService.listRuns({ tenantId: req.tenant?.tenantId || null, providerId: provider.id, limit: Number(req.query.limit || 10) }));
}));
router.get('/api/identity/providers/:key/sync-runs/:runId/events', requireAuth, identityAdminLimiter, requireAction('platform.sso.providers.read'), validateQuery(IdentityProviderSyncEventsQuerySchema), asyncHandler(async (req, res) => {
  const provider = await identityProviderService.getByKey(providerKeySchema.parse(req.params.key), req.tenant?.tenantId || null);
  if (!provider) throw Errors.notFound('Identity provider not found');
  res.json(await ssoSyncDiagnosticsService.listEvents({
    tenantId: req.tenant?.tenantId || null,
    providerId: provider.id,
    runId: z.string().min(1).max(128).parse(req.params.runId),
    severity: req.query.severity ? String(req.query.severity) as 'info' | 'warning' | 'error' : undefined,
    limit: Number(req.query.limit || 50),
  }));
}));
router.post('/api/identity/providers/:key/test-connection', requireAuth, identityAdminLimiter, reconciliationLimiter, requireAction('platform.sso.providers.manage'), asyncHandler(async (req, res) => {
  const provider = await identityProviderService.getByKey(providerKeySchema.parse(req.params.key), req.tenant?.tenantId || null);
  if (!provider) throw Errors.notFound('Identity provider not found');
  let result: Record<string, unknown>;
  if (provider.protocol === 'ldap') {
    const page = await directLdapIdentityService.listDirectoryPage(provider);
    result = { status: 'connected', protocol: 'ldap', sampledIdentities: page.identities.length };
  } else if (provider.protocol === 'oidc') {
    const metadata = await genericOidcService.testConnection(JSON.parse(provider.configurationJson));
    result = { status: 'connected', protocol: 'oidc', issuer: metadata.issuer };
  } else {
    const metadata = await samlMetadataService.testConnection(provider.configurationJson);
    result = { status: 'connected', protocol: 'saml', entityDescriptorCount: metadata.entityDescriptorCount };
  }
  await logAudit({ action: 'identity.provider.connection_test', userId: req.user!.userId, resourceType: 'identity_provider', resourceId: provider.id, details: { key: provider.key, ...result } });
  res.json(result);
}));
router.post('/api/identity/providers', requireAuth, identityAdminLimiter, requireAction('platform.sso.providers.manage'), identityAdminJsonPayloadLimit, validateBody(IdentityProviderRequestSchema), asyncHandler(async (req, res) => {
  const provider = await identityProviderService.upsert({ ...req.body, tenantId: req.tenant?.tenantId || null });
  await logAudit({
    action: 'identity.provider.create', userId: req.user!.userId, resourceType: 'identity_provider', resourceId: provider.id,
    details: { key: provider.key, protocol: provider.protocol, isEnabled: provider.isEnabled },
  });
  res.status(201).json(provider);
}));
router.put('/api/identity/providers/:key', requireAuth, identityAdminLimiter, requireAction('platform.sso.providers.manage'), identityAdminJsonPayloadLimit, validateBody(IdentityProviderUpdateSchema), asyncHandler(async (req, res) => {
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
router.post('/api/identity/providers/:key/reconcile', requireAuth, identityAdminLimiter, reconciliationLimiter, requireAction('platform.sso.providers.manage'), asyncHandler(async (req, res) => {
  const key = providerKeySchema.parse(req.params.key);
  const provider = await identityProviderService.getByKey(key, req.tenant?.tenantId || null);
  if (!provider) throw Errors.notFound('Identity provider not found');
  if (provider.protocol !== 'ldap') throw Errors.validation('Manual reconciliation is currently available only for LDAP directory providers');
  const result = await ldapReconciliationService.reconcileProvider(key, req.tenant?.tenantId || null, 'manual');
  await logAudit({ action: 'identity.provider.reconcile', userId: req.user!.userId, resourceType: 'identity_provider', resourceId: provider.id, details: { key: provider.key, protocol: provider.protocol, ...result } });
  res.json(result);
}));
router.post('/api/identity/providers/:key/reconciliation-preview', requireAuth, identityAdminLimiter, reconciliationLimiter, requireAction('platform.sso.providers.manage'), identityAdminJsonPayloadLimit, asyncHandler(async (req, res) => {
  const key = providerKeySchema.parse(req.params.key);
  const input = IdentityProviderMembershipReplayRequestSchema.parse(req.body || {});
  const provider = await identityProviderService.getByKey(key, req.tenant?.tenantId || null);
  if (!provider) throw Errors.notFound('Identity provider not found');
  const result = await ssoNormalizedIdentityService.previewMemberships({ tenantId: req.tenant?.tenantId || null, providerId: provider.id, limit: input.limit, cursor: input.cursor });
  await logAudit({ action: 'identity.provider.memberships.preview', userId: req.user!.userId, resourceType: 'identity_provider', resourceId: provider.id, details: { key: provider.key, protocol: provider.protocol, scanned: result.scanned, additions: result.additions, removals: result.removals, failed: result.failed, truncated: result.truncated, warnings: result.warnings } });
  res.json(result);
}));
router.post('/api/identity/providers/:key/replay-memberships', requireAuth, identityAdminLimiter, reconciliationLimiter, requireAction('platform.sso.providers.manage'), identityAdminJsonPayloadLimit, asyncHandler(async (req, res) => {
  const key = providerKeySchema.parse(req.params.key);
  const input = IdentityProviderMembershipReplayRequestSchema.parse(req.body || {});
  const provider = await identityProviderService.getByKey(key, req.tenant?.tenantId || null);
  if (!provider) throw Errors.notFound('Identity provider not found');
  const tenantId = req.tenant?.tenantId || null;
  const runId = await ssoSyncDiagnosticsService.startRun({ tenantId, providerId: provider.id, trigger: 'manual', details: { source: 'identity_provider_membership_replay' } });
  try {
    const result = await ssoNormalizedIdentityService.replayMemberships({ tenantId, providerIds: [provider.id], limit: input.limit, cursor: input.cursor });
    await ssoSyncDiagnosticsService.completeRun(runId, { tenantId, providerId: provider.id, groupMembershipsCreated: result.created, groupMembershipsRemoved: result.removed, details: { source: 'identity_provider_membership_replay', ...result } });
    await logAudit({ action: 'identity.provider.memberships.replay', userId: req.user!.userId, resourceType: 'identity_provider', resourceId: provider.id, details: { key: provider.key, protocol: provider.protocol, runId, ...result } });
    res.json({ ...result, runId });
  } catch (error) {
    await ssoSyncDiagnosticsService.failRun(runId, error, { tenantId, providerId: provider.id, details: { source: 'identity_provider_membership_replay' } });
    throw error;
  }
}));
router.delete('/api/identity/providers/:key', requireAuth, identityAdminLimiter, requireAction('platform.sso.providers.manage'), asyncHandler(async (req, res) => {
  const key = providerKeySchema.parse(req.params.key);
  const existing = await identityProviderService.getByKey(key, req.tenant?.tenantId || null);
  if (!existing) throw Errors.notFound('Identity provider not found');
  const cleanup = await identityProviderService.archive(key, req.tenant?.tenantId || null);
  await logAudit({
    action: 'identity.provider.archive', userId: req.user!.userId, resourceType: 'identity_provider', resourceId: existing.id,
    details: { key: existing.key, protocol: existing.protocol, cleanup },
  });
  res.status(204).send();
}));
export default router;

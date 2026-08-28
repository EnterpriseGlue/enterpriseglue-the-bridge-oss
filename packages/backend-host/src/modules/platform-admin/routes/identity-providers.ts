import { Router, type Request, type RequestHandler } from 'express';
import { createHash } from 'node:crypto';
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
import { tenantIdentityProviderSecretService } from '@enterpriseglue/shared/services/platform-admin/TenantIdentityProviderSecretService.js';
import { TenantSecretBrokerError } from '@enterpriseglue/shared/services/platform-admin/TenantSecretBroker.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { normalizeIdentityProviderSyncForMandatoryLogin } from '@enterpriseglue/shared/schemas/platform-admin/identity.js';
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
  TenantIdentitySecretProvisionRequestSchema,
  TenantIdentitySecretPutRequestSchema,
  TenantIdentitySecretReferenceRetireRequestSchema,
  TenantIdentitySecretRetireRequestSchema,
} from '@enterpriseglue/shared/schemas/platform-admin/authz.js';
import { TenantIdentitySecretPurposeSchema } from '@enterpriseglue/shared/schemas/platform-admin/identity.js';

const router = Router();
const providerKeySchema = z.string().min(1).max(128);
const platformSsoRead = requireAction('platform.sso.providers.read');
const platformSsoManage = requireAction('platform.sso.providers.manage');
const identityProviderRead: RequestHandler = (req, res, next) => (
  res.locals.tenantIdentityProviderScope
    ? requireAction('tenant.sso.providers.read')(req, res, next)
    : platformSsoRead(req, res, next)
);
const identityProviderManage: RequestHandler = (req, res, next) => (
  res.locals.tenantIdentityProviderScope
    ? requireAction('tenant.sso.providers.manage')(req, res, next)
    : platformSsoManage(req, res, next)
);

function tenantSecretScope(req: Request): string {
  if (!req.tenant?.tenantId) throw Errors.validation('Tenant-scoped secret administration requires a tenant route');
  return req.tenant.tenantId;
}

function correlationId(req: Request): string | undefined {
  const candidate = req.headers['x-correlation-id'] || req.headers['x-request-id'];
  return (Array.isArray(candidate) ? candidate[0] : candidate)?.trim() || undefined;
}

function referenceFingerprint(reference: string): string {
  return createHash('sha256').update(reference, 'utf8').digest('hex').slice(0, 24);
}

function safeBrokerError(error: unknown): never {
  if (error instanceof TenantSecretBrokerError) {
    if (['invalid_context', 'invalid_reference', 'tenant_mismatch', 'purpose_mismatch'].includes(error.code)) {
      throw Errors.validation('Tenant secret request is invalid for the current tenant and purpose');
    }
    throw Errors.serviceUnavailable('Tenant secret broker');
  }
  throw error;
}

router.get('/api/identity/providers', requireAuth, identityAdminLimiter, identityProviderRead, asyncHandler(async (req, res) => {
  res.json(await identityProviderService.list(req.tenant?.tenantId || null));
}));

router.post('/api/identity/provider-secrets', requireAuth, identityAdminLimiter, identityProviderManage, identityAdminJsonPayloadLimit, validateBody(TenantIdentitySecretProvisionRequestSchema), asyncHandler(async (req, res) => {
  try {
    const result = await tenantIdentityProviderSecretService.provision({
      tenantId: tenantSecretScope(req),
      purpose: req.body.purpose,
      value: req.body.value,
      ...(correlationId(req) ? { correlationId: correlationId(req) } : {}),
    });
    await logAudit({
      tenantId: req.tenant!.tenantId,
      userId: req.user!.userId,
      action: 'identity.provider.secret.provision',
      resourceType: 'identity_provider_secret',
      resourceId: referenceFingerprint(result.reference),
      details: { purpose: result.purpose, version: result.version, correlationId: correlationId(req) || null },
    });
    res.status(201).json(result);
  } catch (error) { safeBrokerError(error); }
}));

router.post('/api/identity/provider-secrets/retire', requireAuth, identityAdminLimiter, identityProviderManage, identityAdminJsonPayloadLimit, validateBody(TenantIdentitySecretReferenceRetireRequestSchema), asyncHandler(async (req, res) => {
  try {
    const result = await tenantIdentityProviderSecretService.retireReference({
      tenantId: tenantSecretScope(req),
      purpose: req.body.purpose,
      reference: req.body.reference,
      ...(correlationId(req) ? { correlationId: correlationId(req) } : {}),
    });
    await logAudit({
      tenantId: req.tenant!.tenantId,
      userId: req.user!.userId,
      action: 'identity.provider.secret.retire',
      resourceType: 'identity_provider_secret',
      resourceId: referenceFingerprint(req.body.reference),
      details: { purpose: result.purpose, retired: result.retired, correlationId: correlationId(req) || null },
    });
    res.json(result);
  } catch (error) { safeBrokerError(error); }
}));

router.put('/api/identity/providers/:key/secrets/:purpose', requireAuth, identityAdminLimiter, identityProviderManage, identityAdminJsonPayloadLimit, validateBody(TenantIdentitySecretPutRequestSchema), asyncHandler(async (req, res) => {
  try {
    const result = await tenantIdentityProviderSecretService.rotateProvider({
      tenantId: tenantSecretScope(req),
      providerKey: providerKeySchema.parse(req.params.key),
      purpose: TenantIdentitySecretPurposeSchema.parse(req.params.purpose),
      value: req.body.value,
      ...(correlationId(req) ? { correlationId: correlationId(req) } : {}),
    });
    await logAudit({
      tenantId: req.tenant!.tenantId,
      userId: req.user!.userId,
      action: 'identity.provider.secret.rotate',
      resourceType: 'identity_provider',
      resourceId: providerKeySchema.parse(req.params.key),
      details: { purpose: result.purpose, version: result.version, previousRetired: result.previousRetired, referenceFingerprint: referenceFingerprint(result.reference), correlationId: correlationId(req) || null },
    });
    res.json(result);
  } catch (error) { safeBrokerError(error); }
}));

router.get('/api/identity/providers/:key/secrets/:purpose/availability', requireAuth, identityAdminLimiter, identityProviderManage, asyncHandler(async (req, res) => {
  try {
    const result = await tenantIdentityProviderSecretService.availability({
      tenantId: tenantSecretScope(req),
      providerKey: providerKeySchema.parse(req.params.key),
      purpose: TenantIdentitySecretPurposeSchema.parse(req.params.purpose),
      ...(correlationId(req) ? { correlationId: correlationId(req) } : {}),
    });
    await logAudit({
      tenantId: req.tenant!.tenantId,
      userId: req.user!.userId,
      action: 'identity.provider.secret.availability',
      resourceType: 'identity_provider',
      resourceId: providerKeySchema.parse(req.params.key),
      details: { purpose: result.purpose, configured: result.configured, available: result.available, reason: result.reason || null, correlationId: correlationId(req) || null },
    });
    res.json(result);
  } catch (error) { safeBrokerError(error); }
}));

router.post('/api/identity/providers/:key/secrets/:purpose/retire', requireAuth, identityAdminLimiter, identityProviderManage, identityAdminJsonPayloadLimit, validateBody(TenantIdentitySecretRetireRequestSchema), asyncHandler(async (req, res) => {
  try {
    const result = await tenantIdentityProviderSecretService.retireProvider({
      tenantId: tenantSecretScope(req),
      providerKey: providerKeySchema.parse(req.params.key),
      purpose: TenantIdentitySecretPurposeSchema.parse(req.params.purpose),
      ...(correlationId(req) ? { correlationId: correlationId(req) } : {}),
    });
    await logAudit({
      tenantId: req.tenant!.tenantId,
      userId: req.user!.userId,
      action: 'identity.provider.secret.retire',
      resourceType: 'identity_provider',
      resourceId: providerKeySchema.parse(req.params.key),
      details: { purpose: result.purpose, retired: result.retired, providerDisabled: true, correlationId: correlationId(req) || null },
    });
    res.json(result);
  } catch (error) { safeBrokerError(error); }
}));
// Keep retired legacy migration paths from being interpreted as provider keys
// by the generic route below.
router.all([
  '/api/identity/providers/environment-migration-drafts',
  '/api/identity/providers/migration-readiness',
  '/api/identity/providers/legacy-migration-draft/:legacyProviderId',
  '/api/identity/providers/legacy-cutover',
], (_req, res) => res.status(404).end());
router.post('/api/identity/providers/:key/external-identities/unlink', requireAuth, identityAdminLimiter, identityProviderManage, identityAdminJsonPayloadLimit, validateBody(IdentityProviderExternalIdentityUnlinkRequestSchema), asyncHandler(async (req, res) => {
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
router.get('/api/identity/providers/:key', requireAuth, identityAdminLimiter, identityProviderRead, asyncHandler(async (req, res) => {
  const provider = await identityProviderService.getByKey(providerKeySchema.parse(req.params.key), req.tenant?.tenantId || null);
  if (!provider) throw Errors.notFound('Identity provider not found');
  res.json(provider);
}));
router.get('/api/identity/providers/:key/sync-runs', requireAuth, identityAdminLimiter, identityProviderRead, validateQuery(IdentityProviderSyncRunsQuerySchema), asyncHandler(async (req, res) => {
  const provider = await identityProviderService.getByKey(providerKeySchema.parse(req.params.key), req.tenant?.tenantId || null);
  if (!provider) throw Errors.notFound('Identity provider not found');
  res.json(await ssoSyncDiagnosticsService.listRuns({ tenantId: req.tenant?.tenantId || null, providerId: provider.id, limit: Number(req.query.limit || 10) }));
}));
router.get('/api/identity/providers/:key/sync-runs/:runId/events', requireAuth, identityAdminLimiter, identityProviderRead, validateQuery(IdentityProviderSyncEventsQuerySchema), asyncHandler(async (req, res) => {
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
router.post('/api/identity/providers/:key/test-connection', requireAuth, identityAdminLimiter, reconciliationLimiter, identityProviderManage, asyncHandler(async (req, res) => {
  const provider = await identityProviderService.getByKey(providerKeySchema.parse(req.params.key), req.tenant?.tenantId || null);
  if (!provider) throw Errors.notFound('Identity provider not found');
  let result: Record<string, unknown>;
  if (provider.protocol === 'ldap') {
    const page = await directLdapIdentityService.listDirectoryPage(provider);
    result = { status: 'connected', protocol: 'ldap', sampledIdentities: page.identities.length };
  } else if (provider.protocol === 'oidc') {
    const metadata = await genericOidcService.testConnection(JSON.parse(provider.configurationJson));
    result = { status: 'metadata_reachable', protocol: 'oidc', issuer: metadata.issuer };
  } else {
    const metadata = await samlMetadataService.testConnection(provider.configurationJson, { tenantId: provider.tenantId, ...(correlationId(req) ? { correlationId: correlationId(req) } : {}) });
    result = { status: 'metadata_reachable', protocol: 'saml', entityDescriptorCount: metadata.entityDescriptorCount };
  }
  await logAudit({ action: 'identity.provider.connection_test', userId: req.user!.userId, resourceType: 'identity_provider', resourceId: provider.id, details: { key: provider.key, ...result } });
  res.json(result);
}));
router.post('/api/identity/providers', requireAuth, identityAdminLimiter, identityProviderManage, identityAdminJsonPayloadLimit, validateBody(IdentityProviderRequestSchema), asyncHandler(async (req, res) => {
  const provider = await identityProviderService.upsert({ ...req.body, tenantId: req.tenant?.tenantId || null });
  await logAudit({
    action: 'identity.provider.create', userId: req.user!.userId, resourceType: 'identity_provider', resourceId: provider.id,
    details: { key: provider.key, protocol: provider.protocol, isEnabled: provider.isEnabled },
  });
  res.status(201).json(provider);
}));
router.put('/api/identity/providers/:key', requireAuth, identityAdminLimiter, identityProviderManage, identityAdminJsonPayloadLimit, validateBody(IdentityProviderUpdateSchema), asyncHandler(async (req, res) => {
  const key = providerKeySchema.parse(req.params.key);
  const existing = await identityProviderService.getByKey(key, req.tenant?.tenantId || null);
  if (!existing) throw Errors.notFound('Identity provider not found');
  const providerInput = IdentityProviderRequestSchema.parse({
    key: existing.key,
    displayName: existing.displayName || existing.key,
    organization: existing.organization,
    displayOrder: existing.displayOrder,
    isPreferred: existing.isPreferred,
    loginDomains: JSON.parse(existing.loginDomainsJson || '[]'),
    protocol: existing.protocol,
    isEnabled: existing.isEnabled,
    authenticationMode: existing.authenticationMode,
    directoryTenantId: existing.directoryTenantId,
    configuration: JSON.parse(existing.configurationJson),
    sync: normalizeIdentityProviderSyncForMandatoryLogin(JSON.parse(existing.syncJson)),
    ownershipMode: existing.ownershipMode,
    sourceRef: existing.sourceRef,
    ...req.body,
  });
  const provider = await identityProviderService.upsert({ ...providerInput, tenantId: req.tenant?.tenantId || null });
  await logAudit({
    action: 'identity.provider.update', userId: req.user!.userId, resourceType: 'identity_provider', resourceId: provider.id,
    details: { key: provider.key, changedFields: Object.keys(req.body) },
  });
  res.json(provider);
}));
router.post('/api/identity/providers/:key/reconcile', requireAuth, identityAdminLimiter, reconciliationLimiter, identityProviderManage, asyncHandler(async (req, res) => {
  const key = providerKeySchema.parse(req.params.key);
  const provider = await identityProviderService.getByKey(key, req.tenant?.tenantId || null);
  if (!provider) throw Errors.notFound('Identity provider not found');
  if (provider.protocol !== 'ldap') throw Errors.validation('Manual reconciliation is currently available only for LDAP directory providers');
  const result = await ldapReconciliationService.reconcileProvider(key, req.tenant?.tenantId || null, 'manual');
  await logAudit({ action: 'identity.provider.reconcile', userId: req.user!.userId, resourceType: 'identity_provider', resourceId: provider.id, details: { key: provider.key, protocol: provider.protocol, ...result } });
  res.json(result);
}));
router.post('/api/identity/providers/:key/reconciliation-preview', requireAuth, identityAdminLimiter, reconciliationLimiter, identityProviderManage, identityAdminJsonPayloadLimit, asyncHandler(async (req, res) => {
  const key = providerKeySchema.parse(req.params.key);
  const input = IdentityProviderMembershipReplayRequestSchema.parse(req.body || {});
  const provider = await identityProviderService.getByKey(key, req.tenant?.tenantId || null);
  if (!provider) throw Errors.notFound('Identity provider not found');
  const result = await ssoNormalizedIdentityService.previewMemberships({ tenantId: req.tenant?.tenantId || null, providerId: provider.id, limit: input.limit, cursor: input.cursor });
  await logAudit({ action: 'identity.provider.memberships.preview', userId: req.user!.userId, resourceType: 'identity_provider', resourceId: provider.id, details: { key: provider.key, protocol: provider.protocol, scanned: result.scanned, additions: result.additions, removals: result.removals, failed: result.failed, truncated: result.truncated, warnings: result.warnings } });
  res.json(result);
}));
router.post('/api/identity/providers/:key/replay-memberships', requireAuth, identityAdminLimiter, reconciliationLimiter, identityProviderManage, identityAdminJsonPayloadLimit, asyncHandler(async (req, res) => {
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
router.delete('/api/identity/providers/:key', requireAuth, identityAdminLimiter, identityProviderManage, asyncHandler(async (req, res) => {
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

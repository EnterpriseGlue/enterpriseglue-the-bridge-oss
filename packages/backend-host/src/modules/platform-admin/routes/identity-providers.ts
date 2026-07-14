import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { requireAction } from '@enterpriseglue/shared/middleware/requireAction.js';
import { asyncHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { validateBody, validateQuery } from '@enterpriseglue/shared/middleware/validate.js';
import { identityProviderService } from '@enterpriseglue/shared/services/platform-admin/IdentityProviderService.js';
import { legacyIdentityProviderMigrationService } from '@enterpriseglue/shared/services/platform-admin/LegacyIdentityProviderMigrationService.js';
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
  IdentityProviderSyncEventsQuerySchema,
  IdentityProviderSyncRunsQuerySchema,
} from '@enterpriseglue/shared/schemas/platform-admin/authz.js';

const router = Router();
const schema = z.object({ key: z.string().min(1).max(128), protocol: z.enum(['oidc', 'saml', 'ldap']), isEnabled: z.boolean().optional(), authenticationMode: z.enum(['direct', 'claims_only']).optional(), directoryTenantId: z.string().optional().nullable(), configuration: z.record(z.string(), z.unknown()), sync: z.record(z.string(), z.unknown()).optional(), ownershipMode: z.string().max(64).optional(), sourceRef: z.string().optional().nullable() });

const providerKeySchema = z.string().min(1).max(128);
const legacyProviderIdSchema = z.string().min(1).max(128);
const migrationReadinessQuerySchema = z.object({ targetProviderKey: z.string().min(1).max(128), legacyProviderId: z.string().min(1).max(128).optional() });
const legacyCutoverSchema = z.object({ legacyProviderId: z.string().min(1).max(128), targetProviderKey: z.string().min(1).max(128) });

router.get('/api/identity/providers', requireAuth, identityAdminLimiter, requireAction('platform.sso.providers.read'), asyncHandler(async (req, res) => {
  res.json(await identityProviderService.list(req.tenant?.tenantId || null));
}));
router.get('/api/identity/providers/environment-migration-drafts', requireAuth, identityAdminLimiter, requireAction('platform.sso.providers.manage'), asyncHandler(async (req, res) => {
  const drafts = legacyIdentityProviderMigrationService.listEnvironmentDrafts();
  await logAudit({
    action: 'identity.provider.environment_migration_drafts.read',
    userId: req.user!.userId,
    resourceType: 'platform',
    resourceId: req.tenant?.tenantId || 'platform',
    details: { providerTypes: drafts.map((draft) => draft.legacyProvider.type) },
  });
  res.json(drafts);
}));
router.get('/api/identity/providers/legacy-migration-draft/:legacyProviderId', requireAuth, identityAdminLimiter, requireAction('platform.sso.providers.manage'), asyncHandler(async (req, res) => {
  const draft = await legacyIdentityProviderMigrationService.createDraft(legacyProviderIdSchema.parse(req.params.legacyProviderId));
  await logAudit({
    action: 'identity.provider.legacy_migration_draft',
    userId: req.user!.userId,
    resourceType: 'sso_provider',
    resourceId: draft.legacyProvider.id,
    details: {
      legacyProviderType: draft.legacyProvider.type,
      generatedProviderKey: draft.provider.key,
      clientSecretConfigured: draft.legacyProvider.clientSecretConfigured,
    },
  });
  res.json(draft);
}));
router.get('/api/identity/providers/migration-readiness', requireAuth, identityAdminLimiter, requireAction('platform.sso.providers.manage'), validateQuery(migrationReadinessQuerySchema), asyncHandler(async (req, res) => {
  const readiness = await legacyIdentityProviderMigrationService.getReadiness({ targetProviderKey: String(req.query.targetProviderKey), legacyProviderId: req.query.legacyProviderId ? String(req.query.legacyProviderId) : null, tenantId: req.tenant?.tenantId || null });
  await logAudit({ action: 'identity.provider.migration_readiness.read', userId: req.user!.userId, resourceType: 'identity_provider', resourceId: readiness.targetProviderKey, details: { legacyProviderId: readiness.legacyProviderId, ready: readiness.ready, activeMappingCount: readiness.activeMappingCount, blockers: readiness.blockers } });
  res.json(readiness);
}));
router.post('/api/identity/providers/legacy-cutover', requireAuth, identityAdminLimiter, requireAction('platform.sso.providers.manage'), identityAdminJsonPayloadLimit, validateBody(legacyCutoverSchema), asyncHandler(async (req, res) => {
  const result = await legacyIdentityProviderMigrationService.cutover({ ...req.body, tenantId: req.tenant?.tenantId || null });
  await logAudit({
    action: 'identity.provider.legacy_cutover',
    userId: req.user!.userId,
    resourceType: 'sso_provider',
    resourceId: result.legacyProvider.id,
    details: {
      legacyProviderType: result.legacyProvider.type,
      targetProviderKey: result.targetProviderKey,
      legacyProviderDisabled: result.legacyProviderDisabled,
      alreadyDisabled: result.alreadyDisabled,
    },
  });
  res.json(result);
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
router.post('/api/identity/providers', requireAuth, identityAdminLimiter, requireAction('platform.sso.providers.manage'), identityAdminJsonPayloadLimit, validateBody(schema), asyncHandler(async (req, res) => {
  const provider = await identityProviderService.upsert({ ...req.body, tenantId: req.tenant?.tenantId || null });
  await logAudit({
    action: 'identity.provider.create', userId: req.user!.userId, resourceType: 'identity_provider', resourceId: provider.id,
    details: { key: provider.key, protocol: provider.protocol, isEnabled: provider.isEnabled },
  });
  res.status(201).json(provider);
}));
router.put('/api/identity/providers/:key', requireAuth, identityAdminLimiter, requireAction('platform.sso.providers.manage'), identityAdminJsonPayloadLimit, validateBody(schema.omit({ key: true }).partial()), asyncHandler(async (req, res) => {
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

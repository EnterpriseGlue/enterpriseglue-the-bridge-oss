import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import identityProvidersRouter from '../../../../../packages/backend-host/src/modules/platform-admin/routes/identity-providers.js';
import { logAudit } from '@enterpriseglue/shared/services/audit.js';

const service = vi.hoisted(() => ({
  list: vi.fn(),
  getByKey: vi.fn(),
  upsert: vi.fn(),
  archive: vi.fn(),
  reconcile: vi.fn(),
  previewMemberships: vi.fn(),
  replayMemberships: vi.fn(),
  startRun: vi.fn(),
  completeRun: vi.fn(),
  failRun: vi.fn(),
  listRuns: vi.fn(),
  listEvents: vi.fn(),
  testConnection: vi.fn(),
  testSamlMetadata: vi.fn(),
  unlinkExternalIdentity: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'admin-1' };
    req.tenant = { tenantId: 'tenant-1' };
    next();
  },
}));
vi.mock('@enterpriseglue/shared/middleware/requireAction.js', () => ({
  requireAction: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock('@enterpriseglue/shared/services/platform-admin/IdentityProviderService.js', () => ({ identityProviderService: service }));
vi.mock('@enterpriseglue/shared/services/platform-admin/ExternalIdentityService.js', () => ({ externalIdentityService: { unlink: service.unlinkExternalIdentity } }));
vi.mock('@enterpriseglue/shared/services/platform-admin/LdapReconciliationService.js', () => ({ ldapReconciliationService: { reconcileProvider: service.reconcile } }));
vi.mock('@enterpriseglue/shared/services/platform-admin/SsoNormalizedIdentityService.js', () => ({ ssoNormalizedIdentityService: { previewMemberships: service.previewMemberships, replayMemberships: service.replayMemberships } }));
vi.mock('@enterpriseglue/shared/services/platform-admin/SsoSyncDiagnosticsService.js', () => ({ ssoSyncDiagnosticsService: { startRun: service.startRun, completeRun: service.completeRun, failRun: service.failRun, listRuns: service.listRuns, listEvents: service.listEvents } }));
vi.mock('@enterpriseglue/shared/services/platform-admin/GenericOidcService.js', () => ({ genericOidcService: { testConnection: service.testConnection } }));
vi.mock('@enterpriseglue/shared/services/platform-admin/DirectLdapIdentityService.js', () => ({ directLdapIdentityService: { listDirectoryPage: vi.fn() } }));
vi.mock('@enterpriseglue/shared/services/platform-admin/SamlMetadataService.js', () => ({ samlMetadataService: { testConnection: service.testSamlMetadata } }));
vi.mock('@enterpriseglue/shared/services/audit.js', () => ({ logAudit: vi.fn() }));

const provider = {
  id: 'provider-1', tenantId: 'tenant-1', key: 'entra', protocol: 'oidc', isEnabled: true,
  authenticationMode: 'claims_only', directoryTenantId: null,
  configurationJson: JSON.stringify({ issuerUrl: 'https://login.example.test', clientId: 'client-1', callbackUrl: 'https://app.example.test/api/auth/identity/callback', scopes: ['openid'] }),
  syncJson: JSON.stringify({ triggers: ['login'] }), ownershipMode: 'manual', sourceRef: null, createdAt: 1, updatedAt: 1,
};

describe('identity provider routes', () => {
  let app: express.Application;
  beforeEach(() => {
    vi.clearAllMocks();
    service.list.mockResolvedValue([provider]);
    service.getByKey.mockResolvedValue(provider);
    service.upsert.mockResolvedValue(provider);
    service.archive.mockResolvedValue({ providerId: 'provider-1', providerManagedMembershipsRemoved: 2, normalizedIdentitiesMarked: 1, externalIdentitiesMarked: 1, providerRefreshSessionsRevoked: 1 });
    service.reconcile.mockResolvedValue({ processed: 3, runId: 'sync-run-ldap-1' });
    service.previewMemberships.mockResolvedValue({ scanned: 3, additions: 1, removals: 1, unchanged: 1, failed: 0, truncated: false, nextCursor: null, latestSnapshotAt: 10, warnings: ['stored_snapshots_only'], mappings: [] });
    service.replayMemberships.mockResolvedValue({ scanned: 3, created: 1, removed: 1, failed: 0, truncated: false, nextCursor: null });
    service.startRun.mockResolvedValue('sync-run-1');
    service.completeRun.mockResolvedValue(undefined);
    service.failRun.mockResolvedValue(undefined);
    service.listRuns.mockResolvedValue([{ id: 'sync-run-1', status: 'success', trigger: 'manual', startedAt: 10, completedAt: 11, groupMembershipsCreated: 1, groupMembershipsRemoved: 0, errorMessage: null }]);
    service.listEvents.mockResolvedValue([{ id: 'event-1', providerId: 'provider-1', runId: 'sync-run-1', severity: 'info', type: 'membership_replayed', message: 'Membership replayed', details: '{}', createdAt: 11 }]);
    service.testConnection.mockResolvedValue({ issuer: 'https://login.example.test', authorizationEndpoint: 'https://login.example.test/auth', tokenEndpoint: 'https://login.example.test/token', jwksUri: 'https://login.example.test/jwks' });
    service.testSamlMetadata.mockResolvedValue({ metadataUrl: 'https://idp.example.test/metadata.xml', entityDescriptorCount: 2 });
    service.unlinkExternalIdentity.mockResolvedValue({ identityId: 'external-identity-1', providerManagedMembershipsRemoved: 2, normalizedIdentitiesMarked: 1, providerRefreshSessionsRevoked: 1 });
    app = express();
    app.use(express.json());
    app.use(identityProvidersRouter);
    app.use((error: any, _req: any, res: any, _next: any) => res.status(error.statusCode || 500).json(error.toJSON?.() || { error: error.message }));
  });

  it('lists provider-neutral definitions using the scoped tenant', async () => {
    const response = await request(app).get('/api/identity/providers');
    expect(response.status).toBe(200);
    expect(service.list).toHaveBeenCalledWith('tenant-1');
  });

  it('does not expose legacy provider migration or cutover endpoints', async () => {
    const results = await Promise.all([
      request(app).get('/api/identity/providers/legacy-migration-draft/legacy-google-1'),
      request(app).get('/api/identity/providers/environment-migration-drafts'),
      request(app).get('/api/identity/providers/migration-readiness?targetProviderKey=migrated-entra'),
      request(app).post('/api/identity/providers/legacy-cutover').send({ legacyProviderId: 'legacy-google-1', targetProviderKey: 'migrated-google' }),
    ]);
    expect(results.map((result) => result.status)).toEqual([404, 404, 404, 404]);
  });

  it('explicitly unlinks a conflicting external subject without reassigning it and records the recovery gate', async () => {
    const response = await request(app)
      .post('/api/identity/providers/entra/external-identities/unlink')
      .send({ subjectId: 'subject-1', userId: 'user-1', confirmation: 'UNLINK_EXTERNAL_IDENTITY' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({ identityId: 'external-identity-1', recovery: 'verified_sign_in_required' }));
    expect(service.unlinkExternalIdentity).toHaveBeenCalledWith({ tenantId: 'tenant-1', providerId: 'provider-1', subjectId: 'subject-1', userId: 'user-1' });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'identity.provider.external_identity_unlinked', resourceType: 'external_identity', resourceId: 'external-identity-1',
      details: expect.objectContaining({ providerKey: 'entra', targetUserId: 'user-1' }),
    }));
  });

  it('requires the explicit external-identity unlink acknowledgement', async () => {
    const response = await request(app)
      .post('/api/identity/providers/entra/external-identities/unlink')
      .send({ subjectId: 'subject-1', userId: 'user-1', confirmation: 'no' });

    expect(response.status).toBe(400);
    expect(service.unlinkExternalIdentity).not.toHaveBeenCalled();
  });

  it('lists bounded synchronization history for one provider', async () => {
    const response = await request(app).get('/api/identity/providers/entra/sync-runs?limit=5');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([expect.objectContaining({ id: 'sync-run-1', trigger: 'manual' })]);
    expect(service.listRuns).toHaveBeenCalledWith({ tenantId: 'tenant-1', providerId: 'provider-1', limit: 5 });
  });

  it('lists bounded synchronization events through the provider-neutral API', async () => {
    const response = await request(app).get('/api/identity/providers/entra/sync-runs/sync-run-1/events?severity=info&limit=25');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([expect.objectContaining({ id: 'event-1', providerId: 'provider-1', runId: 'sync-run-1' })]);
    expect(service.listEvents).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      providerId: 'provider-1',
      runId: 'sync-run-1',
      severity: 'info',
      limit: 25,
    });
  });

  it('tests OIDC discovery and audits the connection result', async () => {
    const response = await request(app).post('/api/identity/providers/entra/test-connection');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'connected', protocol: 'oidc', issuer: 'https://login.example.test' });
    expect(service.testConnection).toHaveBeenCalledWith(JSON.parse(provider.configurationJson));
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'identity.provider.connection_test', resourceId: 'provider-1' }));
  });

  it('tests SAML metadata and returns a sanitized descriptor count', async () => {
    service.getByKey.mockResolvedValue({ ...provider, protocol: 'saml', configurationJson: JSON.stringify({ entityId: 'enterpriseglue', callbackUrl: 'https://app.example.test/callback', metadataUrl: 'https://idp.example.test/metadata.xml' }) });

    const response = await request(app).post('/api/identity/providers/entra/test-connection');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'connected', protocol: 'saml', entityDescriptorCount: 2 });
    expect(service.testSamlMetadata).toHaveBeenCalledWith(expect.stringContaining('metadata.xml'));
  });

  it('creates a provider and audits sanitized definition metadata', async () => {
    const response = await request(app).post('/api/identity/providers').send({
      key: 'entra', protocol: 'oidc', authenticationMode: 'direct', configuration: {
        issuerUrl: 'https://login.example.test', clientId: 'client-1', clientSecretRef: 'secret/entra',
        callbackUrl: 'https://app.example.test/api/auth/identity/callback', scopes: ['openid', 'groups'], groupClaim: 'groups', expectedAudience: 'enterpriseglue',
      }, sync: { triggers: ['login', 'manual'], requiredForLogin: true, incompleteEntitlements: 'fail_closed', connectorCapability: 'claim_only', scheduled: false },
    });
    expect(response.status).toBe(201);
    expect(service.upsert).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1', key: 'entra', protocol: 'oidc',
      configuration: expect.objectContaining({ groupClaim: 'groups', expectedAudience: 'enterpriseglue' }),
      sync: expect.objectContaining({ triggers: ['login', 'manual'], connectorCapability: 'claim_only' }),
    }));
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'identity.provider.create', resourceId: 'provider-1' }));
  });

  it('rejects incomplete or plaintext direct-provider configuration before it reaches the service', async () => {
    const incomplete = await request(app).post('/api/identity/providers').send({
      key: 'invalid-oidc', protocol: 'oidc', configuration: { issuerUrl: 'https://login.example.test', clientId: 'client-1' },
    });
    const plaintext = await request(app).post('/api/identity/providers').send({
      key: 'invalid-ldap', protocol: 'ldap', configuration: {
        url: 'ldaps://directory.example.test', bindDn: 'CN=EnterpriseGlue', bindPassword: 'not-a-reference',
        userBaseDn: 'OU=Users,DC=example,DC=test', userSearchFilter: '(uid={username})', groupBaseDn: 'OU=Groups,DC=example,DC=test', groupIdAttribute: 'entryUUID', membershipMode: 'memberOf',
      },
    });
    expect(incomplete.status).toBe(400);
    expect(plaintext.status).toBe(400);
    expect(service.upsert).not.toHaveBeenCalled();
  });

  it('revalidates a merged provider record against its stored protocol on update', async () => {
    const response = await request(app).put('/api/identity/providers/entra').send({
      isEnabled: false,
      configuration: {
        issuerUrl: 'https://login.example.test', clientId: 'client-1', callbackUrl: 'https://app.example.test/api/auth/identity/callback', scopes: ['openid'],
        allowVerifiedEmailLinking: true, authorizationAttributeKeys: ['department'], groupClaim: 'groups', expectedAudience: 'enterpriseglue',
      },
      sync: { triggers: ['login', 'manual'], requiredForLogin: true, incompleteEntitlements: 'preserve_previous', connectorCapability: 'graph', scheduled: false },
    });
    expect(response.status).toBe(200);
    expect(service.upsert).toHaveBeenCalledWith(expect.objectContaining({
      key: 'entra', protocol: 'oidc', isEnabled: false,
      configuration: expect.objectContaining({ allowVerifiedEmailLinking: true, expectedAudience: 'enterpriseglue' }),
      sync: expect.objectContaining({ triggers: ['login', 'manual'], requiredForLogin: true, incompleteEntitlements: 'preserve_previous', connectorCapability: 'graph' }),
    }));
  });

  it('rejects a provider update that attempts to disable mandatory sign-in reconciliation', async () => {
    const response = await request(app).put('/api/identity/providers/entra').send({
      sync: { triggers: ['manual'], requiredForLogin: false, incompleteEntitlements: 'preserve_previous', connectorCapability: 'graph', scheduled: false },
    });

    expect(response.status).toBe(400);
    expect(service.upsert).not.toHaveBeenCalled();
  });

  it('archives instead of deleting provider history', async () => {
    const response = await request(app).delete('/api/identity/providers/entra');
    expect(response.status).toBe(204);
    expect(service.archive).toHaveBeenCalledWith('entra', 'tenant-1');
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'identity.provider.archive', details: expect.objectContaining({ cleanup: expect.objectContaining({ providerManagedMembershipsRemoved: 2 }) }) }));
  });

  it('runs one bounded LDAP reconciliation page and audits the action', async () => {
    service.getByKey.mockResolvedValue({ ...provider, protocol: 'ldap' });

    const response = await request(app).post('/api/identity/providers/entra/reconcile');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ processed: 3, runId: 'sync-run-ldap-1' });
    expect(service.reconcile).toHaveBeenCalledWith('entra', 'tenant-1', 'manual');
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'identity.provider.reconcile' }));
  });

  it('previews normalized identity membership changes without replaying them', async () => {
    const response = await request(app).post('/api/identity/providers/entra/reconciliation-preview').send({ limit: 25 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({ scanned: 3, additions: 1, removals: 1, warnings: ['stored_snapshots_only'] }));
    expect(service.previewMemberships).toHaveBeenCalledWith({ tenantId: 'tenant-1', providerId: 'provider-1', limit: 25, cursor: undefined });
    expect(service.replayMemberships).not.toHaveBeenCalled();
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'identity.provider.memberships.preview', resourceId: 'provider-1' }));
  });

  it('replays stored memberships for any provider without a directory call', async () => {
    const response = await request(app).post('/api/identity/providers/entra/replay-memberships').send({ limit: 25 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ runId: 'sync-run-1', scanned: 3, created: 1, removed: 1, failed: 0, truncated: false, nextCursor: null });
    expect(service.replayMemberships).toHaveBeenCalledWith({ tenantId: 'tenant-1', providerIds: ['provider-1'], limit: 25, cursor: undefined });
    expect(service.startRun).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-1', providerId: 'provider-1', trigger: 'manual' }));
    expect(service.completeRun).toHaveBeenCalledWith('sync-run-1', expect.objectContaining({ groupMembershipsCreated: 1, groupMembershipsRemoved: 1 }));
    expect(service.reconcile).not.toHaveBeenCalled();
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'identity.provider.memberships.replay', resourceId: 'provider-1' }));
  });
});

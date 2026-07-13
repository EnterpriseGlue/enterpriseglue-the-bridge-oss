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
  testConnection: vi.fn(),
  testSamlMetadata: vi.fn(),
  createLegacyMigrationDraft: vi.fn(),
  listEnvironmentMigrationDrafts: vi.fn(),
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
vi.mock('@enterpriseglue/shared/services/platform-admin/LegacyIdentityProviderMigrationService.js', () => ({ legacyIdentityProviderMigrationService: { createDraft: service.createLegacyMigrationDraft, listEnvironmentDrafts: service.listEnvironmentMigrationDrafts } }));
vi.mock('@enterpriseglue/shared/services/platform-admin/LdapReconciliationService.js', () => ({ ldapReconciliationService: { reconcileProvider: service.reconcile } }));
vi.mock('@enterpriseglue/shared/services/platform-admin/SsoNormalizedIdentityService.js', () => ({ ssoNormalizedIdentityService: { previewMemberships: service.previewMemberships, replayMemberships: service.replayMemberships } }));
vi.mock('@enterpriseglue/shared/services/platform-admin/SsoSyncDiagnosticsService.js', () => ({ ssoSyncDiagnosticsService: { startRun: service.startRun, completeRun: service.completeRun, failRun: service.failRun, listRuns: service.listRuns } }));
vi.mock('@enterpriseglue/shared/services/platform-admin/GenericOidcService.js', () => ({ genericOidcService: { testConnection: service.testConnection } }));
vi.mock('@enterpriseglue/shared/services/platform-admin/DirectLdapIdentityService.js', () => ({ directLdapIdentityService: { listDirectoryPage: vi.fn() } }));
vi.mock('@enterpriseglue/shared/services/platform-admin/SamlMetadataService.js', () => ({ samlMetadataService: { testConnection: service.testSamlMetadata } }));
vi.mock('@enterpriseglue/shared/services/audit.js', () => ({ logAudit: vi.fn() }));

const provider = {
  id: 'provider-1', tenantId: 'tenant-1', key: 'entra', protocol: 'oidc', isEnabled: true,
  authenticationMode: 'claims_only', directoryTenantId: null,
  configurationJson: JSON.stringify({ issuerUrl: 'https://login.example.test', clientId: 'client-1' }),
  syncJson: '{}', ownershipMode: 'manual', sourceRef: null, createdAt: 1, updatedAt: 1,
};

describe('identity provider routes', () => {
  let app: express.Application;
  beforeEach(() => {
    vi.clearAllMocks();
    service.list.mockResolvedValue([provider]);
    service.getByKey.mockResolvedValue(provider);
    service.upsert.mockResolvedValue(provider);
    service.archive.mockResolvedValue({ providerId: 'provider-1', providerManagedMembershipsRemoved: 2, normalizedIdentitiesMarked: 1, externalIdentitiesMarked: 1, providerRefreshSessionsRevoked: 1 });
    service.reconcile.mockResolvedValue({ processed: 3 });
    service.previewMemberships.mockResolvedValue({ scanned: 3, additions: 1, removals: 1, unchanged: 1, failed: 0, truncated: false, nextCursor: null, latestSnapshotAt: 10, warnings: ['stored_snapshots_only'], mappings: [] });
    service.replayMemberships.mockResolvedValue({ scanned: 3, created: 1, removed: 1, failed: 0, truncated: false, nextCursor: null });
    service.startRun.mockResolvedValue('sync-run-1');
    service.completeRun.mockResolvedValue(undefined);
    service.failRun.mockResolvedValue(undefined);
    service.listRuns.mockResolvedValue([{ id: 'sync-run-1', status: 'success', trigger: 'manual', startedAt: 10, completedAt: 11, groupMembershipsCreated: 1, groupMembershipsRemoved: 0, errorMessage: null }]);
    service.testConnection.mockResolvedValue({ issuer: 'https://login.example.test', authorizationEndpoint: 'https://login.example.test/auth', tokenEndpoint: 'https://login.example.test/token', jwksUri: 'https://login.example.test/jwks' });
    service.testSamlMetadata.mockResolvedValue({ metadataUrl: 'https://idp.example.test/metadata.xml', entityDescriptorCount: 2 });
    service.createLegacyMigrationDraft.mockResolvedValue({
      legacyProvider: { id: 'legacy-google-1', name: 'Google', type: 'google', enabled: true, clientSecretConfigured: true },
      provider: { key: 'legacy-google-legacy-google-1', protocol: 'oidc', isEnabled: false, authenticationMode: 'direct', directoryTenantId: null, configuration: { issuerUrl: 'https://accounts.google.com', clientId: 'client-1', callbackUrl: 'https://app.example.test/api/auth/identity/callback', scopes: ['openid', 'email'] } },
      requirements: ['client_secret_reference', 'identity_provider_redirect_uri', 'identity_mappings', 'legacy_provider_cutover'],
      warnings: ['The legacy client secret is not copied.'],
    });
    service.listEnvironmentMigrationDrafts.mockReturnValue([
      { legacyProvider: { id: 'environment:microsoft', name: 'Microsoft Entra ID environment configuration', type: 'microsoft', enabled: true, clientSecretConfigured: true }, provider: { key: 'legacy-environment-microsoft', protocol: 'oidc', isEnabled: false, authenticationMode: 'direct', directoryTenantId: 'directory-tenant', configuration: { issuerUrl: 'https://login.microsoftonline.com/directory-tenant/v2.0', clientId: 'client-1', callbackUrl: 'https://app.example.test/api/auth/identity/callback', scopes: ['openid'], clientSecretRef: 'env://MICROSOFT_CLIENT_SECRET' } }, requirements: ['identity_provider_redirect_uri', 'identity_mappings', 'legacy_provider_cutover'], warnings: ['Environment-backed secret reference.'] },
    ]);
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

  it('returns a non-secret provider-neutral draft for a legacy provider migration', async () => {
    const response = await request(app).get('/api/identity/providers/legacy-migration-draft/legacy-google-1');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      legacyProvider: expect.objectContaining({ id: 'legacy-google-1', clientSecretConfigured: true }),
      provider: expect.objectContaining({ protocol: 'oidc', isEnabled: false }),
    }));
    expect(service.createLegacyMigrationDraft).toHaveBeenCalledWith('legacy-google-1');
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'identity.provider.legacy_migration_draft',
      resourceId: 'legacy-google-1',
      details: expect.objectContaining({ clientSecretConfigured: true }),
    }));
    expect(JSON.stringify(response.body)).not.toContain('clientSecretEnc');
  });

  it('lists non-secret environment-backed legacy migration drafts', async () => {
    const response = await request(app).get('/api/identity/providers/environment-migration-drafts');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([expect.objectContaining({
      legacyProvider: expect.objectContaining({ id: 'environment:microsoft' }),
      provider: expect.objectContaining({ configuration: expect.objectContaining({ clientSecretRef: 'env://MICROSOFT_CLIENT_SECRET' }) }),
    })]);
    expect(service.listEnvironmentMigrationDrafts).toHaveBeenCalledOnce();
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'identity.provider.environment_migration_drafts.read', details: { providerTypes: ['microsoft'] } }));
  });

  it('lists bounded synchronization history for one provider', async () => {
    const response = await request(app).get('/api/identity/providers/entra/sync-runs?limit=5');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([expect.objectContaining({ id: 'sync-run-1', trigger: 'manual' })]);
    expect(service.listRuns).toHaveBeenCalledWith({ tenantId: 'tenant-1', providerId: 'provider-1', limit: 5 });
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
      key: 'entra', protocol: 'oidc', configuration: { issuerUrl: 'https://login.example.test', clientId: 'client-1', clientSecretRef: 'secret/entra' },
    });
    expect(response.status).toBe(201);
    expect(service.upsert).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-1', key: 'entra' }));
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'identity.provider.create', resourceId: 'provider-1' }));
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
    expect(response.body).toEqual({ processed: 3 });
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

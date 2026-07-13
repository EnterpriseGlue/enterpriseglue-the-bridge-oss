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
  replayMemberships: vi.fn(),
  startRun: vi.fn(),
  completeRun: vi.fn(),
  failRun: vi.fn(),
  listRuns: vi.fn(),
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
vi.mock('@enterpriseglue/shared/services/platform-admin/LdapReconciliationService.js', () => ({ ldapReconciliationService: { reconcileProvider: service.reconcile } }));
vi.mock('@enterpriseglue/shared/services/platform-admin/SsoNormalizedIdentityService.js', () => ({ ssoNormalizedIdentityService: { replayMemberships: service.replayMemberships } }));
vi.mock('@enterpriseglue/shared/services/platform-admin/SsoSyncDiagnosticsService.js', () => ({ ssoSyncDiagnosticsService: { startRun: service.startRun, completeRun: service.completeRun, failRun: service.failRun, listRuns: service.listRuns } }));
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
    service.archive.mockResolvedValue(undefined);
    service.reconcile.mockResolvedValue({ processed: 3 });
    service.replayMemberships.mockResolvedValue({ scanned: 3, created: 1, removed: 1, failed: 0, truncated: false, nextCursor: null });
    service.startRun.mockResolvedValue('sync-run-1');
    service.completeRun.mockResolvedValue(undefined);
    service.failRun.mockResolvedValue(undefined);
    service.listRuns.mockResolvedValue([{ id: 'sync-run-1', status: 'success', trigger: 'manual', startedAt: 10, completedAt: 11, groupMembershipsCreated: 1, groupMembershipsRemoved: 0, errorMessage: null }]);
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

  it('lists bounded synchronization history for one provider', async () => {
    const response = await request(app).get('/api/identity/providers/entra/sync-runs?limit=5');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([expect.objectContaining({ id: 'sync-run-1', trigger: 'manual' })]);
    expect(service.listRuns).toHaveBeenCalledWith({ tenantId: 'tenant-1', providerId: 'provider-1', limit: 5 });
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
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'identity.provider.archive' }));
  });

  it('runs one bounded LDAP reconciliation page and audits the action', async () => {
    service.getByKey.mockResolvedValue({ ...provider, protocol: 'ldap' });

    const response = await request(app).post('/api/identity/providers/entra/reconcile');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ processed: 3 });
    expect(service.reconcile).toHaveBeenCalledWith('entra', 'tenant-1', 'manual');
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'identity.provider.reconcile' }));
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

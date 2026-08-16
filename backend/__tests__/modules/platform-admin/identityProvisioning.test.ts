import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import identityProvisioningRouter from '../../../../packages/backend-host/src/modules/platform-admin/routes/identity-provisioning.js';

const service = vi.hoisted(() => ({
  list: vi.fn(),
  getByKey: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
  listCredentials: vi.fn(),
  issueCredential: vi.fn(),
  rotateCredential: vi.fn(),
  revokeCredential: vi.fn(),
  listDiagnostics: vi.fn(),
}));

const logAudit = vi.hoisted(() => vi.fn());

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'admin-1', email: 'admin@example.test' };
    req.tenant = { tenantId: 'tenant-1', tenantSlug: 'acme' };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/middleware/requireAction.js', () => ({
  requireAction: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@enterpriseglue/shared/middleware/apiClientAuth.js', () => ({
  requireApiClientAction: (_scope: string, _action: string) => (req: any, _res: any, next: any) => {
    req.apiClient = { id: 'provisioning-client-1', scopes: ['identity:provisioning:manage'] };
    req.tenant = { tenantId: 'tenant-1', tenantSlug: 'acme' };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/ApiClientService.js', () => ({
  API_CLIENT_TOKEN_PREFIX: 'egac',
  ApiClientScopes: { IDENTITY_PROVISIONING_MANAGE: 'identity:provisioning:manage' },
}));

vi.mock('@enterpriseglue/shared/middleware/rateLimiter.js', () => ({
  identityAdminLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@enterpriseglue/shared/middleware/requestSizeLimit.js', () => ({
  identityAdminJsonPayloadLimit: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/IdentityProvisioningDirectoryService.js', () => ({
  identityProvisioningDirectoryService: service,
}));

vi.mock('@enterpriseglue/shared/services/audit.js', () => ({ logAudit }));

const directory = {
  id: 'directory-1',
  tenantId: 'tenant-1',
  key: 'entra-workforce',
  directoryKeyIdentity: 'tenant-1:entra-workforce',
  displayName: 'Microsoft Entra workforce',
  description: 'Authoritative workforce lifecycle',
  type: 'scim_v2',
  identityProviderKey: 'entra-oidc',
  authoritative: true,
  status: 'active',
  ownershipMode: 'manual',
  sourceRef: null,
  sourceHash: null,
  credentialSecretRef: null,
  lastAppliedAt: null,
  driftStatus: null,
  createdAt: 1000,
  updatedAt: 1001,
  archivedAt: null,
};

const credential = {
  id: 'credential-1',
  directoryId: 'directory-1',
  name: 'Entra production',
  fingerprint: 'sha256:1234567890abcdef',
  status: 'active',
  createdAt: 1002,
  expiresAt: null,
  overlapEndsAt: null,
  lastUsedAt: null,
  revokedAt: null,
};

describe('identity provisioning admin routes', () => {
  let app: express.Application;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use(identityProvisioningRouter);
    app.use(errorHandler);
    service.list.mockResolvedValue([directory]);
    service.getByKey.mockResolvedValue(directory);
    service.listCredentials.mockResolvedValue([credential]);
    service.listDiagnostics.mockResolvedValue([]);
  });

  it('returns a bounded tenant-scoped list without bearer material', async () => {
    const response = await request(app).get('/api/identity/provisioning-directories?status=active&search=entra&limit=25&offset=0');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [directory], total: 1, limit: 25, offset: 0 });
    expect(service.list).toHaveBeenCalledWith('tenant-1');
    expect(JSON.stringify(response.body)).not.toContain('tokenHash');
    expect(JSON.stringify(response.body)).not.toContain('bearerToken');
  });

  it('returns the canonical detail contract including only a safe resolver reference', async () => {
    service.getByKey.mockResolvedValue({ ...directory, credentialSecretRef: 'env://ENTRA_SCIM_TOKEN' });

    const response = await request(app).get('/api/identity/provisioning-directories/entra-workforce');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      key: 'entra-workforce',
      authoritative: true,
      credentialSecretRef: 'env://ENTRA_SCIM_TOKEN',
    });
    expect(response.body).not.toHaveProperty('tokenHash');
    expect(response.body).not.toHaveProperty('token');
  });

  it('creates a disabled directory with tenant and actor context and safe audit metadata', async () => {
    service.create.mockResolvedValue({ ...directory, status: 'disabled' });

    const response = await request(app)
      .post('/api/identity/provisioning-directories')
      .send({ key: 'entra-workforce', displayName: 'Microsoft Entra workforce', isEnabled: false, authoritative: true });

    expect(response.status).toBe(201);
    expect(service.create).toHaveBeenCalledWith(expect.objectContaining({
      key: 'entra-workforce',
      isEnabled: false,
      authoritative: true,
    }), 'tenant-1', 'admin-1', 'user');
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'identity.provisioning.directory.create',
      userId: 'admin-1',
      details: expect.not.objectContaining({ token: expect.anything() }),
    }));
  });

  it('reports readiness from directory state and redacted credential metadata', async () => {
    const response = await request(app).post('/api/identity/provisioning-directories/entra-workforce/test');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ready',
      directoryStatus: 'active',
      activeCredentialCount: 1,
      endpointPath: '/scim/v2/entra-workforce',
    });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'identity.provisioning.directory.test',
      details: expect.not.objectContaining({ token: expect.anything() }),
    }));
  });

  it('reveals a newly issued credential exactly on the mutation response while list remains redacted', async () => {
    service.issueCredential.mockResolvedValue({ credential, token: 'eg_scim_reveal_once_12345678901234567890' });

    const issued = await request(app)
      .post('/api/identity/provisioning-directories/entra-workforce/credentials')
      .send({ name: 'Entra production', expiresAt: null });
    const listed = await request(app).get('/api/identity/provisioning-directories/entra-workforce/credentials');

    expect(issued.status).toBe(201);
    expect(issued.body.token).toBe('eg_scim_reveal_once_12345678901234567890');
    expect(issued.headers['cache-control']).toBe('no-store');
    expect(issued.headers.pragma).toBe('no-cache');
    expect(service.issueCredential).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: null }));
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual({ items: [credential] });
    expect(JSON.stringify(listed.body)).not.toContain('eg_scim_reveal_once');
    expect(JSON.stringify(listed.body)).not.toContain('tokenHash');
  });

  it('authorizes a machine principal and requires durable operation idempotency', async () => {
    service.issueCredential.mockResolvedValue({ credential, token: 'eg_scim_reveal_once_12345678901234567890' });

    const missingKey = await request(app)
      .post('/api/identity/provisioning-directories/entra-workforce/credentials')
      .set('Authorization', 'Bearer egac_provisioning_secret')
      .send({ name: 'Automation' });
    const issued = await request(app)
      .post('/api/identity/provisioning-directories/entra-workforce/credentials')
      .set('Authorization', 'Bearer egac_provisioning_secret')
      .set('Idempotency-Key', 'deployment:2026-08-15:001')
      .send({ name: 'Automation' });

    expect(missingKey.status).toBe(400);
    expect(issued.status).toBe(201);
    expect(service.issueCredential).toHaveBeenLastCalledWith(expect.objectContaining({
      actorUserId: null,
      idempotencyKey: 'deployment:2026-08-15:001',
    }));
    expect(logAudit).toHaveBeenLastCalledWith(expect.objectContaining({
      userId: 'provisioning-client-1',
      details: expect.objectContaining({ principalType: 'api_client' }),
    }));
  });

  it('rotates with bounded overlap, revokes immediately, and returns sanitized diagnostics', async () => {
    const replacement = { ...credential, id: 'credential-2', name: 'Entra production replacement' };
    service.rotateCredential.mockResolvedValue({ credential: replacement, token: 'eg_scim_replacement_12345678901234567890' });
    service.revokeCredential.mockResolvedValue({ ...replacement, status: 'revoked', revokedAt: 1100 });
    service.listDiagnostics.mockResolvedValue([{
      id: 'event-1', directoryId: directory.id, requestId: 'req-safe', eventType: 'User.patch',
      resourceType: 'User', resourceId: 'external-1', userId: 'user-1', status: 'success',
      code: null, message: 'User updated', occurredAt: 1099,
    }]);

    const rotated = await request(app)
      .post('/api/identity/provisioning-directories/entra-workforce/credentials/credential-1/rotate')
      .send({ overlapSeconds: 3600 });
    const revoked = await request(app)
      .delete('/api/identity/provisioning-directories/entra-workforce/credentials/credential-2');
    const events = await request(app)
      .get('/api/identity/provisioning-directories/entra-workforce/events?limit=25');

    expect(rotated.status).toBe(201);
    expect(service.rotateCredential).toHaveBeenCalledWith(expect.objectContaining({ overlapSeconds: 3600 }));
    expect(revoked.status).toBe(204);
    expect(service.revokeCredential).toHaveBeenCalledWith(directory.id, 'credential-2');
    expect(events.status).toBe(200);
    expect(events.body.items[0]).toMatchObject({ requestId: 'req-safe', status: 'success' });
    expect(JSON.stringify(events.body)).not.toContain('token');
  });

  it('archives the directory and all of its credentials through the service boundary', async () => {
    const response = await request(app).delete('/api/identity/provisioning-directories/entra-workforce');

    expect(response.status).toBe(204);
    expect(service.archive).toHaveBeenCalledWith('entra-workforce', 'tenant-1');
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'identity.provisioning.directory.archive',
      details: { principalType: 'user', key: 'entra-workforce', credentialsRevoked: true },
    }));
  });
});

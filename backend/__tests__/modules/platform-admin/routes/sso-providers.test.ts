import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import ssoProvidersRouter from '../../../../../packages/backend-host/src/modules/platform-admin/routes/sso-providers.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { logAudit } from '@enterpriseglue/shared/services/audit.js';

const ssoProviderServiceMock = vi.hoisted(() => ({
  getAllProviders: vi.fn(),
  getProvider: vi.fn(),
  createProvider: vi.fn(),
  updateProvider: vi.fn(),
  deleteProvider: vi.fn(),
  toggleProvider: vi.fn(),
  migrateDefaultRoleToIdentityMapping: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'admin-1', platformRole: 'admin' };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/middleware/requireAction.js', () => ({
  requireAction: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@enterpriseglue/shared/services/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/SsoProviderService.js', () => ({
  ssoProviderService: ssoProviderServiceMock,
}));

describe('platform-admin sso-providers routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(ssoProvidersRouter);
    app.use((error: any, _req: any, res: any, _next: any) => {
      res.status(error.statusCode ?? 500).json(error.toJSON ? error.toJSON() : { error: error.message });
    });
    vi.clearAllMocks();
    ssoProviderServiceMock.getAllProviders.mockResolvedValue([]);
    ssoProviderServiceMock.getProvider.mockResolvedValue(null);
    ssoProviderServiceMock.createProvider.mockResolvedValue({ id: 'provider-1' });
    ssoProviderServiceMock.updateProvider.mockResolvedValue(undefined);
    ssoProviderServiceMock.deleteProvider.mockResolvedValue(undefined);
    ssoProviderServiceMock.toggleProvider.mockResolvedValue(undefined);
    ssoProviderServiceMock.migrateDefaultRoleToIdentityMapping.mockResolvedValue({ mapping: { id: 'mapping-1' }, created: true });

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: () => ({
        find: vi.fn().mockResolvedValue([]),
        findOne: vi.fn().mockResolvedValue(null),
        save: vi.fn(),
      }),
    });
  });

  it('rejects creating an enabled provider without risk acknowledgement', async () => {
    const response = await request(app)
      .post('/api/sso/providers')
      .send({ name: 'Microsoft Entra', type: 'microsoft', enabled: true });

    expect(response.status).toBe(400);
    expect(response.body.details.riskReasons).toEqual(['provider_enable']);
    expect(ssoProviderServiceMock.createProvider).not.toHaveBeenCalled();
  });

  it('rejects SHA-1 legacy SAML provider configuration at the API boundary', async () => {
    const response = await request(app)
      .post('/api/sso/providers')
      .send({ name: 'Legacy SAML', type: 'saml', signatureAlgorithm: 'sha1' });

    expect(response.status).toBe(400);
    expect(ssoProviderServiceMock.createProvider).not.toHaveBeenCalled();
  });

  it('audits risk acknowledgement when creating a provider with admin default role', async () => {
    const response = await request(app)
      .post('/api/sso/providers')
      .send({
        name: 'Admin SSO',
        type: 'microsoft',
        defaultRole: 'admin',
        riskAcknowledged: true,
      });

    expect(response.status).toBe(201);
    expect(ssoProviderServiceMock.createProvider).toHaveBeenCalledWith(
      expect.objectContaining({ defaultRole: 'admin', riskAcknowledged: true }),
      'admin-1',
    );
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'sso.provider.create',
      details: expect.objectContaining({
        defaultRole: 'admin',
        riskAcknowledged: true,
        riskReasons: ['platform_admin_default_role'],
      }),
    }));
  });

  it('never copies provider credentials into API responses or audit details', async () => {
    const clientSecret = 'provider-api-secret-sentinel';
    const certificate = 'provider-api-certificate-sentinel';

    const response = await request(app)
      .post('/api/sso/providers')
      .send({
        name: 'Credential boundary provider',
        type: 'oidc',
        clientId: 'client-id',
        clientSecret,
        certificate,
      });

    expect(response.status).toBe(201);
    expect(ssoProviderServiceMock.createProvider).toHaveBeenCalledWith(
      expect.objectContaining({ clientSecret, certificate }),
      'admin-1',
    );
    expect(JSON.stringify(response.body)).not.toContain(clientSecret);
    expect(JSON.stringify(response.body)).not.toContain(certificate);
    expect(JSON.stringify((logAudit as unknown as Mock).mock.calls)).not.toContain(clientSecret);
    expect(JSON.stringify((logAudit as unknown as Mock).mock.calls)).not.toContain(certificate);
  });

  it('converts an acknowledged admin default role into an explicit identity mapping', async () => {
    ssoProviderServiceMock.getProvider.mockResolvedValue({ id: 'provider-1', defaultRole: 'admin' });
    const response = await request(app).post('/api/sso/providers/provider-1/migrate-default-role').send({ providerKey: 'entra-main', riskAcknowledged: true });
    expect(response.status).toBe(201);
    expect(ssoProviderServiceMock.migrateDefaultRoleToIdentityMapping).toHaveBeenCalledWith('provider-1', 'entra-main');
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'sso.provider.default_role_migrate' }));
  });

  it('rejects updating a provider to admin default role without risk acknowledgement', async () => {
    ssoProviderServiceMock.getProvider.mockResolvedValue({
      id: 'provider-1',
      name: 'Microsoft Entra',
      type: 'microsoft',
      enabled: false,
      defaultRole: 'user',
    });

    const response = await request(app)
      .put('/api/sso/providers/provider-1')
      .send({ defaultRole: 'admin' });

    expect(response.status).toBe(400);
    expect(response.body.details.riskReasons).toEqual(['platform_admin_default_role']);
    expect(ssoProviderServiceMock.updateProvider).not.toHaveBeenCalled();
  });

  it('rejects enabling a provider through toggle without risk acknowledgement', async () => {
    ssoProviderServiceMock.getProvider.mockResolvedValue({
      id: 'provider-1',
      name: 'Microsoft Entra',
      type: 'microsoft',
      enabled: false,
      defaultRole: 'user',
    });

    const response = await request(app)
      .post('/api/sso/providers/provider-1/toggle')
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.details.riskReasons).toEqual(['provider_enable']);
    expect(ssoProviderServiceMock.toggleProvider).not.toHaveBeenCalled();
  });

  it('audits risk acknowledgement when enabling a provider through toggle', async () => {
    ssoProviderServiceMock.getProvider.mockResolvedValue({
      id: 'provider-1',
      name: 'Microsoft Entra',
      type: 'microsoft',
      enabled: false,
      defaultRole: 'user',
    });

    const response = await request(app)
      .post('/api/sso/providers/provider-1/toggle')
      .send({ riskAcknowledged: true });

    expect(response.status).toBe(200);
    expect(response.body.enabled).toBe(true);
    expect(ssoProviderServiceMock.toggleProvider).toHaveBeenCalledWith('provider-1', true);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'sso.provider.enable',
      details: expect.objectContaining({
        enabled: true,
        riskAcknowledged: true,
        riskReasons: ['provider_enable'],
      }),
    }));
  });
});

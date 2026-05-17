import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { existsSync } from 'fs';
import enginesRouter from '../../../../../packages/backend-host/src/modules/mission-control/engines/routes.js';
import { engineService } from '@enterpriseglue/shared/services/platform-admin/index.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
}));

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1' };
    req.tenant = { tenantId: null };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/middleware/platformAuth.js', () => ({
  isPlatformAdmin: () => true,
}));

vi.mock('@enterpriseglue/shared/middleware/rateLimiter.js', () => ({
  apiLimiter: (_req: any, _res: any, next: any) => next(),
  engineLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/index.js', () => ({
  engineService: {
    listEngines: vi.fn().mockResolvedValue([]),
    getEngine: vi.fn().mockResolvedValue({ id: 'e1', name: 'Engine 1' }),
    hasEngineAccess: vi.fn().mockResolvedValue(true),
    getUserEngines: vi.fn().mockResolvedValue([
      { engine: { id: 'e1', name: 'Engine 1' }, role: 'admin' },
    ]),
    getEngineRole: vi.fn().mockResolvedValue('owner'),
  },
}));

vi.mock('@enterpriseglue/shared/constants/roles.js', () => ({
  ENGINE_VIEW_ROLES: ['owner', 'delegate', 'operator', 'viewer'],
  ENGINE_MANAGE_ROLES: ['owner', 'delegate'],
  MANAGE_ROLES: ['owner', 'delegate'],
}));

vi.mock('@enterpriseglue/shared/config/index.js', () => ({
  shouldUseSecureCookies: () => false,
  config: {
    nodeEnv: 'test',
    frontendUrl: 'http://localhost:5173',
  },
}));

describe('mission-control engines routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(enginesRouter);
    app.use(errorHandler);
    vi.clearAllMocks();
    (getDataSource as any).mockResolvedValue({
      getRepository: () => ({
        find: vi.fn().mockResolvedValue([{ id: 'e1', name: 'Engine 1' }]),
        findOneBy: vi.fn().mockResolvedValue({ id: 'e1', name: 'Engine 1' }),
      }),
    });
  });

  it('returns list of engines', async () => {
    const response = await request(app).get('/engines-api/engines');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      expect.objectContaining({
        id: 'e1',
        name: 'Engine 1',
        myRole: 'admin',
        username: null,
        passwordEnc: null,
        capabilities: expect.objectContaining({
          type: 'camunda7',
          compatibilityProfile: 'camunda7-rest',
          supportLevel: 'compatible',
        }),
      }),
    ]);
  });

  it('returns engine detail when user has access', async () => {
    const response = await request(app).get('/engines-api/engines/e1');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: 'e1', name: 'Engine 1' });
    expect((engineService as any).hasEngineAccess).toHaveBeenCalled();
  });

  it('rejects localhost engine URLs when running in Docker', async () => {
    (existsSync as any).mockReturnValue(true);

    const response = await request(app)
      .post('/engines-api/engines')
      .send({ name: 'Docker local engine', baseUrl: 'http://localhost:8080/engine-rest', type: 'operaton' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ field: 'baseUrl' });
    expect(String(response.body.error || '')).toContain('host.docker.internal:8080/engine-rest');
  });

  it('accepts ION, Operaton, and Camunda 7 engine types', async () => {
    const insert = vi.fn().mockResolvedValue({});
    (getDataSource as any).mockResolvedValue({
      getRepository: () => ({
        insert,
      }),
    });

    for (const type of ['ion', 'operaton', 'camunda7']) {
      const response = await request(app)
        .post('/engines-api/engines')
        .send({ name: `${type} engine`, baseUrl: `https://${type}.example.com/engine-rest`, type });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ type });
    }

    expect(insert).toHaveBeenCalledTimes(3);
  });

  it('defaults newly registered engines to ION when type is omitted', async () => {
    const insert = vi.fn().mockResolvedValue({});
    (getDataSource as any).mockResolvedValue({
      getRepository: () => ({
        insert,
      }),
    });

    const response = await request(app)
      .post('/engines-api/engines')
      .send({ name: 'Default engine', baseUrl: 'https://ion.example.com/engine-rest' });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ type: 'ion' });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ type: 'ion' }));
  });

  it('accepts OAuth2 client credentials engine auth metadata', async () => {
    const insert = vi.fn().mockResolvedValue({});
    (getDataSource as any).mockResolvedValue({
      getRepository: () => ({
        insert,
      }),
    });

    const response = await request(app)
      .post('/engines-api/engines')
      .send({
        name: 'Keycloak engine',
        baseUrl: 'https://ion.example.com/engine-rest',
        type: 'ion',
        authType: 'oauth2-client-credentials',
        username: 'enterpriseglue',
        passwordEnc: 'client-secret',
        oauthTokenUrl: 'https://keycloak.example.com/realms/acme/protocol/openid-connect/token',
        oauthScopes: 'engine-rest',
        oauthAudience: 'ion-engine',
      });

    expect(response.status).toBe(201);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      authType: 'oauth2-client-credentials',
      oauthTokenUrl: 'https://keycloak.example.com/realms/acme/protocol/openid-connect/token',
      oauthScopes: 'engine-rest',
      oauthAudience: 'ion-engine',
    }));
  });

  it('rejects unsupported engine type values', async () => {
    const response = await request(app)
      .post('/engines-api/engines')
      .send({ name: 'Unsupported engine', baseUrl: 'https://engine.example.com/engine-rest', type: 'camunda8' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: 'Validation failed' });
    expect(response.body.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'type' }),
    ]));
  });
});

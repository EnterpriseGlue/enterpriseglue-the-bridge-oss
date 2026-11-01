import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { fetch } from 'undici';
import router from '../../../../../packages/backend-host/src/modules/starbase/routes/deployments.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn(async () => ({ getRepository: () => ({
  findOne: vi.fn(async () => ({ id: 'engine-1', tenantId: null, tenancyMode: 'shared', baseUrl: 'http://localhost:8080/engine-rest', authType: 'none' })),
  findOneBy: vi.fn(async () => ({ id: 'engine-1', tenantId: null, tenancyMode: 'shared', baseUrl: 'http://localhost:8080/engine-rest', authType: 'none' })),
}) })) }));
vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({ requireAuth: (req: any, _res: any, next: any) => { req.user = { userId: 'user-1' }; next(); } }));
vi.mock('@enterpriseglue/shared/middleware/rateLimiter.js', () => ({ apiLimiter: (_req: any, _res: any, next: any) => next() }));
vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js', () => ({ EnginePermissions: { DEPLOY: 'engine:deploy', DEPLOY_VIEW: 'engine:deploy:view' }, permissionService: { hasPermission: vi.fn() } }));
vi.mock('@enterpriseglue/shared/services/audit.js', () => ({ logAudit: vi.fn() }));
vi.mock('@enterpriseglue/shared/services/encryption.js', () => ({ safeDecrypt: vi.fn(value => value), blindIndex: vi.fn(() => 'fixture-index') }));
vi.mock('undici', () => ({ fetch: vi.fn(), Response: globalThis.Response }));

describe('deployment deletion route/service/transport contract', () => {
  const app = express(); app.disable('x-powered-by'); app.use(express.json()); app.use(router); app.use(errorHandler);
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(permissionService.hasPermission).mockImplementation(async permission => permission === 'engine:deploy'); });
  it.each([200, 201, 202, 409])('does not convert engine HTTP %s into HTTP 204', async status => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('private-engine-body', { status }) as any);
    const result = await request(app).delete('/starbase-api/deployments/deployment%2Fone').query({ engineId: 'engine-1', cascade: 'false' });
    expect(result.status).toBe(502); expect(JSON.stringify(result.body)).not.toContain('private-engine-body'); expect(fetch).toHaveBeenCalledOnce();
  });
  it('acknowledges the exact noncascading engine target with HTTP 204', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }) as any);
    const result = await request(app).delete('/starbase-api/deployments/deployment%2Fone').query({ engineId: 'engine-1', cascade: 'false' });
    expect(result.status).toBe(204); expect(result.text).toBe('');
    expect(fetch).toHaveBeenCalledExactlyOnceWith('http://localhost:8080/engine-rest/deployment/deployment%2Fone', expect.objectContaining({ method: 'DELETE' }));
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:deploy', expect.objectContaining({ resourceId: 'engine-1', userId: 'user-1' }));
  });
  it('denies deletion without engine permission before any engine request', async () => {
    vi.mocked(permissionService.hasPermission).mockResolvedValue(false);
    const result = await request(app).delete('/starbase-api/deployments/deployment-1').query({ engineId: 'engine-1', cascade: 'false' });
    expect(result.status).toBe(403); expect(fetch).not.toHaveBeenCalled();
  });
});

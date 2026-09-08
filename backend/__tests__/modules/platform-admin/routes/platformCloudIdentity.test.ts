import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authz = vi.hoisted(() => ({
  allowed: new Set<string>(['platform.tenants.self_create', 'platform.tenants.read', 'platform.tenants.manage']),
  evaluated: [] as string[],
}));
const issue = vi.hoisted(() => vi.fn(({ action }: { action: string }) => ({
  token: `${action}.${'x'.repeat(40)}`,
  expiresIn: 90 as const,
})));

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (req.headers['x-test-unauthenticated'] === 'true') {
      return res.status(401).json({ code: 'UNAUTHORIZED', error: 'Authentication required' });
    }
    req.user = { userId: 'operator-1', type: 'access' };
    return next();
  },
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@enterpriseglue/shared/middleware/requireAction.js', () => ({
  requireAction: (actionId: string) => (_req: any, res: any, next: any) => {
    authz.evaluated.push(actionId);
    if (!authz.allowed.has(actionId)) {
      return res.status(403).json({ code: 'FORBIDDEN', error: `Access denied for action ${actionId}` });
    }
    return next();
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/PlatformCloudIdentityService.js', () => ({
  platformCloudIdentityService: { issue },
}));

import { config } from '@enterpriseglue/shared/config/index.js';
import { Tenant as TenantEntity } from '@enterpriseglue/shared/infrastructure/persistence/entities/Tenant.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { tenantService } from '@enterpriseglue/shared/services/platform-admin/TenantService.js';
import router from '@enterpriseglue/backend-host/modules/tenancy/routes/tenants.js';

const original = {
  cloudRequired: config.tenancyCloudRequired,
  cloudAccountIdentityEnabled: config.cloudAccountIdentityEnabled,
  shardId: config.tenantPlacementV2ShardId,
};

describe('platform Cloud identity and direct tenant mutation routes', () => {
  const app = express().use(express.json()).use(router).use(errorHandler);

  beforeEach(() => {
    authz.allowed = new Set(['platform.tenants.self_create', 'platform.tenants.read', 'platform.tenants.manage']);
    authz.evaluated.length = 0;
    issue.mockClear();
    config.tenancyCloudRequired = false;
    config.cloudAccountIdentityEnabled = true;
    config.tenantPlacementV2ShardId = 'regional-shard-01';
  });

  afterEach(() => {
    config.tenancyCloudRequired = original.cloudRequired;
    config.cloudAccountIdentityEnabled = original.cloudAccountIdentityEnabled;
    config.tenantPlacementV2ShardId = original.shardId;
    vi.restoreAllMocks();
  });

  it.each(['platform.tenants.self_create', 'platform.tenants.read', 'platform.tenants.manage'] as const)(
    'evaluates the exact requested %s action before issuing',
    async (action) => {
      const response = await request(app).post('/api/platform/cloud-identity').send({ action });

      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).toMatchObject({ action, expiresIn: 90 });
      expect(authz.evaluated).toEqual([action]);
      expect(issue).toHaveBeenCalledExactlyOnceWith({
        userId: 'operator-1', shardId: 'regional-shard-01', action,
      });
    },
  );

  it.each([
    ['platform.tenants.read', 'platform.tenants.manage'],
    ['platform.tenants.manage', 'platform.tenants.read'],
  ] as const)('denies a %s assertion when only %s is authorized', async (action, allowedAction) => {
    authz.allowed = new Set([allowedAction]);
    const response = await request(app).post('/api/platform/cloud-identity')
      .send({ action });

    expect(response.status).toBe(403);
    expect(authz.evaluated).toEqual([action]);
    expect(issue).not.toHaveBeenCalled();
  });

  it('denies a tenant member without a platform tenant permission', async () => {
    authz.allowed = new Set();
    const response = await request(app).post('/api/platform/cloud-identity')
      .send({ action: 'platform.tenants.read' });

    expect(response.status).toBe(403);
    expect(authz.evaluated).toEqual(['platform.tenants.read']);
    expect(issue).not.toHaveBeenCalled();
  });

  it('requires authentication before evaluating or issuing an assertion', async () => {
    const response = await request(app).post('/api/platform/cloud-identity')
      .set('x-test-unauthenticated', 'true')
      .send({ action: 'platform.tenants.read' });

    expect(response.status).toBe(401);
    expect(authz.evaluated).toEqual([]);
    expect(issue).not.toHaveBeenCalled();
  });

  it('fails closed when the shard identity is unavailable', async () => {
    config.tenantPlacementV2ShardId = undefined;
    const response = await request(app).post('/api/platform/cloud-identity')
      .send({ action: 'platform.tenants.read' });

    expect(response.status).toBe(503);
    expect(authz.evaluated).toEqual(['platform.tenants.read']);
    expect(issue).not.toHaveBeenCalled();
  });

  it('hides self-provisioning assertions unless managed Cloud account identity is enabled', async () => {
    config.cloudAccountIdentityEnabled = false;
    const response = await request(app).post('/api/platform/cloud-identity')
      .send({ action: 'platform.tenants.self_create' });

    expect(response.status).toBe(404);
    expect(authz.evaluated).toEqual(['platform.tenants.self_create']);
    expect(issue).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { action: 'platform.authz.roles.manage' },
    { action: 'platform.tenants.read', tenantId: 'tenant-a' },
  ])('rejects unsupported or over-broad exchange payloads before authorization', async (body) => {
    const response = await request(app).post('/api/platform/cloud-identity').send(body);

    expect(response.status).toBe(400);
    expect(authz.evaluated).toEqual([]);
    expect(issue).not.toHaveBeenCalled();
  });

  it('keeps tenant reads available in cloud-required mode', async () => {
    config.tenancyCloudRequired = true;
    const list = vi.spyOn(tenantService, 'list').mockResolvedValue([]);

    const response = await request(app).get('/api/platform/tenants');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(list).toHaveBeenCalledOnce();
  });

  it('keeps direct TypeORM-backed tenant mutations available outside cloud-required mode', async () => {
    const tenant = Object.assign(new TenantEntity(), {
      id: 'tenant-a',
      name: 'Tenant A',
      slug: 'tenant-a',
      status: 'active' as const,
      placementKey: null,
      placementEpoch: 1,
      createdByUserId: 'operator-1',
      createdAt: 1,
      updatedAt: 1,
    });
    const create = vi.spyOn(tenantService, 'create').mockResolvedValue(tenant);
    const update = vi.spyOn(tenantService, 'update').mockResolvedValue(Object.assign(new TenantEntity(), {
      ...tenant,
      name: 'Tenant A updated',
      updatedAt: 2,
    }));

    const created = await request(app).post('/api/platform/tenants').send({
      name: 'Tenant A',
      slug: 'tenant-a',
      ownerUserId: 'operator-1',
    });
    const updated = await request(app).patch('/api/platform/tenants/tenant-a').send({
      name: 'Tenant A updated',
    });

    expect(created.status).toBe(201);
    expect(updated.status).toBe(200);
    expect(create).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
    expect(authz.evaluated).toEqual(['platform.tenants.manage', 'platform.tenants.manage']);
  });

  it('authenticates and authorizes before applying the cloud-required mutation fence', async () => {
    config.tenancyCloudRequired = true;

    const unauthenticated = await request(app).post('/api/platform/tenants')
      .set('x-test-unauthenticated', 'true')
      .send({});
    expect(unauthenticated.status).toBe(401);
    expect(authz.evaluated).toEqual([]);

    authz.allowed = new Set();
    const unauthorized = await request(app).post('/api/platform/tenants').send({});
    expect(unauthorized.status).toBe(403);
    expect(authz.evaluated).toEqual(['platform.tenants.manage']);
  });

  it.each([
    ['post', '/api/platform/tenants'],
    ['patch', '/api/platform/tenants/tenant-a'],
  ] as const)('fails closed before TypeORM-backed %s %s mutation execution', async (method, path) => {
    config.tenancyCloudRequired = true;
    const create = vi.spyOn(tenantService, 'create');
    const update = vi.spyOn(tenantService, 'update');

    const response = await request(app)[method](path).send({});

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      code: 'CLOUD_CONTROL_PLANE_REQUIRED',
      error: 'Direct platform tenant mutation is disabled in cloud-required mode',
    });
    expect(authz.evaluated).toEqual(['platform.tenants.manage']);
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import metricsRouter from '../../../../../packages/backend-host/src/modules/mission-control/shared/metrics.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1' };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js', () => ({
  EnginePermissions: {
    INSTANCE_VIEW: 'engine:instance:view',
  },
  PlatformPermissions: {
    USER_MANAGE: 'platform:user:manage',
    USERS_CREATE: 'platform:users:create',
  },
  ProjectPermissions: {
    MEMBERS_MANAGE: 'project:members:manage',
  },
  permissionService: {
    hasPermission: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('../../../../../packages/backend-host/src/modules/mission-control/shared/metrics-service.js', () => ({
  listMetrics: vi.fn().mockResolvedValue([{ timestamp: '2026-07-17T00:00:00.000Z', name: 'activity-instance-start', value: 100 }]),
  getMetric: vi.fn().mockResolvedValue({ timestamp: '2026-07-17T00:00:00.000Z', name: 'activity-instance-start', value: 100 }),
}));

describe('mission-control metrics routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(metricsRouter);
    vi.clearAllMocks();

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) {
          return {
            findOne: vi.fn().mockResolvedValue({ id: 'engine-1', tenantId: null, tenancyMode: 'shared' }),
          };
        }
        return {};
      },
    });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(true);
  });

  it('lists metrics', async () => {
    const response = await request(app)
      .get('/mission-control-api/metrics')
      .query({ engineId: 'engine-1' });

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({ name: 'activity-instance-start' });
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:instance:view', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
  });

  it('gets specific metric by name', async () => {
    const response = await request(app)
      .get('/mission-control-api/metrics/activity-instance-start')
      .query({ engineId: 'engine-1' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ name: 'activity-instance-start' });
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:instance:view', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
  });

  it('denies metrics when engine runtime read permission is missing', async () => {
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);

    const response = await request(app)
      .get('/mission-control-api/metrics')
      .query({ engineId: 'engine-1' });

    expect(response.status).toBe(403);
  });
});

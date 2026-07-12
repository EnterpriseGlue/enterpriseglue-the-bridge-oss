import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import deploymentsRouter from '../../../../../packages/backend-host/src/modules/starbase/routes/deployments.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import {
  listDeployments,
  fetchDeploymentById,
  removeDeployment,
  fetchProcessDefinitionDiagram,
} from '../../../../../packages/backend-host/src/modules/starbase/services/deployments-service.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1' };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/middleware/rateLimiter.js', () => ({
  apiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js', () => ({
  EnginePermissions: {
    DEPLOY: 'engine:deploy',
    DEPLOY_VIEW: 'engine:deploy:view',
  },
  permissionService: {
    hasPermission: vi.fn().mockResolvedValue(false),
  },
}));

vi.mock('@enterpriseglue/shared/services/bpmn-engine-request-context.js', () => ({
  updateBpmnEngineRequestContext: vi.fn(),
}));

vi.mock('../../../../../packages/backend-host/src/modules/starbase/services/deployments-service.js', () => ({
  listDeployments: vi.fn().mockResolvedValue([]),
  fetchDeploymentById: vi.fn().mockResolvedValue({ id: 'deployment-1' }),
  removeDeployment: vi.fn().mockResolvedValue(undefined),
  fetchProcessDefinitionDiagram: vi.fn().mockResolvedValue({ id: 'process-1', bpmn20Xml: '<xml />' }),
}));

describe('starbase deployments routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(deploymentsRouter);
    vi.clearAllMocks();

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: () => ({
        findOne: vi.fn().mockResolvedValue({ id: 'engine-1', tenantId: null }),
      }),
    });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    (listDeployments as unknown as Mock).mockResolvedValue([{ id: 'deployment-1' }]);
    (fetchDeploymentById as unknown as Mock).mockResolvedValue({ id: 'deployment-1' });
    (removeDeployment as unknown as Mock).mockResolvedValue(undefined);
    (fetchProcessDefinitionDiagram as unknown as Mock).mockResolvedValue({ id: 'process-1', bpmn20Xml: '<xml />' });
  });

  it('lists deployments through scoped deploy-view permission without legacy engine role', async () => {
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) =>
      permission === 'engine:deploy:view'
    );

    const response = await request(app)
      .get('/starbase-api/deployments')
      .query({ engineId: 'engine-1' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ id: 'deployment-1' }]);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:deploy:view', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
    expect(listDeployments).toHaveBeenCalledWith('engine-1', {});
  });

  it('fetches deployment details through action metadata and scoped deploy-view permission', async () => {
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) =>
      permission === 'engine:deploy:view'
    );

    const response = await request(app)
      .get('/starbase-api/deployments/deployment-1')
      .query({ engineId: 'engine-1' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: 'deployment-1' });
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:deploy:view', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
    expect(fetchDeploymentById).toHaveBeenCalledWith('engine-1', 'deployment-1');
  });

  it('deletes deployments through scoped deploy permission without legacy engine role', async () => {
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) =>
      permission === 'engine:deploy'
    );

    const response = await request(app)
      .delete('/starbase-api/deployments/deployment-1')
      .query({ engineId: 'engine-1', cascade: 'true' });

    expect(response.status).toBe(204);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:deploy', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
    expect(removeDeployment).toHaveBeenCalledWith('engine-1', 'deployment-1', true);
  });

  it('fetches process definition diagrams through scoped deploy-view permission', async () => {
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) =>
      permission === 'engine:deploy:view'
    );

    const response = await request(app)
      .get('/starbase-api/process-definitions/process-1/diagram')
      .query({ engineId: 'engine-1' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: 'process-1', bpmn20Xml: '<xml />' });
    expect(fetchProcessDefinitionDiagram).toHaveBeenCalledWith('engine-1', 'process-1');
  });
});

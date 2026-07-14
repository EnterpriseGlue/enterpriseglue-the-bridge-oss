import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import migrationRouter from '../../../../../packages/backend-host/src/modules/mission-control/migration/routes.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { RuntimeResource } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResource.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import { camundaGet } from '@enterpriseglue/shared/services/bpmn-engine-client.js';
import {
  generateMigrationPlan,
  executeMigrationAsync,
  previewMigrationCount,
} from '../../../../../packages/backend-host/src/modules/mission-control/migration/service.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/bpmn-engine-client.js', () => ({
  camundaGet: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1' };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js', () => ({
  EnginePermissions: {
    INSTANCE_VIEW: 'engine:instance:view',
    PROCESS_MODIFY: 'engine:process:modify',
    MEMBERS_MANAGE: 'engine:members:manage',
  },
  PlatformPermissions: {
    USER_MANAGE: 'platform:user:manage',
    USERS_CREATE: 'platform:users:create',
  },
  ProjectPermissions: {
    MEMBERS_MANAGE: 'project:members:manage',
  },
  permissionService: {
    hasPermission: vi.fn().mockResolvedValue(false),
  },
}));

vi.mock('../../../../../packages/backend-host/src/modules/mission-control/migration/service.js', () => ({
  toEnginePlan: vi.fn(),
  previewMigrationCount: vi.fn().mockResolvedValue(0),
  generateMigrationPlan: vi.fn().mockResolvedValue({ instructions: [] }),
  validateMigrationPlan: vi.fn().mockResolvedValue({ instructionReports: [] }),
  executeMigration: vi.fn().mockResolvedValue(undefined),
  executeMigrationAsync: vi.fn().mockResolvedValue({ batchId: 'b1' }),
  executeMigrationDirect: vi.fn().mockResolvedValue(undefined),
  aggregateActiveSources: vi.fn().mockResolvedValue({}),
}));

describe('mission-control migration routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(migrationRouter);
    app.use(errorHandler);
    vi.clearAllMocks();

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) {
          return {
            findOne: vi.fn(async ({ where }: any) => ({
              id: String(where?.id || 'engine-1'),
              tenantId: null,
            })),
          };
        }
        return { findOne: vi.fn().mockResolvedValue(null) };
      },
    });

    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) =>
      permission.startsWith('engine:')
    );
  });

  it('generates migration plan', async () => {
    const response = await request(app)
      .post('/mission-control-api/migration/generate')
      .send({ engineId: 'engine-1', sourceProcessDefinitionId: 'p1', targetProcessDefinitionId: 'p2' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ instructions: [] });
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:instance:view', expect.objectContaining({
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
    expect(generateMigrationPlan).toHaveBeenCalledWith('engine-1', expect.objectContaining({
      engineId: 'engine-1',
    }));
  });

  it('executes migration async', async () => {
    const response = await request(app)
      .post('/mission-control-api/migration/execute-async')
      .send({ engineId: 'engine-1', processInstanceIds: ['pi1'] });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ batchId: 'b1' });
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:process:modify', expect.objectContaining({
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
    expect(executeMigrationAsync).toHaveBeenCalledWith('engine-1', expect.objectContaining({
      processInstanceIds: ['pi1'],
    }));
  });

  it('denies migration plan generation when instance view permission is missing', async () => {
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);

    const response = await request(app)
      .post('/mission-control-api/migration/generate')
      .send({ engineId: 'engine-1', sourceProcessDefinitionId: 'p1', targetProcessDefinitionId: 'p2' });

    expect(response.status).toBe(403);
    expect(generateMigrationPlan).not.toHaveBeenCalled();
  });

  it('requires both live-resolved migration definitions to be authorized runtime resources on a central engine', async () => {
    const runtimeResourceRepo = {
      findOne: vi.fn(async ({ where }: any) => (
        where.resourceKey === 'payments-v1' ? { id: 'resource-payments-v1', tenantId: null } : { id: 'resource-payments-v2', tenantId: null }
      )),
    };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) return { findOne: vi.fn().mockResolvedValue({ id: 'central-engine', tenantId: null, runtimeAccessScope: 'resource_aware' }) };
        if (entity === RuntimeResource) return runtimeResourceRepo;
        return { findOne: vi.fn().mockResolvedValue(null) };
      },
    });
    (camundaGet as unknown as Mock)
      .mockResolvedValueOnce({ id: 'definition-source', key: 'payments-v1' })
      .mockResolvedValueOnce({ id: 'definition-target', key: 'payments-v2' });
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (_permission: string, context: any) =>
      context.resourceType === 'engine_runtime_resource'
    );

    const response = await request(app)
      .post('/mission-control-api/migration/generate')
      .send({ engineId: 'central-engine', sourceProcessDefinitionId: 'untrusted-source-id', targetProcessDefinitionId: 'untrusted-target-id' });

    expect(response.status).toBe(200);
    expect(camundaGet).toHaveBeenCalledWith('central-engine', '/process-definition/untrusted-source-id');
    expect(camundaGet).toHaveBeenCalledWith('central-engine', '/process-definition/untrusted-target-id');
    expect(runtimeResourceRepo.findOne).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ engineId: 'central-engine', resourceKind: 'process_definition', resourceKey: 'payments-v1', isActive: true }),
    }));
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:instance:view', expect.objectContaining({
      resourceType: 'engine_runtime_resource', resourceId: 'resource-payments-v1',
    }));
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:instance:view', expect.objectContaining({
      resourceType: 'engine_runtime_resource', resourceId: 'resource-payments-v2',
    }));
  });

  it('fails closed for an unselected migration preview on a resource-aware engine', async () => {
    const runtimeResourceRepo = { findOne: vi.fn().mockResolvedValue({ id: 'resource-payments', tenantId: null }) };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) return { findOne: vi.fn().mockResolvedValue({ id: 'central-engine', tenantId: null, runtimeAccessScope: 'resource_aware' }) };
        if (entity === RuntimeResource) return runtimeResourceRepo;
        return { findOne: vi.fn().mockResolvedValue(null) };
      },
    });
    (camundaGet as unknown as Mock).mockResolvedValue({ key: 'payments' });
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (_permission: string, context: any) => context.resourceType === 'engine_runtime_resource');

    const response = await request(app)
      .post('/mission-control-api/migration/preview')
      .send({ engineId: 'central-engine', plan: { sourceProcessDefinitionId: 'payments:1', targetProcessDefinitionId: 'payments:2' } });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Resource-aware migration preview counts are not supported');
    expect(previewMigrationCount).not.toHaveBeenCalled();
  });
});

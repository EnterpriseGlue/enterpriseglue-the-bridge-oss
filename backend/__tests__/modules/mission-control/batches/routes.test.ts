import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import batchesRouter from '../../../../../packages/backend-host/src/modules/mission-control/batches/routes.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { Batch } from '@enterpriseglue/shared/infrastructure/persistence/entities/Batch.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import { markBatchPollerViewer } from '../../../../../packages/backend-host/src/poller/batchPoller.js';
import {
  deleteProcessInstancesBatch,
  suspendProcessInstancesBatch,
  processRetries,
  setBatchSuspended,
  deleteBatch,
} from '../../../../../packages/backend-host/src/modules/mission-control/batches/service.js';

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1' };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js', () => ({
  EnginePermissions: {
    INSTANCE_VIEW: 'engine:instance:view',
    INSTANCE_DELETE: 'engine:instance:delete',
    INSTANCE_RETRY: 'engine:instance:retry',
    PROCESS_MODIFY: 'engine:process:modify',
    PROCESS_CANCEL: 'engine:process:cancel',
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
    getVisibleRuntimeResources: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('../../../../../packages/backend-host/src/modules/mission-control/batches/service.js', () => ({
  processRetries: vi.fn().mockResolvedValue(undefined),
  fetchBatchInfo: vi.fn().mockResolvedValue({ id: 'b1', type: 'delete' }),
  fetchBatchStatistics: vi.fn().mockResolvedValue({ remainingJobs: 0, completedJobs: 10, failedJobs: 0 }),
  fetchJobsByDefinitionIds: vi.fn().mockResolvedValue([]),
  fetchJobStacktrace: vi.fn().mockResolvedValue(null),
  deleteBatch: vi.fn().mockResolvedValue(undefined),
  suspendProcessInstancesBatch: vi.fn().mockResolvedValue({ id: 'camunda-b1' }),
  deleteProcessInstancesBatch: vi.fn().mockResolvedValue({ id: 'camunda-b1' }),
  setBatchSuspended: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../../packages/backend-host/src/poller/batchPoller.js', () => ({
  markBatchPollerViewer: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@enterpriseglue/shared/services/pii/PiiRedactionService.js', () => ({
  piiRedactionService: {
    redactPayload: vi.fn().mockImplementation(async (_req: any, payload: any) => payload),
  },
}));

describe('mission-control batches routes', () => {
  let app: express.Application;
  let batchRepo: {
    insert: ReturnType<typeof vi.fn>;
    find: ReturnType<typeof vi.fn>;
    findOne: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(batchesRouter);
    vi.clearAllMocks();

    batchRepo = {
      insert: vi.fn().mockResolvedValue(undefined),
      find: vi.fn().mockResolvedValue([]),
      findOne: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    };

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
        if (entity === Batch) return batchRepo;
        throw new Error('Unexpected repository');
      },
    });

    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) =>
      permission.startsWith('engine:')
    );
  });

  it('creates delete batch and returns batch id', async () => {
    const response = await request(app)
      .post('/mission-control-api/batches/process-instances/delete')
      .send({ engineId: 'engine-1', processInstanceIds: ['p1'] });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ type: 'DELETE_INSTANCES' });
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:instance:delete', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
    expect(deleteProcessInstancesBatch).toHaveBeenCalledWith('engine-1', expect.objectContaining({
      processInstanceIds: ['p1'],
      deleteReason: 'Canceled via Mission Control',
    }));
    expect(batchRepo.insert).toHaveBeenCalled();
  });

  it('shows only batches with authorized process definition lineage on resource-aware engines', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) {
          return { findOne: vi.fn().mockResolvedValue({ id: 'engine-1', tenantId: null, runtimeAccessScope: 'resource_aware' }) };
        }
        if (entity === Batch) return batchRepo;
        throw new Error('Unexpected repository');
      },
    });
    batchRepo.find.mockResolvedValue([
      { id: 'batch-payments', createdAt: 2, metadata: JSON.stringify({ authz: { processDefinitionKeys: ['payments'] } }) },
      { id: 'batch-hr', createdAt: 1, metadata: JSON.stringify({ authz: { processDefinitionKeys: ['hr'] } }) },
      { id: 'batch-legacy', createdAt: 0, metadata: null },
    ]);
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    (permissionService.getVisibleRuntimeResources as unknown as Mock).mockResolvedValue([{ resourceKey: 'payments' }]);

    const response = await request(app)
      .get('/mission-control-api/batches')
      .query({ engineId: 'engine-1' });

    expect(response.status).toBe(200);
    expect(response.body.map((batch: { id: string }) => batch.id)).toEqual(['batch-payments']);
  });

  it('keeps audit reasons locally without forwarding them to engine batch APIs', async () => {
    await request(app)
      .post('/mission-control-api/batches/process-instances/delete')
      .send({ engineId: 'engine-1', processInstanceIds: ['p1'], auditReason: 'INC-123 approved cancel' });

    const deleteEnginePayload = (deleteProcessInstancesBatch as unknown as Mock).mock.calls[0][1];
    expect(deleteEnginePayload).not.toHaveProperty('auditReason');
    expect(JSON.parse(batchRepo.insert.mock.calls[0][0].payload)).toMatchObject({
      auditReason: 'INC-123 approved cancel',
    });

    vi.clearAllMocks();

    await request(app)
      .post('/mission-control-api/batches/process-instances/suspend')
      .send({ engineId: 'engine-1', processInstanceIds: ['p1'], auditReason: 'INC-124 approved suspend' });

    const suspendEnginePayload = (suspendProcessInstancesBatch as unknown as Mock).mock.calls[0][1];
    expect(suspendEnginePayload).not.toHaveProperty('auditReason');
    expect(suspendEnginePayload).toMatchObject({ suspended: true });
    expect(JSON.parse(batchRepo.insert.mock.calls[0][0].payload)).toMatchObject({
      auditReason: 'INC-124 approved suspend',
      suspended: true,
    });
  });

  it('marks the batch poller viewer on list fetch', async () => {
    const response = await request(app)
      .get('/mission-control-api/batches?engineId=engine-1');

    expect(response.status).toBe(200);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:instance:view', expect.objectContaining({
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
    expect(markBatchPollerViewer as unknown as Mock).toHaveBeenCalled();
  });

  it('marks the batch poller viewer on detail fetch', async () => {
    batchRepo.findOne.mockResolvedValue({
      id: 'batch-1',
      engineId: 'engine-1',
      status: 'RUNNING',
      camundaBatchId: null,
      metadata: null,
    });

    const response = await request(app)
      .get('/mission-control-api/batches/batch-1?engineId=engine-1');

    expect(response.status).toBe(200);
    expect(markBatchPollerViewer as unknown as Mock).toHaveBeenCalled();
  });

  it('creates suspend and activate batches through process modify permission', async () => {
    const suspendResponse = await request(app)
      .post('/mission-control-api/batches/process-instances/suspend')
      .send({ engineId: 'engine-1', processInstanceIds: ['p1'] });

    expect(suspendResponse.status).toBe(201);
    expect(suspendResponse.body).toMatchObject({ type: 'SUSPEND_INSTANCES' });
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:process:modify', expect.objectContaining({
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
    expect(suspendProcessInstancesBatch).toHaveBeenCalledWith('engine-1', expect.objectContaining({
      suspended: true,
    }));

    const activateResponse = await request(app)
      .post('/mission-control-api/batches/process-instances/activate')
      .send({ engineId: 'engine-1', processInstanceIds: ['p1'] });

    expect(activateResponse.status).toBe(201);
    expect(activateResponse.body).toMatchObject({ type: 'ACTIVATE_INSTANCES' });
    expect(suspendProcessInstancesBatch).toHaveBeenCalledWith('engine-1', expect.objectContaining({
      suspended: false,
    }));
  });

  it('creates retry batch through retry permission', async () => {
    const response = await request(app)
      .post('/mission-control-api/batches/jobs/retries')
      .send({ engineId: 'engine-1', processInstanceIds: ['p1'], retries: 3 });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ type: 'SET_JOB_RETRIES' });
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:instance:retry', expect.objectContaining({
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
    expect(processRetries).toHaveBeenCalledWith('engine-1', expect.any(String), ['p1']);
  });

  it('updates batch suspension through process modify permission', async () => {
    batchRepo.findOne.mockResolvedValue({
      id: 'batch-1',
      engineId: 'engine-1',
      status: 'RUNNING',
      camundaBatchId: 'camunda-b1',
      metadata: null,
    });

    const response = await request(app)
      .put('/mission-control-api/batches/batch-1/suspended')
      .send({ engineId: 'engine-1', suspended: true });

    expect(response.status).toBe(204);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:process:modify', expect.objectContaining({
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
    expect(setBatchSuspended).toHaveBeenCalledWith('engine-1', 'camunda-b1', true);
  });

  it('cancels engine batch through cancel permission', async () => {
    batchRepo.findOne.mockResolvedValue({
      id: 'batch-1',
      engineId: 'engine-1',
      status: 'RUNNING',
      camundaBatchId: 'camunda-b1',
      metadata: null,
    });

    const response = await request(app)
      .delete('/mission-control-api/batches/batch-1')
      .query({ engineId: 'engine-1' });

    expect(response.status).toBe(204);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:process:cancel', expect.objectContaining({
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
    expect(deleteBatch).toHaveBeenCalledWith('engine-1', 'camunda-b1');
  });

  it('denies batch reads when instance view permission is missing', async () => {
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);

    const response = await request(app)
      .get('/mission-control-api/batches')
      .query({ engineId: 'engine-1' });

    expect(response.status).toBe(403);
    expect(batchRepo.find).not.toHaveBeenCalled();
  });
});

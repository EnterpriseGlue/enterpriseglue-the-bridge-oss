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

const { logger } = vi.hoisted(() => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const batchDetailRow = {
  id: 'batch-1',
  engineId: 'engine-1',
  camundaBatchId: null,
  type: 'DELETE_INSTANCES',
  payload: null,
  totalJobs: null,
  jobsCreated: null,
  completedJobs: null,
  failedJobs: null,
  remainingJobs: null,
  invocationsPerBatchJob: null,
  seedJobDefinitionId: null,
  monitorJobDefinitionId: null,
  batchJobDefinitionId: null,
  status: 'RUNNING',
  progress: null,
  createdBy: null,
  createdAt: 0,
  updatedAt: 0,
  completedAt: null,
  lastError: null,
};

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1' };
    req.tenant = { tenantId: 'tenant-default' };
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

vi.mock('@enterpriseglue/shared/utils/logger.js', () => ({ logger }));

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
              tenantId: 'tenant-default',
              tenancyMode: 'dedicated',
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

  it('rejects malformed batch payloads after their runtime authorization guard', async () => {
    const response = await request(app)
      .post('/mission-control-api/batches/process-instances/delete')
      .send({ engineId: 'engine-1', processInstanceIds: 'p1' });

    expect(response.status).toBe(400);
    expect(deleteProcessInstancesBatch).not.toHaveBeenCalled();
  });

  it('shows only batches with authorized process definition lineage on resource-aware engines', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) {
          return { findOne: vi.fn().mockResolvedValue({ id: 'engine-1', tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'resource_aware' }) };
        }
        if (entity === Batch) return batchRepo;
        throw new Error('Unexpected repository');
      },
    });
    batchRepo.find.mockResolvedValue([
      { ...batchDetailRow, id: 'batch-payments', createdAt: 2, metadata: JSON.stringify({ authz: { processDefinitionKeys: ['payments'] } }) },
      { ...batchDetailRow, id: 'batch-hr', createdAt: 1, metadata: JSON.stringify({ authz: { processDefinitionKeys: ['hr'] } }) },
      { ...batchDetailRow, id: 'batch-legacy', createdAt: 0, metadata: null },
    ]);
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    (permissionService.getVisibleRuntimeResources as unknown as Mock).mockResolvedValue([{ resourceKey: 'payments' }]);

    const response = await request(app)
      .get('/mission-control-api/batches')
      .query({ engineId: 'engine-1' });

    expect(response.status).toBe(200);
    expect(response.body.map((batch: { id: string }) => batch.id)).toEqual(['batch-payments']);
  });

  it('bounds and pages batch records after resource-aware filtering', async () => {
    batchRepo.find.mockResolvedValue(Array.from({ length: 102 }, (_, index) => ({
      ...batchDetailRow, id: `batch-${index}`, engineId: 'engine-1', createdAt: 1000 - index,
      metadata: JSON.stringify({ authz: { processDefinitionKeys: ['payments'] } }),
    })));

    const response = await request(app)
      .get('/mission-control-api/batches')
      .query({ engineId: 'engine-1', firstResult: 1, maxResults: 2 });

    expect(response.status).toBe(200);
    expect(response.body.map((batch: { id: string }) => batch.id)).toEqual(['batch-1', 'batch-2']);
  });

  it('rejects an unsafe batch page size', async () => {
    const response = await request(app)
      .get('/mission-control-api/batches')
      .query({ engineId: 'engine-1', maxResults: 101 });

    expect(response.status).toBe(403);
    expect(batchRepo.find).toHaveBeenCalled();
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

  it('does not log raw batch payloads or upstream engine responses', async () => {
    const response = await request(app)
      .post('/mission-control-api/batches/process-instances/suspend')
      .send({ engineId: 'engine-1', processInstanceIds: ['p1'], customerDownstreamToken: 'must-not-leak' });

    expect(response.status).toBe(201);
    expect(logger.info).not.toHaveBeenCalled();
    expect(JSON.stringify(logger)).not.toContain('must-not-leak');
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
      ...batchDetailRow,
      metadata: null,
    });

    const response = await request(app)
      .get('/mission-control-api/batches/batch-1?engineId=engine-1');

    expect(response.status).toBe(200);
    expect(markBatchPollerViewer as unknown as Mock).toHaveBeenCalled();
  });

  it('returns per-batch action decisions only when requested', async () => {
    batchRepo.findOne.mockResolvedValue({
      ...batchDetailRow,
      metadata: JSON.stringify({ authz: { processDefinitionKeys: ['payments'] } }),
    });

    const response = await request(app)
      .get('/mission-control-api/batches/batch-1')
      .query({ engineId: 'engine-1', includeActionDecisions: 'true' });

    expect(response.status).toBe(200);
    expect(response.body.runtimeActionDecisions).toEqual(expect.objectContaining({
      suspension: expect.objectContaining({ allowed: true }),
      cancel: expect.objectContaining({ allowed: true }),
      recordDelete: expect.objectContaining({ allowed: true }),
    }));
  });

  it('hides a multi-resource batch unless every runtime resource is authorized', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) return { findOne: vi.fn().mockResolvedValue({ id: 'engine-1', tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'resource_aware' }) };
        if (entity === Batch) return batchRepo;
        throw new Error('Unexpected repository');
      },
    });
    batchRepo.findOne.mockResolvedValue({
      id: 'batch-1', engineId: 'engine-1', status: 'RUNNING', camundaBatchId: null,
      metadata: JSON.stringify({ authz: { processDefinitionKeys: ['payments', 'hr'] } }),
    });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    (permissionService.getVisibleRuntimeResources as unknown as Mock).mockResolvedValue([{ resourceKey: 'payments' }]);

    const response = await request(app)
      .get('/mission-control-api/batches/batch-1')
      .query({ engineId: 'engine-1' });

    expect(response.status).toBe(403);
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

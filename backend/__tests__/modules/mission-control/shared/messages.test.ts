import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import messagesRouter from '../../../../../packages/backend-host/src/modules/mission-control/shared/messages.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import { sendMessage, sendSignal } from '../../../../../packages/backend-host/src/modules/mission-control/shared/messages-service.js';

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
    PROCESS_MODIFY: 'engine:process:modify',
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

vi.mock('../../../../../packages/backend-host/src/modules/mission-control/shared/messages-service.js', () => ({
  sendMessage: vi.fn().mockResolvedValue([{ resultType: 'Execution', execution: { id: 'i1', processInstanceId: 'pi1' }, engineExtension: { traceId: 'message-1' } }]),
  sendSignal: vi.fn().mockResolvedValue(undefined),
}));

describe('mission-control messages routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(messagesRouter);
    vi.clearAllMocks();

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) {
          return {
            findOne: vi.fn().mockResolvedValue({ id: 'engine-1', tenantId: null }),
          };
        }
        return {};
      },
    });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(true);
  });

  it('correlates message', async () => {
    const response = await request(app)
      .post('/mission-control-api/messages')
      .send({ engineId: 'engine-1', messageName: 'TestMessage', businessKey: 'test-key' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ resultType: 'Execution', execution: { id: 'i1', processInstanceId: 'pi1' }, engineExtension: { traceId: 'message-1' } }]);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:process:modify', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
    expect(sendMessage).toHaveBeenCalledWith('engine-1', {
      messageName: 'TestMessage',
      businessKey: 'test-key',
    });
  });

  it('delivers signal', async () => {
    const response = await request(app)
      .post('/mission-control-api/signals')
      .send({ engineId: 'engine-1', name: 'TestSignal' });

    expect(response.status).toBe(204);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:process:modify', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
    expect(sendSignal).toHaveBeenCalledWith('engine-1', { name: 'TestSignal' });
  });

  it('denies message correlation when process modify permission is missing', async () => {
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);

    const response = await request(app)
      .post('/mission-control-api/messages')
      .send({ engineId: 'engine-1', messageName: 'TestMessage' });

    expect(response.status).toBe(403);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { EngineAccessService } from '@enterpriseglue/shared/services/platform-admin/EngineAccessService.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { EngineProjectAccess } from '@enterpriseglue/shared/db/entities/EngineProjectAccess.js';
import { EngineAccessRequest } from '@enterpriseglue/shared/db/entities/EngineAccessRequest.js';
import { Engine } from '@enterpriseglue/shared/db/entities/Engine.js';
import { Project } from '@enterpriseglue/shared/db/entities/Project.js';
import { ProjectEngineTarget } from '@enterpriseglue/shared/db/entities/ProjectEngineTarget.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js', () => ({
  EnginePermissions: { ENGINE_EDIT: 'engine:edit' },
  ProjectPermissions: { PROJECT_SETTINGS: 'project:settings:manage' },
  permissionService: { hasPermission: vi.fn() },
}));

describe('EngineAccessService', () => {
  const service = new EngineAccessService();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns approved when access already exists', async () => {
    const accessRepo = { findOne: vi.fn().mockResolvedValue({ id: 'access-1', grantedById: 'user-1', autoApproved: true }) };
    const requestRepo = { findOne: vi.fn() };
    const engineRepo = { findOne: vi.fn().mockResolvedValue({ id: 'engine-1', tenantId: 'tenant-a', tenancyMode: 'dedicated' }) };
    const projectRepo = { findOne: vi.fn().mockResolvedValue({ id: 'project-1', tenantId: 'tenant-a' }) };
    const targetRepo = { findOne: vi.fn().mockResolvedValue(null), insert: vi.fn() };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === EngineProjectAccess) return accessRepo;
        if (entity === EngineAccessRequest) return requestRepo;
        if (entity === Engine) return engineRepo;
        if (entity === Project) return projectRepo;
        if (entity === ProjectEngineTarget) return targetRepo;
        throw new Error('Unexpected repository');
      },
    });

    const result = await service.requestAccess('project-1', 'engine-1', 'user-1');
    expect(result.status).toBe('approved');
  });

  it('returns pending when request already exists', async () => {
    const accessRepo = { findOne: vi.fn().mockResolvedValue(null) };
    const requestRepo = { findOne: vi.fn().mockResolvedValue({ id: 'req-1' }) };
    const engineRepo = { findOne: vi.fn().mockResolvedValue({ id: 'engine-1', tenantId: 'tenant-a', tenancyMode: 'dedicated' }) };
    const projectRepo = { findOne: vi.fn().mockResolvedValue({ id: 'project-1', tenantId: 'tenant-a' }) };
    const targetRepo = { findOne: vi.fn().mockResolvedValue(null) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === EngineProjectAccess) return accessRepo;
        if (entity === EngineAccessRequest) return requestRepo;
        if (entity === Engine) return engineRepo;
        if (entity === Project) return projectRepo;
        if (entity === ProjectEngineTarget) return targetRepo;
        throw new Error('Unexpected repository');
      },
    });

    const result = await service.requestAccess('project-1', 'engine-1', 'user-1');
    expect(result.status).toBe('pending');
    expect(result.requestId).toBe('req-1');
  });

  it('auto-approves when the requester has canonical management permissions for both resources', async () => {
    const accessRepo = { findOne: vi.fn().mockResolvedValue(null), insert: vi.fn() };
    const requestRepo = { findOne: vi.fn().mockResolvedValue(null), insert: vi.fn() };
    const engineRepo = {
      findOne: vi.fn().mockResolvedValue({ id: 'engine-1', tenantId: 'tenant-a', tenancyMode: 'dedicated', lifecycleStatus: 'active' }),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
    };
    const projectRepo = {
      findOne: vi.fn().mockResolvedValue({ id: 'project-1', tenantId: 'tenant-a' }),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
    };
    const targetRepo = { findOne: vi.fn().mockResolvedValue(null), insert: vi.fn() };

    const getRepository = (entity: unknown) => {
        if (entity === EngineProjectAccess) return accessRepo;
        if (entity === EngineAccessRequest) return requestRepo;
        if (entity === Engine) return engineRepo;
        if (entity === Project) return projectRepo;
        if (entity === ProjectEngineTarget) return targetRepo;
        throw new Error('Unexpected repository');
    };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository,
      transaction: vi.fn(async (callback) => callback({ getRepository })),
    });
    (permissionService.hasPermission as Mock)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);

    const result = await service.requestAccess('project-1', 'engine-1', 'user-1');
    expect(result.status).toBe('approved');
    expect(accessRepo.insert).toHaveBeenCalled();
    expect(targetRepo.insert).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      projectId: 'project-1',
      engineId: 'engine-1',
      source: 'legacy',
    }));
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:settings:manage', expect.objectContaining({
      userId: 'user-1', resourceType: 'project', resourceId: 'project-1',
    }));
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:edit', expect.objectContaining({
      userId: 'user-1', resourceType: 'engine', resourceId: 'engine-1',
    }));
  });

  it('does not auto-approve from matching accountable metadata without canonical permissions', async () => {
    const accessRepo = { findOne: vi.fn().mockResolvedValue(null), insert: vi.fn() };
    const requestRepo = { findOne: vi.fn().mockResolvedValue(null), insert: vi.fn() };
    const engineRepo = { findOne: vi.fn().mockResolvedValue({ id: 'engine-1', tenantId: 'tenant-a', tenancyMode: 'dedicated', ownerId: 'user-1', delegateId: null }) };
    const projectRepo = { findOne: vi.fn().mockResolvedValue({ id: 'project-1', tenantId: 'tenant-a', ownerId: 'user-1' }) };
    const targetRepo = { findOne: vi.fn().mockResolvedValue(null) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === EngineProjectAccess) return accessRepo;
        if (entity === EngineAccessRequest) return requestRepo;
        if (entity === Engine) return engineRepo;
        if (entity === Project) return projectRepo;
        if (entity === ProjectEngineTarget) return targetRepo;
        throw new Error('Unexpected repository');
      },
    });
    (permissionService.hasPermission as Mock)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);

    const result = await service.requestAccess('project-1', 'engine-1', 'user-1');
    expect(result.status).toBe('pending');
    expect(requestRepo.insert).toHaveBeenCalled();
  });

  it('does not persist legacy engine access for a project without tenant ownership', async () => {
    const accessRepo = { insert: vi.fn() };
    const projectRepo = {
      update: vi.fn().mockResolvedValue({ affected: 0 }),
      findOne: vi.fn().mockResolvedValue({ id: 'project-1', tenantId: null }),
    };
    const getRepository = (entity: unknown) => {
      if (entity === EngineProjectAccess) return accessRepo;
      if (entity === Project) return projectRepo;
      throw new Error('Unexpected repository');
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository,
      transaction: vi.fn(async (callback) => callback({ getRepository })),
    });

    await expect(service.grantAccess('project-1', 'engine-1', 'user-1', true, 'tenant-default'))
      .rejects.toThrow('same tenant');
    expect(accessRepo.insert).not.toHaveBeenCalled();
  });

  it('rejects a direct cross-tenant grant before persisting access or a target', async () => {
    const accessRepo = { insert: vi.fn() };
    const targetRepo = { findOne: vi.fn(), insert: vi.fn() };
    const projectRepo = {
      update: vi.fn().mockResolvedValue({ affected: 1 }),
      findOne: vi.fn().mockResolvedValue({ id: 'project-1', tenantId: 'tenant-a' }),
    };
    const engineRepo = {
      update: vi.fn().mockResolvedValue({ affected: 1 }),
      findOne: vi.fn().mockResolvedValue({
        id: 'engine-1', tenantId: 'tenant-b', tenancyMode: 'dedicated', lifecycleStatus: 'active',
      }),
    };
    const getRepository = (entity: unknown) => {
      if (entity === EngineProjectAccess) return accessRepo;
      if (entity === ProjectEngineTarget) return targetRepo;
      if (entity === Project) return projectRepo;
      if (entity === Engine) return engineRepo;
      throw new Error('Unexpected repository');
    };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository,
      transaction: vi.fn(async (callback) => callback({ getRepository })),
    });

    await expect(service.grantAccess('project-1', 'engine-1', 'user-1', true, 'tenant-a'))
      .rejects.toThrow('same tenant');
    expect(accessRepo.insert).not.toHaveBeenCalled();
    expect(targetRepo.insert).not.toHaveBeenCalled();
  });

  it('rolls back the legacy access row when target materialization fails', async () => {
    const committedAccess: Array<Record<string, unknown>> = [];
    const pendingAccess: Array<Record<string, unknown>> = [];
    const accessRepo = {
      findOne: vi.fn().mockResolvedValue(null),
      insert: vi.fn(async (row) => { pendingAccess.push(row); }),
    };
    const targetRepo = {
      findOne: vi.fn().mockResolvedValue(null),
      insert: vi.fn().mockRejectedValue(new Error('injected target persistence failure')),
    };
    const projectRepo = {
      update: vi.fn().mockResolvedValue({ affected: 1 }),
      findOne: vi.fn().mockResolvedValue({ id: 'project-1', tenantId: 'tenant-a' }),
    };
    const engineRepo = {
      update: vi.fn().mockResolvedValue({ affected: 1 }),
      findOne: vi.fn().mockResolvedValue({
        id: 'engine-1', tenantId: 'tenant-a', tenancyMode: 'dedicated', lifecycleStatus: 'active',
      }),
    };
    const getRepository = (entity: unknown) => {
      if (entity === EngineProjectAccess) return accessRepo;
      if (entity === ProjectEngineTarget) return targetRepo;
      if (entity === Project) return projectRepo;
      if (entity === Engine) return engineRepo;
      throw new Error('Unexpected repository');
    };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository,
      transaction: vi.fn(async (callback) => {
        try {
          const result = await callback({ getRepository });
          committedAccess.push(...pendingAccess);
          return result;
        } finally {
          pendingAccess.length = 0;
        }
      }),
    });

    await expect(service.grantAccess('project-1', 'engine-1', 'user-1', true, 'tenant-a'))
      .rejects.toThrow('injected target persistence failure');
    expect(committedAccess).toEqual([]);
  });

  it('does not honor a stale cross-tenant legacy row', async () => {
    const accessRepo = { findOne: vi.fn().mockResolvedValue({ id: 'access-1' }) };
    const projectRepo = { findOne: vi.fn().mockResolvedValue({ id: 'project-1', tenantId: 'tenant-a' }) };
    const engineRepo = { findOne: vi.fn().mockResolvedValue({
      id: 'engine-1', tenantId: 'tenant-b', tenancyMode: 'dedicated', lifecycleStatus: 'active',
    }) };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === EngineProjectAccess) return accessRepo;
        if (entity === Project) return projectRepo;
        if (entity === Engine) return engineRepo;
        throw new Error('Unexpected repository');
      },
    });

    await expect(service.hasProjectAccess('project-1', 'engine-1', 'tenant-a')).resolves.toBe(false);
  });

  it('filters shared-engine pending requests to the active tenant', async () => {
    const requestRepo = { find: vi.fn().mockResolvedValue([
      { id: 'request-a', projectId: 'project-a', engineId: 'engine-1', status: 'pending' },
      { id: 'request-b', projectId: 'project-b', engineId: 'engine-1', status: 'pending' },
    ]) };
    const engineRepo = { findOne: vi.fn().mockResolvedValue({
      id: 'engine-1', tenantId: null, tenancyMode: 'shared', lifecycleStatus: 'active',
    }) };
    const projectRepo = { find: vi.fn().mockResolvedValue([
      { id: 'project-a', tenantId: 'tenant-a' },
      { id: 'project-b', tenantId: 'tenant-b' },
    ]) };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === EngineAccessRequest) return requestRepo;
        if (entity === Engine) return engineRepo;
        if (entity === Project) return projectRepo;
        throw new Error('Unexpected repository');
      },
    });

    await expect(service.getPendingRequests('engine-1', 'tenant-a')).resolves.toEqual([
      expect.objectContaining({ id: 'request-a' }),
    ]);
  });

  it('rejects approve and deny when the request belongs to another route engine', async () => {
    const requestRepo = {
      update: vi.fn().mockResolvedValue({ affected: 0 }),
      findOne: vi.fn().mockResolvedValue(null),
    };
    const getRepository = (entity: unknown) => {
      if (entity === EngineAccessRequest) return requestRepo;
      throw new Error('Unexpected repository');
    };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository,
      transaction: vi.fn(async (callback) => callback({ getRepository })),
    });

    await expect(service.approveRequest('request-b', 'engine-a', 'reviewer-a', 'tenant-a'))
      .rejects.toThrow('not found');
    await expect(service.denyRequest('request-b', 'engine-a', 'reviewer-a', 'tenant-a'))
      .rejects.toThrow('not found');
    expect(requestRepo.update).toHaveBeenCalledTimes(2);
  });

  it('does not let one shared-engine tenant approve or deny another tenant request', async () => {
    const requestRepo = {
      update: vi.fn().mockResolvedValue({ affected: 1 }),
      findOne: vi.fn().mockResolvedValue({
        id: 'request-b', projectId: 'project-b', engineId: 'engine-shared', status: 'pending',
      }),
    };
    const projectRepo = {
      update: vi.fn().mockResolvedValue({ affected: 0 }),
      findOne: vi.fn().mockResolvedValue({ id: 'project-b', tenantId: 'tenant-b' }),
    };
    const getRepository = (entity: unknown) => {
      if (entity === EngineAccessRequest) return requestRepo;
      if (entity === Project) return projectRepo;
      throw new Error('Unexpected repository');
    };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository,
      transaction: vi.fn(async (callback) => callback({ getRepository })),
    });

    await expect(service.approveRequest('request-b', 'engine-shared', 'reviewer-a', 'tenant-a'))
      .rejects.toThrow('same tenant');
    await expect(service.denyRequest('request-b', 'engine-shared', 'reviewer-a', 'tenant-a'))
      .rejects.toThrow('same tenant');
    expect(requestRepo.update).toHaveBeenCalledTimes(2);
  });

  it('rolls back a successful grant when the approval status transition loses its claim', async () => {
    const committedAccess: Array<Record<string, unknown>> = [];
    const pendingAccess: Array<Record<string, unknown>> = [];
    const committedTargets: Array<Record<string, unknown>> = [];
    const pendingTargets: Array<Record<string, unknown>> = [];
    const requestRepo = {
      update: vi.fn()
        .mockResolvedValueOnce({ affected: 1 })
        .mockResolvedValueOnce({ affected: 0 }),
      findOne: vi.fn().mockResolvedValue({
        id: 'request-1', projectId: 'project-1', engineId: 'engine-1', status: 'pending',
      }),
    };
    const accessRepo = {
      findOne: vi.fn().mockResolvedValue(null),
      insert: vi.fn(async (row) => { pendingAccess.push(row); }),
    };
    const targetRepo = {
      findOne: vi.fn().mockResolvedValue(null),
      insert: vi.fn(async (row) => { pendingTargets.push(row); }),
    };
    const projectRepo = {
      update: vi.fn().mockResolvedValue({ affected: 1 }),
      findOne: vi.fn().mockResolvedValue({ id: 'project-1', tenantId: 'tenant-a' }),
    };
    const engineRepo = {
      update: vi.fn().mockResolvedValue({ affected: 1 }),
      findOne: vi.fn().mockResolvedValue({
        id: 'engine-1', tenantId: 'tenant-a', tenancyMode: 'dedicated', lifecycleStatus: 'active',
      }),
    };
    const getRepository = (entity: unknown) => {
      if (entity === EngineAccessRequest) return requestRepo;
      if (entity === EngineProjectAccess) return accessRepo;
      if (entity === ProjectEngineTarget) return targetRepo;
      if (entity === Project) return projectRepo;
      if (entity === Engine) return engineRepo;
      throw new Error('Unexpected repository');
    };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository,
      transaction: vi.fn(async (callback) => {
        try {
          const result = await callback({ getRepository });
          committedAccess.push(...pendingAccess);
          committedTargets.push(...pendingTargets);
          return result;
        } finally {
          pendingAccess.length = 0;
          pendingTargets.length = 0;
        }
      }),
    });

    await expect(service.approveRequest('request-1', 'engine-1', 'reviewer-1', 'tenant-a'))
      .rejects.toThrow('changed while');
    expect(committedAccess).toEqual([]);
    expect(committedTargets).toEqual([]);
  });

  it('rejects a cross-tenant revoke before deleting the legacy row', async () => {
    const accessRepo = { delete: vi.fn() };
    const projectRepo = { update: vi.fn().mockResolvedValue({ affected: 0 }) };
    const getRepository = (entity: unknown) => {
      if (entity === EngineProjectAccess) return accessRepo;
      if (entity === Project) return projectRepo;
      throw new Error('Unexpected repository');
    };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository,
      transaction: vi.fn(async (callback) => callback({ getRepository })),
    });

    await expect(service.revokeAccess('project-b', 'engine-shared', 'tenant-a'))
      .rejects.toThrow('same tenant');
    expect(accessRepo.delete).not.toHaveBeenCalled();
  });

  it('rolls back the legacy-row delete when target archival fails', async () => {
    let committedDelete = false;
    let pendingDelete = false;
    const accessRepo = { delete: vi.fn(async () => { pendingDelete = true; }) };
    const targetRepo = {
      findOne: vi.fn().mockResolvedValue({
        id: 'target-1', tenantId: 'tenant-a', projectId: 'project-1', engineId: 'engine-1',
        source: 'legacy', sourceRef: 'engine_project_access:project-1:engine-1',
      }),
      update: vi.fn().mockRejectedValue(new Error('injected target archive failure')),
    };
    const projectRepo = {
      update: vi.fn().mockResolvedValue({ affected: 1 }),
      findOne: vi.fn().mockResolvedValue({ id: 'project-1', tenantId: 'tenant-a' }),
    };
    const engineRepo = {
      update: vi.fn().mockResolvedValue({ affected: 1 }),
      findOne: vi.fn().mockResolvedValue({
        id: 'engine-1', tenantId: 'tenant-a', tenancyMode: 'dedicated', lifecycleStatus: 'active',
      }),
    };
    const getRepository = (entity: unknown) => {
      if (entity === EngineProjectAccess) return accessRepo;
      if (entity === ProjectEngineTarget) return targetRepo;
      if (entity === Project) return projectRepo;
      if (entity === Engine) return engineRepo;
      throw new Error('Unexpected repository');
    };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository,
      transaction: vi.fn(async (callback) => {
        try {
          const result = await callback({ getRepository });
          committedDelete = pendingDelete;
          return result;
        } finally {
          pendingDelete = false;
        }
      }),
    });

    await expect(service.revokeAccess('project-1', 'engine-1', 'tenant-a'))
      .rejects.toThrow('injected target archive failure');
    expect(committedDelete).toBe(false);
  });

  it('rejects a cross-tenant project and engine before evaluating auto-approval', async () => {
    const accessRepo = { findOne: vi.fn().mockResolvedValue(null) };
    const requestRepo = { findOne: vi.fn().mockResolvedValue(null) };
    const engineRepo = { findOne: vi.fn().mockResolvedValue({ id: 'engine-1', tenantId: 'tenant-engine', tenancyMode: 'dedicated' }) };
    const projectRepo = { findOne: vi.fn().mockResolvedValue({ id: 'project-1', tenantId: 'tenant-project' }) };
    const targetRepo = { findOne: vi.fn().mockResolvedValue(null) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === EngineProjectAccess) return accessRepo;
        if (entity === EngineAccessRequest) return requestRepo;
        if (entity === Engine) return engineRepo;
        if (entity === Project) return projectRepo;
        if (entity === ProjectEngineTarget) return targetRepo;
        throw new Error('Unexpected repository');
      },
    });

    await expect(service.requestAccess('project-1', 'engine-1', 'user-1')).rejects.toThrow('same tenant');
    expect(permissionService.hasPermission).not.toHaveBeenCalled();
  });

  it('rejects a null-owned dedicated migration engine before honoring legacy access rows', async () => {
    const accessRepo = { findOne: vi.fn().mockResolvedValue({ id: 'access-1' }) };
    const requestRepo = { findOne: vi.fn() };
    const engineRepo = {
      findOne: vi.fn().mockResolvedValue({
        id: 'engine-migration',
        tenantId: null,
        tenancyMode: 'dedicated',
      }),
    };
    const projectRepo = { findOne: vi.fn().mockResolvedValue({ id: 'project-1', tenantId: 'tenant-a' }) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === EngineProjectAccess) return accessRepo;
        if (entity === EngineAccessRequest) return requestRepo;
        if (entity === Engine) return engineRepo;
        if (entity === Project) return projectRepo;
        throw new Error('Unexpected repository');
      },
    });

    await expect(service.requestAccess('project-1', 'engine-migration', 'user-1')).rejects.toThrow('same tenant');
    expect(accessRepo.findOne).not.toHaveBeenCalled();
    expect(requestRepo.findOne).not.toHaveBeenCalled();
    expect(permissionService.hasPermission).not.toHaveBeenCalled();
  });
});

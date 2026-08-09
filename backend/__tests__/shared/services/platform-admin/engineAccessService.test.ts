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
    const accessRepo = { insert: vi.fn(async (row) => { pendingAccess.push(row); }) };
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

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Project } from '@enterpriseglue/shared/db/entities/Project.js';
import { File } from '@enterpriseglue/shared/db/entities/File.js';
import { Folder } from '@enterpriseglue/shared/db/entities/Folder.js';
import { GitRepository } from '@enterpriseglue/shared/db/entities/GitRepository.js';
import { GitProvider } from '@enterpriseglue/shared/db/entities/GitProvider.js';
import { ProjectMember } from '@enterpriseglue/shared/db/entities/ProjectMember.js';
import { ProjectMemberRole } from '@enterpriseglue/shared/db/entities/ProjectMemberRole.js';
import { User } from '@enterpriseglue/shared/db/entities/User.js';
import { Invitation } from '@enterpriseglue/shared/db/entities/Invitation.js';
import { Engine } from '@enterpriseglue/shared/db/entities/Engine.js';
import { EngineHealth } from '@enterpriseglue/shared/db/entities/EngineHealth.js';
import { EngineProjectAccess } from '@enterpriseglue/shared/db/entities/EngineProjectAccess.js';
import { EngineAccessRequest } from '@enterpriseglue/shared/db/entities/EngineAccessRequest.js';
import { EnvironmentTag } from '@enterpriseglue/shared/db/entities/EnvironmentTag.js';
import { RbacRoleAssignment } from '@enterpriseglue/shared/db/entities/RbacRoleAssignment.js';
import { projectQueryService } from '@enterpriseglue/shared/services/starbase/ProjectQueryService.js';
import { applyPreparedEngineImportToProject } from '@enterpriseglue/shared/services/starbase/engine-import-service.js';
import { generateId, unixTimestamp } from '@enterpriseglue/shared/utils/id.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/starbase/engine-import-service.js', () => ({
  applyPreparedEngineImportToProject: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/utils/id.js', () => ({
  generateId: vi.fn(),
  unixTimestamp: vi.fn(),
}));

describe('ProjectQueryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.CAMUNDA_BASE_URL;
    delete process.env.ENGINE_BASE_URL;
  });

  it('lists user projects with deduped membership and filtered pending invite members', async () => {
    const memberProjectBuilder = {
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      getRawMany: vi.fn().mockResolvedValue([
        { p_id: 'proj-2', p_name: 'Member Project', p_ownerId: 'owner-2', p_createdAt: '200' },
        { p_id: 'proj-1', p_name: 'Owner Project', p_owner_id: 'user-1', p_created_at: '100' },
      ]),
    };
    const fileCountBuilder = {
      select: vi.fn().mockReturnThis(),
      addSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockReturnThis(),
      getRawMany: vi.fn().mockResolvedValue([
        { projectId: 'proj-1', count: '3' },
        { projectId: 'proj-2', count: '4' },
      ]),
    };
    const folderCountBuilder = {
      select: vi.fn().mockReturnThis(),
      addSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockReturnThis(),
      getRawMany: vi.fn().mockResolvedValue([
        { projectId: 'proj-1', count: '1' },
        { projectId: 'proj-2', count: '2' },
      ]),
    };

    const projectRepo = {
      find: vi.fn().mockResolvedValue([
        { id: 'proj-1', name: 'Owner Project', ownerId: 'user-1', createdAt: 100 },
      ]),
      createQueryBuilder: vi.fn().mockReturnValue(memberProjectBuilder),
    };
    const fileRepo = {
      createQueryBuilder: vi.fn().mockReturnValue(fileCountBuilder),
    };
    const folderRepo = {
      createQueryBuilder: vi.fn().mockReturnValue(folderCountBuilder),
    };
    const gitRepositoryRepo = {
      find: vi.fn().mockResolvedValue([
        { projectId: 'proj-2', remoteUrl: 'https://example.com/repo.git', providerId: 'prov-1' },
      ]),
    };
    const gitProviderRepo = {
      find: vi.fn().mockResolvedValue([
        { id: 'prov-1', type: 'github' },
      ]),
    };
    const projectMemberRepo = {
      find: vi.fn().mockResolvedValue([
        { projectId: 'proj-1', userId: 'member-1', role: 'viewer' },
        { projectId: 'proj-2', userId: 'member-2', role: 'editor' },
      ]),
    };
    const invitationRepo = {
      find: vi.fn().mockResolvedValue([
        { resourceId: 'proj-2', userId: 'member-2' },
      ]),
    };
    const userRepo = {
      find: vi.fn().mockResolvedValue([
        { id: 'member-1', firstName: 'Mia', lastName: 'Viewer' },
        { id: 'member-2', firstName: 'Evan', lastName: 'Editor' },
      ]),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Project) return projectRepo;
        if (entity === File) return fileRepo;
        if (entity === Folder) return folderRepo;
        if (entity === GitRepository) return gitRepositoryRepo;
        if (entity === GitProvider) return gitProviderRepo;
        if (entity === ProjectMember) return projectMemberRepo;
        if (entity === User) return userRepo;
        if (entity === Invitation) return invitationRepo;
        throw new Error('Unexpected repository');
      },
    });

    const result = await projectQueryService.listForUser('user-1');

    expect(result).toEqual([
      {
        id: 'proj-1',
        name: 'Owner Project',
        createdAt: 100,
        foldersCount: 1,
        filesCount: 3,
        gitUrl: null,
        gitProviderType: null,
        gitSyncStatus: null,
        members: [
          {
            userId: 'member-1',
            firstName: 'Mia',
            lastName: 'Viewer',
            role: 'viewer',
          },
        ],
      },
      {
        id: 'proj-2',
        name: 'Member Project',
        createdAt: 200,
        foldersCount: 2,
        filesCount: 4,
        gitUrl: 'https://example.com/repo.git',
        gitProviderType: 'github',
        gitSyncStatus: null,
        members: [],
      },
    ]);
  });

  it('creates a project, owner membership, owner role, and applies prepared import', async () => {
    const projectInsert = vi.fn().mockResolvedValue(undefined);
    const memberExecute = vi.fn().mockResolvedValue(undefined);
    const roleExecute = vi.fn().mockResolvedValue(undefined);
    const memberBuilder = {
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      orIgnore: vi.fn().mockReturnThis(),
      execute: memberExecute,
    };
    const roleBuilder = {
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      orIgnore: vi.fn().mockReturnThis(),
      execute: roleExecute,
    };
    const assignmentUpsert = vi.fn().mockResolvedValue(undefined);
    const manager = {
      getRepository: (entity: unknown) => {
        if (entity === Project) return { insert: projectInsert };
        if (entity === ProjectMember) return { createQueryBuilder: vi.fn().mockReturnValue(memberBuilder) };
        if (entity === ProjectMemberRole) return { createQueryBuilder: vi.fn().mockReturnValue(roleBuilder) };
        if (entity === RbacRoleAssignment) return { upsert: assignmentUpsert };
        throw new Error('Unexpected manager repository');
      },
    };

    (generateId as unknown as Mock)
      .mockReturnValueOnce('project-1')
      .mockReturnValueOnce('member-link-1');
    (unixTimestamp as unknown as Mock).mockReturnValue(123456);
    (getDataSource as unknown as Mock).mockResolvedValue({
      transaction: async (callback: (managerArg: any) => Promise<void>) => callback(manager),
    });

    const preparedImport = { engineId: 'engine-1', files: [], counts: { bpmn: 0, dmn: 0 } } as any;
    const result = await projectQueryService.createProject({
      name: 'Project One',
      ownerId: 'user-1',
      preparedImport,
    });

    expect(projectInsert).toHaveBeenCalledWith({
      id: 'project-1',
      name: 'Project One',
      ownerId: 'user-1',
      createdAt: 123456,
      updatedAt: 123456,
    });
    expect(memberBuilder.values).toHaveBeenCalledWith({
      id: 'member-link-1',
      projectId: 'project-1',
      userId: 'user-1',
      role: 'owner',
      invitedById: null,
      joinedAt: 123456,
      createdAt: 123456,
      updatedAt: 123456,
    });
    expect(roleBuilder.values).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'user-1',
      role: 'owner',
      createdAt: 123456,
    });
    expect(assignmentUpsert).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({
        id: 'legacy:project:project-1:user-1:system.project.owner',
        source: 'legacy',
        sourceRef: 'project_member_role:project-1:user-1:owner',
      }),
    ]), expect.objectContaining({ conflictPaths: ['id'] }));
    expect(applyPreparedEngineImportToProject).toHaveBeenCalledWith({
      manager,
      projectId: 'project-1',
      userId: 'user-1',
      importData: preparedImport,
    });
    expect(result).toEqual({
      id: 'project-1',
      name: 'Project One',
      ownerId: 'user-1',
      createdAt: 123456,
      updatedAt: 123456,
    });
  });

  it('builds engine access overview including legacy env engine, pending requests, and available engines', async () => {
    process.env.CAMUNDA_BASE_URL = 'https://legacy-engine';

    const engineProjectAccessRepo = {
      find: vi.fn().mockResolvedValue([
        { engineId: '__env__', createdAt: 100 },
        { engineId: 'engine-1', createdAt: 200 },
      ]),
    };
    const engineRepo = {
      find: vi.fn()
        .mockResolvedValueOnce([
          { id: 'engine-1', name: 'Engine One', baseUrl: 'https://engine-1', environmentTagId: 'env-1' },
        ])
        .mockResolvedValueOnce([
          { id: 'engine-2', name: null, baseUrl: 'https://engine-2' },
        ])
        .mockResolvedValueOnce([
          { id: 'engine-1', name: 'Engine One', baseUrl: 'https://engine-1' },
          { id: 'engine-2', name: null, baseUrl: 'https://engine-2' },
          { id: 'engine-3', name: 'Engine Three', baseUrl: 'https://engine-3' },
        ]),
    };
    const envTagRepo = {
      find: vi.fn().mockResolvedValue([
        { id: 'env-1', name: 'Prod', color: 'red', manualDeployAllowed: false },
      ]),
    };
    const engineHealthRepo = {
      find: vi.fn().mockResolvedValue([
        { engineId: 'engine-1', status: 'healthy', latencyMs: 42, checkedAt: 500 },
      ]),
    };
    const engineAccessRequestRepo = {
      find: vi.fn().mockResolvedValue([
        { id: 'request-1', engineId: 'engine-2', createdAt: 300 },
      ]),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === EngineProjectAccess) return engineProjectAccessRepo;
        if (entity === Engine) return engineRepo;
        if (entity === EnvironmentTag) return envTagRepo;
        if (entity === EngineHealth) return engineHealthRepo;
        if (entity === EngineAccessRequest) return engineAccessRequestRepo;
        throw new Error('Unexpected repository');
      },
    });

    const result = await projectQueryService.getEngineAccessOverview('project-1');

    expect(result).toEqual({
      accessedEngines: [
        {
          engineId: '__env__',
          engineName: 'Environment Engine (Legacy)',
          baseUrl: 'https://legacy-engine',
          environment: null,
          health: null,
          grantedAt: 100,
          isLegacy: true,
        },
        {
          engineId: 'engine-1',
          engineName: 'Engine One',
          baseUrl: 'https://engine-1',
          environment: { name: 'Prod', color: 'red' },
          manualDeployAllowed: false,
          health: { status: 'healthy', latencyMs: 42 },
          grantedAt: 200,
        },
      ],
      pendingRequests: [
        {
          requestId: 'request-1',
          engineId: 'engine-2',
          engineName: 'https://engine-2',
          requestedAt: 300,
        },
      ],
      availableEngines: [
        { id: 'engine-3', name: 'Engine Three' },
      ],
    });
  });
});

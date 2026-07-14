import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import decisionsRouter from '../../../../../packages/backend-host/src/modules/mission-control/decisions/routes.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { EngineDeploymentArtifact } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineDeploymentArtifact.js';
import { EngineDeployment } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineDeployment.js';
import { File } from '@enterpriseglue/shared/infrastructure/persistence/entities/File.js';
import { FileCommitVersion } from '@enterpriseglue/shared/infrastructure/persistence/entities/FileCommitVersion.js';
import { projectMemberService } from '@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import {
  listDecisionDefinitions,
  evaluateDecisionById,
} from '../../../../../packages/backend-host/src/modules/mission-control/decisions/service.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: req.get('x-test-user') || 'user-1' };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js', () => ({
  projectMemberService: {
    hasAccess: vi.fn().mockResolvedValue(true),
    hasRole: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js', () => ({
  EnginePermissions: {
    INSTANCE_VIEW: 'engine:instance:view',
    DEPLOY_VIEW: 'engine:deploy:view',
    PROJECT_ACCESS_APPROVE: 'engine:project-access:approve',
    MEMBERS_MANAGE: 'engine:members:manage',
  },
  PlatformPermissions: {
    USER_MANAGE: 'platform:user:manage',
    USERS_CREATE: 'platform:users:create',
  },
  ProjectPermissions: {
    FILES_VIEW: 'project:files:view',
    FILES_EDIT: 'project:files:edit',
    MEMBERS_MANAGE: 'project:members:manage',
  },
  SYSTEM_ROLE_IDS: {
    ENGINE_OWNER: 'system.engine.owner',
    ENGINE_DELEGATE: 'system.engine.delegate',
    ENGINE_OPERATOR: 'system.engine.operator',
    ENGINE_DEPLOYER: 'system.engine.deployer',
  },
  ENGINE_SYSTEM_ROLE_TO_LEGACY_ROLE: {
    'system.engine.owner': 'owner',
    'system.engine.delegate': 'delegate',
    'system.engine.operator': 'operator',
    'system.engine.deployer': 'deployer',
  },
  permissionService: {
    hasPermission: vi.fn().mockResolvedValue(false),
    getVisibleRuntimeResources: vi.fn().mockResolvedValue([]),
    getKnownProjectIdsForUser: vi.fn().mockResolvedValue([]),
    getKnownEngineIdsForUser: vi.fn().mockResolvedValue([]),
    syncLegacyRoleAssignments: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../../../packages/backend-host/src/modules/mission-control/decisions/service.js', () => ({
  listDecisionDefinitions: vi.fn().mockResolvedValue([]),
  fetchDecisionDefinition: vi.fn().mockResolvedValue({ id: 'd1', key: 'decision1' }),
  fetchDecisionDefinitionXml: vi.fn().mockResolvedValue({ id: 'd1', dmnXml: '<definitions />' }),
  evaluateDecisionById: vi.fn().mockResolvedValue([{ result: 'approved' }]),
  evaluateDecisionByKey: vi.fn().mockResolvedValue([{ result: 'approved' }]),
}));

describe('mission-control decisions routes', () => {
  let app: express.Application;
  let artifactFind: ReturnType<typeof vi.fn>;
  let fileFind: ReturnType<typeof vi.fn>;
  let fileVersionFindOne: ReturnType<typeof vi.fn>;
  let fileVersionQbGetRawOne: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(decisionsRouter);
    vi.clearAllMocks();

    artifactFind = vi.fn().mockResolvedValue([]);
    fileFind = vi.fn().mockResolvedValue([]);
    fileVersionFindOne = vi.fn().mockResolvedValue(null);
    fileVersionQbGetRawOne = vi.fn().mockResolvedValue(null);

    const fileVersionRepo = {
      findOne: fileVersionFindOne,
      createQueryBuilder: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        getRawOne: fileVersionQbGetRawOne,
      }),
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
        if (entity === EngineDeploymentArtifact) {
          return { find: artifactFind };
        }
        if (entity === EngineDeployment) {
          return { findOne: vi.fn().mockResolvedValue({ deployedAt: null, lineageQuality: 'complete' }) };
        }
        if (entity === File) {
          return { find: fileFind };
        }
        if (entity === FileCommitVersion) {
          return fileVersionRepo;
        }
        return { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue(null) };
      },
    });

    (projectMemberService.hasAccess as unknown as Mock).mockResolvedValue(true);
    (projectMemberService.hasRole as unknown as Mock).mockResolvedValue(true);
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) =>
      permission.startsWith('engine:')
    );
  });

  it('lists decision definitions', async () => {
    const response = await request(app)
      .get('/mission-control-api/decision-definitions')
      .query({ engineId: 'engine-1' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:instance:view', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
    expect(listDecisionDefinitions).toHaveBeenCalledWith('engine-1', {});
  });

  it('evaluates decision', async () => {
    const response = await request(app)
      .post('/mission-control-api/decision-definitions/d1/evaluate')
      .send({ engineId: 'engine-1', variables: { amount: { value: 10, type: 'Integer' } } });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ result: 'approved' }]);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:instance:view', expect.objectContaining({
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
    expect(evaluateDecisionById).toHaveBeenCalledWith('engine-1', 'd1', {
      variables: { amount: { value: 10, type: 'Integer' } },
    });
  });

  it('denies decision definition reads when instance view permission is missing', async () => {
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);

    const response = await request(app)
      .get('/mission-control-api/decision-definitions')
      .query({ engineId: 'engine-1' });

    expect(response.status).toBe(403);
    expect(listDecisionDefinitions).not.toHaveBeenCalled();
  });

  it('returns only authorized decision definition keys for a resource-aware engine', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) {
          return {
            findOne: vi.fn().mockResolvedValue({
              id: 'engine-1',
              tenantId: null,
              runtimeAccessScope: 'resource_aware',
            }),
          };
        }
        return { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue(null) };
      },
    });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    (permissionService.getVisibleRuntimeResources as unknown as Mock).mockResolvedValue([
      { resourceKey: 'credit-decision' },
    ]);
    (listDecisionDefinitions as unknown as Mock).mockResolvedValue([
      { id: 'credit:1', key: 'credit-decision' },
      { id: 'fraud:1', key: 'fraud-decision' },
    ]);

    const response = await request(app)
      .get('/mission-control-api/decision-definitions')
      .query({ engineId: 'engine-1' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      { id: 'credit:1', key: 'credit-decision' },
    ]);
    expect(permissionService.getVisibleRuntimeResources).toHaveBeenCalledWith(expect.objectContaining({
      engineId: 'engine-1',
      resourceKind: 'decision_definition',
      permission: 'engine:instance:view',
    }));
  });

  it('returns disjoint decision-definition subsets to users sharing a resource-aware central engine', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) return { findOne: vi.fn().mockResolvedValue({ id: 'central-engine', tenantId: null, runtimeAccessScope: 'resource_aware' }) };
        return { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue(null) };
      },
    });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    (permissionService.getVisibleRuntimeResources as unknown as Mock).mockImplementation(async ({ userId }: { userId: string }) => (
      userId === 'payments-user'
        ? [{ resourceKey: 'payments-risk' }]
        : [{ resourceKey: 'hr-eligibility' }]
    ));
    (listDecisionDefinitions as unknown as Mock).mockResolvedValue([
      { id: 'payments:1', key: 'payments-risk' },
      { id: 'hr:1', key: 'hr-eligibility' },
    ]);

    const [paymentsResponse, hrResponse] = await Promise.all([
      request(app).get('/mission-control-api/decision-definitions').set('x-test-user', 'payments-user').query({ engineId: 'central-engine' }),
      request(app).get('/mission-control-api/decision-definitions').set('x-test-user', 'hr-user').query({ engineId: 'central-engine' }),
    ]);

    expect(paymentsResponse.status).toBe(200);
    expect(paymentsResponse.body).toEqual([{ id: 'payments:1', key: 'payments-risk' }]);
    expect(hrResponse.status).toBe(200);
    expect(hrResponse.body).toEqual([{ id: 'hr:1', key: 'hr-eligibility' }]);
    expect(permissionService.getVisibleRuntimeResources).toHaveBeenCalledWith(expect.objectContaining({
      engineId: 'central-engine', resourceKind: 'decision_definition', permission: 'engine:instance:view', userId: 'payments-user',
    }));
    expect(permissionService.getVisibleRuntimeResources).toHaveBeenCalledWith(expect.objectContaining({
      engineId: 'central-engine', resourceKind: 'decision_definition', permission: 'engine:instance:view', userId: 'hr-user',
    }));
    expect(listDecisionDefinitions).toHaveBeenCalledWith('central-engine', expect.objectContaining({ maxResults: 100 }));
  });

  it('rejects oversized decision-definition collection requests for resource-aware engines', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => entity === Engine
        ? { findOne: vi.fn().mockResolvedValue({ id: 'central-engine', tenantId: null, runtimeAccessScope: 'resource_aware' }) }
        : { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue(null) },
    });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    (permissionService.getVisibleRuntimeResources as unknown as Mock).mockResolvedValue([{ resourceKey: 'credit-decision' }]);

    const response = await request(app)
      .get('/mission-control-api/decision-definitions')
      .query({ engineId: 'central-engine', maxResults: 101 });

    expect(response.status).toBe(403);
    expect(listDecisionDefinitions).not.toHaveBeenCalled();
  });

  it('does not infer a Starbase edit target from a matching decision key without deployment lineage', async () => {
    fileFind.mockResolvedValueOnce([{ id: 'file-key-match', projectId: 'project-1' }]);

    const response = await request(app)
      .get('/mission-control-api/decision-definitions/edit-target')
      .query({ engineId: 'engine-1', key: 'risk', version: 2 });

    expect(response.status).toBe(404);
    expect(fileFind).not.toHaveBeenCalled();
  });

  it('resolves edit-target through scoped project file permissions without legacy project membership', async () => {
    artifactFind.mockResolvedValueOnce([
      {
        projectId: 'project-scoped',
        fileId: 'file-scoped',
        fileGitCommitId: 'commit-scoped',
        engineDeploymentId: 'dep-scoped',
        createdAt: 1700000000000,
      },
    ]);
    (projectMemberService.hasAccess as unknown as Mock).mockResolvedValue(false);
    (projectMemberService.hasRole as unknown as Mock).mockResolvedValue(false);
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) =>
      permission === 'engine:instance:view' || permission === 'project:files:view' || permission === 'project:files:edit'
    );
    fileVersionFindOne.mockResolvedValueOnce({ versionNumber: 5 });

    const response = await request(app)
      .get('/mission-control-api/decision-definitions/edit-target')
      .query({ engineId: 'engine-1', key: 'risk', version: 2, decisionDefinitionId: 'risk:2:abc123' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      canShowEditButton: true,
      canEdit: true,
      projectId: 'project-scoped',
      fileId: 'file-scoped',
      fileVersionNumber: 5,
      mappingSource: 'git-commit',
    });
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:files:view', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'project',
      resourceId: 'project-scoped',
    }));
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:files:edit', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'project',
      resourceId: 'project-scoped',
    }));
  });
});

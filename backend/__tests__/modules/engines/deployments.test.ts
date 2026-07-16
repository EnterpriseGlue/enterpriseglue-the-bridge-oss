import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import { apiClientService } from '@enterpriseglue/shared/services/platform-admin/ApiClientService.js';
import { serviceAccountService } from '@enterpriseglue/shared/services/platform-admin/ServiceAccountService.js';
import { deploymentEligibilityService } from '@enterpriseglue/shared/services/platform-admin/DeploymentEligibilityService.js';
import { getAuthzActionDefinition } from '@enterpriseglue/shared/authz/permission-actions.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1' };
    req.tenant = { tenantId: null };
    next();
  },
}));

vi.mock('undici', () => ({
  fetch: vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: () => Promise.resolve('[]'),
  }),
  FormData: class {
    append() {}
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js', () => ({
  EnginePermissions: {
    DEPLOY: 'engine:deploy',
    DEPLOY_VIEW: 'engine:deploy:view',
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
    syncLegacyRoleAssignments: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/ApiClientService.js', () => ({
  ApiClientScopes: {
    ENGINE_REGISTER: 'engine:register',
    DEPLOYMENT_EXECUTE: 'deployment:execute',
  },
  apiClientService: {
    authenticateToken: vi.fn(),
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/ServiceAccountService.js', () => ({
  SERVICE_ACCOUNT_TOKEN_PREFIX: 'egsa',
  ServiceAccountScopes: {
    DEPLOYMENT_EXECUTE: 'deployment:execute',
  },
  serviceAccountService: {
    authenticateToken: vi.fn(),
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/DeploymentEligibilityService.js', () => ({
  deploymentEligibilityService: {
    evaluate: vi.fn(),
  },
}));

describe('engines deployments routes', () => {
  let app: express.Application;
  let engineDeploymentInserts: any[];
  let artifactInserts: any[];
  let deploymentArtifactRows: any[];
  let deploymentHistoryRows: any[];
  let mockEngine: any;

  beforeEach(async () => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    const { default: deploymentsRouter } = await import('../../../../packages/backend-host/src/modules/engines/routes/deployments.js');
    app.use(deploymentsRouter);
    vi.clearAllMocks();
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    (apiClientService.authenticateToken as unknown as Mock).mockResolvedValue({
      id: 'api-client-1',
      name: 'Deployment automation',
      tokenPrefix: 'egac_api-cli',
      scopes: ['deployment:execute'],
      isActive: true,
      createdById: 'admin-1',
      lastUsedAt: null,
      revokedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      authenticatedAt: Date.now(),
    });
    (serviceAccountService.authenticateToken as unknown as Mock).mockResolvedValue({
      id: 'service-account-1',
      name: 'Release service',
      tokenPrefix: 'egsa_service',
      scopes: ['deployment:execute'],
      description: 'Release automation',
      isActive: true,
      createdById: 'admin-1',
      lastUsedAt: null,
      revokedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      authenticatedAt: Date.now(),
    });
    (deploymentEligibilityService.evaluate as unknown as Mock).mockResolvedValue({
      allowed: true,
      decision: 'allow',
      mode: 'api',
      projectId: 'project-1',
      engineId: 'e1',
      checks: [],
      reasons: [],
    });
    engineDeploymentInserts = [];
    artifactInserts = [];
    deploymentArtifactRows = [];
    deploymentHistoryRows = [];

    mockEngine = {
      id: 'e1',
      baseUrl: 'http://localhost:8080',
      name: 'Test Engine',
      username: null,
      passwordEnc: null,
    };
    const mockFile = {
      id: 'file-1',
      projectId: 'project-1',
      folderId: null,
      name: 'process.bpmn',
      type: 'bpmn',
      xml: '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn"></bpmn:definitions>',
      updatedAt: 123,
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: any) => {
        const entityName = entity?.name || '';
        if (entityName === 'Engine') {
          return {
            find: vi.fn().mockResolvedValue([mockEngine]),
            findOne: vi.fn().mockResolvedValue(mockEngine),
            findOneBy: vi.fn().mockResolvedValue(mockEngine),
          };
        }
        if (entityName === 'File') {
          return {
            find: vi.fn().mockResolvedValue([mockFile]),
            findOne: vi.fn().mockResolvedValue(mockFile),
          };
        }
        if (entityName === 'Folder') {
          return {
            find: vi.fn().mockResolvedValue([]),
            findOne: vi.fn().mockResolvedValue(null),
          };
        }
        if (entityName === 'GitDeployment') {
          return {
            findOne: vi.fn().mockResolvedValue(null),
          };
        }
        if (entityName === 'EngineDeployment') {
          return {
            find: vi.fn().mockImplementation(() => Promise.resolve(deploymentHistoryRows)),
            findOne: vi.fn().mockImplementation(() => Promise.resolve(deploymentHistoryRows[0] || null)),
            insert: vi.fn().mockImplementation((row) => {
              engineDeploymentInserts.push(row);
              return Promise.resolve({});
            }),
            update: vi.fn().mockResolvedValue({}),
          };
        }
        if (entityName === 'EngineDeploymentArtifact') {
          return {
            find: vi.fn().mockImplementation(() => Promise.resolve(deploymentArtifactRows)),
            insert: vi.fn().mockImplementation((rows) => {
              artifactInserts.push(...rows);
              return Promise.resolve({});
            }),
          };
        }
        return {
          find: vi.fn().mockResolvedValue([]),
          findOne: vi.fn().mockResolvedValue(null),
          insert: vi.fn().mockResolvedValue({}),
        };
      },
    });
  });

  it('registers engine.deployment-receipts.create as a high-risk audited action', () => {
    expect(getAuthzActionDefinition('engine.deployment-receipts.create')).toMatchObject({
      permissionId: 'engine:deploy', risk: 'high', audit: true,
    });
  });

  it('lists deployments for an engine through action metadata permission', async () => {
    // TODO: Convert to E2E test with Prism mock server (see local-docs/ING/api-specs)
    const { fetch } = await import('undici');
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) =>
      permission === 'engine:deploy:view'
    );
    (fetch as any).mockResolvedValueOnce({
      status: 200,
      ok: true,
      text: () => Promise.resolve(JSON.stringify([])),
    });

    const response = await request(app).get('/engines-api/engines/e1/deployments');
    expect(response.status).toBe(200);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:deploy:view', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'engine',
      resourceId: 'e1',
    }));
  });

  it('does not call an engine-native deployment passthrough when deploy-view is denied', async () => {
    const { fetch } = await import('undici');
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);

    const response = await request(app).get('/engines-api/engines/e1/deployments');

    expect(response.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('lists sanitized external deployment receipts through deployment-read permission', async () => {
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) =>
      permission === 'engine:deploy:view'
    );

    const response = await request(app).get('/engines-api/engines/e1/deployment-receipts');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:deploy:view', expect.objectContaining({
      userId: 'user-1', resourceType: 'engine', resourceId: 'e1',
    }));
  });

  it('lists sanitized canonical deployment history through deployment-read permission', async () => {
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) => permission === 'engine:deploy:view');
    deploymentHistoryRows = [{
      id: 'history-1', engineId: 'e1', camundaDeploymentId: 'camunda-1', camundaDeploymentName: 'Payments release', camundaDeploymentTime: null,
      projectId: null, ingestionSource: 'engine_discovery', lineageQuality: 'discovered', reportingPrincipalId: null,
      deployedAt: 1700000000000, reconciledAt: 1700000001000, resourceCount: 2, status: 'success', rawResponse: '{"secret":"must-not-leak"}', lineageJson: '{"internal":"must-not-leak"}',
    }];

    const response = await request(app).get('/engines-api/engines/e1/deployment-history');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([expect.objectContaining({
      id: 'history-1', engineDeploymentId: 'camunda-1', lineageQuality: 'discovered', lineageReadiness: 'inventory_only',
      lineageIssues: ['missing_project_lineage', 'no_artifacts_recorded'], artifactCount: 0, linkedArtifactCount: 0, resourceCount: 2,
    })]);
    expect(response.body[0]).not.toHaveProperty('rawResponse');
    expect(response.body[0]).not.toHaveProperty('lineageJson');
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:deploy:view', expect.objectContaining({
      userId: 'user-1', resourceType: 'engine', resourceId: 'e1',
    }));
  });

  it('reports bridge-ready diagnostics only for complete linked lineage', async () => {
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) => permission === 'engine:deploy:view');
    deploymentHistoryRows = [{
      id: 'history-1', engineId: 'e1', camundaDeploymentId: 'camunda-1', camundaDeploymentName: 'Payments release', camundaDeploymentTime: null,
      projectId: 'project-1', ingestionSource: 'enterpriseglue_proxy', lineageQuality: 'complete', reportingPrincipalId: null,
      deployedAt: 1700000000000, reconciledAt: 1700000001000, resourceCount: 1, status: 'success',
    }];
    deploymentArtifactRows = [{ engineDeploymentId: 'history-1', projectId: 'project-1', fileId: 'file-1', fileGitCommitId: 'commit-1', fileUpdatedAt: 1700000000000 }];

    const response = await request(app).get('/engines-api/engines/e1/deployment-history');

    expect(response.status).toBe(200);
    expect(response.body[0]).toMatchObject({ lineageReadiness: 'bridge_ready', lineageIssues: [], artifactCount: 1, linkedArtifactCount: 1, versionedArtifactCount: 1 });
  });

  it('returns a sanitized canonical lineage view for one deployment', async () => {
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) => permission === 'engine:deploy:view');
    deploymentHistoryRows = [{
      id: 'history-1', engineId: 'e1', camundaDeploymentId: 'camunda-1', projectId: 'project-1',
      ingestionSource: 'pipeline_receipt', lineageQuality: 'reported', reportingPrincipalId: 'service-account-1',
      deployedAt: 1700000000000, reconciledAt: 1700000001000, resourceCount: 1, status: 'success',
      rawResponse: '{"secret":"must-not-leak"}', lineageJson: '{"internal":"must-not-leak"}',
    }];
    deploymentArtifactRows = [{
      id: 'artifact-1', engineDeploymentId: 'history-1', artifactKind: 'process', artifactId: 'payments:3', artifactKey: 'payments', artifactVersion: 3,
      tenantId: 'tenant-a', projectId: 'project-1', fileId: 'file-1', fileContentHash: 'must-not-leak', fileGitCommitMessage: 'must-not-leak',
    }];

    const response = await request(app).get('/engines-api/engines/e1/deployments/camunda-1/lineage');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: 'history-1', engineDeploymentId: 'camunda-1', ingestionSource: 'pipeline_receipt', lineageQuality: 'reported',
      reconciliationStatus: 'reconciled', lineageReadiness: 'version_resolution_required',
      artifacts: [{ artifactKind: 'process', runtimeResourceId: 'payments:3', runtimeResourceKey: 'payments', runtimeResourceVersion: 3, runtimeTenantId: 'tenant-a', projectId: 'project-1', fileId: 'file-1' }],
    });
    expect(response.body).not.toHaveProperty('rawResponse');
    expect(response.body).not.toHaveProperty('lineageJson');
    expect(response.body.artifacts[0]).not.toHaveProperty('fileContentHash');
    expect(response.body.artifacts[0]).not.toHaveProperty('fileGitCommitMessage');
  });

  it('does not fall through to the raw engine deployment endpoint when canonical lineage is absent', async () => {
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) => permission === 'engine:deploy:view');

    const response = await request(app).get('/engines-api/engines/e1/deployments/missing/lineage');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: 'Deployment lineage not found' });
  });

  it('gets deployment by id through action metadata permission', async () => {
    // TODO: Convert to E2E test with Prism mock server (see local-docs/ING/api-specs)
    const { fetch } = await import('undici');
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) =>
      permission === 'engine:deploy:view'
    );
    (fetch as any).mockResolvedValueOnce({
      status: 200,
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        id: 'd1',
        name: 'invoice-deployment',
        deploymentTime: '2026-01-20T02:00:00.000+0000',
        source: 'process application',
        tenantId: null
      })),
    });

    const response = await request(app).get('/engines-api/engines/e1/deployments/d1');
    expect(response.status).toBe(200);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:deploy:view', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'engine',
      resourceId: 'e1',
    }));
  });

  it('does not call an engine-native deployment detail passthrough when deploy-view is denied', async () => {
    const { fetch } = await import('undici');
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);

    const response = await request(app).get('/engines-api/engines/e1/deployments/d1');

    expect(response.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('lists deployments through scoped deploy-view permission without legacy engine access', async () => {
    const { fetch } = await import('undici');
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) =>
      permission === 'engine:deploy:view'
    );
    (fetch as any).mockResolvedValueOnce({
      status: 200,
      ok: true,
      text: () => Promise.resolve(JSON.stringify([])),
    });

    const response = await request(app).get('/engines-api/engines/e1/deployments');

    expect(response.status).toBe(200);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:deploy:view', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'engine',
      resourceId: 'e1',
    }));
  });

  it('deletes deployments through scoped deploy permission without legacy engine access', async () => {
    const { fetch } = await import('undici');
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) =>
      permission === 'engine:deploy'
    );
    (fetch as any).mockResolvedValueOnce({
      status: 204,
      ok: true,
      text: () => Promise.resolve(''),
    });

    const response = await request(app)
      .delete('/engines-api/engines/e1/deployments/d1')
      .query({ cascade: 'true' });

    expect(response.status).toBe(204);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:deploy', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'engine',
      resourceId: 'e1',
    }));
  });

  it('previews manual deployments through composite deployment eligibility', async () => {
    const response = await request(app)
      .post('/engines-api/engines/e1/deployments/preview')
      .send({
        resources: { projectId: 'project-1' },
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      count: 1,
      resources: ['process.bpmn'],
      errors: [],
    });
    expect(deploymentEligibilityService.evaluate).toHaveBeenCalledWith({
      userId: 'user-1',
      tenantId: null,
      projectId: 'project-1',
      engineId: 'e1',
      mode: 'manual',
    });
  });

  it('rejects proxy deployment preview for a direct-engine integration', async () => {
    mockEngine.deploymentIntegration = 'direct_engine';

    const response = await request(app)
      .post('/engines-api/engines/e1/deployments/preview')
      .send({ resources: { projectId: 'project-1' } });

    expect(response.status).toBe(409);
    expect(deploymentEligibilityService.evaluate).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      engineId: 'e1',
      mode: 'manual',
    }));
  });

  it('creates manual deployments through composite deployment eligibility', async () => {
    const { fetch } = await import('undici');
    (fetch as any).mockResolvedValueOnce({
      status: 200,
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ id: 'camunda-deployment-1', name: 'Manual deployment' })),
    });

    const response = await request(app)
      .post('/engines-api/engines/e1/deployments')
      .send({
        resources: { projectId: 'project-1' },
        options: { deploymentName: 'Manual deployment' },
      });

    expect(response.status).toBe(201);
    expect(deploymentEligibilityService.evaluate).toHaveBeenCalledWith({
      userId: 'user-1',
      tenantId: null,
      projectId: 'project-1',
      engineId: 'e1',
      mode: 'manual',
    });
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8080/deployment/create',
      expect.objectContaining({ method: 'POST' })
    );
    expect(engineDeploymentInserts[0]).toMatchObject({
      projectId: 'project-1',
      engineId: 'e1',
      deployedBy: 'user-1',
      status: 'success',
    });
  });

  it('denies manual deployments before calling the engine when composite eligibility fails', async () => {
    const { fetch } = await import('undici');
    mockEngine.connectionMode = 'customer_sidecar';
    mockEngine.authType = 'none';
    (deploymentEligibilityService.evaluate as unknown as Mock).mockResolvedValueOnce({
      allowed: false,
      decision: 'deny',
      mode: 'manual',
      projectId: 'project-1',
      engineId: 'e1',
      checks: [
        {
          id: 'project.permission.deploy',
          label: 'Project deploy permission',
          allowed: false,
          reason: 'Missing project deploy permission',
        },
      ],
      reasons: ['Missing project deploy permission'],
    });

    const response = await request(app)
      .post('/engines-api/engines/e1/deployments')
      .send({
        resources: { projectId: 'project-1' },
      });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      error: 'Missing project deploy permission',
      reasons: ['Missing project deploy permission'],
    });
    expect(deploymentEligibilityService.evaluate).toHaveBeenCalledWith({
      userId: 'user-1',
      tenantId: null,
      projectId: 'project-1',
      engineId: 'e1',
      mode: 'manual',
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(engineDeploymentInserts).toEqual([]);
  });

  it('creates deployments through API-client api-mode eligibility', async () => {
    const { fetch } = await import('undici');
    (fetch as any).mockResolvedValueOnce({
      status: 200,
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ id: 'camunda-deployment-1', name: 'API deployment' })),
    });

    const response = await request(app)
      .post('/engines-api/external/engines/e1/deployments')
      .set('Authorization', 'Bearer token-1')
      .send({
        resources: { projectId: 'project-1' },
        options: { deploymentName: 'API deployment' },
      });

    expect(response.status).toBe(201);
    expect(apiClientService.authenticateToken).toHaveBeenCalledWith('token-1', 'deployment:execute');
    expect(deploymentEligibilityService.evaluate).toHaveBeenCalledWith({
      principalType: 'api_client',
      principalId: 'api-client-1',
      tenantId: null,
      projectId: 'project-1',
      engineId: 'e1',
      mode: 'api',
    });
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8080/deployment/create',
      expect.objectContaining({ method: 'POST' })
    );
    expect(engineDeploymentInserts[0]).toMatchObject({
      projectId: 'project-1',
      engineId: 'e1',
      deployedBy: 'api_client:api-client-1',
      status: 'success',
    });
  });

  it('creates deployments through service-account api-mode eligibility', async () => {
    const { fetch } = await import('undici');
    (fetch as any).mockResolvedValueOnce({
      status: 200,
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ id: 'camunda-deployment-1', name: 'Service deployment' })),
    });

    const response = await request(app)
      .post('/engines-api/external/engines/e1/deployments')
      .set('Authorization', 'Bearer egsa_service-account-1_secret')
      .send({
        resources: { projectId: 'project-1' },
        options: { deploymentName: 'Service deployment' },
      });

    expect(response.status).toBe(201);
    expect(serviceAccountService.authenticateToken).toHaveBeenCalledWith('egsa_service-account-1_secret', 'deployment:execute');
    expect(apiClientService.authenticateToken).not.toHaveBeenCalled();
    expect(deploymentEligibilityService.evaluate).toHaveBeenCalledWith({
      principalType: 'service_account',
      principalId: 'service-account-1',
      tenantId: null,
      projectId: 'project-1',
      engineId: 'e1',
      mode: 'api',
    });
    expect(engineDeploymentInserts[0]).toMatchObject({
      projectId: 'project-1',
      engineId: 'e1',
      deployedBy: 'service_account:service-account-1',
      status: 'success',
    });
  });

  it('records an idempotent external deployment receipt through API deployment eligibility', async () => {
    mockEngine.deploymentIntegration = 'direct_engine';
    const response = await request(app)
      .post('/engines-api/external/engines/e1/deployment-receipts')
      .set('Authorization', 'Bearer token-1')
      .send({
        idempotencyKey: 'release-2026-07-12-001',
        projectId: 'project-1',
        engineDeploymentId: 'camunda-deployment-1',
        artifacts: [{ resourceKind: 'process_definition', resourceKey: 'payments-order', version: 1 }],
        lineage: { pipelineRunId: 'run-1', commitSha: 'abc123' },
      });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ idempotent: false, inventory: { created: 1, updated: 0 } });
    expect(apiClientService.authenticateToken).toHaveBeenCalledWith('token-1', 'deployment:execute');
    expect(deploymentEligibilityService.evaluate).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      engineId: 'e1',
      mode: 'api',
    }));
  });

  it('rejects pipeline receipts when the engine disables receipt ingestion', async () => {
    mockEngine.deploymentIntegration = 'direct_engine';
    mockEngine.pipelineReceiptEnabled = false;

    const response = await request(app)
      .post('/engines-api/external/engines/e1/deployment-receipts')
      .set('Authorization', 'Bearer token-1')
      .send({
        idempotencyKey: 'release-2026-07-13-disabled', projectId: 'project-1', engineDeploymentId: 'camunda-deployment-1',
        artifacts: [{ resourceKind: 'process_definition', resourceKey: 'payments-order', version: 1 }],
      });

    expect(response.status).toBe(409);
  });
});

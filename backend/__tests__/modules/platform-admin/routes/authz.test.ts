import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import authzRouter from '../../../../../packages/backend-host/src/modules/platform-admin/routes/authz.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import {
  deploymentEligibilityService,
  engineService,
  engineSetService,
  permissionService,
  policyService,
  projectEngineTargetService,
  serviceAccountService,
  ssoSyncDiagnosticsService,
} from '@enterpriseglue/shared/services/platform-admin/index.js';

const sharedPermissionServiceMock = vi.hoisted(() => ({
  hasPermission: vi.fn().mockResolvedValue(true),
}));
const configBundleApplyMock = vi.hoisted(() => ({
  apply: vi.fn().mockResolvedValue({
    canonicalHash: 'preview-hash', created: 2, updated: 0, archived: 0, changes: [],
    reconciliation: { status: 'completed', engineSetCount: 0, runtimeResourceSetCount: 0, engineCount: 0 },
  }),
}));
const configBundleIdentityReplayTaskMock = vi.hoisted(() => ({
  listForApplyRun: vi.fn().mockResolvedValue([{ id: 'identity-task-1', providerId: 'provider-1', status: 'queued', attempts: 0, nextAttemptAt: null, scanned: 500, created: 2, removed: 1, failed: 0, lastError: null, completedAt: null, createdAt: 1, updatedAt: 1 }]),
}));
const configBundleRuntimeReconciliationTaskMock = vi.hoisted(() => ({
  listForApplyRun: vi.fn().mockResolvedValue([{ id: 'runtime-task-1', status: 'queued', attempts: 0, nextAttemptAt: null, engineSetIdsJson: '[]', runtimeResourceSetIdsJson: '["runtime-set-1"]', engineIdsJson: '["engine-1"]', lastError: null, completedAt: null, createdAt: 1, updatedAt: 1 }]),
}));
const configBundleSecretPreflightMock = vi.hoisted(() => ({
  check: vi.fn().mockReturnValue({
    valid: true,
    canonicalHash: 'preview-hash',
    availabilityHash: 'secret-preflight-hash',
    available: false,
    errors: [],
    references: [{ reference: 'MISSING_ENGINE_TOKEN', locations: ['./engines.json.engines.0.auth.tokenRef'], available: false, reason: 'environment_variable_missing' }],
  }),
}));
const configBundleRemoteSourceMock = vi.hoisted(() => ({
  import: vi.fn().mockResolvedValue({
    payload: { bundle: { metadata: { key: 'remote.authz' } }, files: {} },
    sourceHost: 'raw.githubusercontent.com',
    sourceKind: 'json',
  }),
}));
const platformSettingsServiceMock = vi.hoisted(() => ({
  get: vi.fn().mockResolvedValue({ credentiallessCustomerSidecarsEnabled: false }),
}));
const auditLogMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const apiClientAuthMock = vi.hoisted(() => ({
  requireApiClientAction: vi.fn(() => (req: any, _res: any, next: any) => {
    req.apiClient = { id: 'client-1', createdById: 'user-1', scopes: ['config:bundle:manage'] };
    next();
  }),
}));

vi.mock('@enterpriseglue/shared/middleware/rateLimiter.js', () => ({
  apiLimiter: (_req: any, _res: any, next: any) => next(),
  configBundleLimiter: (_req: any, _res: any, next: any) => next(),
  reconciliationLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1', platformRole: 'admin' };
    if (req.headers['x-test-omit-tenant-context'] !== 'true') {
      req.tenant ||= { tenantId: 'tenant-default' };
    }
    next();
  },
}));

vi.mock('@enterpriseglue/shared/middleware/apiClientAuth.js', () => apiClientAuthMock);

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/audit.js', () => ({
  logAudit: auditLogMock,
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js', () => ({
  permissionService: sharedPermissionServiceMock,
  PermissionCatalog: [
    { key: 'engine:deploy', scope: 'engine' },
  ],
  SystemRoleDefinitions: [
    { key: 'system.engine.operator' },
  ],
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/PolicyService.js', () => ({
  policyService: {
    evaluateGate: vi.fn().mockResolvedValue({ decision: 'allow', reason: 'no-matching-deny-policy' }),
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/ConfigBundleApplyService.js', () => ({
  configBundleApplyService: configBundleApplyMock,
}));
vi.mock('@enterpriseglue/shared/services/platform-admin/ConfigBundleIdentityReplayTaskService.js', () => ({
  configBundleIdentityReplayTaskService: configBundleIdentityReplayTaskMock,
}));
vi.mock('@enterpriseglue/shared/services/platform-admin/ConfigBundleRuntimeReconciliationTaskService.js', () => ({
  configBundleRuntimeReconciliationTaskService: configBundleRuntimeReconciliationTaskMock,
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/ConfigBundleSecretPreflightService.js', () => ({
  configBundleSecretPreflightService: configBundleSecretPreflightMock,
}));
vi.mock('@enterpriseglue/shared/services/platform-admin/ConfigBundleRemoteSourceService.js', () => ({
  configBundleRemoteSourceService: configBundleRemoteSourceMock,
}));
vi.mock('@enterpriseglue/shared/services/platform-admin/PlatformSettingsService.js', () => ({
  platformSettingsService: platformSettingsServiceMock,
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/index.js', () => ({
  policyService: {
    evaluateAndLog: vi.fn().mockResolvedValue({ decision: 'allow', reason: 'User is admin' }),
    evaluate: vi.fn().mockResolvedValue({ decision: 'allow', reason: 'role:platform:admin' }),
    getAllPolicies: vi.fn().mockResolvedValue([]),
    createPolicy: vi.fn().mockResolvedValue({ id: 'policy-1' }),
    updatePolicy: vi.fn().mockResolvedValue(undefined),
    deletePolicy: vi.fn().mockResolvedValue(undefined),
    getAuditLog: vi.fn().mockResolvedValue([]),
  },
  permissionService: {
    getPermissionCatalog: vi.fn().mockReturnValue([{ key: 'platform:authz:check', scope: 'platform', category: 'Access Control', label: 'Check', description: 'Check access' }]),
    getRoles: vi.fn().mockResolvedValue([
      { id: 'system.platform.admin', key: 'system.platform.admin', name: 'Platform Admin', scope: 'platform', kind: 'system', isAssignable: true, isArchived: false, permissionCount: 1 },
      { id: 'system.engine.operator', key: 'system.engine.operator', name: 'Engine Operator', scope: 'engine', kind: 'system', isAssignable: true, isArchived: false, permissionCount: 1 },
      { id: 'system.engine.deployer', key: 'system.engine.deployer', name: 'Engine Deployer', scope: 'engine', kind: 'system', isAssignable: true, isArchived: false, permissionCount: 1 },
      { id: 'system.engine.owner', key: 'system.engine.owner', name: 'Engine Owner', scope: 'engine', kind: 'system', isAssignable: false, isArchived: false, permissionCount: 1 },
      { id: 'custom.engine.operator-lite', key: 'custom.engine.operator-lite', name: 'Operator Lite', scope: 'engine', kind: 'custom', isAssignable: true, isArchived: false, permissionCount: 1 },
    ]),
    getRole: vi.fn().mockResolvedValue({ id: 'system.platform.admin', tenantId: null, key: 'system.platform.admin', name: 'Platform Admin', scope: 'platform', kind: 'system', isAssignable: true, isArchived: false, permissionCount: 1, permissions: ['platform:authz:check'] }),
    createCustomPermission: vi.fn().mockResolvedValue({ id: 'project:custom:approve-release', key: 'project:custom:approve-release' }),
    createCustomRole: vi.fn().mockResolvedValue({ id: '00000000-0000-4000-8000-000000000010' }),
    updateCustomRole: vi.fn().mockResolvedValue(undefined),
    archiveCustomRole: vi.fn().mockResolvedValue(undefined),
    listRoleAssignments: vi.fn().mockResolvedValue([{ id: '00000000-0000-4000-8000-000000000020', userId: '00000000-0000-4000-8000-000000000001', roleId: 'system.engine.operator', roleName: 'Engine Operator', resourceType: 'engine', resourceId: 'engine-1', source: 'manual' }]),
    assignRole: vi.fn().mockResolvedValue({ id: '00000000-0000-4000-8000-000000000020' }),
    removeRoleAssignment: vi.fn().mockResolvedValue(undefined),
    hasPermission: sharedPermissionServiceMock.hasPermission,
    getCurrentUserPermissions: vi.fn().mockResolvedValue({
      userId: 'user-1',
      platform: ['platform:authz:check'],
      projects: [{ resourceId: 'project-1', permissions: ['project:files:view'] }],
      engines: [{ resourceId: 'engine-1', permissions: ['engine:instance:view'], runtimePermissions: [] }],
      authorizationVersion: 'authz:123:test',
      generatedAt: 123,
    }),
    evaluatePermission: vi.fn().mockResolvedValue({ allowed: true, reason: 'role:platform:admin', sources: [{ type: 'legacy-role', role: 'admin' }] }),
  },
  apiClientService: {
    listClients: vi.fn().mockResolvedValue([{ id: 'client-1', name: 'Engine registration', tokenPrefix: 'egac_client', scopes: ['engine:register'], isActive: true }]),
    createClient: vi.fn().mockResolvedValue({ client: { id: 'client-1', name: 'Engine registration', tokenPrefix: 'egac_client', scopes: ['engine:register'], isActive: true }, token: 'egac_client-1_secret' }),
    rotateClient: vi.fn().mockResolvedValue({ client: { id: '00000000-0000-4000-8000-000000000040', name: 'Engine registration', tokenPrefix: 'egac_client', scopes: ['engine:register'], isActive: true }, token: 'egac_client-1_new-secret' }),
    revokeClient: vi.fn().mockResolvedValue(undefined),
  },
  serviceAccountService: {
    listServiceAccounts: vi.fn().mockResolvedValue([{ id: 'service-account-1', name: 'CI deployer', tokenPrefix: 'egsa_service', scopes: ['deployment:execute'], description: 'Deploys from CI', isActive: true }]),
    createServiceAccount: vi.fn().mockResolvedValue({ account: { id: 'service-account-1', name: 'Release service', tokenPrefix: 'egsa_service', scopes: ['deployment:execute'], description: 'Release automation', isActive: true }, token: 'egsa_service-account-1_secret' }),
    rotateServiceAccountToken: vi.fn().mockResolvedValue({ account: { id: 'service-account-1', name: 'Release service', tokenPrefix: 'egsa_service', scopes: ['deployment:execute'], description: 'Release automation', isActive: true }, token: 'egsa_service-account-1_new-secret' }),
    revokeServiceAccount: vi.fn().mockResolvedValue(undefined),
  },
  ServiceAccountScopes: {
    DEPLOYMENT_EXECUTE: 'deployment:execute',
  },
  ApiClientScopes: {
    CONFIG_BUNDLE_MANAGE: 'config:bundle:manage',
    ENGINE_REGISTER: 'engine:register',
    DEPLOYMENT_EXECUTE: 'deployment:execute',
  },
  API_CLIENT_TOKEN_PREFIX: 'egac',
  ssoSyncDiagnosticsService: {
    listRuns: vi.fn().mockResolvedValue([
      {
        id: '00000000-0000-4000-8000-000000000070',
        tenantId: null,
        providerId: 'microsoft',
        userId: '00000000-0000-4000-8000-000000000001',
        trigger: 'login',
        status: 'failed',
        startedAt: 1000,
        completedAt: 1500,
        groupMembershipsCreated: 1,
        groupMembershipsUpdated: 0,
        groupMembershipsRemoved: 0,
        assignmentsCreated: 1,
        assignmentsUpdated: 0,
        assignmentsRemoved: 0,
        errorCode: 'sync_failed',
        errorMessage: 'Engine materialization failed',
        details: '{}',
      },
    ]),
    listEvents: vi.fn().mockResolvedValue([
      {
        id: '00000000-0000-4000-8000-000000000071',
        tenantId: null,
        providerId: 'microsoft',
        runId: '00000000-0000-4000-8000-000000000070',
        severity: 'error',
        type: 'engine_assignment.materialization_failed',
        userId: '00000000-0000-4000-8000-000000000001',
        mappingType: 'sso_assignment',
        mappingId: 'mapping-1',
        resourceType: 'engine',
        resourceId: 'engine-1',
        message: 'Engine materialization failed',
        details: '{}',
        createdAt: 1400,
      },
    ]),
    runProviderIdentityCheck: vi.fn().mockResolvedValue({
      runId: '00000000-0000-4000-8000-000000000073',
      scannedIdentities: 2,
      checkedIdentities: 1,
      unsupportedIdentities: 1,
      activeIdentities: 1,
      inactiveIdentities: 0,
      deletedIdentities: 0,
      unknownIdentities: 0,
      failedIdentities: 0,
    }),
  },
  projectEngineTargetService: {
    listTargets: vi.fn().mockResolvedValue([
      {
        id: 'target-1',
        tenantId: null,
        projectId: 'project-1',
        projectName: 'Project One',
        engineId: 'engine-1',
        engineName: 'Engine One',
        engineBaseUrl: 'https://engine.example.com',
        environment: null,
        status: 'active',
        source: 'manual',
        sourceRef: null,
        externalSystemId: null,
        externalProjectId: null,
        externalEngineId: null,
        externalTargetId: null,
        allowManualDeploy: true,
        allowCiDeploy: false,
        allowApiDeploy: false,
        allowImport: true,
        createdById: 'user-1',
        approvedById: null,
        approvalStatus: 'not_required',
        approvedAt: null,
        policyTags: [],
        diagnostics: null,
        lastSeenAt: 123,
        createdAt: 100,
        updatedAt: 123,
      },
    ]),
    getTarget: vi.fn().mockResolvedValue({
      id: 'target-1',
      tenantId: 'tenant-default',
      projectId: 'project-1',
      projectName: 'Project One',
      engineId: 'engine-1',
      engineName: 'Engine One',
      engineBaseUrl: 'https://engine.example.com',
      environment: null,
      status: 'active',
      source: 'manual',
      sourceRef: null,
      allowManualDeploy: true,
      allowCiDeploy: false,
      allowApiDeploy: false,
      allowImport: true,
      createdById: 'user-1',
      approvedById: null,
      lastSeenAt: 123,
      createdAt: 100,
      updatedAt: 123,
    }),
    createTarget: vi.fn().mockResolvedValue({ id: 'target-1' }),
    updateTarget: vi.fn().mockResolvedValue(undefined),
    archiveTarget: vi.fn().mockResolvedValue(undefined),
    syncLegacyAccessForProject: vi.fn().mockResolvedValue({ createdOrUpdated: 1 }),
  },
  deploymentEligibilityService: {
    evaluate: vi.fn().mockResolvedValue({
      allowed: true,
      decision: 'allow',
      mode: 'manual',
      projectId: 'project-1',
      engineId: 'engine-1',
      checks: [{ id: 'project_engine_target.active', allowed: true, reason: 'Project-engine target allows manual mode' }],
      reasons: [],
    }),
  },
  engineSetService: {
    materializeEngineSetsForEngine: vi.fn().mockResolvedValue([{ engineSetId: 'set-1', matched: 1, created: 0, updated: 1, removed: 0 }]),
  },
  engineService: {
    decommissionEngine: vi.fn().mockResolvedValue(undefined),
  },
  AllPermissions: {
    AUTHZ_CHECK: 'platform:authz:check',
    INSTANCE_VIEW: 'engine:instance:view',
  },
  EnginePermissions: {
    MEMBERS_MANAGE: 'engine:members:manage',
    MEMBERS_VIEW: 'engine:members:view',
    INSTANCE_VIEW: 'engine:instance:view',
  },
  PlatformPermissions: {
    ENGINE_REGISTRATION_MANAGE: 'platform:engine-registration:manage',
    ENGINE_SETS_VIEW: 'platform:engine-sets:view',
    ENGINE_SETS_MANAGE: 'platform:engine-sets:manage',
    PROJECT_ENGINE_TARGETS_VIEW: 'platform:project-engine-targets:view',
    PROJECT_ENGINE_TARGETS_MANAGE: 'platform:project-engine-targets:manage',
    SETTINGS_MANAGE: 'platform:settings:manage',
    AUDIT_VIEW: 'platform:audit:view',
    AUTHZ_ROLES_VIEW: 'platform:authz:roles:view',
    AUTHZ_ROLES_MANAGE: 'platform:authz:roles:manage',
    AUTHZ_CHECK: 'platform:authz:check',
    SSO_ASSIGNMENTS_VIEW: 'platform:sso-assignments:view',
    SSO_ASSIGNMENTS_MANAGE: 'platform:sso-assignments:manage',
  },
  ProjectPermissions: {
    MEMBERS_MANAGE: 'project:members:manage',
    MEMBERS_VIEW: 'project:members:view',
    FILES_VIEW: 'project:files:view',
    FILES_EDIT: 'project:files:edit',
  },
  Permission: {},
  EvaluationContext: {},
  SYSTEM_ROLE_IDS: {
    PROJECT_DEVELOPER: 'system.project.developer',
    PROJECT_DEPLOYER: 'system.project.deployer',
    PROJECT_EDITOR: 'system.project.editor',
    PROJECT_VIEWER: 'system.project.viewer',
    ENGINE_OPERATOR: 'system.engine.operator',
    ENGINE_DEPLOYER: 'system.engine.deployer',
  },
}));

describe('platform-admin authz routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json({ limit: '2mb' }));
    app.use(authzRouter);
    vi.clearAllMocks();
    (getDataSource as any).mockResolvedValue({
      getRepository: (entity: any) => {
        if (entity.name === 'ExternalEngineRegistration') {
          return {
            find: vi.fn().mockResolvedValue([
              {
                id: 'registration-1',
                engineId: 'engine-1',
                externalId: 'cluster-a/prod',
                labelsJson: JSON.stringify({ environment: 'prod', region: 'eu' }),
                registrationSource: 'external_api',
                apiClientId: 'client-1',
                externalSystemId: 'system-1',
                managementMode: 'hybrid',
                fieldOwnershipJson: JSON.stringify({ connection: 'external', auth: 'external', display: 'manual' }),
                driftStatus: 'in_sync',
                lifecycleStatus: 'active',
                lastExternalSyncAt: 1000,
                capabilitiesJson: JSON.stringify({ operations: ['engine.read'], supportLevel: 'compatible' }),
                capabilityStatus: 'mismatch',
                lastRegisteredAt: 1000,
                createdAt: 900,
                updatedAt: 1000,
              },
            ]),
          };
        }
        if (entity.name === 'ExternalEngineSystem') {
          const system = {
            id: 'system-1',
            tenantId: null,
            key: 'fleet-manager',
            name: 'Fleet Manager',
            description: 'External CMDB',
            defaultManagementMode: 'hybrid',
            defaultFieldOwnershipJson: JSON.stringify({ connection: 'external', auth: 'external', display: 'manual' }),
            isActive: true,
            createdById: 'user-1',
            createdAt: 900,
            updatedAt: 1000,
          };
          return {
            find: vi.fn().mockResolvedValue([system]),
            findOne: vi.fn().mockResolvedValue(null),
            findOneBy: vi.fn().mockResolvedValue(system),
            insert: vi.fn().mockResolvedValue(undefined),
            update: vi.fn().mockResolvedValue(undefined),
          };
        }
        if (entity.name === 'Engine') {
          const engine = {
            id: 'engine-1',
            tenantId: 'tenant-default',
            tenancyMode: 'dedicated',
            name: 'External Engine',
            baseUrl: 'https://engine.example.com',
            type: 'camunda8',
            connectionMode: 'customer_sidecar',
            externalId: 'cluster-a/prod',
            labelsJson: JSON.stringify({ environment: 'prod', region: 'eu' }),
            registrationSource: 'external_api',
            externalSystemId: 'system-1',
            managementMode: 'hybrid',
            fieldOwnershipJson: JSON.stringify({ connection: 'external', auth: 'external', display: 'manual' }),
            driftStatus: 'in_sync',
            lifecycleStatus: 'active',
            lastExternalSyncAt: 1000,
            capabilitiesJson: JSON.stringify({ operations: ['engine.read'], supportLevel: 'compatible' }),
            capabilityStatus: 'mismatch',
            externalUpdatedAt: 1000,
            createdAt: 900,
            updatedAt: 1000,
          };
          return {
            find: vi.fn().mockResolvedValue([engine]),
            findOne: vi.fn().mockResolvedValue(engine),
          };
        }
        if (entity.name === 'File') {
          return {
            findOne: vi.fn().mockResolvedValue({
              id: 'file-1',
              projectId: 'project-1',
              name: 'process.bpmn',
              type: 'bpmn',
              bpmnProcessId: 'invoice',
              dmnDecisionId: null,
            }),
          };
        }
        if (entity.name === 'Project') {
          return {
            find: vi.fn().mockResolvedValue([]),
            findOne: vi.fn().mockResolvedValue({
              id: 'project-1',
              tenantId: 'tenant-default',
              name: 'Project One',
            }),
          };
        }
        if (entity.name === 'ProjectEngineTarget') {
          return {
            find: vi.fn().mockResolvedValue([]),
            findOne: vi.fn().mockResolvedValue({
              id: 'target-1',
              tenantId: 'tenant-default',
              projectId: 'project-1',
              engineId: 'engine-1',
              status: 'active',
            }),
          };
        }
        if (entity.name === 'AuditLog') {
          return {
            find: vi.fn().mockResolvedValue([
              {
                id: 'audit-1',
                userId: 'admin-1',
                action: 'engine.external_registration.update',
                resourceType: 'engine',
                resourceId: 'engine-1',
                ipAddress: '127.0.0.1',
                userAgent: 'vitest',
                details: JSON.stringify({ externalId: 'cluster-a/prod', labels: { environment: 'prod' } }),
                createdAt: 1000,
              },
            ]),
          };
        }
        if (entity.name === 'ConfigBundleApplyRun') {
          const run = {
            id: 'config-run-1',
            bundleKey: 'acme.authz',
            canonicalHash: 'preview-hash',
            idempotencyKey: 'config-apply-2026-07-13',
            actorId: 'user-1',
            status: 'succeeded',
            resultJson: JSON.stringify({ created: 2, updated: 1, archived: 0, changes: [{ objectType: 'group', key: 'group.ops', operation: 'create', reason: 'New config group' }], reconciliation: { status: 'completed', engineSetCount: 0, runtimeResourceSetCount: 0, engineCount: 0, identitySnapshot: { status: 'completed', providerCount: 1, scanned: 2, created: 1, removed: 0, failed: 0 } }, bootstrap: { mode: 'apply', status: 'applied', hash: 'preview-hash', message: null, reconciliation: 'completed', secretPreflight: 'passed', issueCode: null } }),
            errorMessage: null,
            completedAt: 1100,
            createdAt: 1000,
          };
          return {
            find: vi.fn().mockResolvedValue([run]),
            findOne: vi.fn().mockResolvedValue(run),
          };
        }
        if (entity.name === 'RbacRoleAssignment') {
          return {
            find: vi.fn().mockResolvedValue([]),
            findOne: vi.fn().mockResolvedValue({
              id: '00000000-0000-4000-8000-000000000020',
              principalType: 'user',
              principalId: '00000000-0000-4000-8000-000000000001',
              roleId: 'custom.engine.operator-lite',
              scopeType: 'engine',
              scopeId: 'engine-1',
              source: 'manual',
            }),
          };
        }
        return { find: vi.fn().mockResolvedValue([]) };
      },
    });
    vi.mocked(permissionService.getRole).mockResolvedValue({
      id: 'system.platform.admin',
      tenantId: null,
      key: 'system.platform.admin',
      name: 'Platform Admin',
      description: null,
      scope: 'platform',
      kind: 'system',
      isEditable: false,
      isAssignable: true,
      isArchived: false,
      source: 'system',
      sourceRef: 'rbac-foundation',
      ownershipMode: 'manual',
      sourceHash: null,
      lastAppliedAt: null,
      driftStatus: null,
      permissionCount: 1,
      permissions: ['platform:authz:check'] as any,
      createdAt: 1,
      updatedAt: 1,
    });
    sharedPermissionServiceMock.hasPermission.mockResolvedValue(true);
    vi.mocked(projectEngineTargetService.listTargets).mockResolvedValue([
      {
        id: 'target-1',
        tenantId: null,
        projectId: 'project-1',
        projectName: 'Project One',
        engineId: 'engine-1',
        engineName: 'Engine One',
        engineBaseUrl: 'https://engine.example.com',
        environment: null,
        status: 'active',
        source: 'manual',
        sourceRef: null,
        ownershipMode: 'manual',
        sourceHash: null,
        lastAppliedAt: null,
        driftStatus: null,
        externalSystemId: null,
        externalProjectId: null,
        externalEngineId: null,
        externalTargetId: null,
        allowManualDeploy: true,
        allowCiDeploy: false,
        allowApiDeploy: false,
        allowImport: true,
        createdById: 'user-1',
        approvedById: null,
        approvalStatus: 'not_required',
        approvedAt: null,
        policyTags: [],
        diagnostics: null,
        lastSeenAt: 123,
        createdAt: 100,
        updatedAt: 123,
      },
    ]);
    vi.mocked(projectEngineTargetService.createTarget).mockResolvedValue({ id: 'target-1' });
    vi.mocked(projectEngineTargetService.updateTarget).mockResolvedValue(undefined);
    vi.mocked(projectEngineTargetService.archiveTarget).mockResolvedValue(undefined);
    vi.mocked(projectEngineTargetService.syncLegacyAccessForProject).mockResolvedValue({ createdOrUpdated: 1 });
    vi.mocked(deploymentEligibilityService.evaluate).mockResolvedValue({
      allowed: true,
      decision: 'allow',
      mode: 'manual',
      projectId: 'project-1',
      engineId: 'engine-1',
      checks: [{ id: 'project_engine_target.active', allowed: true, reason: 'Project-engine target allows manual mode' }],
      reasons: [],
    });
  });

  it('checks authorization', async () => {
    const response = await request(app)
      .post('/api/authz/check')
      .send({ action: 'read', resourceType: 'project', resourceId: 'p1' });

    expect(response.status).toBe(200);
    expect(response.body.allowed).toBeDefined();
  });

  it('returns current user effective permissions', async () => {
    const response = await request(app).get('/api/authz/me/permissions');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      userId: 'user-1',
      tenantId: 'tenant-default',
      platform: ['platform:authz:check'],
      projects: [{ resourceId: 'project-1', permissions: ['project:files:view'] }],
      engines: [{ resourceId: 'engine-1', permissions: ['engine:instance:view'], runtimePermissions: [] }],
      authorizationVersion: 'authz:123:test',
      generatedAt: 123,
    });
  });

  it('uses the default tenant for a current-user snapshot when middleware has no tenant context', async () => {
    const response = await request(app)
      .get('/api/authz/me/permissions')
      .set('x-test-omit-tenant-context', 'true');

    expect(response.status).toBe(200);
    expect(response.body.tenantId).toBeNull();
    expect(permissionService.getCurrentUserPermissions).toHaveBeenCalledWith('user-1', 'tenant-default');
  });

  it('serializes authorization audit records through the strict shared API view', async () => {
    vi.mocked(policyService.getAuditLog).mockResolvedValueOnce([{
      id: 'audit-1',
      tenantId: null,
      userId: 'user-1',
      action: 'authz.check',
      resourceType: null,
      resourceId: null,
      decision: 'allow',
      reason: 'role assignment',
      policyId: null,
      context: '{}',
      ipAddress: null,
      userAgent: null,
      timestamp: 1,
      createdAt: 1,
      updatedAt: 1,
    }] as any);

    const response = await request(app).get('/api/authz/audit?limit=25');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{
      id: 'audit-1',
      tenantId: null,
      userId: 'user-1',
      action: 'authz.check',
      resourceType: null,
      resourceId: null,
      decision: 'allow',
      reason: 'role assignment',
      policyId: null,
      context: '{}',
      ipAddress: null,
      userAgent: null,
      timestamp: 1,
    }]);
    expect(policyService.getAuditLog).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-default', limit: 25 }));
  });

  it('never serializes runtime-resource keys into the coarse current-user permission snapshot', async () => {
    vi.mocked(permissionService.getCurrentUserPermissions).mockResolvedValue({
      userId: 'user-1',
      platform: ['platform:authz:check'],
      projects: [{ resourceId: 'project-1', permissions: ['project:files:view'], runtimeResourceKeys: ['should-not-leak'] }],
      engines: [{
        resourceId: 'engine-central',
        permissions: [],
        runtimePermissions: ['engine:instance:view'],
        runtimeResourceKeys: ['payments-order', 'credit-risk'],
      }],
      authorizationVersion: 'authz:123:test',
      generatedAt: 123,
      runtimeResources: [{ engineId: 'engine-central', resourceKey: 'payments-order', runtimeTenantId: 'tenant-a' }],
    } as any);

    const response = await request(app).get('/api/authz/me/permissions');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      userId: 'user-1',
      tenantId: 'tenant-default',
      platform: ['platform:authz:check'],
      projects: [{ resourceId: 'project-1', permissions: ['project:files:view'] }],
      engines: [{ resourceId: 'engine-central', permissions: [], runtimePermissions: ['engine:instance:view'] }],
      authorizationVersion: 'authz:123:test',
      generatedAt: 123,
    });
    expect(JSON.stringify(response.body)).not.toContain('payments-order');
    expect(JSON.stringify(response.body)).not.toContain('tenant-a');
  });

  it('lists the permission catalog', async () => {
    const response = await request(app).get('/api/authz/permissions');

    expect(response.status).toBe(200);
    expect(response.body[0].key).toBe('platform:authz:check');
  });

  it('blocks platform admin routes through action middleware before handlers run', async () => {
    vi.mocked(permissionService.hasPermission).mockResolvedValue(false);
    vi.mocked(permissionService.getPermissionCatalog).mockClear();

    const response = await request(app).get('/api/authz/permissions');

    expect(response.status).toBe(403);
    expect(permissionService.hasPermission).toHaveBeenCalledWith(
      'platform:authz:roles:view',
      expect.objectContaining({
        userId: 'user-1',
        resourceType: 'platform',
      })
    );
    expect(permissionService.getPermissionCatalog).not.toHaveBeenCalled();
  });

  it('creates custom permissions', async () => {
    const response = await request(app)
      .post('/api/authz/permissions')
      .send({
        key: 'project:custom:approve-release',
        scope: 'project',
        category: 'Release',
        label: 'Approve release',
        description: 'Allows approving a release gate.',
      });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: 'project:custom:approve-release',
      key: 'project:custom:approve-release',
    });
    expect(permissionService.createCustomPermission).toHaveBeenCalledWith(expect.objectContaining({
      key: 'project:custom:approve-release',
      scope: 'project',
      createdById: 'user-1',
    }));
  });

  it('lists RBAC roles', async () => {
    const response = await request(app).get('/api/authz/roles');

    expect(response.status).toBe(200);
    expect(response.body[0].id).toBe('system.platform.admin');
  });

  it('gets role details', async () => {
    const response = await request(app).get('/api/authz/roles/system.platform.admin');

    expect(response.status).toBe(200);
    expect(response.body.permissions).toContain('platform:authz:check');
  });

  it('creates custom roles', async () => {
    const response = await request(app)
      .post('/api/authz/roles')
      .send({
        name: 'Engine Operators',
        scope: 'engine',
        permissionIds: ['engine:deploy'],
      });

    expect(response.status).toBe(201);
    expect(response.body.id).toBe('00000000-0000-4000-8000-000000000010');
  });

  it('updates custom role assignability', async () => {
    const response = await request(app)
      .put('/api/authz/roles/custom.engine.operator-lite')
      .send({ isAssignable: false });

    expect(response.status).toBe(200);
    expect(permissionService.updateCustomRole).toHaveBeenCalledWith('custom.engine.operator-lite', expect.objectContaining({
      isAssignable: false,
      updatedById: 'user-1',
    }));
  });

  it('rejects deny fields on custom role creation', async () => {
    const response = await request(app)
      .post('/api/authz/roles')
      .send({
        name: 'Deny Role',
        scope: 'engine',
        permissionIds: ['engine:deploy:view'],
        denyPermissionIds: ['engine:deploy'],
      });

    expect(response.status).toBe(400);
    expect(response.body.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'denyPermissionIds',
        message: 'Custom roles are allow-only; use authorization policies for deny rules',
      }),
    ]));
    expect(permissionService.createCustomRole).not.toHaveBeenCalled();
  });

  it('assigns and removes manual roles', async () => {
    const createResponse = await request(app)
      .post('/api/authz/role-assignments')
      .send({
        principalType: 'user',
        principalId: '00000000-0000-4000-8000-000000000001',
        roleId: 'system.engine.operator',
        resourceType: 'engine',
        resourceId: 'engine-1',
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.id).toBe('00000000-0000-4000-8000-000000000020');

    const listResponse = await request(app).get('/api/authz/role-assignments');
    expect(listResponse.status).toBe(200);
    expect(listResponse.body[0].source).toBe('manual');

    const deleteResponse = await request(app).delete('/api/authz/role-assignments/00000000-0000-4000-8000-000000000020');
    expect(deleteResponse.status).toBe(204);
  });

  it('binds tenant role assignments to the authenticated tenant instead of a caller-supplied tenant id', async () => {
    const tenantApp = express();
    tenantApp.use(express.json());
    tenantApp.use((req, _res, next) => {
      req.tenant = { tenantId: 'tenant-a' } as any;
      next();
    });
    tenantApp.use(authzRouter);

    const response = await request(tenantApp)
      .post('/api/authz/role-assignments')
      .send({
        principalType: 'group',
        principalId: 'group-1',
        roleId: 'system.tenant.engine_operator',
        resourceType: 'tenant',
        resourceId: 'tenant-b',
      });

    expect(response.status).toBe(201);
    expect(permissionService.assignRole).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      resourceType: 'tenant',
      resourceId: 'tenant-a',
      scopeType: 'tenant',
      scopeId: 'tenant-a',
    }));
  });

  it('uses the OSS default tenant for scoped assignments without tenant middleware while keeping platform assignments global', async () => {
    const scopedResponse = await request(app)
      .post('/api/authz/role-assignments')
      .set('x-test-omit-tenant-context', 'true')
      .send({
        principalType: 'user',
        principalId: '00000000-0000-4000-8000-000000000001',
        roleId: 'system.engine.operator',
        resourceType: 'engine_runtime_resource',
        resourceId: 'runtime-resource-1',
      });

    expect(scopedResponse.status).toBe(201);
    expect(permissionService.assignRole).toHaveBeenLastCalledWith(expect.objectContaining({
      tenantId: 'tenant-default',
      resourceType: 'engine_runtime_resource',
      resourceId: 'runtime-resource-1',
    }));

    const platformResponse = await request(app)
      .post('/api/authz/role-assignments')
      .set('x-test-omit-tenant-context', 'true')
      .send({
        principalType: 'user',
        principalId: '00000000-0000-4000-8000-000000000001',
        roleId: 'system.platform.admin',
        resourceType: 'platform',
        resourceId: null,
      });

    expect(platformResponse.status).toBe(201);
    expect(permissionService.assignRole).toHaveBeenLastCalledWith(expect.objectContaining({
      tenantId: null,
      resourceType: 'platform',
      resourceId: null,
    }));
  });

  it('lists default-tenant runtime targets when platform access control has no tenant middleware', async () => {
    const runtimeResources = [
      { id: 'runtime-default', tenantId: 'tenant-default', engineId: 'engine-1', resourceKind: 'process_definition', resourceKey: 'invoice-process', isActive: true },
      { id: 'runtime-other', tenantId: 'tenant-other', engineId: 'engine-1', resourceKind: 'process_definition', resourceKey: 'other-tenant', isActive: true },
    ];
    const runtimeResourceSets = [
      { id: 'runtime-set-default', tenantId: 'tenant-default', engineId: 'engine-1', key: 'invoice-processes', isArchived: false },
      { id: 'runtime-set-other', tenantId: 'tenant-other', engineId: 'engine-1', key: 'other-tenant-processes', isArchived: false },
    ];
    (getDataSource as any).mockResolvedValue({
      getRepository: (entity: any) => {
        if (entity.name === 'RuntimeResource') return { find: vi.fn().mockResolvedValue(runtimeResources) };
        if (entity.name === 'RuntimeResourceSet') return { find: vi.fn().mockResolvedValue(runtimeResourceSets) };
        return { find: vi.fn().mockResolvedValue([]) };
      },
    });

    const [resourcesResponse, setsResponse] = await Promise.all([
      request(app)
        .get('/api/authz/runtime-resources?engineId=engine-1')
        .set('x-test-omit-tenant-context', 'true'),
      request(app)
        .get('/api/authz/runtime-resource-sets?engineId=engine-1')
        .set('x-test-omit-tenant-context', 'true'),
    ]);

    expect(resourcesResponse.status).toBe(200);
    expect(resourcesResponse.body.map((resource: { id: string }) => resource.id)).toEqual(['runtime-default']);
    expect(setsResponse.status).toBe(200);
    expect(setsResponse.body.map((set: { id: string }) => set.id)).toEqual(['runtime-set-default']);
  });

  it('lists exact runtime grants only through the platform-authorized engine filter', async () => {
    const response = await request(app)
      .get('/api/authz/role-assignments?engineId=engine-1');

    expect(response.status).toBe(200);
    expect(permissionService.listRoleAssignments).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-default',
      runtimeEngineId: 'engine-1',
    }));
  });

  it('does not let an engine member manager enumerate runtime grants through the engine filter', async () => {
    vi.mocked(permissionService.hasPermission).mockImplementation(async (permission) =>
      permission === 'engine:members:manage'
    );

    const response = await request(app)
      .get('/api/authz/role-assignments?engineId=engine-1');

    expect(response.status).toBe(403);
    expect(permissionService.listRoleAssignments).not.toHaveBeenCalled();
  });

  it('allows scoped resource managers to list assignable custom roles for their resource scope', async () => {
    vi.mocked(permissionService.hasPermission).mockImplementation(async (permission) =>
      permission === 'engine:members:manage'
    );

    const response = await request(app)
      .get('/api/authz/roles?scope=engine&kind=custom&assignable=true&resourceType=engine&resourceId=engine-1');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      expect.objectContaining({
        id: 'custom.engine.operator-lite',
        scope: 'engine',
        kind: 'custom',
      }),
    ]);
    expect(permissionService.hasPermission).toHaveBeenCalledWith(
      'engine:members:manage',
      expect.objectContaining({
        userId: 'user-1',
        resourceType: 'engine',
        resourceId: 'engine-1',
      })
    );
  });

  it('allows scoped resource managers to manage manual custom role assignments for their resource', async () => {
    vi.mocked(permissionService.hasPermission).mockImplementation(async (permission) =>
      permission === 'engine:members:manage'
    );
    vi.mocked(permissionService.getRole).mockResolvedValue({
      id: 'custom.engine.operator-lite',
      tenantId: null,
      key: 'custom.engine.operator-lite',
      name: 'Operator Lite',
      description: null,
      scope: 'engine',
      kind: 'custom',
      isEditable: true,
      isAssignable: true,
      isArchived: false,
      source: 'manual',
      sourceRef: null,
      ownershipMode: 'manual',
      sourceHash: null,
      lastAppliedAt: null,
      driftStatus: null,
      permissionCount: 1,
      permissions: ['engine:instance:view'] as any,
      createdAt: 1,
      updatedAt: 1,
    });

    const listResponse = await request(app)
      .get('/api/authz/role-assignments?resourceType=engine&resourceId=engine-1');
    expect(listResponse.status).toBe(200);

    const createResponse = await request(app)
      .post('/api/authz/role-assignments')
      .send({
        principalType: 'user',
        principalId: '00000000-0000-4000-8000-000000000001',
        roleId: 'custom.engine.operator-lite',
        resourceType: 'engine',
        resourceId: 'engine-1',
      });
    expect(createResponse.status).toBe(201);

    const deleteResponse = await request(app).delete('/api/authz/role-assignments/00000000-0000-4000-8000-000000000020');
    expect(deleteResponse.status).toBe(204);
  });

  it('allows scoped resource managers to list and assign delegated system roles for their resource', async () => {
    vi.mocked(permissionService.hasPermission).mockImplementation(async (permission) =>
      permission === 'engine:members:manage'
    );
    vi.mocked(permissionService.getRole).mockResolvedValue({
      id: 'system.engine.operator',
      tenantId: null,
      key: 'system.engine.operator',
      name: 'Engine Operator',
      description: null,
      scope: 'engine',
      kind: 'system',
      isEditable: false,
      isAssignable: true,
      isArchived: false,
      source: 'system',
      sourceRef: 'rbac-foundation',
      ownershipMode: 'manual',
      sourceHash: null,
      lastAppliedAt: null,
      driftStatus: null,
      permissionCount: 1,
      permissions: ['engine:instance:view'] as any,
      createdAt: 1,
      updatedAt: 1,
    });
    (getDataSource as any).mockResolvedValue({
      getRepository: (entity: any) => {
        if (entity.name !== 'RbacRoleAssignment') return { find: vi.fn().mockResolvedValue([]) };
        return {
          findOne: vi.fn().mockResolvedValue({
            id: '00000000-0000-4000-8000-000000000020',
            roleId: 'system.engine.operator',
            scopeType: 'engine',
            scopeId: 'engine-1',
            source: 'manual',
          }),
        };
      },
    });

    const rolesResponse = await request(app)
      .get('/api/authz/roles?scope=engine&assignable=true&resourceType=engine&resourceId=engine-1');
    expect(rolesResponse.status).toBe(200);
    expect(rolesResponse.body.map((role: any) => role.id)).toEqual([
      'system.engine.operator',
      'system.engine.deployer',
      'custom.engine.operator-lite',
    ]);

    const createResponse = await request(app)
      .post('/api/authz/role-assignments')
      .send({
        principalType: 'group',
        principalId: 'group-1',
        roleId: 'system.engine.operator',
        resourceType: 'engine',
        resourceId: 'engine-1',
      });
    expect(createResponse.status).toBe(201);
    expect(permissionService.assignRole).toHaveBeenCalledWith(expect.objectContaining({
      principalType: 'group',
      principalId: 'group-1',
      roleId: 'system.engine.operator',
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));

    const deleteResponse = await request(app).delete('/api/authz/role-assignments/00000000-0000-4000-8000-000000000020');
    expect(deleteResponse.status).toBe(204);
  });

  it('blocks scoped resource managers from assigning protected owner and delegate system roles', async () => {
    vi.mocked(permissionService.hasPermission).mockImplementation(async (permission) =>
      permission === 'engine:members:manage'
    );
    vi.mocked(permissionService.getRole).mockResolvedValue({
      id: 'system.engine.owner',
      tenantId: null,
      key: 'system.engine.owner',
      name: 'Engine Owner',
      description: null,
      scope: 'engine',
      kind: 'system',
      isEditable: false,
      isAssignable: false,
      isArchived: false,
      source: 'system',
      sourceRef: 'rbac-foundation',
      ownershipMode: 'manual',
      sourceHash: null,
      lastAppliedAt: null,
      driftStatus: null,
      permissionCount: 1,
      permissions: ['engine:members:manage'] as any,
      createdAt: 1,
      updatedAt: 1,
    });

    const createResponse = await request(app)
      .post('/api/authz/role-assignments')
      .send({
        principalType: 'user',
        principalId: '00000000-0000-4000-8000-000000000001',
        roleId: 'system.engine.owner',
        resourceType: 'engine',
        resourceId: 'engine-1',
      });
    expect(createResponse.status).toBe(403);
    expect(permissionService.assignRole).not.toHaveBeenCalled();
  });

  it('rejects legacy userId-only role assignment create bodies', async () => {
    const response = await request(app)
      .post('/api/authz/role-assignments')
      .send({
        userId: '00000000-0000-4000-8000-000000000001',
        roleId: 'system.engine.operator',
        resourceType: 'engine',
        resourceId: 'engine-1',
      });

    expect(response.status).toBe(400);
    expect(permissionService.assignRole).not.toHaveBeenCalled();
  });

  it('allows access control readers to read roles and permissions without platform admin role', async () => {
    vi.mocked(permissionService.hasPermission).mockImplementation(async (permission) =>
      permission === 'platform:authz:roles:view'
    );

    const permissionsResponse = await request(app).get('/api/authz/permissions');
    expect(permissionsResponse.status).toBe(200);

    const rolesResponse = await request(app).get('/api/authz/roles');
    expect(rolesResponse.status).toBe(200);

    const roleResponse = await request(app).get('/api/authz/roles/system.platform.admin');
    expect(roleResponse.status).toBe(200);
    expect(permissionService.hasPermission).toHaveBeenCalledWith(
      'platform:authz:roles:view',
      expect.objectContaining({
        userId: 'user-1',
        resourceType: 'platform',
      })
    );
  });

  it('allows access control managers to mutate custom role catalog without platform admin role', async () => {
    vi.mocked(permissionService.hasPermission).mockImplementation(async (permission) =>
      permission === 'platform:authz:roles:manage'
    );

    const roleResponse = await request(app)
      .post('/api/authz/roles')
      .send({
        name: 'Engine Operators',
        scope: 'engine',
        permissionIds: ['engine:deploy'],
      });
    expect(roleResponse.status).toBe(201);

    const permissionResponse = await request(app)
      .post('/api/authz/permissions')
      .send({
        key: 'project:custom:approve-release',
        scope: 'project',
        category: 'Release',
        label: 'Approve release',
      });
    expect(permissionResponse.status).toBe(201);
  });

  it('allows effective access evaluators to evaluate permissions without platform admin role', async () => {
    vi.mocked(permissionService.hasPermission).mockImplementation(async (permission) =>
      permission === 'platform:authz:check'
    );

    const response = await request(app)
      .post('/api/authz/evaluate')
      .send({ userId: '00000000-0000-4000-8000-000000000001', permission: 'platform:authz:check', resourceType: 'platform' });

    expect(response.status).toBe(200);
    expect(response.body.allowed).toBe(true);
  });

  it('allows external engine registration managers to manage registration inventory without platform admin role', async () => {
    vi.mocked(permissionService.hasPermission).mockImplementation(async (permission) =>
      permission === 'platform:engine-registration:manage' ||
      permission === 'platform:api-clients:view'
    );

    const clientsResponse = await request(app).get('/api/authz/api-clients');
    expect(clientsResponse.status).toBe(200);

    const enginesResponse = await request(app).get('/api/authz/external-engines');
    expect(enginesResponse.status).toBe(200);
  });

  it('accepts a policy activation update through the shared write contract', async () => {
    const response = await request(app)
      .put('/api/authz/policies/00000000-0000-4000-8000-000000000090')
      .send({ isActive: false });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(vi.mocked(policyService.updatePolicy)).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000090',
      expect.objectContaining({ isActive: false, tenantId: 'tenant-default', updatedById: 'user-1' }),
    );
  });

  it('lists SSO sync diagnostics with SSO assignment read permission', async () => {
    vi.mocked(permissionService.hasPermission).mockImplementation(async (permission) =>
      permission === 'platform:sso-assignments:view'
    );

    const runsResponse = await request(app)
      .get('/api/authz/sso-sync-runs')
      .query({ providerId: 'microsoft', status: 'failed', trigger: 'login', limit: 5 });

    expect(runsResponse.status).toBe(200);
    expect(runsResponse.body[0]).toMatchObject({
      id: '00000000-0000-4000-8000-000000000070',
      status: 'failed',
      errorMessage: 'Engine materialization failed',
    });
    expect(ssoSyncDiagnosticsService.listRuns).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'microsoft',
      status: 'failed',
      trigger: 'login',
      limit: 5,
    }));

    const eventsResponse = await request(app)
      .get('/api/authz/sso-sync-runs/00000000-0000-4000-8000-000000000070/events')
      .query({ severity: 'error', limit: 25 });

    expect(eventsResponse.status).toBe(200);
    expect(eventsResponse.body[0]).toMatchObject({
      id: '00000000-0000-4000-8000-000000000071',
      severity: 'error',
      type: 'engine_assignment.materialization_failed',
    });
    expect(ssoSyncDiagnosticsService.listEvents).toHaveBeenCalledWith(expect.objectContaining({
      runId: '00000000-0000-4000-8000-000000000070',
      severity: 'error',
      limit: 25,
    }));
  });


  it('evaluates Mission Control to Starbase bridge access', async () => {
    vi.mocked(permissionService.hasPermission).mockResolvedValue(true);

    const response = await request(app)
      .post('/api/mission-control/bridge/starbase-edit/evaluate')
      .send({
        engineId: 'engine-1',
        projectId: 'project-1',
        fileId: 'file-1',
        definitionKey: 'invoice',
        kind: 'process',
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      allowed: true,
      reasonCode: 'allowed',
      projectId: 'project-1',
      fileId: 'file-1',
      engineId: 'engine-1',
      targetId: 'target-1',
    });
  });

  it('does not make either bridge direction depend on direct versus sidecar transport metadata', async () => {
    vi.mocked(permissionService.hasPermission).mockResolvedValue(true);
    const evaluate = (route: string, connectionMode: 'direct' | 'customer_sidecar') => request(app)
      .post(route)
      .send({
        engineId: 'engine-1',
        projectId: 'project-1',
        fileId: 'file-1',
        definitionKey: 'invoice',
        kind: 'process',
        connectionMode,
      });

    for (const route of [
      '/api/mission-control/bridge/starbase-edit/evaluate',
      '/api/starbase/bridge/mission-control/evaluate',
    ]) {
      const [direct, sidecar] = await Promise.all([
        evaluate(route, 'direct'),
        evaluate(route, 'customer_sidecar'),
      ]);

      expect(direct.status).toBe(200);
      expect(sidecar.status).toBe(200);
      expect(sidecar.body).toEqual(direct.body);
      expect(sidecar.body).toMatchObject({ allowed: true, reasonCode: 'allowed', engineId: 'engine-1' });
    }
  });

  it('denies Mission Control to Starbase bridge access when project edit permission is missing', async () => {
    vi.mocked(permissionService.hasPermission).mockImplementation(async (permission) =>
      permission !== 'project:files:edit'
    );

    const response = await request(app)
      .post('/api/mission-control/bridge/starbase-edit/evaluate')
      .send({
        engineId: 'engine-1',
        projectId: 'project-1',
        fileId: 'file-1',
        definitionKey: 'invoice',
        kind: 'process',
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      allowed: false,
      reasonCode: 'missing_project_file_edit_permission',
      missingActions: ['project.files.update'],
    });
  });

  it('evaluates Starbase to Mission Control bridge access', async () => {
    vi.mocked(permissionService.hasPermission).mockResolvedValue(true);

    const response = await request(app)
      .post('/api/starbase/bridge/mission-control/evaluate')
      .send({
        engineId: 'engine-1',
        projectId: 'project-1',
        fileId: 'file-1',
        definitionKey: 'invoice',
        kind: 'process',
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      allowed: true,
      reasonCode: 'allowed',
      projectId: 'project-1',
      fileId: 'file-1',
      engineId: 'engine-1',
      targetId: 'target-1',
    });
  });

  it('denies Starbase to Mission Control bridge access when engine runtime permission is missing', async () => {
    vi.mocked(permissionService.hasPermission).mockImplementation(async (permission) =>
      permission !== 'engine:instance:view'
    );

    const response = await request(app)
      .post('/api/starbase/bridge/mission-control/evaluate')
      .send({
        engineId: 'engine-1',
        projectId: 'project-1',
        fileId: 'file-1',
        definitionKey: 'invoice',
        kind: 'process',
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      allowed: false,
      reasonCode: 'missing_engine_runtime_read_permission',
      missingActions: ['engine.runtime.process-definitions.read'],
    });
  });

  it('denies bridge access when the project-engine target is inactive', async () => {
    vi.mocked(permissionService.hasPermission).mockResolvedValue(true);
    (getDataSource as any).mockResolvedValue({
      getRepository: (entity: any) => {
        if (entity.name === 'File') {
          return {
            findOne: vi.fn().mockResolvedValue({
              id: 'file-1',
              projectId: 'project-1',
              name: 'process.bpmn',
              type: 'bpmn',
            }),
          };
        }
        if (entity.name === 'Project') {
          return {
            findOne: vi.fn().mockResolvedValue({
              id: 'project-1',
              tenantId: null,
              name: 'Project One',
            }),
          };
        }
        if (entity.name === 'ProjectEngineTarget') {
          return {
            findOne: vi.fn().mockResolvedValue({
              id: 'target-1',
              tenantId: null,
              projectId: 'project-1',
              engineId: 'engine-1',
              status: 'inactive',
            }),
          };
        }
        return { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue(null) };
      },
    });

    const response = await request(app)
      .post('/api/starbase/bridge/mission-control/evaluate')
      .send({
        engineId: 'engine-1',
        projectId: 'project-1',
        fileId: 'file-1',
        definitionKey: 'invoice',
        kind: 'process',
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      allowed: false,
      reasonCode: 'missing_active_project_engine_target',
      missingActions: ['project.deployment-targets.read'],
    });
  });

  it('denies Starbase to Mission Control bridge access when engine lineage is missing', async () => {
    vi.mocked(permissionService.hasPermission).mockResolvedValue(true);

    const response = await request(app)
      .post('/api/starbase/bridge/mission-control/evaluate')
      .send({
        projectId: 'project-1',
        fileId: 'file-1',
        definitionKey: 'invoice',
        kind: 'process',
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      allowed: false,
      reasonCode: 'missing_engine_lineage',
      missingActions: ['engine.runtime.process-definitions.read'],
    });
  });

  it('does not invoke retired legacy mapping evaluators from diagnostics', async () => {
    vi.mocked(permissionService.hasPermission).mockImplementation(async (permission) =>
      permission === 'platform:sso-assignments:manage'
    );

    const response = await request(app)
      .post('/api/authz/sso-sync-runs/reconcile')
      .send({ providerId: 'microsoft', trigger: 'manual' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      legacyMappingEvaluationRetired: true,
      providerIdentityCheck: null,
    });
  });

  it('runs an optional provider identity health check when requested', async () => {
    vi.mocked(permissionService.hasPermission).mockImplementation(async (permission) =>
      permission === 'platform:sso-assignments:manage'
    );

    const response = await request(app)
      .post('/api/authz/sso-sync-runs/reconcile')
      .send({
        providerId: 'microsoft',
        trigger: 'manual',
        includeProviderChecks: true,
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      legacyMappingEvaluationRetired: true,
      providerIdentityCheck: {
        runId: '00000000-0000-4000-8000-000000000073',
        checkedIdentities: 1,
      },
    });
    const expectedInput = expect.objectContaining({
      tenantId: 'tenant-default',
      providerId: 'microsoft',
      trigger: 'manual',
      details: expect.objectContaining({
        actorUserId: 'user-1',
        source: 'admin_access_control',
      }),
    });
    expect(ssoSyncDiagnosticsService.runProviderIdentityCheck).toHaveBeenCalledWith(expectedInput);
  });

  it('evaluates effective access', async () => {
    const response = await request(app)
      .post('/api/authz/evaluate')
      .send({ userId: '00000000-0000-4000-8000-000000000001', permission: 'platform:authz:check', resourceType: 'platform' });

    expect(response.status).toBe(200);
    expect(response.body.allowed).toBe(true);
    expect(response.body.baseReason).toBe('role:platform:admin');
  });

  it('does not make engine Effective Access depend on direct versus sidecar transport metadata', async () => {
    const evaluate = (connectionMode: 'direct' | 'customer_sidecar') => request(app)
      .post('/api/authz/evaluate')
      .send({
        userId: '00000000-0000-4000-8000-000000000001',
        permission: 'engine:instance:view',
        resourceType: 'engine',
        resourceId: 'engine-1',
        connectionMode,
      });

    const [direct, sidecar] = await Promise.all([
      evaluate('direct'),
      evaluate('customer_sidecar'),
    ]);

    expect(direct.status).toBe(200);
    expect(sidecar.status).toBe(200);
    expect(sidecar.body).toEqual(direct.body);
    expect(permissionService.evaluatePermission).toHaveBeenCalledWith(
      'engine:instance:view',
      expect.objectContaining({ resourceType: 'engine', resourceId: 'engine-1' }),
    );
  });

  it('resolves a runtime resource selector before evaluating access', async () => {
    const findOne = vi.fn().mockResolvedValue({
      id: 'runtime-resource-1',
      tenantId: 'tenant-default',
      engineId: 'engine-1',
      resourceKind: 'process_definition',
      resourceKey: 'invoice',
      runtimeTenantId: 'finance',
      tenantResolutionStatus: 'resolved',
      tenantMappingId: 'mapping-1',
      tenantMappingVersion: 3,
      isActive: true,
    });
    (getDataSource as any).mockResolvedValue({
      getRepository: (entity: any) => entity.name === 'RuntimeResource'
        ? { findOne }
        : { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue(null) },
    });

    const response = await request(app)
      .post('/api/authz/evaluate')
      .send({
        userId: '00000000-0000-4000-8000-000000000001',
        permission: 'platform:authz:check',
        resourceType: 'engine_runtime_resource',
        runtimeResource: {
          engineId: 'engine-1',
          resourceKind: 'process_definition',
          resourceKey: 'invoice',
          runtimeTenantId: 'finance',
        },
      });

    expect(response.status).toBe(200);
    expect(findOne).toHaveBeenCalledWith({
      where: expect.arrayContaining([
        expect.objectContaining({
          engineId: 'engine-1',
          resourceKind: 'process_definition',
          resourceKey: 'invoice',
          runtimeTenantId: 'finance',
          tenantId: 'tenant-default',
          tenantResolutionStatus: 'resolved',
          isActive: true,
        }),
      ]),
    });
    expect(permissionService.evaluatePermission).toHaveBeenCalledWith(
      'platform:authz:check',
      expect.objectContaining({
        tenantId: 'tenant-default',
        resourceType: 'engine_runtime_resource',
        resourceId: 'runtime-resource-1',
      }),
    );
    expect(response.body.resolvedRuntimeResource).toMatchObject({
      id: 'runtime-resource-1',
      resourceKey: 'invoice',
      tenantId: 'tenant-default',
      tenantResolutionStatus: 'resolved',
      tenantMappingId: 'mapping-1',
      tenantMappingVersion: 3,
    });
  });

  it('uses the default tenant for runtime-resource evaluation when middleware has no tenant context', async () => {
    const findOne = vi.fn().mockResolvedValue({
      id: 'runtime-resource-1',
      tenantId: 'tenant-default',
      engineId: 'engine-1',
      resourceKind: 'process_definition',
      resourceKey: 'invoice',
      runtimeTenantId: '',
      tenantResolutionStatus: 'resolved',
      tenantMappingId: null,
      tenantMappingVersion: 0,
      isActive: true,
    });
    (getDataSource as any).mockResolvedValue({
      getRepository: () => ({ findOne }),
    });

    const response = await request(app)
      .post('/api/authz/evaluate')
      .set('x-test-omit-tenant-context', 'true')
      .send({
        userId: '00000000-0000-4000-8000-000000000001',
        permission: 'platform:authz:check',
        resourceType: 'engine_runtime_resource',
        runtimeResource: {
          engineId: 'engine-1',
          resourceKind: 'process_definition',
          resourceKey: 'invoice',
        },
      });

    expect(response.status).toBe(200);
    expect(findOne).toHaveBeenCalledWith({
      where: expect.arrayContaining([
        expect.objectContaining({ tenantId: 'tenant-default' }),
      ]),
    });
    expect(permissionService.evaluatePermission).toHaveBeenCalledWith(
      'platform:authz:check',
      expect.objectContaining({
        tenantId: 'tenant-default',
        resourceType: 'engine_runtime_resource',
        resourceId: 'runtime-resource-1',
      }),
    );
  });

  it('manages external registration API clients', async () => {
    const listResponse = await request(app).get('/api/authz/api-clients');
    expect(listResponse.status).toBe(200);
    expect(listResponse.body[0]).toMatchObject({ id: 'client-1', scopes: ['engine:register'] });
    expect(listResponse.body[0]).not.toHaveProperty('secretHash');

    const createResponse = await request(app)
      .post('/api/authz/api-clients')
      .send({ name: 'Engine registration', scopes: ['engine:register'] });
    expect(createResponse.status).toBe(201);
    expect(createResponse.body.token).toBe('egac_client-1_secret');

    const rotateResponse = await request(app)
      .post('/api/authz/api-clients/00000000-0000-4000-8000-000000000040/rotate');
    expect(rotateResponse.status).toBe(200);
    expect(rotateResponse.body.token).toBe('egac_client-1_new-secret');

    const revokeResponse = await request(app)
      .delete('/api/authz/api-clients/00000000-0000-4000-8000-000000000040');
    expect(revokeResponse.status).toBe(204);
  });

  it('manages service accounts for machine role assignment', async () => {
    const listResponse = await request(app).get('/api/authz/service-accounts');
    expect(listResponse.status).toBe(200);
    expect(listResponse.body[0]).toMatchObject({
      id: 'service-account-1',
      name: 'CI deployer',
      isActive: true,
    });

    const createResponse = await request(app)
      .post('/api/authz/service-accounts')
      .send({ name: 'Release service', description: 'Release automation', scopes: ['deployment:execute'] });
    expect(createResponse.status).toBe(201);
    expect(createResponse.body.token).toBe('egsa_service-account-1_secret');
    expect(serviceAccountService.createServiceAccount).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Release service',
      description: 'Release automation',
      scopes: ['deployment:execute'],
      createdById: 'user-1',
    }));

    const rotateResponse = await request(app)
      .post('/api/authz/service-accounts/00000000-0000-4000-8000-000000000041/rotate');
    expect(rotateResponse.status).toBe(200);
    expect(rotateResponse.body.token).toBe('egsa_service-account-1_new-secret');
    expect(serviceAccountService.rotateServiceAccountToken).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000041');

    const revokeResponse = await request(app)
      .delete('/api/authz/service-accounts/00000000-0000-4000-8000-000000000041');
    expect(revokeResponse.status).toBe(204);
    expect(serviceAccountService.revokeServiceAccount).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000041');
  });

  it('manages external engine systems', async () => {
    const listResponse = await request(app).get('/api/authz/external-engine-systems');
    expect(listResponse.status).toBe(200);
    expect(listResponse.body[0]).toMatchObject({
      id: 'system-1',
      key: 'fleet-manager',
      name: 'Fleet Manager',
      defaultManagementMode: 'hybrid',
      defaultFieldOwnership: { connection: 'external', auth: 'external', display: 'manual' },
      isActive: true,
    });

    const system = {
      id: 'system-2',
      tenantId: null,
      key: 'cmdb',
      name: 'CMDB',
      description: null,
      defaultManagementMode: 'external_managed',
      defaultFieldOwnershipJson: JSON.stringify({ connection: 'external', auth: 'external', display: 'manual' }),
      isActive: true,
      createdById: 'user-1',
      createdAt: 1000,
      updatedAt: 1000,
    };
    const insert = vi.fn().mockResolvedValue(undefined);
    const update = vi.fn().mockResolvedValue(undefined);
    const createFindOne = vi.fn().mockResolvedValue(null);
    const updateFindOne = vi.fn().mockResolvedValue(system);
    const findOneBy = vi.fn().mockResolvedValue({ ...system, name: 'Updated CMDB', updatedAt: 1200 });

    (getDataSource as any).mockResolvedValueOnce({
      getRepository: () => ({
        findOne: createFindOne,
        insert,
      }),
    });
    const createResponse = await request(app)
      .post('/api/authz/external-engine-systems')
      .send({
        key: 'cmdb',
        name: 'CMDB',
        defaultManagementMode: 'external_managed',
        defaultFieldOwnership: { connection: 'external', auth: 'external', display: 'manual' },
      });
    expect(createResponse.status).toBe(201);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      key: 'cmdb',
      defaultManagementMode: 'external_managed',
      defaultFieldOwnershipJson: expect.stringContaining('connection'),
    }));

    (getDataSource as any).mockResolvedValueOnce({
      getRepository: () => ({
        findOne: updateFindOne,
        findOneBy,
        update,
      }),
    });
    const updateResponse = await request(app)
      .put('/api/authz/external-engine-systems/system-2')
      .send({ name: 'Updated CMDB', defaultManagementMode: 'hybrid' });
    expect(updateResponse.status).toBe(200);
    expect(update).toHaveBeenCalledWith({ id: 'system-2' }, expect.objectContaining({
      name: 'Updated CMDB',
      defaultManagementMode: 'hybrid',
    }));

    (getDataSource as any).mockResolvedValueOnce({
      getRepository: () => ({
        findOne: updateFindOne,
        update,
      }),
    });
    const archiveResponse = await request(app).delete('/api/authz/external-engine-systems/system-2');
    expect(archiveResponse.status).toBe(204);
    expect(update).toHaveBeenCalledWith({ id: 'system-2' }, expect.objectContaining({ isActive: false }));
  });

  it('lists externally registered engines and registration audit entries', async () => {
    const listResponse = await request(app).get('/api/authz/external-engines');
    expect(listResponse.status).toBe(200);
    expect(listResponse.body[0]).toMatchObject({
      id: 'engine-1',
      registrationId: 'registration-1',
      externalId: 'cluster-a/prod',
      connectionMode: 'customer_sidecar',
      labels: { environment: 'prod', region: 'eu' },
      registrationSource: 'external_api',
      apiClientId: 'client-1',
      externalSystemId: 'system-1',
      externalSystemName: 'Fleet Manager',
      managementMode: 'hybrid',
      fieldOwnership: { connection: 'external', auth: 'external', display: 'manual' },
      driftStatus: 'in_sync',
      lifecycleStatus: 'active',
      lastExternalSyncAt: 1000,
      capabilities: { operations: ['engine.read'], supportLevel: 'compatible' },
      capabilityStatus: 'mismatch',
      capabilityDiagnostics: {
        status: 'mismatch',
        reportedOperations: ['engine.read'],
        missingOperations: expect.arrayContaining(['engine.deploy', 'engine.admin']),
        mismatchedQueryCapabilities: expect.arrayContaining(['processDefinitionKey', 'batches']),
        extraOperations: [],
        recommendation: 'Update the external registration payload to report the missing operations and query capabilities, then run reconcile again.',
      },
    });
    expect(listResponse.body[0]).not.toHaveProperty('passwordEnc');

    const auditResponse = await request(app).get('/api/authz/external-engines/engine-1/audit');
    expect(auditResponse.status).toBe(200);
    expect(permissionService.hasPermission).toHaveBeenCalledWith(
      'platform:engine-registration:manage',
      expect.objectContaining({
        userId: 'user-1',
        resourceType: 'engine',
        resourceId: 'engine-1',
      })
    );
    expect(auditResponse.body[0]).toMatchObject({
      id: 'audit-1',
      action: 'engine.external_registration.update',
      details: {
        externalId: 'cluster-a/prod',
        labels: { environment: 'prod' },
      },
    });
  });

  it('excludes externally registered engines owned by another tenant', async () => {
    const ownRegistration = { id: 'registration-own', engineId: 'engine-own', externalId: 'own', registrationSource: 'external_api', externalSystemId: null, labelsJson: '{}', capabilitiesJson: null, lastRegisteredAt: 1, updatedAt: 1 };
    const foreignRegistration = { ...ownRegistration, id: 'registration-foreign', engineId: 'engine-foreign', externalId: 'foreign' };
    const ownEngine = { id: 'engine-own', tenantId: 'tenant-a', name: 'Own engine', baseUrl: 'https://own.example.com', type: 'camunda8', externalId: 'own', registrationSource: 'external_api', capabilitiesJson: null, createdAt: 1, updatedAt: 1 };
    const foreignEngine = { ...ownEngine, id: 'engine-foreign', tenantId: 'tenant-b', name: 'Foreign engine', externalId: 'foreign' };
    (getDataSource as any).mockResolvedValue({
      getRepository: (entity: any) => {
        if (entity.name === 'ExternalEngineRegistration') return { find: vi.fn().mockResolvedValue([ownRegistration, foreignRegistration]) };
        if (entity.name === 'Engine') return { find: vi.fn().mockResolvedValue([ownEngine, foreignEngine]) };
        if (entity.name === 'ExternalEngineSystem') return { find: vi.fn().mockResolvedValue([]) };
        return { find: vi.fn().mockResolvedValue([]) };
      },
    });
    const tenantApp = express();
    tenantApp.use(express.json());
    tenantApp.use((req, _res, next) => {
      req.tenant = { tenantId: 'tenant-a' } as any;
      next();
    });
    tenantApp.use(authzRouter);

    const response = await request(tenantApp).get('/api/authz/external-engines');

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({ id: 'engine-own', externalId: 'own' });
  });

  it('filters external engine registration audit entries', async () => {
    const auditFind = vi.fn().mockResolvedValue([
      {
        id: 'audit-2',
        userId: 'admin-1',
        action: 'engine.external_registration.decommission',
        resourceType: 'engine',
        resourceId: 'engine-1',
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
        details: JSON.stringify({ externalId: 'cluster-a/prod' }),
        createdAt: 1001,
      },
    ]);
    (getDataSource as any).mockResolvedValue({
      getRepository: (entity: any) => {
        if (entity.name === 'Engine') {
          return {
            findOne: vi.fn().mockResolvedValue({
              id: 'engine-1',
              tenantId: 'tenant-default',
              tenancyMode: 'dedicated',
            }),
          };
        }
        if (entity.name === 'AuditLog') {
          return { find: auditFind };
        }
        return { find: vi.fn().mockResolvedValue([]) };
      },
    });

    const response = await request(app).get('/api/authz/external-engines/engine-1/audit?action=engine.external_registration.decommission&limit=10');

    expect(response.status).toBe(200);
    expect(auditFind).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        action: 'engine.external_registration.decommission',
      }),
      take: 10,
    }));
    expect(response.body[0]).toMatchObject({
      action: 'engine.external_registration.decommission',
    });
  });

  it('reconciles external engine capability and materialization state', async () => {
    const engineUpdate = vi.fn().mockResolvedValue(undefined);
    const registrationUpdate = vi.fn().mockResolvedValue(undefined);
    const queryCapabilities = {
      processDefinitionKey: true,
      decisionDefinitionKey: true,
      tenantFilters: true,
      instanceLineage: true,
      history: true,
      jobs: true,
      incidents: true,
      batches: false,
      counts: true,
    };
    const registration = {
      id: 'registration-1',
      engineId: 'engine-1',
      externalId: 'cluster-a/prod',
      externalSystemId: 'system-1',
      lifecycleStatus: 'active',
      capabilitiesJson: JSON.stringify({ operations: ['engine.read', 'engine.deploy', 'engine.instance.mutate', 'engine.task.mutate', 'engine.job.mutate', 'engine.batch.admin', 'engine.admin'], queryCapabilities }),
      capabilityStatus: 'mismatch',
    };
    const engine = {
      id: 'engine-1',
      tenantId: 'tenant-default',
      tenancyMode: 'dedicated',
      type: 'ion',
      externalId: 'cluster-a/prod',
      externalSystemId: 'system-1',
      registrationSource: 'external_api',
      lifecycleStatus: 'active',
      capabilitiesJson: registration.capabilitiesJson,
      capabilityStatus: 'mismatch',
    };
    (getDataSource as any).mockResolvedValue({
      getRepository: (entity: any) => {
        if (entity.name === 'ExternalEngineRegistration') {
          return {
            findOne: vi.fn().mockResolvedValue(registration),
            update: registrationUpdate,
          };
        }
        if (entity.name === 'Engine') {
          return {
            findOne: vi.fn().mockResolvedValue(engine),
            findOneBy: vi.fn().mockResolvedValue(engine),
            update: engineUpdate,
          };
        }
        return { find: vi.fn().mockResolvedValue([]) };
      },
    });
    vi.mocked(engineSetService.materializeEngineSetsForEngine).mockResolvedValueOnce([
      { engineSetId: 'set-1', matched: 1, created: 0, updated: 1, removed: 0 } as any,
    ]);

    const response = await request(app).post('/api/authz/external-engines/engine-1/reconcile');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      engineId: 'engine-1',
      externalId: 'cluster-a/prod',
      lifecycleStatus: 'active',
      capabilityStatus: 'in_sync',
      capabilityDiagnostics: {
        status: 'in_sync',
        missingOperations: [],
        mismatchedQueryCapabilities: [],
        reportedOperations: expect.arrayContaining(['engine.read', 'engine.deploy']),
      },
      materializationDiagnostics: {
        engineSetCount: 1,
        matched: 1,
        created: 0,
        updated: 1,
        removed: 0,
        status: 'ok',
      },
    });
    expect(engineUpdate).toHaveBeenCalledWith({ id: 'engine-1' }, expect.objectContaining({
      capabilityStatus: 'in_sync',
    }));
    expect(registrationUpdate).toHaveBeenCalledWith({ id: 'registration-1' }, expect.objectContaining({
      capabilityStatus: 'in_sync',
    }));
    expect(engineSetService.materializeEngineSetsForEngine).toHaveBeenCalledWith('engine-1', 'tenant-default');
  });

  it('decommissions and reactivates externally registered engines from Access Control', async () => {
    const engineUpdate = vi.fn().mockResolvedValue(undefined);
    const registrationUpdate = vi.fn().mockResolvedValue(undefined);
    const decommissionEngine = vi.spyOn(engineService, 'decommissionEngine')
      .mockResolvedValue(undefined);
    const registration = {
      id: 'registration-1',
      engineId: 'engine-1',
      externalId: 'cluster-a/prod',
      externalSystemId: 'system-1',
      lifecycleStatus: 'active',
      driftStatus: 'in_sync',
    };
    const engine = {
      id: 'engine-1',
      tenantId: 'tenant-default',
      tenancyMode: 'dedicated',
      type: 'camunda8',
      externalId: 'cluster-a/prod',
      externalSystemId: 'system-1',
      registrationSource: 'external_api',
      lifecycleStatus: 'active',
      driftStatus: 'in_sync',
    };
    const getRepository = (entity: any) => {
        if (entity.name === 'ExternalEngineRegistration') {
          return {
            findOne: vi.fn().mockResolvedValue(registration),
            update: registrationUpdate,
          };
        }
        if (entity.name === 'Engine') {
          return {
            findOne: vi.fn().mockResolvedValue(engine),
            findOneBy: vi.fn().mockResolvedValue(engine),
            update: engineUpdate,
          };
        }
        return { find: vi.fn().mockResolvedValue([]) };
      };
    (getDataSource as any).mockResolvedValue({
      getRepository,
      transaction: (callback: (manager: unknown) => unknown) => callback({ getRepository }),
    });

    const response = await request(app)
      .post('/api/authz/external-engines/engine-1/decommission')
      .send({ reason: 'Retired cluster' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      decommissioned: true,
      engineId: 'engine-1',
      lifecycleStatus: 'decommissioned',
    });
    expect(registrationUpdate).toHaveBeenCalledWith({ id: 'registration-1' }, expect.objectContaining({
      lifecycleStatus: 'decommissioned',
      driftStatus: 'decommissioned',
    }));
    expect(decommissionEngine).toHaveBeenCalledWith(
      'engine-1',
      {},
      expect.objectContaining({ getRepository }),
    );

    const decommissionedRegistration = { ...registration, lifecycleStatus: 'decommissioned', driftStatus: 'decommissioned' };
    const decommissionedEngine = { ...engine, lifecycleStatus: 'decommissioned', driftStatus: 'decommissioned' };
    const findReactivationEngine = vi.fn()
      .mockResolvedValueOnce(decommissionedEngine)
      .mockResolvedValueOnce(null);
    (getDataSource as any).mockResolvedValue({
      getRepository: (entity: any) => {
        if (entity.name === 'ExternalEngineRegistration') {
          return {
            findOne: vi.fn().mockResolvedValue(decommissionedRegistration),
            update: registrationUpdate,
          };
        }
        if (entity.name === 'Engine') {
          return {
            findOne: findReactivationEngine,
            findOneBy: vi.fn().mockResolvedValue(decommissionedEngine),
            update: engineUpdate,
          };
        }
        return { find: vi.fn().mockResolvedValue([]) };
      },
    });
    vi.mocked(engineSetService.materializeEngineSetsForEngine).mockResolvedValueOnce([
      { engineSetId: 'set-1', matched: 1, created: 1, updated: 0, removed: 0 } as any,
    ]);

    const reactivateResponse = await request(app)
      .post('/api/authz/external-engines/engine-1/reactivate')
      .send({ reason: 'Cluster restored' });

    expect(reactivateResponse.status).toBe(200);
    expect(reactivateResponse.body).toMatchObject({
      reactivated: true,
      engineId: 'engine-1',
      lifecycleStatus: 'active',
      driftStatus: 'in_sync',
    });
    expect(engineUpdate).toHaveBeenCalledWith({ id: 'engine-1' }, expect.objectContaining({
      lifecycleStatus: 'active',
      driftStatus: 'in_sync',
    }));
    expect(registrationUpdate).toHaveBeenCalledWith({ id: 'registration-1' }, expect.objectContaining({
      lifecycleStatus: 'active',
      driftStatus: 'in_sync',
    }));
    expect(engineSetService.materializeEngineSetsForEngine).toHaveBeenCalledWith('engine-1', 'tenant-default');
  });

  it('refuses to reactivate a retired external engine after a replacement is active', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const retired = {
      id: 'engine-retired',
      tenantId: 'tenant-default',
      externalId: 'cluster-a/prod',
      registrationSource: 'external_api',
      lifecycleStatus: 'decommissioned',
    };
    const registration = {
      id: 'registration-retired',
      engineId: retired.id,
      externalId: retired.externalId,
      lifecycleStatus: 'decommissioned',
    };
    const findReactivationEngine = vi.fn()
      .mockResolvedValueOnce(retired)
      .mockResolvedValueOnce({
        id: 'engine-replacement',
        externalId: retired.externalId,
        lifecycleStatus: 'active',
      });
    (getDataSource as any).mockResolvedValue({
      getRepository: (entity: any) => {
        if (entity.name === 'ExternalEngineRegistration') {
          return { findOne: vi.fn().mockResolvedValue(registration), update };
        }
        if (entity.name === 'Engine') {
          return {
            findOneBy: vi.fn().mockResolvedValue(retired),
            findOne: findReactivationEngine,
            update,
          };
        }
        return { find: vi.fn().mockResolvedValue([]) };
      },
    });

    const response = await request(app)
      .post(`/api/authz/external-engines/${retired.id}/reactivate`)
      .send({ reason: 'Attempted stale recovery' });

    expect(response.status).toBe(409);
    expect(update).not.toHaveBeenCalled();
  });

  it('does not decommission an externally registered engine from another tenant', async () => {
    const engineUpdate = vi.fn();
    const foreignEngine = {
      id: 'engine-foreign',
      tenantId: 'tenant-b',
      registrationSource: 'external_api',
      externalId: 'foreign',
    };
    (getDataSource as any).mockResolvedValue({
      getRepository: (entity: any) => entity.name === 'Engine'
        ? { findOne: vi.fn().mockResolvedValue(foreignEngine), findOneBy: vi.fn().mockResolvedValue(foreignEngine), update: engineUpdate }
        : { findOne: vi.fn().mockResolvedValue(null), update: vi.fn(), delete: vi.fn() },
    });
    const tenantApp = express();
    tenantApp.use(express.json());
    tenantApp.use((req, _res, next) => {
      req.tenant = { tenantId: 'tenant-a' } as any;
      next();
    });
    tenantApp.use(authzRouter);

    const response = await request(tenantApp)
      .post('/api/authz/external-engines/engine-foreign/decommission')
      .send({ reason: 'Cross-tenant request' });

    expect(response.status).toBe(403);
    expect(engineUpdate).not.toHaveBeenCalled();
  });

  it('manages project-engine targets and evaluates deployment eligibility', async () => {
    const listResponse = await request(app).get('/api/authz/project-engine-targets?projectId=project-1');
    expect(listResponse.status).toBe(200);
    expect(listResponse.body[0]).toMatchObject({
      id: 'target-1',
      projectId: 'project-1',
      engineId: 'engine-1',
      allowManualDeploy: true,
    });
    expect(projectEngineTargetService.listTargets).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
    }));

    const createResponse = await request(app)
      .post('/api/authz/project-engine-targets')
      .send({
        projectId: 'project-1',
        engineId: 'engine-1',
        allowManualDeploy: true,
        allowCiDeploy: true,
      });
    expect(createResponse.status).toBe(201);
    expect(createResponse.body.id).toBe('target-1');

    const evaluateResponse = await request(app)
      .post('/api/authz/project-engine-targets/evaluate')
      .send({
        userId: 'user-1',
        projectId: 'project-1',
        engineId: 'engine-1',
        mode: 'manual',
      });
    expect(evaluateResponse.status).toBe(200);
    expect(evaluateResponse.body.allowed).toBe(true);
    expect(deploymentEligibilityService.evaluate).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      projectId: 'project-1',
      engineId: 'engine-1',
      mode: 'manual',
    }));

    const syncResponse = await request(app)
      .post('/api/authz/project-engine-targets/sync-legacy')
      .send({ projectId: 'project-1' });
    expect(syncResponse.status).toBe(200);
    expect(syncResponse.body.createdOrUpdated).toBe(1);

    const updateResponse = await request(app)
      .put('/api/authz/project-engine-targets/target-1')
      .send({ allowApiDeploy: true });
    expect(updateResponse.status).toBe(200);

    const deleteResponse = await request(app).delete('/api/authz/project-engine-targets/target-1');
    expect(deleteResponse.status).toBe(204);
  });

  it('previews configuration bundles without mutating authorization state', async () => {
    const bundle = {
      apiVersion: 'enterpriseglue.ai/v1alpha1',
      kind: 'EnterpriseGlueConfigBundle',
      metadata: { key: 'acme.authz', owner: 'platform' },
      tenantKey: 'acme',
      mode: 'preview_only',
      settings: {},
      imports: ['./groups.json'],
    };

    const validResponse = await request(app)
      .post('/api/authz/config-bundles/preview')
      .send({
        bundle,
        files: {
          './groups.json': {
            groups: [{ key: 'group.ops', name: 'Operations' }],
          },
        },
      });

    expect(validResponse.status).toBe(200);
    expect(validResponse.body).toMatchObject({
      valid: true,
      canonicalHash: expect.any(String),
      counts: { './groups.json': 1 },
      errors: [],
    });

    const invalidResponse = await request(app)
      .post('/api/authz/config-bundles/preview')
      .send({ bundle, files: { './roles.json': { roles: [] } } });

    expect(invalidResponse.status).toBe(422);
    expect(invalidResponse.body).toMatchObject({ valid: false });
  });

  it('imports a bounded Git raw-file source through the config preview permission', async () => {
    const response = await request(app)
      .post('/api/authz/config-bundles/import-url')
      .send({ url: 'https://raw.githubusercontent.com/acme/config/main/bundle.json' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ bundle: { metadata: { key: 'remote.authz' } }, files: {} });
    expect(configBundleRemoteSourceMock.import).toHaveBeenCalledWith('https://raw.githubusercontent.com/acme/config/main/bundle.json');
  });

  it('rejects oversized configuration bundle JSON before preview compilation', async () => {
    const response = await request(app)
      .post('/api/authz/config-bundles/preview')
      .send({
        bundle: {},
        files: { './groups.json': { padding: 'x'.repeat(1024 * 1024) } },
      });

    expect(response.status).toBe(413);
    expect(response.body).toEqual({
      error: 'Request payload exceeds the allowed size',
      code: 'PAYLOAD_TOO_LARGE',
      maxBytes: 1024 * 1024,
    });
  });

  it('uses platform policy when previewing credentialless customer sidecars', async () => {
    const payload = {
      bundle: {
        apiVersion: 'enterpriseglue.ai/v1alpha1',
        kind: 'EnterpriseGlueConfigBundle',
        metadata: { key: 'acme.sidecar', owner: 'platform' },
        tenantKey: 'acme',
        mode: 'preview_only',
        settings: {},
        imports: ['./engines.json'],
      },
      files: {
        './engines.json': {
          engines: [{
            key: 'engine.private-sidecar', name: 'Private sidecar', type: 'ion',
            baseUrl: 'https://sidecar.example.com/engine-rest',
            connectionMode: 'customer_sidecar', auth: { type: 'none' },
          }],
        },
      },
    };

    platformSettingsServiceMock.get.mockResolvedValueOnce({ credentiallessCustomerSidecarsEnabled: false });
    const blocked = await request(app).post('/api/authz/config-bundles/preview').send(payload);
    expect(blocked.status).toBe(422);
    expect(blocked.body.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Credentialless customer-sidecar endpoints are disabled by platform policy' }),
    ]));

    platformSettingsServiceMock.get.mockResolvedValueOnce({ credentiallessCustomerSidecarsEnabled: true });
    const permitted = await request(app).post('/api/authz/config-bundles/preview').send(payload);
    expect(permitted.status).toBe(200);
    expect(permitted.body).toMatchObject({ valid: true, canonicalHash: expect.any(String) });
  });

  it('checks configuration secret references without returning secret values', async () => {
    const response = await request(app)
      .post('/api/authz/config-bundles/validate-secret-refs')
      .send({
        bundle: {
          apiVersion: 'enterpriseglue.ai/v1alpha1', kind: 'EnterpriseGlueConfigBundle', metadata: { key: 'acme.authz', owner: 'platform' },
          tenantKey: 'acme', mode: 'preview_only', settings: {}, imports: ['./engines.json'],
        },
        files: { './engines.json': { engines: [] } },
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      valid: true,
      available: false,
      availabilityHash: 'secret-preflight-hash',
      references: [expect.objectContaining({ reference: 'MISSING_ENGINE_TOKEN', available: false })],
    });
    expect(JSON.stringify(response.body)).not.toContain('secret-value');
    expect(configBundleSecretPreflightMock.check).toHaveBeenCalledTimes(1);
  });

  it('returns a persisted-state diff for validated configuration bundles', async () => {
    const response = await request(app)
      .post('/api/authz/config-bundles/diff')
      .send({
        bundle: {
          apiVersion: 'enterpriseglue.ai/v1alpha1',
          kind: 'EnterpriseGlueConfigBundle',
          metadata: { key: 'acme.authz', owner: 'platform' },
          tenantKey: 'acme',
          mode: 'preview_only',
          settings: {},
          imports: ['./groups.json'],
        },
        files: {
          './groups.json': { groups: [{ key: 'group.ops', name: 'Operations' }] },
        },
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      valid: true,
      canonicalHash: expect.any(String),
      changes: [expect.objectContaining({ objectType: 'group', key: 'group.ops', operation: 'create' })],
      warnings: [],
      requiredAcknowledgements: [],
      affectedPrincipals: { affectedGroupCount: 0, affectedUserCount: 0, externalIdentityMappingChangeCount: 0 },
    });
  });

  it('applies a configuration bundle only through the hash-bound apply contract', async () => {
    const response = await request(app)
      .post('/api/authz/config-bundles/apply')
      .send({
        bundle: { apiVersion: 'enterpriseglue.ai/v1alpha1', kind: 'EnterpriseGlueConfigBundle' },
        files: {},
        expectedPreviewHash: 'preview-hash',
        acknowledgements: ['config.engine_set_broad:engines.all'],
        idempotencyKey: 'config-apply-2026-07-13',
        expectedTenantScope: 'platform',
        identityReconciliationMode: 'preview',
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      canonicalHash: 'preview-hash',
      created: 2,
      reconciliation: { status: 'completed', engineSetCount: 0, runtimeResourceSetCount: 0, engineCount: 0 },
    });
    expect(configBundleApplyMock.apply).toHaveBeenCalledWith(expect.objectContaining({
      expectedPreviewHash: 'preview-hash',
      acknowledgements: ['config.engine_set_broad:engines.all'],
      idempotencyKey: 'config-apply-2026-07-13',
      expectedTenantScope: 'platform',
      identityReconciliationMode: 'preview',
      actorId: 'user-1',
    }), expect.objectContaining({ credentiallessCustomerSidecarsEnabled: false }));
  });

  it('returns an accepted apply receipt when identity replay continues asynchronously', async () => {
    configBundleApplyMock.apply.mockResolvedValueOnce({
      canonicalHash: 'preview-hash', created: 0, updated: 1, archived: 0, changes: [], applyRunId: 'config-run-async',
      reconciliation: {
        status: 'completed', engineSetCount: 0, runtimeResourceSetCount: 0, engineCount: 0,
        identitySnapshot: { mode: 'apply', status: 'truncated', providerCount: 1, scanned: 500, created: 4, removed: 1, failed: 0 },
      },
    });

    const response = await request(app)
      .post('/api/authz/config-bundles/apply')
      .send({
        bundle: { apiVersion: 'enterpriseglue.ai/v1alpha1', kind: 'EnterpriseGlueConfigBundle' },
        files: {}, expectedPreviewHash: 'preview-hash', idempotencyKey: 'config-apply-async-2026-07-14',
      });

    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({
      applyRunId: 'config-run-async',
      reconciliation: { identitySnapshot: { status: 'truncated', providerCount: 1 } },
    });
  });

  it('returns an accepted apply receipt when runtime reconciliation is queued', async () => {
    configBundleApplyMock.apply.mockResolvedValueOnce({
      canonicalHash: 'preview-hash', created: 0, updated: 1, archived: 0, changes: [], applyRunId: 'config-run-runtime',
      reconciliation: {
        status: 'completed', engineSetCount: 1, runtimeResourceSetCount: 1, engineCount: 1,
        identitySnapshot: { mode: 'apply', status: 'completed', providerCount: 0, scanned: 0, created: 0, removed: 0, failed: 0 },
        runtimeReconciliation: { status: 'queued', taskId: 'runtime-task-1', engineSetCount: 1, runtimeResourceSetCount: 1, engineCount: 1 },
      },
    });

    const response = await request(app)
      .post('/api/authz/config-bundles/apply')
      .send({ bundle: { apiVersion: 'enterpriseglue.ai/v1alpha1', kind: 'EnterpriseGlueConfigBundle' }, files: {}, expectedPreviewHash: 'preview-hash', idempotencyKey: 'config-apply-runtime-2026-07-14' });

    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({
      applyRunId: 'config-run-runtime',
      reconciliation: { runtimeReconciliation: { status: 'queued', taskId: 'runtime-task-1' } },
    });
  });

  it('requires target-management permission when config apply transfers target ownership', async () => {
    sharedPermissionServiceMock.hasPermission.mockImplementation(async (permission: string) =>
      permission !== 'platform:project-engine-targets:manage'
    );
    const response = await request(app)
      .post('/api/authz/config-bundles/apply')
      .send({
        bundle: { apiVersion: 'enterpriseglue.ai/v1alpha1', kind: 'EnterpriseGlueConfigBundle' },
        files: {
          './project-engine-targets.json': {
            projectEngineTargets: [{
              projectRef: { id: 'project-1' },
              engineRef: { engineKey: 'engine.central' },
              transferOwnership: { reason: 'Move target into reviewed configuration.' },
            }],
          },
        },
        expectedPreviewHash: 'preview-hash',
      });

    expect(response.status).toBe(403);
    expect(sharedPermissionServiceMock.hasPermission).toHaveBeenCalledWith(
      'platform:project-engine-targets:manage',
      expect.objectContaining({ userId: 'user-1', resourceType: 'platform' }),
    );
    expect(configBundleApplyMock.apply).not.toHaveBeenCalled();
  });

  it('lists persisted configuration apply runs with retry lineage', async () => {
    const response = await request(app).get('/api/authz/config-bundles/runs');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      expect.objectContaining({
        id: 'config-run-1',
        bundleKey: 'acme.authz',
        idempotencyKey: 'config-apply-2026-07-13',
        status: 'succeeded',
        created: 2,
        updated: 1,
        reconciliation: expect.objectContaining({ identitySnapshot: expect.objectContaining({ status: 'completed', scanned: 2 }) }),
        bootstrap: expect.objectContaining({ status: 'applied', reconciliation: 'completed', issueCode: null }),
      }),
    ]);
  });

  it('returns one persisted configuration apply receipt with its planned changes', async () => {
    const response = await request(app).get('/api/authz/config-bundles/runs/config-run-1');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: 'config-run-1',
      bundleKey: 'acme.authz',
      changes: [expect.objectContaining({ objectType: 'group', key: 'group.ops', operation: 'create' })],
      reconciliation: expect.objectContaining({ identitySnapshot: expect.objectContaining({ scanned: 2 }) }),
      bootstrap: expect.objectContaining({ status: 'applied', secretPreflight: 'passed' }),
    });
  });

  it('returns durable stored identity replay tasks only for a visible configuration apply', async () => {
    const response = await request(app).get('/api/authz/config-bundles/runs/config-run-1/identity-replay-tasks');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([expect.objectContaining({ id: 'identity-task-1', providerId: 'provider-1', status: 'queued', scanned: 500 })]);
    expect(configBundleIdentityReplayTaskMock.listForApplyRun).toHaveBeenCalledWith('config-run-1', 'tenant-default');
  });

  it('returns durable runtime reconciliation tasks only for a visible configuration apply', async () => {
    const response = await request(app).get('/api/authz/config-bundles/runs/config-run-1/runtime-reconciliation-tasks');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([expect.objectContaining({ id: 'runtime-task-1', status: 'queued', runtimeResourceSetIds: ['runtime-set-1'], engineIds: ['engine-1'] })]);
    expect(configBundleRuntimeReconciliationTaskMock.listForApplyRun).toHaveBeenCalledWith('config-run-1', 'tenant-default');
  });

  it('allows configuration-scoped API clients to apply bundles and preserves machine audit lineage', async () => {
    const response = await request(app)
      .post('/api/authz/config-bundles/apply')
      .set('Authorization', 'Bearer egac_client-1_secret')
      .send({
        bundle: { apiVersion: 'enterpriseglue.ai/v1alpha1', kind: 'EnterpriseGlueConfigBundle' },
        files: {},
        expectedPreviewHash: 'preview-hash',
        ciProvenance: {
          repository: 'EnterpriseGlue/enterpriseglue-the-bridge-oss',
          revision: 'a'.repeat(40),
          workflowRunId: '123456',
          workflow: 'Configuration Bundle',
        },
      });

    expect(response.status).toBe(200);
    expect(apiClientAuthMock.requireApiClientAction).toHaveBeenCalledWith(
      'config:bundle:manage',
      'platform.config-bundles.apply',
    );
    expect(configBundleApplyMock.apply).toHaveBeenCalledWith(expect.objectContaining({
      actorId: 'user-1',
      ciProvenance: {
        repository: 'EnterpriseGlue/enterpriseglue-the-bridge-oss',
        revision: 'a'.repeat(40),
        workflowRunId: '123456',
        workflow: 'Configuration Bundle',
      },
    }), expect.objectContaining({ credentiallessCustomerSidecarsEnabled: false }));
    expect(auditLogMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'authz.config_bundle.apply',
      details: expect.objectContaining({
        actorType: 'api_client',
        apiClientId: 'client-1',
        ciProvenance: expect.objectContaining({ repository: 'EnterpriseGlue/enterpriseglue-the-bridge-oss', revision: 'a'.repeat(40) }),
      }),
    }));
  });

  it('allows configuration-scoped API clients to preview bundles from CI', async () => {
    const response = await request(app)
      .post('/api/authz/config-bundles/preview')
      .set('Authorization', 'Bearer egac_client-1_secret')
      .send({
        bundle: {
          apiVersion: 'enterpriseglue.ai/v1alpha1', kind: 'EnterpriseGlueConfigBundle', metadata: { key: 'acme.authz', owner: 'platform' },
          tenantKey: 'acme', mode: 'preview_only', settings: {}, imports: ['./groups.json'],
        },
        files: { './groups.json': { groups: [] } },
      });

    expect(response.status).toBe(200);
    expect(apiClientAuthMock.requireApiClientAction).toHaveBeenCalledWith(
      'config:bundle:manage',
      'platform.config-bundles.preview',
    );
  });

});

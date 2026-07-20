import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticateToken: vi.fn(),
  authenticateServiceAccountToken: vi.fn(),
  evaluateDeploymentEligibility: vi.fn(),
  hasPermission: vi.fn(),
  evaluatePolicyGate: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/ApiClientService.js', () => ({
  ApiClientScopes: {
    CONFIG_BUNDLE_MANAGE: 'config:bundle:manage',
    ENGINE_REGISTER: 'engine:register',
    DEPLOYMENT_EXECUTE: 'deployment:execute',
  },
  apiClientService: {
    authenticateToken: mocks.authenticateToken,
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/ServiceAccountService.js', () => ({
  SERVICE_ACCOUNT_TOKEN_PREFIX: 'egsa',
  ServiceAccountScopes: {
    DEPLOYMENT_EXECUTE: 'deployment:execute',
  },
  serviceAccountService: {
    authenticateToken: mocks.authenticateServiceAccountToken,
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/DeploymentEligibilityService.js', () => ({
  deploymentEligibilityService: {
    evaluate: mocks.evaluateDeploymentEligibility,
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js', () => ({
  permissionService: {
    hasPermission: mocks.hasPermission,
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/PolicyService.js', () => ({
  policyService: {
    evaluateGate: mocks.evaluatePolicyGate,
  },
}));

import { requireApiClientAction, requireApiClientScope, requireApiDeploymentEligibility } from '@enterpriseglue/shared/middleware/apiClientAuth.js';

describe('apiClientAuth middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateToken.mockResolvedValue({
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
    mocks.authenticateServiceAccountToken.mockResolvedValue({
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
    mocks.evaluateDeploymentEligibility.mockResolvedValue({
      allowed: true,
      decision: 'allow',
      mode: 'api',
      projectId: 'project-1',
      engineId: 'engine-1',
      checks: [],
      reasons: [],
    });
    mocks.hasPermission.mockResolvedValue(true);
    mocks.evaluatePolicyGate.mockResolvedValue({ decision: 'allow', reason: 'no-policy-deny' });
  });

  it('authenticates engine-registration API clients and authorizes the registered action', async () => {
    mocks.authenticateToken.mockResolvedValueOnce({
      id: 'api-client-1',
      name: 'Engine registrar',
      tokenPrefix: 'egac_api-cli',
      scopes: ['engine:register'],
      isActive: true,
      createdById: 'admin-1',
      lastUsedAt: null,
      revokedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      authenticatedAt: Date.now(),
    });
    const req: any = {
      headers: { authorization: 'Bearer token-1' },
      tenant: { tenantId: 'tenant-1' },
    };
    const next = vi.fn();

    await requireApiClientAction('engine:register', 'engine.external-registration.upsert')(req, {} as any, next);

    expect(mocks.authenticateToken).toHaveBeenCalledWith('token-1', 'engine:register');
    expect(mocks.hasPermission).toHaveBeenCalledWith('platform:engine-registration:manage', {
      principalType: 'api_client',
      principalId: 'api-client-1',
      tenantId: 'tenant-1',
      resourceType: 'platform',
    });
    expect(req.apiClient).toMatchObject({ id: 'api-client-1' });
    expect(next).toHaveBeenCalledWith();
  });

  it('denies engine-registration API clients without the required action permission', async () => {
    mocks.hasPermission.mockResolvedValueOnce(false);
    const req: any = {
      headers: { authorization: 'Bearer token-1' },
      tenant: { tenantId: 'tenant-1' },
    };
    const next = vi.fn();

    await requireApiClientAction('engine:register', 'engine.external-registration.upsert')(req, {} as any, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 403,
      message: 'API client is not authorized for action: engine.external-registration.upsert',
    }));
  });

  it('denies an API client when an explicit policy deny overrides its scoped grant', async () => {
    mocks.evaluatePolicyGate.mockResolvedValueOnce({
      decision: 'deny',
      reason: 'policy:registration-freeze',
    });
    const req: any = {
      headers: { authorization: 'Bearer token-1' },
      tenant: { tenantId: 'tenant-1' },
    };
    const next = vi.fn();

    await requireApiClientAction('engine:register', 'engine.external-registration.upsert')(req, {} as any, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 403,
      message: 'API client is not authorized for action: engine.external-registration.upsert: policy:registration-freeze',
    }));
    expect(mocks.evaluatePolicyGate).toHaveBeenCalledWith('platform:engine-registration:manage', {
      principalType: 'api_client',
      principalId: 'api-client-1',
      tenantId: 'tenant-1',
      resourceType: 'platform',
      resourceId: undefined,
    });
  });

  it('authorizes configuration API clients only with the configuration scope and RBAC action', async () => {
    mocks.authenticateToken.mockResolvedValueOnce({
      id: 'api-client-1',
      name: 'Configuration automation',
      tokenPrefix: 'egac_api-cli',
      scopes: ['config:bundle:manage'],
      isActive: true,
      createdById: 'admin-1',
      lastUsedAt: null,
      revokedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      authenticatedAt: Date.now(),
    });
    const req: any = {
      headers: { authorization: 'Bearer token-1' },
      tenant: { tenantId: 'tenant-1' },
    };
    const next = vi.fn();

    await requireApiClientAction('config:bundle:manage', 'platform.authz.roles.manage')(req, {} as any, next);

    expect(mocks.authenticateToken).toHaveBeenCalledWith('token-1', 'config:bundle:manage');
    expect(mocks.hasPermission).toHaveBeenCalledWith('platform:authz:roles:manage', {
      principalType: 'api_client',
      principalId: 'api-client-1',
      tenantId: 'tenant-1',
      resourceType: 'platform',
    });
    expect(next).toHaveBeenCalledWith();
  });

  it('authorizes engine-registration API clients against an external-system scoped role assignment', async () => {
    mocks.authenticateToken.mockResolvedValueOnce({
      id: 'api-client-1',
      name: 'Engine registrar',
      tokenPrefix: 'egac_api-cli',
      scopes: ['engine:register'],
      isActive: true,
      createdById: 'admin-1',
      lastUsedAt: null,
      revokedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      authenticatedAt: Date.now(),
    });
    mocks.hasPermission.mockResolvedValueOnce(true);
    const req: any = {
      headers: { authorization: 'Bearer token-1' },
      tenant: { tenantId: 'tenant-1' },
      body: { externalSystemId: 'system-1' },
    };
    const next = vi.fn();

    await requireApiClientAction('engine:register', 'engine.external-registration.upsert', {
      permissionId: 'external-engine-system:engine-registration:manage',
      resourceType: 'external_engine_system',
      resourceIdFrom: 'body',
      resourceIdKey: 'externalSystemId',
    })(req, {} as any, next);

    expect(mocks.hasPermission).toHaveBeenCalledTimes(1);
    expect(mocks.hasPermission).toHaveBeenCalledWith('external-engine-system:engine-registration:manage', {
      principalType: 'api_client',
      principalId: 'api-client-1',
      tenantId: 'tenant-1',
      resourceType: 'external_engine_system',
      resourceId: 'system-1',
    });
    expect(next).toHaveBeenCalledWith();
  });

  it('falls back to broad platform registrar permission for legacy engine-registration API clients', async () => {
    mocks.authenticateToken.mockResolvedValueOnce({
      id: 'api-client-1',
      name: 'Engine registrar',
      tokenPrefix: 'egac_api-cli',
      scopes: ['engine:register'],
      isActive: true,
      createdById: 'admin-1',
      lastUsedAt: null,
      revokedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      authenticatedAt: Date.now(),
    });
    mocks.hasPermission
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const req: any = {
      headers: { authorization: 'Bearer token-1' },
      tenant: { tenantId: 'tenant-1' },
      body: { externalSystemId: 'system-1' },
    };
    const next = vi.fn();

    await requireApiClientAction('engine:register', 'engine.external-registration.upsert', {
      permissionId: 'external-engine-system:engine-registration:manage',
      resourceType: 'external_engine_system',
      resourceIdFrom: 'body',
      resourceIdKey: 'externalSystemId',
    })(req, {} as any, next);

    expect(mocks.hasPermission).toHaveBeenNthCalledWith(1, 'external-engine-system:engine-registration:manage', expect.objectContaining({
      resourceType: 'external_engine_system',
      resourceId: 'system-1',
    }));
    expect(mocks.hasPermission).toHaveBeenNthCalledWith(2, 'platform:engine-registration:manage', expect.objectContaining({
      resourceType: 'platform',
    }));
    expect(next).toHaveBeenCalledWith();
  });

  it('authenticates deployment-scoped API clients and evaluates api deployment eligibility', async () => {
    const req: any = {
      headers: { authorization: 'Bearer token-1' },
      body: { projectId: 'project-1', engineId: 'engine-1' },
      tenant: { tenantId: 'tenant-1' },
    };
    const next = vi.fn();

    await requireApiDeploymentEligibility()(req, {} as any, next);

    expect(mocks.authenticateToken).toHaveBeenCalledWith('token-1', 'deployment:execute');
    expect(mocks.evaluateDeploymentEligibility).toHaveBeenCalledWith({
      principalType: 'api_client',
      principalId: 'api-client-1',
      tenantId: 'tenant-1',
      projectId: 'project-1',
      engineId: 'engine-1',
      mode: 'api',
    });
    expect(req.deploymentEligibility).toMatchObject({ allowed: true, mode: 'api' });
    expect(next).toHaveBeenCalledWith();
  });

  it('authenticates deployment-scoped service accounts and evaluates api deployment eligibility', async () => {
    const req: any = {
      headers: { authorization: 'Bearer egsa_service-account-1_secret' },
      body: { projectId: 'project-1', engineId: 'engine-1' },
      tenant: { tenantId: 'tenant-1' },
    };
    const next = vi.fn();

    await requireApiDeploymentEligibility()(req, {} as any, next);

    expect(mocks.authenticateServiceAccountToken).toHaveBeenCalledWith('egsa_service-account-1_secret', 'deployment:execute');
    expect(mocks.authenticateToken).not.toHaveBeenCalled();
    expect(mocks.evaluateDeploymentEligibility).toHaveBeenCalledWith({
      principalType: 'service_account',
      principalId: 'service-account-1',
      tenantId: 'tenant-1',
      projectId: 'project-1',
      engineId: 'engine-1',
      mode: 'api',
    });
    expect(req.serviceAccount).toMatchObject({ id: 'service-account-1' });
    expect(req.deploymentEligibility).toMatchObject({ allowed: true, mode: 'api' });
    expect(next).toHaveBeenCalledWith();
  });

  it('returns a 403 app error with eligibility details when API deployment is denied', async () => {
    mocks.evaluateDeploymentEligibility.mockResolvedValueOnce({
      allowed: false,
      decision: 'deny',
      mode: 'api',
      projectId: 'project-1',
      engineId: 'engine-1',
      checks: [
        {
          id: 'project_engine_target.active',
          allowed: false,
          reason: 'No active project-engine target allows api mode',
        },
      ],
      reasons: ['No active project-engine target allows api mode'],
    });
    const req: any = {
      headers: { authorization: 'Bearer token-1' },
      body: { projectId: 'project-1', engineId: 'engine-1' },
    };
    const next = vi.fn();

    await requireApiDeploymentEligibility()(req, {} as any, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 403,
      message: 'No active project-engine target allows api mode',
      details: expect.objectContaining({
        reasons: ['No active project-engine target allows api mode'],
      }),
    }));
  });

  it('returns the same denied deployment contract for a service account', async () => {
    mocks.evaluateDeploymentEligibility.mockResolvedValueOnce({
      allowed: false,
      decision: 'deny',
      mode: 'api',
      projectId: 'project-1',
      engineId: 'engine-1',
      checks: [
        {
          id: 'project_engine_target.active',
          allowed: false,
          reason: 'No active project-engine target allows api mode',
        },
      ],
      reasons: ['No active project-engine target allows api mode'],
    });
    const req: any = {
      headers: { authorization: 'Bearer egsa_service-account-1_secret' },
      body: { projectId: 'project-1', engineId: 'engine-1' },
      tenant: { tenantId: 'tenant-1' },
    };
    const next = vi.fn();

    await requireApiDeploymentEligibility()(req, {} as any, next);

    expect(mocks.evaluateDeploymentEligibility).toHaveBeenCalledWith(expect.objectContaining({
      principalType: 'service_account',
      principalId: 'service-account-1',
      tenantId: 'tenant-1',
      projectId: 'project-1',
      engineId: 'engine-1',
      mode: 'api',
    }));
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 403,
      message: 'No active project-engine target allows api mode',
      details: expect.objectContaining({
        reasons: ['No active project-engine target allows api mode'],
      }),
    }));
  });

  it('enforces bearer syntax and normalizes scope authentication failures', async () => {
    const next = vi.fn();
    await requireApiClientScope('engine:register')({ headers: {} } as any, {} as any, next);
    expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ statusCode: 401 }));

    await requireApiClientScope('engine:register')({ headers: { authorization: 'Bearer ' } } as any, {} as any, next);
    expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ statusCode: 401 }));

    mocks.authenticateToken.mockRejectedValueOnce(new Error('upstream authentication error'));
    await requireApiClientScope('engine:register')({ headers: { authorization: 'Bearer token-1' } } as any, {} as any, next);
    expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ statusCode: 401, message: 'upstream authentication error' }));

    mocks.authenticateToken.mockRejectedValueOnce(null);
    await requireApiClientScope('engine:register')({ headers: { authorization: 'Bearer token-1' } } as any, {} as any, next);
    expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ statusCode: 401, message: 'API client authentication failed' }));

    const req: any = { headers: { authorization: 'Bearer token-1' } };
    await requireApiClientScope('engine:register')(req, {} as any, next);
    expect(req.apiClient).toMatchObject({ id: 'api-client-1' });
  });

  it('honors action resource options and normalizes unexpected authorization failures', async () => {
    const next = vi.fn();
    const action = requireApiClientAction('engine:register', 'engine.external-registration.upsert', {
      permissionId: 'external-engine-system:engine-registration:manage',
      resourceType: 'external_engine_system',
      resourceId: 'configured-system',
      allowActionPermissionFallback: false,
    });
    await action({ headers: { authorization: 'Bearer token-1' } } as any, {} as any, next);
    expect(mocks.hasPermission).toHaveBeenCalledWith('external-engine-system:engine-registration:manage', expect.objectContaining({ resourceId: 'configured-system' }));

    await requireApiClientAction('engine:register', 'engine.external-registration.upsert', {
      resourceType: 'external_engine_system', resourceId: 'action-permission-resource',
    })({ headers: { authorization: 'Bearer token-1' } } as any, {} as any, next);
    expect(mocks.hasPermission).toHaveBeenLastCalledWith('platform:engine-registration:manage', expect.objectContaining({ resourceId: 'action-permission-resource' }));

    mocks.hasPermission.mockResolvedValueOnce(false);
    await requireApiClientAction('engine:register', 'engine.external-registration.upsert', {
      resourceType: 'external_engine_system', resourceIdKey: 'externalSystemId', allowActionPermissionFallback: false,
    })({ headers: { authorization: 'Bearer token-1' }, body: { externalSystemId: ['  '] } } as any, {} as any, next);
    expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ statusCode: 403 }));

    await requireApiClientAction('engine:register', 'engine.external-registration.upsert', {
      resourceType: 'external_engine_system', resourceIdKey: 'externalSystemId', allowActionPermissionFallback: false,
    })({ headers: { authorization: 'Bearer token-1' }, body: {} } as any, {} as any, next);
    expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ statusCode: 403 }));

    mocks.authenticateToken.mockRejectedValueOnce(new Error('authorization transport error'));
    await requireApiClientAction('engine:register', 'engine.external-registration.upsert')({ headers: { authorization: 'Bearer token-1' } } as any, {} as any, next);
    expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ statusCode: 401, message: 'authorization transport error' }));

    mocks.authenticateToken.mockRejectedValueOnce(undefined);
    await requireApiClientAction('engine:register', 'engine.external-registration.upsert')({ headers: { authorization: 'Bearer token-1' } } as any, {} as any, next);
    expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ statusCode: 401, message: 'API client authorization failed' }));
  });

  it('uses cached deployment principals, validates scopes, and reads configured request locations', async () => {
    const next = vi.fn();
    await requireApiDeploymentEligibility({ projectIdFrom: 'query', engineIdFrom: 'params' })({
      headers: {}, query: { projectId: [' project-query '] }, params: { engineId: ' engine-param ' },
      tenant: { tenantId: 'tenant-1' }, apiClient: { id: 'cached-client', scopes: ['deployment:execute'] },
    } as any, {} as any, next);
    expect(mocks.evaluateDeploymentEligibility).toHaveBeenLastCalledWith(expect.objectContaining({
      principalType: 'api_client', principalId: 'cached-client', projectId: 'project-query', engineId: 'engine-param',
    }));

    await requireApiDeploymentEligibility()({
      headers: {}, body: { projectId: 'project-1', engineId: 'engine-1' },
      serviceAccount: { id: 'cached-service', scopes: ['deployment:execute'] },
    } as any, {} as any, next);
    expect(mocks.evaluateDeploymentEligibility).toHaveBeenLastCalledWith(expect.objectContaining({ principalType: 'service_account', principalId: 'cached-service' }));

    await requireApiDeploymentEligibility()({
      headers: {}, body: { projectId: 'project-1', engineId: 'engine-1' }, apiClient: { id: 'missing-scope', scopes: [] },
    } as any, {} as any, next);
    expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ statusCode: 403, message: expect.stringContaining('missing required scope') }));

    await requireApiDeploymentEligibility()({
      headers: {}, body: { projectId: 'project-1', engineId: 'engine-1' }, serviceAccount: { id: 'missing-scope', scopes: [] },
    } as any, {} as any, next);
    expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ statusCode: 403, message: expect.stringContaining('missing required scope') }));
  });

  it('normalizes invalid deployment requests and unexpected deployment failures', async () => {
    const next = vi.fn();
    await requireApiDeploymentEligibility({ projectId: 'project-1' })({ headers: { authorization: 'Bearer token-1' }, body: {} } as any, {} as any, next);
    expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ statusCode: 400, message: 'API deployment requires projectId and engineId' }));

    mocks.evaluateDeploymentEligibility.mockResolvedValueOnce({
      allowed: false, decision: 'deny', mode: 'api', projectId: 'project-1', engineId: 'engine-1', checks: [], reasons: [],
    });
    await requireApiDeploymentEligibility()({ headers: { authorization: 'Bearer token-1' }, body: { projectId: 'project-1', engineId: 'engine-1' } } as any, {} as any, next);
    expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ statusCode: 403, message: 'API deployment is not allowed' }));

    mocks.authenticateToken.mockRejectedValueOnce(new Error('deployment transport error'));
    await requireApiDeploymentEligibility()({ headers: { authorization: 'Bearer token-1' }, body: { projectId: 'project-1', engineId: 'engine-1' } } as any, {} as any, next);
    expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ statusCode: 401, message: 'deployment transport error' }));

    mocks.authenticateToken.mockRejectedValueOnce(null);
    await requireApiDeploymentEligibility()({ headers: { authorization: 'Bearer token-1' }, body: { projectId: 'project-1', engineId: 'engine-1' } } as any, {} as any, next);
    expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ statusCode: 401, message: 'API deployment authorization failed' }));
  });
});

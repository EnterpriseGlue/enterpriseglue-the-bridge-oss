import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticateToken: vi.fn(),
  authenticateServiceAccountToken: vi.fn(),
  evaluateDeploymentEligibility: vi.fn(),
  hasPermission: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/ApiClientService.js', () => ({
  ApiClientScopes: {
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

import { requireApiClientAction, requireApiDeploymentEligibility } from '@enterpriseglue/shared/middleware/apiClientAuth.js';

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
});

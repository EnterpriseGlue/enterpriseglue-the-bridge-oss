import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine, EnvironmentTag, Project } from '@enterpriseglue/shared/db/entities/index.js';
import { deploymentEligibilityService } from '@enterpriseglue/shared/services/platform-admin/DeploymentEligibilityService.js';
import { projectEngineTargetService } from '@enterpriseglue/shared/services/platform-admin/ProjectEngineTargetService.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

describe('deploymentEligibilityService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.spyOn(deploymentEligibilityService as any, 'evaluatePolicyGate').mockResolvedValue({
      decision: 'allow',
      reason: 'no-policy-deny',
    });
  });

  function mockDataSource(options: {
    baseUrl?: string | null;
    engineType?: string | null;
    environmentLocked?: boolean;
    manualDeployAllowed?: boolean;
  } = {}) {
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Project) return { findOne: vi.fn().mockResolvedValue({ id: 'project-1', tenantId: null }) };
        if (entity === Engine) return {
          findOne: vi.fn().mockResolvedValue({
            id: 'engine-1',
            tenantId: null,
            baseUrl: options.baseUrl ?? 'https://engine.example.test',
            type: options.engineType ?? 'camunda7',
            environmentTagId: 'env-prod',
            environmentLocked: Boolean(options.environmentLocked),
          }),
        };
        if (entity === EnvironmentTag) return {
          findOne: vi.fn().mockResolvedValue({
            id: 'env-prod',
            name: 'Production',
            manualDeployAllowed: options.manualDeployAllowed ?? true,
          }),
        };
        throw new Error('Unexpected repository');
      },
    });
  }

  it('allows deployment when project permission, engine permission, target, and environment all pass', async () => {
    mockDataSource();
    vi.spyOn(permissionService, 'hasPermission').mockResolvedValue(true);
    vi.spyOn(projectEngineTargetService, 'hasActiveTarget').mockResolvedValue(true);

    const result = await deploymentEligibilityService.evaluate({
      userId: 'user-1',
      projectId: 'project-1',
      engineId: 'engine-1',
      mode: 'manual',
    });

    expect(result.allowed).toBe(true);
    expect(result.checks.map((check) => check.id)).toEqual(expect.arrayContaining([
      'project.permission.deploy',
      'engine.permission.deploy',
      'project_engine_target.active',
      'engine.lifecycle.active',
      'engine.capability.deploy',
      'policy.project',
      'policy.engine',
      'engine.environment.manual_deploy',
    ]));
  });

  it('evaluates multiple deployment modes for the same project-engine pair', async () => {
    mockDataSource();
    vi.spyOn(permissionService, 'hasPermission').mockResolvedValue(true);
    vi.spyOn(projectEngineTargetService, 'hasActiveTarget').mockResolvedValue(true);

    const result = await deploymentEligibilityService.evaluateModes({
      userId: 'user-1',
      projectId: 'project-1',
      engineId: 'engine-1',
      modes: ['manual', 'ci'],
    });

    expect(result.manual).toEqual(expect.objectContaining({
      allowed: true,
      mode: 'manual',
      projectId: 'project-1',
      engineId: 'engine-1',
    }));
    expect(result.ci).toEqual(expect.objectContaining({
      allowed: true,
      mode: 'ci',
      projectId: 'project-1',
      engineId: 'engine-1',
    }));
    expect(projectEngineTargetService.hasActiveTarget).toHaveBeenCalledWith('project-1', 'engine-1', 'manual', undefined);
    expect(projectEngineTargetService.hasActiveTarget).toHaveBeenCalledWith('project-1', 'engine-1', 'ci', undefined);
  });

  it('denies deployment with explicit reasons when the target mode is unavailable', async () => {
    mockDataSource();
    vi.spyOn(permissionService, 'hasPermission').mockResolvedValue(true);
    vi.spyOn(projectEngineTargetService, 'hasActiveTarget').mockResolvedValue(false);

    const result = await deploymentEligibilityService.evaluate({
      userId: 'user-1',
      projectId: 'project-1',
      engineId: 'engine-1',
      mode: 'ci',
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('No active project-engine target allows ci mode');
  });

  it('denies manual deployment when the engine environment disables manual deploys', async () => {
    mockDataSource({ manualDeployAllowed: false });
    vi.spyOn(permissionService, 'hasPermission').mockResolvedValue(true);
    vi.spyOn(projectEngineTargetService, 'hasActiveTarget').mockResolvedValue(true);

    const result = await deploymentEligibilityService.evaluate({
      userId: 'user-1',
      projectId: 'project-1',
      engineId: 'engine-1',
      mode: 'manual',
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('Manual deployment is disabled for Production');
  });

  it('denies deployment when the engine has no active connection endpoint', async () => {
    mockDataSource({ baseUrl: '   ' });
    vi.spyOn(permissionService, 'hasPermission').mockResolvedValue(true);
    vi.spyOn(projectEngineTargetService, 'hasActiveTarget').mockResolvedValue(true);

    const result = await deploymentEligibilityService.evaluate({
      userId: 'user-1',
      projectId: 'project-1',
      engineId: 'engine-1',
      mode: 'manual',
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('Engine is not active or has no connection endpoint configured');
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'engine.lifecycle.active', allowed: false }),
    ]));
  });

  it('denies deployment when the engine lacks the required deploy capability', async () => {
    mockDataSource();
    vi.spyOn(permissionService, 'hasPermission').mockResolvedValue(true);
    vi.spyOn(projectEngineTargetService, 'hasActiveTarget').mockResolvedValue(true);
    vi.spyOn(deploymentEligibilityService as any, 'getEngineCapabilities').mockReturnValue({
      type: 'camunda7',
      compatibilityProfile: 'camunda7-rest',
      supportLevel: 'compatible',
      operations: ['engine.read'],
    });

    const result = await deploymentEligibilityService.evaluate({
      userId: 'user-1',
      projectId: 'project-1',
      engineId: 'engine-1',
      mode: 'ci',
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('Engine does not support CI deployment');
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'engine.capability.deploy', allowed: false }),
    ]));
  });

  it('denies deployment when a project policy gate denies the action', async () => {
    mockDataSource();
    vi.spyOn(permissionService, 'hasPermission').mockResolvedValue(true);
    vi.spyOn(projectEngineTargetService, 'hasActiveTarget').mockResolvedValue(true);
    (deploymentEligibilityService as any).evaluatePolicyGate.mockResolvedValueOnce({
      decision: 'deny',
      reason: 'policy:release-freeze',
      policyId: 'policy-1',
      policyName: 'release-freeze',
    });

    const result = await deploymentEligibilityService.evaluate({
      userId: 'user-1',
      projectId: 'project-1',
      engineId: 'engine-1',
      mode: 'manual',
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('Project policy denied manual deployment: policy:release-freeze');
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'policy.project', allowed: false }),
    ]));
  });

  it('does not let a passing policy gate replace missing base permissions', async () => {
    mockDataSource();
    vi.spyOn(permissionService, 'hasPermission').mockResolvedValue(false);
    vi.spyOn(projectEngineTargetService, 'hasActiveTarget').mockResolvedValue(true);

    const result = await deploymentEligibilityService.evaluate({
      userId: 'user-1',
      projectId: 'project-1',
      engineId: 'engine-1',
      mode: 'manual',
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining([
      'User lacks project deploy permission',
      'User lacks engine deploy permission',
    ]));
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'policy.project', allowed: true }),
      expect.objectContaining({ id: 'policy.engine', allowed: true }),
    ]));
  });

  it('uses file-create and engine deploy-view permissions for import eligibility', async () => {
    mockDataSource();
    const permissionSpy = vi.spyOn(permissionService, 'hasPermission').mockResolvedValue(true);
    vi.spyOn(projectEngineTargetService, 'hasActiveTarget').mockResolvedValue(true);

    const result = await deploymentEligibilityService.evaluate({
      userId: 'user-1',
      projectId: 'project-1',
      engineId: 'engine-1',
      mode: 'import',
    });

    expect(result.allowed).toBe(true);
    expect(permissionSpy).toHaveBeenCalledWith('project:files:create', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'project',
      resourceId: 'project-1',
    }));
    expect(permissionSpy).toHaveBeenCalledWith('engine:deploy:view', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
    expect(projectEngineTargetService.hasActiveTarget).toHaveBeenCalledWith('project-1', 'engine-1', 'import', undefined);
    expect(result.checks.map((check) => check.id)).toEqual(expect.arrayContaining([
      'project.permission.files_create',
      'engine.permission.deploy_view',
      'project_engine_target.active',
      'engine.capability.read',
    ]));
  });

  it('denies import when the engine lacks the required read capability', async () => {
    mockDataSource();
    vi.spyOn(permissionService, 'hasPermission').mockResolvedValue(true);
    vi.spyOn(projectEngineTargetService, 'hasActiveTarget').mockResolvedValue(true);
    vi.spyOn(deploymentEligibilityService as any, 'getEngineCapabilities').mockReturnValue({
      type: 'camunda7',
      compatibilityProfile: 'camunda7-rest',
      supportLevel: 'compatible',
      operations: ['engine.deploy'],
    });

    const result = await deploymentEligibilityService.evaluate({
      userId: 'user-1',
      projectId: 'project-1',
      engineId: 'engine-1',
      mode: 'import',
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('Engine does not support engine import');
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'engine.capability.read', allowed: false }),
    ]));
  });

  it('evaluates api deployment eligibility against the API-client principal', async () => {
    mockDataSource();
    const permissionSpy = vi.spyOn(permissionService, 'hasPermission').mockResolvedValue(true);
    vi.spyOn(projectEngineTargetService, 'hasActiveTarget').mockResolvedValue(true);

    const result = await deploymentEligibilityService.evaluate({
      principalType: 'api_client',
      principalId: 'api-client-1',
      projectId: 'project-1',
      engineId: 'engine-1',
      mode: 'api',
    });

    expect(result.allowed).toBe(true);
    expect(permissionSpy).toHaveBeenCalledWith('project:deploy', expect.objectContaining({
      principalType: 'api_client',
      principalId: 'api-client-1',
      resourceType: 'project',
      resourceId: 'project-1',
    }));
    expect(permissionSpy).toHaveBeenCalledWith('engine:deploy', expect.objectContaining({
      principalType: 'api_client',
      principalId: 'api-client-1',
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
    expect(projectEngineTargetService.hasActiveTarget).toHaveBeenCalledWith('project-1', 'engine-1', 'api', undefined);
  });
});

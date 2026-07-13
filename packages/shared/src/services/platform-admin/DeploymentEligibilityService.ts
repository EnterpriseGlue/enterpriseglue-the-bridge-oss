import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { EnvironmentTag } from '@enterpriseglue/shared/infrastructure/persistence/entities/EnvironmentTag.js';
import { Project } from '@enterpriseglue/shared/infrastructure/persistence/entities/Project.js';
import { getEngineCapabilities, type EngineOperationCapability } from '../bpmn-engine-capabilities.js';
import {
  projectEngineTargetService,
  type ProjectEngineTargetMode,
} from './ProjectEngineTargetService.js';
import { policyService, type EvaluationContext, type PolicyGateResult } from './PolicyService.js';
import {
  EnginePermissions,
  ProjectPermissions,
  permissionService,
  type PermissionContext,
} from './permissions.js';
import type { AuthzPrincipalType, AuthzResourceType } from '../../authz/permission-actions.js';

export interface DeploymentEligibilityInput {
  userId?: string;
  principalType?: AuthzPrincipalType;
  principalId?: string;
  tenantId?: string | null;
  ipAddress?: string;
  userAgent?: string;
  timestamp?: number;
  userAttributes?: Record<string, unknown>;
  projectId: string;
  engineId: string;
  mode?: ProjectEngineTargetMode;
}

export interface DeploymentEligibilityCheck {
  id: string;
  allowed: boolean;
  reason: string;
  remediation?: string;
}

export interface DeploymentEligibilityResult {
  allowed: boolean;
  decision: 'allow' | 'deny';
  mode: ProjectEngineTargetMode;
  projectId: string;
  engineId: string;
  checks: DeploymentEligibilityCheck[];
  reasons: string[];
}

export interface DeploymentEligibilityModesInput extends Omit<DeploymentEligibilityInput, 'mode'> {
  modes: ProjectEngineTargetMode[];
}

export type DeploymentEligibilityModeResults = Partial<Record<ProjectEngineTargetMode, DeploymentEligibilityResult>>;

function deny(
  input: DeploymentEligibilityInput,
  mode: ProjectEngineTargetMode,
  checks: DeploymentEligibilityCheck[]
): DeploymentEligibilityResult {
  const reasons = checks.filter((check) => !check.allowed).map((check) => check.reason);
  return {
    allowed: false,
    decision: 'deny',
    mode,
    projectId: input.projectId,
    engineId: input.engineId,
    checks,
    reasons: reasons.length > 0 ? reasons : ['Deployment is not allowed'],
  };
}

function allow(input: DeploymentEligibilityInput, mode: ProjectEngineTargetMode, checks: DeploymentEligibilityCheck[]): DeploymentEligibilityResult {
  return {
    allowed: true,
    decision: 'allow',
    mode,
    projectId: input.projectId,
    engineId: input.engineId,
    checks,
    reasons: [],
  };
}

function resolvePrincipal(input: DeploymentEligibilityInput): { principalType: AuthzPrincipalType; principalId: string; label: string } {
  const principalType = input.principalType ?? 'user';
  const principalId = input.principalId ?? input.userId;
  if (!principalId) {
    throw new Error('Deployment eligibility requires a principalId');
  }
  if (principalType === 'user' && input.userId && input.userId !== principalId) {
    throw new Error('userId must match principalId for user deployment eligibility');
  }
  return {
    principalType,
    principalId,
    label: principalType === 'user' ? 'User' : principalType.replace(/_/g, ' '),
  };
}

function permissionContext(
  input: DeploymentEligibilityInput,
  principal: { principalType: AuthzPrincipalType; principalId: string },
  resourceType: AuthzResourceType,
  resourceId: string
): PermissionContext {
  if (principal.principalType === 'user') {
    return {
      userId: principal.principalId,
      tenantId: input.tenantId,
      resourceType,
      resourceId,
    };
  }

  return {
    principalType: principal.principalType,
    principalId: principal.principalId,
    tenantId: input.tenantId,
    resourceType,
    resourceId,
  };
}

function policyContext(
  input: DeploymentEligibilityInput,
  principal: { principalType: AuthzPrincipalType; principalId: string },
  resourceType: AuthzResourceType,
  resourceId: string,
  resourceAttributes: Record<string, unknown>
): EvaluationContext {
  return {
    ...permissionContext(input, principal, resourceType, resourceId),
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    timestamp: input.timestamp,
    userAttributes: input.userAttributes,
    resourceAttributes,
  };
}

function requiredEngineCapabilityForMode(mode: ProjectEngineTargetMode): EngineOperationCapability {
  return mode === 'import' ? 'engine.read' : 'engine.deploy';
}

function engineCapabilityCheckId(capability: EngineOperationCapability): string {
  return capability === 'engine.read' ? 'engine.capability.read' : 'engine.capability.deploy';
}

function modeActionLabel(mode: ProjectEngineTargetMode): string {
  switch (mode) {
    case 'api':
      return 'API deployment';
    case 'ci':
      return 'CI deployment';
    case 'import':
      return 'engine import';
    case 'manual':
    default:
      return 'manual deployment';
  }
}

export class DeploymentEligibilityService {
  async evaluateModes(input: DeploymentEligibilityModesInput): Promise<DeploymentEligibilityModeResults> {
    const { modes, ...baseInput } = input;
    const results: DeploymentEligibilityModeResults = {};
    for (const mode of modes) {
      results[mode] = await this.evaluate({ ...baseInput, mode });
    }
    return results;
  }

  async evaluate(input: DeploymentEligibilityInput): Promise<DeploymentEligibilityResult> {
    const mode = input.mode || 'manual';
    const checks: DeploymentEligibilityCheck[] = [];

    try {
      const principal = resolvePrincipal(input);
      const dataSource = await getDataSource();
      const project = await dataSource.getRepository(Project).findOne({
        where: { id: input.projectId },
        select: ['id', 'tenantId'],
      });
      if (!project || !this.isTenantVisible(project.tenantId, input.tenantId)) {
        checks.push({
          id: 'project.exists',
          allowed: false,
          reason: 'Project was not found or is outside the tenant scope',
        });
        return deny(input, mode, checks);
      }
      checks.push({ id: 'project.exists', allowed: true, reason: 'Project exists' });

      const engine = await dataSource.getRepository(Engine).findOne({
        where: { id: input.engineId },
        select: ['id', 'tenantId', 'type', 'baseUrl', 'environmentTagId', 'environmentLocked', 'deploymentIntegration'],
      });
      if (!engine || !this.isTenantVisible(engine.tenantId, input.tenantId)) {
        checks.push({
          id: 'engine.exists',
          allowed: false,
          reason: 'Engine was not found or is outside the tenant scope',
        });
        return deny(input, mode, checks);
      }
      checks.push({ id: 'engine.exists', allowed: true, reason: 'Engine exists' });

      const usesEnterpriseGlueDeployment = mode === 'manual' || mode === 'ci';
      const isDirectEngine = engine.deploymentIntegration === 'direct_engine';
      checks.push({
        id: 'engine.integration.proxy',
        allowed: !usesEnterpriseGlueDeployment || !isDirectEngine,
        reason: !usesEnterpriseGlueDeployment || !isDirectEngine
          ? 'Engine accepts EnterpriseGlue-managed deployment for this mode'
          : 'Engine is configured for direct deployment through a customer pipeline',
        remediation: !usesEnterpriseGlueDeployment || !isDirectEngine
          ? undefined
          : 'Deploy through the customer pipeline and submit a pipeline receipt for lineage.',
      });

      const engineConfigured = typeof engine.baseUrl === 'string' && engine.baseUrl.trim().length > 0;
      checks.push({
        id: 'engine.lifecycle.active',
        allowed: engineConfigured,
        reason: engineConfigured
          ? 'Engine has an active connection endpoint configured'
          : 'Engine is not active or has no connection endpoint configured',
        remediation: engineConfigured ? undefined : 'Configure the engine endpoint or reactivate the engine before using it for deployments.',
      });

      const requiredCapability = requiredEngineCapabilityForMode(mode);
      const engineCapabilities = this.getEngineCapabilities(engine.type);
      const hasRequiredCapability = engineCapabilities.operations.includes(requiredCapability);
      checks.push({
        id: engineCapabilityCheckId(requiredCapability),
        allowed: hasRequiredCapability,
        reason: hasRequiredCapability
          ? `Engine supports ${modeActionLabel(mode)}`
          : `Engine does not support ${modeActionLabel(mode)}`,
        remediation: hasRequiredCapability
          ? undefined
          : `Use an engine type that supports ${requiredCapability} or choose a different deployment target.`,
      });

      const projectPermission = mode === 'import' ? ProjectPermissions.FILES_CREATE : ProjectPermissions.DEPLOY;
      const projectPermissionLabel = mode === 'import' ? 'project file-create' : 'project deploy';
      const projectPermissionContext = permissionContext(input, principal, 'project', input.projectId);
      const hasProjectDeploy = await permissionService.hasPermission(
        projectPermission,
        projectPermissionContext
      );
      checks.push({
        id: mode === 'import' ? 'project.permission.files_create' : 'project.permission.deploy',
        allowed: hasProjectDeploy,
        reason: hasProjectDeploy
          ? `${principal.label} has ${projectPermissionLabel} permission`
          : `${principal.label} lacks ${projectPermissionLabel} permission`,
        remediation: hasProjectDeploy ? undefined : `Assign a project role or grant ${projectPermission} on this project.`,
      });

      const enginePermission = mode === 'import' ? EnginePermissions.DEPLOY_VIEW : EnginePermissions.DEPLOY;
      const enginePermissionLabel = mode === 'import' ? 'engine deployment view' : 'engine deploy';
      const enginePermissionContext = permissionContext(input, principal, 'engine', input.engineId);
      const hasEngineDeploy = await permissionService.hasPermission(
        enginePermission,
        enginePermissionContext
      );
      checks.push({
        id: mode === 'import' ? 'engine.permission.deploy_view' : 'engine.permission.deploy',
        allowed: hasEngineDeploy,
        reason: hasEngineDeploy
          ? `${principal.label} has ${enginePermissionLabel} permission`
          : `${principal.label} lacks ${enginePermissionLabel} permission`,
        remediation: hasEngineDeploy ? undefined : `Assign an engine role or grant ${enginePermission} on this engine.`,
      });

      const hasTarget = await projectEngineTargetService.hasActiveTarget(input.projectId, input.engineId, mode, input.tenantId);
      checks.push({
        id: 'project_engine_target.active',
        allowed: hasTarget,
        reason: hasTarget ? `Project-engine target allows ${mode} mode` : `No active project-engine target allows ${mode} mode`,
        remediation: hasTarget ? undefined : 'Create or enable a project-engine target for this project and engine.',
      });

      let manualDeployAllowed: boolean | undefined;
      let environmentName: string | undefined;
      if (engine.environmentLocked) {
        checks.push({
          id: 'engine.environment.locked',
          allowed: false,
          reason: 'Engine environment is locked',
          remediation: 'Unlock the engine environment before deploying.',
        });
      } else {
        checks.push({ id: 'engine.environment.locked', allowed: true, reason: 'Engine environment is not locked' });
      }

      if (mode === 'manual' && engine.environmentTagId) {
        const environment = await dataSource.getRepository(EnvironmentTag).findOne({
          where: { id: engine.environmentTagId },
          select: ['id', 'name', 'manualDeployAllowed'],
        });
        manualDeployAllowed = !environment || Boolean(environment.manualDeployAllowed);
        environmentName = environment?.name;
        checks.push({
          id: 'engine.environment.manual_deploy',
          allowed: manualDeployAllowed,
          reason: manualDeployAllowed
            ? 'Engine environment allows manual deployment'
            : `Manual deployment is disabled for ${environmentName ?? 'this environment'}`,
          remediation: manualDeployAllowed ? undefined : 'Use CI/CD mode or change the environment tag policy.',
        });
      }

      const deploymentResourceAttributes = {
        deploymentMode: mode,
        projectId: input.projectId,
        engineId: input.engineId,
        projectEngineTargetActive: hasTarget,
        engineLifecycleActive: engineConfigured,
        engineRequiredCapability: requiredCapability,
        engineCapabilitySupported: hasRequiredCapability,
        engineType: engine.type ?? null,
        environmentLocked: Boolean(engine.environmentLocked),
        environmentTagId: engine.environmentTagId ?? null,
        environmentName: environmentName ?? null,
        manualDeployAllowed: manualDeployAllowed ?? null,
      };

      const projectPolicy = await this.evaluatePolicyGate(
        projectPermission,
        policyContext(input, principal, 'project', input.projectId, deploymentResourceAttributes)
      );
      checks.push({
        id: 'policy.project',
        allowed: projectPolicy.decision !== 'deny',
        reason: projectPolicy.decision === 'deny'
          ? `Project policy denied ${modeActionLabel(mode)}: ${projectPolicy.reason}`
          : `Project policy allows ${modeActionLabel(mode)} to continue`,
        remediation: projectPolicy.decision === 'deny' ? 'Review the project authorization policies that apply to this deployment.' : undefined,
      });

      const enginePolicy = await this.evaluatePolicyGate(
        enginePermission,
        policyContext(input, principal, 'engine', input.engineId, deploymentResourceAttributes)
      );
      checks.push({
        id: 'policy.engine',
        allowed: enginePolicy.decision !== 'deny',
        reason: enginePolicy.decision === 'deny'
          ? `Engine policy denied ${modeActionLabel(mode)}: ${enginePolicy.reason}`
          : `Engine policy allows ${modeActionLabel(mode)} to continue`,
        remediation: enginePolicy.decision === 'deny' ? 'Review the engine authorization policies that apply to this deployment.' : undefined,
      });

      if (checks.every((check) => check.allowed)) {
        return allow(input, mode, checks);
      }
      return deny(input, mode, checks);
    } catch (error: any) {
      checks.push({
        id: 'authorization.resolver',
        allowed: false,
        reason: error?.message || 'Deployment eligibility resolution failed',
      });
      return deny(input, mode, checks);
    }
  }

  private isTenantVisible(rowTenantId: string | null | undefined, tenantId?: string | null): boolean {
    const normalizedTenantId = tenantId?.trim() || null;
    return !normalizedTenantId || !rowTenantId || rowTenantId === normalizedTenantId;
  }

  protected getEngineCapabilities(type: unknown) {
    return getEngineCapabilities(type);
  }

  protected evaluatePolicyGate(action: string, context: EvaluationContext): Promise<PolicyGateResult> {
    return policyService.evaluateGate(action, context);
  }
}

export const deploymentEligibilityService = new DeploymentEligibilityService();

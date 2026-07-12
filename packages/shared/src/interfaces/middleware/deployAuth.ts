/**
 * Deploy Authorization Middleware
 * Multi-level check for deployment permissions:
 * 1. User has deploy permission in project
 * 2. User has deploy permission on engine
 * 3. Project has an active target for the requested engine and mode
 * 4. Engine environment allows manual deployment
 */

import { Request, Response, NextFunction } from 'express';
import { Errors } from './errorHandler.js';
import { engineAccessService } from '../../services/platform-admin/EngineAccessService.js';
import {
  deploymentEligibilityService,
  type DeploymentEligibilityResult,
} from '../../services/platform-admin/DeploymentEligibilityService.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine, EnvironmentTag } from '@enterpriseglue/shared/db/entities/index.js';
import { EnginePermissions, permissionService } from '../../services/platform-admin/permissions.js';

export interface DeployContext {
  projectId: string;
  engineId: string;
  projectRole: string;
  engineName: string;
  environmentTag: string | null;
}

async function canViewEngineForDeploy(userId: string, engineId: string, tenantId?: string | null): Promise<boolean> {
  return permissionService.hasPermission(EnginePermissions.DEPLOY_VIEW, {
    userId,
    tenantId,
    resourceType: 'engine',
    resourceId: engineId,
  }) ||
    permissionService.hasPermission(EnginePermissions.INSTANCE_VIEW, {
      userId,
      tenantId,
      resourceType: 'engine',
      resourceId: engineId,
    });
}

async function canAutoGrantProjectAccess(userId: string, engineId: string, tenantId?: string | null): Promise<boolean> {
  return permissionService.hasPermission(EnginePermissions.PROJECT_ACCESS_APPROVE, {
    userId,
    tenantId,
    resourceType: 'engine',
    resourceId: engineId,
  });
}

function hasDeniedCheck(result: DeploymentEligibilityResult, checkId: string): boolean {
  return result.checks.some((check) => check.id === checkId && !check.allowed);
}

function deniedCheckIds(result: DeploymentEligibilityResult): string[] {
  return result.checks
    .filter((check) => !check.allowed)
    .map((check) => check.id);
}

async function evaluateManualDeployment(
  userId: string,
  tenantId: string | null,
  projectId: string,
  engineId: string
): Promise<DeploymentEligibilityResult> {
  return deploymentEligibilityService.evaluate({
    userId,
    tenantId,
    projectId,
    engineId,
    mode: 'manual',
  });
}

async function evaluateManualDeploymentWithLegacyAutoGrant(
  userId: string,
  tenantId: string | null,
  projectId: string,
  engineId: string
): Promise<DeploymentEligibilityResult> {
  let result = await evaluateManualDeployment(userId, tenantId, projectId, engineId);
  if (result.allowed) {
    return result;
  }

  const failedChecks = deniedCheckIds(result);
  if (failedChecks.length === 1 && failedChecks[0] === 'project_engine_target.active') {
    const canAutoGrant = await canAutoGrantProjectAccess(userId, engineId, tenantId);
    if (canAutoGrant) {
      await engineAccessService.grantAccess(projectId, engineId, userId, true);
      result = await evaluateManualDeployment(userId, tenantId, projectId, engineId);
    }
  }

  return result;
}

function deploymentDeniedPayload(result: DeploymentEligibilityResult) {
  const remediation = result.checks.find((check) => !check.allowed && check.remediation)?.remediation;
  return {
    error: result.reasons[0] || 'Deployment is not allowed',
    reasons: result.reasons,
    checks: result.checks,
    ...(remediation ? { hint: remediation } : {}),
  };
}

async function loadDeployContext(projectId: string, engineId: string): Promise<DeployContext> {
  const dataSource = await getDataSource();
  const engineRepo = dataSource.getRepository(Engine);
  const engine = await engineRepo.findOneBy({ id: engineId });
  if (!engine) {
    throw Errors.engineNotFound();
  }

  let envTagName: string | null = null;
  if (engine.environmentTagId) {
    const envTagRepo = dataSource.getRepository(EnvironmentTag);
    const envTag = await envTagRepo.findOneBy({ id: engine.environmentTagId });
    envTagName = envTag?.name || null;
  }

  return {
    projectId,
    engineId,
    projectRole: 'permission',
    engineName: engine.name,
    environmentTag: envTagName,
  };
}

/**
 * Require permission to deploy from a project to an engine
 * Expects projectId and engineId in request body
 */
export function requireDeployPermission() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const { projectId, engineId } = req.body;

    if (!projectId || !engineId) {
      throw Errors.validation('projectId and engineId required');
    }

    if (!req.user) {
      throw Errors.unauthorized('Authentication required');
    }

    const userId = req.user.userId;
    const tenantId = req.tenant?.tenantId || null;

    try {
      const result = await evaluateManualDeploymentWithLegacyAutoGrant(userId, tenantId, projectId, engineId);
      (req as any).deploymentEligibility = result;

      if (!result.allowed) {
        if (hasDeniedCheck(result, 'project.exists')) {
          throw Errors.projectNotFound();
        }
        if (hasDeniedCheck(result, 'engine.exists')) {
          throw Errors.engineNotFound();
        }
        if (hasDeniedCheck(result, 'engine.permission.deploy')) {
          const canViewEngine = await canViewEngineForDeploy(userId, engineId, tenantId);
          if (!canViewEngine) {
            throw Errors.engineNotFound();
          }
        }
        return res.status(403).json(deploymentDeniedPayload(result));
      }

      (req as any).deployContext = await loadDeployContext(projectId, engineId);

      next();
    } catch (error: any) {
      if (typeof error?.statusCode === 'number') {
        throw error;
      }
      console.error('Deploy auth error:', error);
      throw Errors.internal('Failed to check deploy permissions');
    }
  };
}

/**
 * Check if user can deploy (non-blocking)
 * Sets req.canDeploy boolean for use in route handlers
 */
export function checkDeployPermission() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const { projectId, engineId } = req.body;

    if (!projectId || !engineId || !req.user) {
      (req as any).canDeploy = false;
      return next();
    }

    try {
      const userId = req.user.userId;
      const tenantId = req.tenant?.tenantId || null;
      const result = await evaluateManualDeployment(userId, tenantId, projectId, engineId);
      (req as any).deploymentEligibility = result;
      (req as any).canDeploy = result.allowed;
      next();
    } catch {
      (req as any).canDeploy = false;
      next();
    }
  };
}

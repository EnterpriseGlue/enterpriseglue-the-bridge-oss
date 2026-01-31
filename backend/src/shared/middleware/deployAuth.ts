/**
 * Deploy Authorization Middleware
 * Multi-level check for deployment permissions:
 * 1. User has deploy role in project
 * 2. Project has access to engine
 * 3. Engine environment allows manual deployment
 */

import { Request, Response, NextFunction } from 'express';
import { In } from 'typeorm';
import { Errors } from './errorHandler.js';
import { projectMemberService } from '../services/platform-admin/ProjectMemberService.js';
import { engineAccessService } from '../services/platform-admin/EngineAccessService.js';
import { engineService } from '../services/platform-admin/EngineService.js';
import { getDataSource } from '@shared/db/data-source.js';
import { Engine } from '@shared/db/entities/Engine.js';
import { PlatformSettings } from '@shared/db/entities/PlatformSettings.js';
import { EnvironmentTag } from '@shared/db/entities/EnvironmentTag.js';
import { PermissionGrant } from '@shared/db/entities/PermissionGrant.js';
import { ENGINE_MEMBER_ROLES } from '@shared/constants/roles.js';

export interface DeployContext {
  projectId: string;
  engineId: string;
  projectRole: string;
  engineName: string;
  environmentTag: string | null;
}

async function hasProjectDeployGrant(userId: string, projectId: string): Promise<boolean> {
  const dataSource = await getDataSource();
  const repo = dataSource.getRepository(PermissionGrant);
  const count = await repo.count({
    where: {
      userId,
      permission: In(['project.deploy', 'project:deploy']),
      resourceType: 'project',
      resourceId: projectId,
    },
  });
  return count > 0;
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
    const dataSource = await getDataSource();

    try {
      // Check 1: User has deploy permission in project
      const membership = await projectMemberService.getMembership(projectId, userId);
      if (!membership) {
        throw Errors.projectNotFound();
      }

      // Get platform settings for default deploy roles
      const platformRepo = dataSource.getRepository(PlatformSettings);
      const settings = await platformRepo.findOneBy({ id: 'default' });

      // Project deploy roles (configurable via membership grants)
      const defaultProjectDeployRoles = ['owner', 'delegate', 'developer'];

      let hasDeployRole = defaultProjectDeployRoles.includes(membership.role);
      if (!hasDeployRole && membership.role === 'editor') {
        hasDeployRole = await hasProjectDeployGrant(userId, projectId);
      }

      if (!hasDeployRole) {
        throw Errors.forbidden('User does not have deploy permission in this project');
      }

      // Check 2b: User has engine deploy role (platform-configured)
      const engineDeployRoles = JSON.parse(
        settings?.defaultDeployRoles || '["owner","delegate","operator","deployer"]'
      );
      const hasEngineRole = await engineService.hasEngineAccess(userId, engineId, engineDeployRoles);
      if (!hasEngineRole) {
        const canViewEngine = await engineService.hasEngineAccess(userId, engineId, ENGINE_MEMBER_ROLES);
        if (!canViewEngine) {
          throw Errors.engineNotFound();
        }
        throw Errors.forbidden('No deploy permission on this engine');
      }

      // Check 2: Project has access to engine
      // If the caller is engine owner/delegate, we can auto-grant access (explicit approval) to unblock deployments.
      let hasAccess = await engineAccessService.hasProjectAccess(projectId, engineId);
      if (!hasAccess) {
        const canAutoGrant = await engineService.hasEngineAccess(userId, engineId, ['owner', 'delegate']);
        if (canAutoGrant) {
          await engineAccessService.grantAccess(projectId, engineId, userId, true);
          hasAccess = true;
        }
      }
      if (!hasAccess) {
        return res.status(403).json({
          error: 'Project not connected to this engine',
          hint: 'Ask the engine owner or delegate to grant this project access',
        });
      }

      // Check 3: Engine environment allows manual deployment
      const engineRepo = dataSource.getRepository(Engine);
      const engine = await engineRepo.findOneBy({ id: engineId });

      if (!engine) {
        throw Errors.engineNotFound();
      }

      // Check if environment is locked
      if (engine.environmentLocked) {
        throw Errors.forbidden('Engine environment is locked');
      }

      // Check environment tag settings
      let envTagName: string | null = null;
      if (engine.environmentTagId) {
        const envTagRepo = dataSource.getRepository(EnvironmentTag);
        const envTag = await envTagRepo.findOneBy({ id: engine.environmentTagId });

        if (envTag) {
          envTagName = envTag.name;
          if (!envTag.manualDeployAllowed) {
            return res.status(403).json({
              error: 'Manual deployment not allowed for this environment',
              environment: envTag.name,
              hint: 'Use CI/CD pipeline for this environment',
            });
          }
        }
      }

      // All checks passed - attach context to request
      (req as any).deployContext = {
        projectId,
        engineId,
        projectRole: membership.role,
        engineName: engine.name,
        environmentTag: envTagName,
      } as DeployContext;

      next();
    } catch (error) {
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
      const dataSource = await getDataSource();

      // Quick checks
      const membership = await projectMemberService.getMembership(projectId, userId);
      if (!membership) {
        (req as any).canDeploy = false;
        return next();
      }

      const platformRepo = dataSource.getRepository(PlatformSettings);
      const settings = await platformRepo.findOneBy({ id: 'default' });

      const defaultProjectDeployRoles = ['owner', 'delegate', 'developer'];

      let hasDeployRole = defaultProjectDeployRoles.includes(membership.role);
      if (!hasDeployRole && membership.role === 'editor') {
        hasDeployRole = await hasProjectDeployGrant(userId, projectId);
      }
      const hasAccess = await engineAccessService.hasProjectAccess(projectId, engineId);

      if (!hasDeployRole || !hasAccess) {
        (req as any).canDeploy = false;
        return next();
      }

      const engineDeployRoles = JSON.parse(
        settings?.defaultDeployRoles || '["owner","delegate","operator","deployer"]'
      );
      const hasEngineRole = await engineService.hasEngineAccess(userId, engineId, engineDeployRoles);
      if (!hasEngineRole) {
        (req as any).canDeploy = false;
        return next();
      }

      const engineRepo = dataSource.getRepository(Engine);
      const engine = await engineRepo.findOneBy({ id: engineId });

      if (!engine) {
        (req as any).canDeploy = false;
        return next();
      }

      if (engine.environmentLocked) {
        (req as any).canDeploy = false;
        return next();
      }

      if (engine.environmentTagId) {
        const envTagRepo = dataSource.getRepository(EnvironmentTag);
        const envTag = await envTagRepo.findOneBy({ id: engine.environmentTagId });

        if (envTag && !envTag.manualDeployAllowed) {
          (req as any).canDeploy = false;
          return next();
        }
      }

      (req as any).canDeploy = true;
      next();
    } catch {
      (req as any).canDeploy = false;
      next();
    }
  };
}

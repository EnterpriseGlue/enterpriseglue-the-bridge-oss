/**
 * Project Authorization Middleware
 * Centralized authorization checks for project-scoped routes
 */

import { Request, Response, NextFunction } from 'express';
import type { ProjectRole } from '@enterpriseglue/shared/contracts/roles.js';
import { Errors } from './errorHandler.js';
import { projectMemberService } from '../services/platform-admin/ProjectMemberService.js';
import { AuthorizationService } from '../services/authorization.js';
import { engineService } from '../services/platform-admin/index.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { File } from '@enterpriseglue/shared/db/entities/File.js';
import type { EngineRole } from '@enterpriseglue/shared/constants/roles.js';

/**
 * Middleware to require specific project roles
 * Extracts projectId from params, body, or query
 * 
 * @param roles - Array of roles that are allowed
 * @param options - Configuration options
 */
export function requireProjectRole(
  roles: ProjectRole[],
  options: {
    projectIdFrom?: 'params' | 'body' | 'query';
    projectIdKey?: string;
    errorStatus?: number;
    errorMessage?: string;
  } = {}
) {
  const {
    projectIdFrom = 'params',
    projectIdKey = 'projectId',
    errorStatus = 404,
    errorMessage = 'Project not found',
  } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw Errors.unauthorized('Authentication required');
      }

      let projectId: string | undefined;
      
      if (projectIdFrom === 'params') {
        projectId = req.params[projectIdKey];
      } else if (projectIdFrom === 'body') {
        projectId = req.body?.[projectIdKey];
      } else if (projectIdFrom === 'query') {
        const queryVal = req.query[projectIdKey];
        projectId = typeof queryVal === 'string' ? queryVal : undefined;
      }

      if (!projectId) {
        throw Errors.validation(`${projectIdKey} is required`);
      }

      const hasRole = await projectMemberService.hasRole(projectId, userId, roles);
      if (!hasRole) {
        throw Errors.forbidden(errorMessage);
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Middleware to require project access (any role)
 */
export function requireProjectAccess(
  options: {
    projectIdFrom?: 'params' | 'body' | 'query';
    projectIdKey?: string;
  } = {}
) {
  const {
    projectIdFrom = 'params',
    projectIdKey = 'projectId',
  } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw Errors.unauthorized('Authentication required');
      }

      let projectId: string | undefined;
      
      if (projectIdFrom === 'params') {
        projectId = req.params[projectIdKey];
      } else if (projectIdFrom === 'body') {
        projectId = req.body?.[projectIdKey];
      } else if (projectIdFrom === 'query') {
        const queryVal = req.query[projectIdKey];
        projectId = typeof queryVal === 'string' ? queryVal : undefined;
      }

      if (!projectId) {
        throw Errors.validation(`${projectIdKey} is required`);
      }

      const hasAccess = await projectMemberService.hasAccess(projectId, userId);
      if (!hasAccess) {
        throw Errors.projectNotFound();
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Middleware to require file access (view)
 * Uses AuthorizationService.verifyFileAccess
 */
export function requireFileAccess(
  options: {
    fileIdFrom?: 'params' | 'query';
    fileIdKey?: string;
  } = {}
) {
  const { fileIdFrom = 'params', fileIdKey = 'fileId' } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw Errors.unauthorized('Authentication required');
      }

      let fileId: string | undefined;
      if (fileIdFrom === 'params') {
        fileId = req.params[fileIdKey];
      } else if (fileIdFrom === 'query') {
        const queryVal = req.query[fileIdKey];
        fileId = typeof queryVal === 'string' ? queryVal : undefined;
      }

      if (!fileId) {
        throw Errors.validation(`${fileIdKey} is required`);
      }

      const hasAccess = await AuthorizationService.verifyFileAccess(fileId, userId);
      if (!hasAccess) {
        throw Errors.fileNotFound();
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Middleware to require file edit access
 * Looks up the file's project and checks role
 */
export function requireFileEditAccess(
  roles: ProjectRole[],
  options: {
    fileIdKey?: string;
  } = {}
) {
  const { fileIdKey = 'fileId' } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw Errors.unauthorized('Authentication required');
      }

      const fileId = req.params[fileIdKey];
      if (!fileId) {
        throw Errors.validation(`${fileIdKey} is required`);
      }

      const dataSource = await getDataSource();
      const fileRepo = dataSource.getRepository(File);
      const file = await fileRepo.findOne({
        where: { id: fileId },
        select: ['projectId'],
      });

      if (!file) {
        throw Errors.fileNotFound();
      }

      const projectId = String(file.projectId);
      const hasRole = await projectMemberService.hasRole(projectId, userId, roles);
      if (!hasRole) {
        throw Errors.fileNotFound();
      }

      // Attach projectId to request for downstream use
      (req as any).fileProjectId = projectId;

      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Middleware to require specific engine roles
 * Extracts engineId from params, body, or query
 */
export function requireEngineRole(
  roles: EngineRole[],
  options: {
    engineIdFrom?: 'params' | 'body' | 'query';
    engineIdKey?: string;
    errorStatus?: number;
    errorMessage?: string;
  } = {}
) {
  const {
    engineIdFrom = 'params',
    engineIdKey = 'engineId',
    errorStatus = 404,
    errorMessage = 'Engine not found',
  } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw Errors.unauthorized('Authentication required');
      }

      let engineId: string | undefined;

      if (engineIdFrom === 'params') {
        engineId = req.params[engineIdKey];
      } else if (engineIdFrom === 'body') {
        engineId = req.body?.[engineIdKey];
      } else if (engineIdFrom === 'query') {
        const queryVal = req.query[engineIdKey];
        engineId = typeof queryVal === 'string' ? queryVal : undefined;
      }

      if (!engineId) {
        throw Errors.validation(`${engineIdKey} is required`);
      }

      const hasRole = await engineService.hasEngineAccess(userId, engineId, roles);
      if (!hasRole) {
        throw Errors.forbidden(errorMessage);
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}


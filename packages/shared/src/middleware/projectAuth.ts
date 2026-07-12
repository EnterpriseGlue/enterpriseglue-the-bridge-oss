/**
 * Project Authorization Middleware
 * Centralized authorization checks for project-scoped routes
 */

import { Request, Response, NextFunction } from 'express';
import type { ProjectRole } from '@enterpriseglue/shared/contracts/roles.js';
import { Errors } from './errorHandler.js';
import { permissionService, type Permission } from '../services/platform-admin/permissions.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { File } from '@enterpriseglue/shared/infrastructure/persistence/entities/File.js';
import type { EngineRole } from '@enterpriseglue/shared/constants/roles.js';

type PermissionFallback = Permission | Permission[];

async function hasProjectPermissionFallback(params: {
  userId: string;
  tenantId?: string | null;
  platformRole?: string;
  projectId: string;
  permission?: PermissionFallback;
}): Promise<boolean> {
  const permissions = Array.isArray(params.permission)
    ? params.permission
    : (params.permission ? [params.permission] : []);
  if (permissions.length === 0) return false;

  for (const permission of permissions) {
    if (await permissionService.hasPermission(permission, {
      userId: params.userId,
      tenantId: params.tenantId || null,
      platformRole: params.platformRole,
      resourceType: 'project',
      resourceId: params.projectId,
    })) {
      return true;
    }
  }

  return false;
}

/**
 * Middleware to require explicit project permissions.
 * Extracts projectId from params, body, or query
 *
 * @param roles - Deprecated; retained for source compatibility and ignored.
 * @param options - Configuration options
 */
export function requireProjectRole(
  _roles: ProjectRole[],
  options: {
    projectIdFrom?: 'params' | 'body' | 'query';
    projectIdKey?: string;
    errorStatus?: number;
    errorMessage?: string;
    permission?: PermissionFallback;
  } = {}
) {
  const {
    projectIdFrom = 'params',
    projectIdKey = 'projectId',
    errorStatus = 404,
    errorMessage = 'Project not found',
    permission,
  } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw Errors.unauthorized('Authentication required');
      }

      let projectId: string | undefined;
      
      if (projectIdFrom === 'params') {
        projectId = req.params[projectIdKey] as string | undefined;
      } else if (projectIdFrom === 'body') {
        projectId = req.body?.[projectIdKey];
      } else if (projectIdFrom === 'query') {
        const queryVal = req.query[projectIdKey];
        projectId = typeof queryVal === 'string' ? queryVal : undefined;
      }

      if (!projectId) {
        throw Errors.validation(`${projectIdKey} is required`);
      }

      const hasScopedPermission = await hasProjectPermissionFallback({
        userId,
        tenantId: req.tenant?.tenantId || null,
        platformRole: req.user?.platformRole || (req.user as any)?.role,
        projectId,
        permission,
      });
      if (!hasScopedPermission) {
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
    permission?: PermissionFallback;
  } = {}
) {
  const {
    projectIdFrom = 'params',
    projectIdKey = 'projectId',
    permission,
  } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw Errors.unauthorized('Authentication required');
      }

      let projectId: string | undefined;
      
      if (projectIdFrom === 'params') {
        projectId = req.params[projectIdKey] as string | undefined;
      } else if (projectIdFrom === 'body') {
        projectId = req.body?.[projectIdKey];
      } else if (projectIdFrom === 'query') {
        const queryVal = req.query[projectIdKey];
        projectId = typeof queryVal === 'string' ? queryVal : undefined;
      }

      if (!projectId) {
        throw Errors.validation(`${projectIdKey} is required`);
      }

      const hasScopedPermission = await hasProjectPermissionFallback({
        userId,
        tenantId: req.tenant?.tenantId || null,
        platformRole: req.user?.platformRole || (req.user as any)?.role,
        projectId,
        permission,
      });
      if (!hasScopedPermission) {
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
 * Uses the file's project to evaluate the provided project permission.
 */
export function requireFileAccess(
  options: {
    fileIdFrom?: 'params' | 'query';
    fileIdKey?: string;
    permission?: PermissionFallback;
  } = {}
) {
  const { fileIdFrom = 'params', fileIdKey = 'fileId', permission } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw Errors.unauthorized('Authentication required');
      }

      let fileId: string | undefined;
      if (fileIdFrom === 'params') {
        fileId = req.params[fileIdKey] as string | undefined;
      } else if (fileIdFrom === 'query') {
        const queryVal = req.query[fileIdKey];
        fileId = typeof queryVal === 'string' ? queryVal : undefined;
      }

      // Whitelist-sanitize: keep only hex chars and hyphens to break taint chain
      const sanitizedFileId = (fileId ?? '').replace(/[^0-9a-fA-F-]/g, '');
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sanitizedFileId)) {
        throw Errors.validation(`${fileIdKey} must be a valid UUID`);
      }

      const dataSource = await getDataSource();
      const file = await dataSource.getRepository(File).findOne({
        where: { id: sanitizedFileId },
        select: ['projectId'],
      });
      if (!file) {
        throw Errors.fileNotFound();
      }
      const projectId = String(file.projectId);
      const hasScopedPermission = await hasProjectPermissionFallback({
        userId,
        tenantId: req.tenant?.tenantId || null,
        platformRole: req.user?.platformRole || (req.user as any)?.role,
        projectId,
        permission,
      });
      if (!hasScopedPermission) {
        throw Errors.fileNotFound();
      }
      (req as any).fileProjectId = projectId;

      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Middleware to require explicit file edit permission.
 * Looks up the file's project and checks the provided permission.
 */
export function requireFileEditAccess(
  _roles: ProjectRole[],
  options: {
    fileIdKey?: string;
    permission?: PermissionFallback;
  } = {}
) {
  const { fileIdKey = 'fileId', permission } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw Errors.unauthorized('Authentication required');
      }

      const fileId = req.params[fileIdKey] as string | undefined;
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
      const hasScopedPermission = await hasProjectPermissionFallback({
        userId,
        tenantId: req.tenant?.tenantId || null,
        platformRole: req.user?.platformRole || (req.user as any)?.role,
        projectId,
        permission,
      });
      if (!hasScopedPermission) {
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
 * Middleware to require explicit engine permissions.
 * Extracts engineId from params, body, or query
 */
export function requireEngineRole(
  _roles: EngineRole[],
  options: {
    engineIdFrom?: 'params' | 'body' | 'query';
    engineIdKey?: string;
    errorStatus?: number;
    errorMessage?: string;
    permission?: PermissionFallback;
  } = {}
) {
  const {
    engineIdFrom = 'params',
    engineIdKey = 'engineId',
    errorStatus = 404,
    errorMessage = 'Engine not found',
    permission,
  } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw Errors.unauthorized('Authentication required');
      }

      let engineId: string | undefined;

      if (engineIdFrom === 'params') {
        engineId = req.params[engineIdKey] as string | undefined;
      } else if (engineIdFrom === 'body') {
        engineId = req.body?.[engineIdKey];
      } else if (engineIdFrom === 'query') {
        const queryVal = req.query[engineIdKey];
        engineId = typeof queryVal === 'string' ? queryVal : undefined;
      }

      if (!engineId) {
        throw Errors.validation(`${engineIdKey} is required`);
      }

      const permissions = Array.isArray(permission)
        ? permission
        : (permission ? [permission] : []);
      let hasPermission = false;
      for (const candidate of permissions) {
        if (await permissionService.hasPermission(candidate, {
          userId,
          tenantId: req.tenant?.tenantId || null,
          platformRole: req.user?.platformRole || (req.user as any)?.role,
          resourceType: 'engine',
          resourceId: engineId,
        })) {
          hasPermission = true;
          break;
        }
      }
      if (!hasPermission) {
        throw Errors.forbidden(errorMessage);
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

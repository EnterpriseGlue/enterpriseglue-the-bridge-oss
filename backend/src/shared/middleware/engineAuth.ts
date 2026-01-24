import type { Request, Response, NextFunction } from 'express';
import { Errors } from './errorHandler.js';
import { engineService } from '../services/platform-admin/index.js';
import type { EngineRole } from '@shared/constants/roles.js';
import { isPlatformAdmin } from './platformAuth.js';
import { getDataSource } from '@shared/db/data-source.js';
import { Engine } from '@shared/db/entities/Engine.js';

type EngineIdFrom = 'params' | 'body' | 'query' | 'any';

type EngineAuthOptions = {
  engineIdFrom?: EngineIdFrom;
  engineIdKey?: string;
};

type EngineRequest = Request & { engineId?: string; engineRole?: EngineRole | null };

function extractEngineId(req: Request, { engineIdFrom = 'any', engineIdKey = 'engineId' }: EngineAuthOptions = {}): string | null {
  const params = req.params as Record<string, string | undefined>;
  const body = req.body as Record<string, unknown> | undefined;
  const query = req.query as Record<string, unknown> | undefined;

  const fromParams = typeof params?.[engineIdKey] === 'string' ? params[engineIdKey] : null;
  const fromBody = typeof body?.[engineIdKey] === 'string' ? (body[engineIdKey] as string) : null;
  const fromQuery = typeof query?.[engineIdKey] === 'string' ? (query[engineIdKey] as string) : null;

  if (engineIdFrom === 'params') return fromParams;
  if (engineIdFrom === 'body') return fromBody;
  if (engineIdFrom === 'query') return fromQuery;

  return fromParams || fromBody || fromQuery || null;
}

function stripEngineId(req: Request, engineIdKey: string) {
  const body = req.body as Record<string, unknown> | undefined;
  if (body && Object.prototype.hasOwnProperty.call(body, engineIdKey)) {
    delete body[engineIdKey];
  }

  const query = req.query as Record<string, unknown> | undefined;
  if (query && Object.prototype.hasOwnProperty.call(query, engineIdKey)) {
    delete query[engineIdKey];
  }
}

function requireEngineRole(allowedRoles: EngineRole[], options: EngineAuthOptions = {}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) throw Errors.unauthorized('Authentication required');

      const existingEngineId = (req as EngineRequest).engineId;
      const existingEngineRole = (req as EngineRequest).engineRole;
      if (typeof existingEngineId === 'string' && existingEngineId && existingEngineRole !== undefined) {
        // Engine access already resolved by an earlier middleware in the chain.
        // This is important because the earlier middleware may have stripped engineId from req.query/req.body.
        if (existingEngineRole && !allowedRoles.includes(existingEngineRole)) {
          throw Errors.forbidden('Access denied');
        }
        return next();
      }

      const engineIdKey = options.engineIdKey || 'engineId';
      const engineId = extractEngineId(req, options);
      if (!engineId) {
        throw Errors.validation(`${engineIdKey} is required`);
      }

      stripEngineId(req, engineIdKey);

      // Verify engine exists and belongs to current tenant
      const dataSource = await getDataSource();
      const engineRepo = dataSource.getRepository(Engine);
      const engine = await engineRepo.findOne({ where: { id: engineId } });
      
      if (!engine) {
        throw Errors.notFound('Engine not found');
      }

      // Platform admins can access any engine (cross-tenant support)
      if (isPlatformAdmin(req)) {
        (req as EngineRequest).engineId = engineId;
        (req as EngineRequest).engineRole = null;
        return next();
      }

      // Verify engine belongs to current tenant context
      const requestTenantId = req.tenant?.tenantId;
      if (requestTenantId && engine.tenantId && engine.tenantId !== requestTenantId) {
        throw Errors.forbidden('Engine not accessible in this tenant');
      }

      const role = await engineService.getEngineRole(req.user.userId, engineId);
      if (!role || !allowedRoles.includes(role)) {
        throw Errors.forbidden('Access denied');
      }

      (req as EngineRequest).engineId = engineId;
      (req as EngineRequest).engineRole = role;

      next();
    } catch (e: any) {
      if (e instanceof Error) {
        return next(e);
      }
      return next(Errors.internal('Authorization failed'));
    }
  };
}

export function requireEngineAccess(options?: EngineAuthOptions) {
  return requireEngineRole(['owner', 'delegate', 'deployer', 'viewer'], options);
}

export function requireEngineDeployer(options?: EngineAuthOptions) {
  return requireEngineRole(['owner', 'delegate', 'deployer'], options);
}

export function requireEngineReadOrWrite(options?: EngineAuthOptions) {
  return (req: Request, res: Response, next: NextFunction) => {
    const method = String(req.method || 'GET').toUpperCase();
    const path = String(req.path || '');
    const readLikeNonGet =
      path === '/mission-control-api/process-instances/preview-count' ||
      path === '/mission-control-api/migration/preview' ||
      path === '/mission-control-api/migration/generate' ||
      path === '/mission-control-api/migration/plan/validate' ||
      path === '/mission-control-api/migration/active-sources' ||
      (path.startsWith('/mission-control-api/decision-definitions/') && path.endsWith('/evaluate'));

    const isRead = method === 'GET' || readLikeNonGet;
    const mw = isRead ? requireEngineAccess(options) : requireEngineDeployer(options);
    return mw(req, res, next);
  };
}

export function requireEngineManager(options?: EngineAuthOptions) {
  return requireEngineRole(['owner', 'delegate'], options);
}

import type { Request, Response, NextFunction } from 'express';
import {
  apiClientService,
  ApiClientScopes,
  type AuthenticatedApiClient,
} from '@enterpriseglue/shared/services/platform-admin/ApiClientService.js';
import {
  serviceAccountService,
  ServiceAccountScopes,
  SERVICE_ACCOUNT_TOKEN_PREFIX,
  type AuthenticatedServiceAccount,
} from '@enterpriseglue/shared/services/platform-admin/ServiceAccountService.js';
import {
  deploymentEligibilityService,
  type DeploymentEligibilityResult,
} from '@enterpriseglue/shared/services/platform-admin/DeploymentEligibilityService.js';
import { assertKnownAuthzAction, type AuthzResourceType } from '@enterpriseglue/shared/authz/permission-actions.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import { Errors, AppError } from './errorHandler.js';

declare global {
  namespace Express {
    interface Request {
      apiClient?: AuthenticatedApiClient;
      serviceAccount?: AuthenticatedServiceAccount;
      deploymentEligibility?: DeploymentEligibilityResult;
    }
  }
}

export type ApiDeploymentRequestLocation = 'body' | 'params' | 'query';

export interface RequireApiDeploymentEligibilityOptions {
  projectId?: string;
  engineId?: string;
  projectIdFrom?: ApiDeploymentRequestLocation;
  engineIdFrom?: ApiDeploymentRequestLocation;
}

export interface RequireApiClientActionOptions {
  permissionId?: string;
  resourceType?: AuthzResourceType;
  resourceId?: string;
  resourceIdFrom?: ApiDeploymentRequestLocation;
  resourceIdKey?: string;
  allowActionPermissionFallback?: boolean;
}

function readBearerToken(req: Request): string {
  const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  if (!authHeader.startsWith('Bearer ')) {
    throw Errors.unauthorized('API client bearer token required');
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    throw Errors.unauthorized('API client bearer token required');
  }
  return token;
}

function readRequestValue(req: Request, key: string, location: ApiDeploymentRequestLocation): string | null {
  const source = location === 'body'
    ? req.body
    : location === 'params'
      ? req.params
      : req.query;
  const value = source?.[key];
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' && value[0].trim() ? value[0].trim() : null;
  }
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function hasScope(scopes: string[] | undefined, scope: string): boolean {
  return Array.isArray(scopes) && scopes.includes(scope);
}

async function authenticateDeploymentPrincipal(req: Request): Promise<{ principalType: 'api_client' | 'service_account'; principalId: string }> {
  if (req.apiClient) {
    if (!hasScope(req.apiClient.scopes, ApiClientScopes.DEPLOYMENT_EXECUTE)) {
      throw Errors.forbidden(`API client missing required scope: ${ApiClientScopes.DEPLOYMENT_EXECUTE}`);
    }
    return { principalType: 'api_client', principalId: req.apiClient.id };
  }

  if (req.serviceAccount) {
    if (!hasScope(req.serviceAccount.scopes, ServiceAccountScopes.DEPLOYMENT_EXECUTE)) {
      throw Errors.forbidden(`Service account missing required scope: ${ServiceAccountScopes.DEPLOYMENT_EXECUTE}`);
    }
    return { principalType: 'service_account', principalId: req.serviceAccount.id };
  }

  const token = readBearerToken(req);
  if (token.startsWith(`${SERVICE_ACCOUNT_TOKEN_PREFIX}_`)) {
    req.serviceAccount = await serviceAccountService.authenticateToken(token, ServiceAccountScopes.DEPLOYMENT_EXECUTE);
    return { principalType: 'service_account', principalId: req.serviceAccount.id };
  }

  req.apiClient = await apiClientService.authenticateToken(token, ApiClientScopes.DEPLOYMENT_EXECUTE);
  return { principalType: 'api_client', principalId: req.apiClient.id };
}

export function requireApiClientScope(scope: string) {
  return async function requireScopedApiClient(req: Request, _res: Response, next: NextFunction) {
    try {
      const token = readBearerToken(req);
      req.apiClient = await apiClientService.authenticateToken(token, scope);
      return next();
    } catch (error) {
      if (error instanceof AppError) {
        return next(error);
      }
      if (error instanceof Error) {
        return next(Errors.unauthorized(error.message));
      }
      return next(Errors.unauthorized('API client authentication failed'));
    }
  };
}

export function requireApiClientAction(scope: string, actionId: string, options: RequireApiClientActionOptions = {}) {
  const action = assertKnownAuthzAction(actionId);

  return async function requireAuthorizedApiClient(req: Request, _res: Response, next: NextFunction) {
    try {
      const token = readBearerToken(req);
      req.apiClient = await apiClientService.authenticateToken(token, scope);

      const tenantId = req.tenant?.tenantId || null;
      const optionResourceId = options.resourceId || (
        options.resourceIdKey
          ? readRequestValue(req, options.resourceIdKey, options.resourceIdFrom || 'body')
          : null
      );
      let allowed = false;
      if (options.resourceType && optionResourceId) {
        allowed = await permissionService.hasPermission(options.permissionId || action.permissionId, {
          principalType: 'api_client',
          principalId: req.apiClient.id,
          tenantId,
          resourceType: options.resourceType,
          resourceId: optionResourceId,
        });
      }

      if (!allowed && options.allowActionPermissionFallback !== false) {
        allowed = await permissionService.hasPermission(action.permissionId, {
          principalType: 'api_client',
          principalId: req.apiClient.id,
          tenantId,
          resourceType: action.resourceType,
        });
      }
      if (!allowed) {
        throw Errors.forbidden(`API client is not authorized for action: ${actionId}`);
      }

      return next();
    } catch (error) {
      if (error instanceof AppError) {
        return next(error);
      }
      if (error instanceof Error) {
        return next(Errors.unauthorized(error.message));
      }
      return next(Errors.unauthorized('API client authorization failed'));
    }
  };
}

export function requireApiDeploymentEligibility(options: RequireApiDeploymentEligibilityOptions = {}) {
  return async function requireEligibleApiDeployment(req: Request, _res: Response, next: NextFunction) {
    try {
      const principal = await authenticateDeploymentPrincipal(req);

      const projectId = options.projectId || readRequestValue(req, 'projectId', options.projectIdFrom || 'body');
      const engineId = options.engineId || readRequestValue(req, 'engineId', options.engineIdFrom || 'body');
      if (!projectId || !engineId) {
        throw Errors.validation('API deployment requires projectId and engineId');
      }

      const result = await deploymentEligibilityService.evaluate({
        principalType: principal.principalType,
        principalId: principal.principalId,
        tenantId: req.tenant?.tenantId || null,
        projectId,
        engineId,
        mode: 'api',
      });
      req.deploymentEligibility = result;

      if (!result.allowed) {
        throw new AppError(
          'DEPLOYMENT_NOT_ALLOWED',
          result.reasons[0] || 'API deployment is not allowed',
          403,
          { reasons: result.reasons, checks: result.checks }
        );
      }

      return next();
    } catch (error) {
      if (error instanceof AppError) {
        return next(error);
      }
      if (error instanceof Error) {
        return next(Errors.unauthorized(error.message));
      }
      return next(Errors.unauthorized('API deployment authorization failed'));
    }
  };
}

import { Request, Response, NextFunction } from 'express';
import { normalizeUserJwtPayload, verifyToken, type AuthenticatedUserJwtPayload, type JwtPayload, type UserJwtPayload } from '@enterpriseglue/shared/utils/jwt.js';
import { Errors, AppError } from './errorHandler.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import { config } from '@enterpriseglue/shared/config/index.js';
import { updateBpmnEngineRequestContext } from '@enterpriseglue/shared/services/bpmn-engine-request-context.js';
import { permissionService, PlatformPermissions } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import { getActivePlatformAdministratorUserIds } from '@enterpriseglue/shared/services/platform-admin/PlatformAdministratorMembershipService.js';

/**
 * Authentication middleware
 * Verifies JWT tokens and adds user info to request
 */

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUserJwtPayload;
      onboarding?: UserJwtPayload;
    }
  }
}

export interface EnterprisePostAuthContext {
  tokenPayload: JwtPayload;
  user: User;
}

export type EnterprisePostAuthResolver = (
  req: Request,
  context: EnterprisePostAuthContext
) => void | Promise<void>;

function getRequestTokenCandidate(req: Request): string | null {
  const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : null;
  if (authHeader?.startsWith('Bearer ')) {
    const bearerToken = authHeader.slice(7).trim();
    if (bearerToken.length > 0) {
      return bearerToken;
    }
  }

  const cookieToken = typeof req.cookies?.accessToken === 'string' ? req.cookies.accessToken.trim() : '';
  return cookieToken.length > 0 ? cookieToken : null;
}

function isStructurallyValidJwt(token: string): boolean {
  const segments = token.split('.');
  return segments.length === 3 && segments.every(segment => /^[A-Za-z0-9_-]+$/.test(segment));
}

function readRequiredAuthPayload(req: Request): JwtPayload {
  const tokenCandidate = getRequestTokenCandidate(req);
  if (tokenCandidate === null) {
    throw Errors.unauthorized('No token provided');
  }

  if (!isStructurallyValidJwt(tokenCandidate)) {
    throw Errors.unauthorized('Malformed token');
  }

  return verifyToken(tokenCandidate);
}

function readOptionalAuthPayload(req: Request): JwtPayload | null {
  const tokenCandidate = getRequestTokenCandidate(req);
  if (tokenCandidate === null || !isStructurallyValidJwt(tokenCandidate)) {
    return null;
  }

  return verifyToken(tokenCandidate);
}

/**
 * Old sessions did not carry principal fields. Normalize them to the only
 * supported browser-session principal while rejecting a mismatched identity.
 */
async function runEnterprisePostAuthResolver(
  req: Request,
  context: EnterprisePostAuthContext
): Promise<void> {
  const resolver = (req.app?.locals as Record<string, unknown> | undefined)?.enterpriseTenantAuthorizationResolver;
  if (typeof resolver === 'function') {
    await (resolver as EnterprisePostAuthResolver)(req, context);
  }
}

/**
 * Middleware to require authentication
 * Verifies JWT token from Authorization header OR cookies
 * Supports both Bearer token auth (email/password) and cookie auth (Microsoft OAuth)
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const payload = normalizeUserJwtPayload(readRequiredAuthPayload(req));

    if (payload.type !== 'access') {
      throw Errors.unauthorized('Invalid token type. Use access token.');
    }

    const dataSource = await getDataSource();
    const userRepo = dataSource.getRepository(User);
    const user = await userRepo.findOneBy({ id: payload.userId, isActive: true });

    if (!user) {
      throw Errors.unauthorized('User not found or inactive');
    }
    if ((payload.authSessionVersion ?? 0) !== (user.authSessionVersion ?? 0)) {
      throw Errors.unauthorized('Session has been revoked');
    }
    if (payload.recovery === 'platform_administrator'
      && !(await getActivePlatformAdministratorUserIds([payload.userId], dataSource)).has(payload.userId)) {
      throw Errors.unauthorized('Session has been revoked');
    }

    // Do not establish downstream request identity until the token's subject
    // has passed the active-account and session-revocation checks.
    req.user = { ...payload, email: user.email };
    updateBpmnEngineRequestContext({ userId: payload.userId });

    const requestPath = req.path;
    const allowUnverifiedPaths = [
      '/api/auth/me',
      '/api/auth/reset-password',
      '/api/auth/change-password',
      '/api/auth/logout',
    ];

    const isAdminVerificationExempt =
      config.adminEmailVerificationExempt &&
      user.email.toLowerCase() === config.adminEmail.toLowerCase() &&
      user.createdByUserId === null;

    if (!user.isEmailVerified && !isAdminVerificationExempt && !allowUnverifiedPaths.includes(requestPath)) {
      throw Errors.forbidden('Email verification required');
    }

    await runEnterprisePostAuthResolver(req, { tokenPayload: payload, user });

    next();
  } catch (error) {
    if (error instanceof AppError) {
      return next(error);
    }
    if (error instanceof Error) {
      return next(Errors.unauthorized(error.message));
    }
    return next(Errors.unauthorized('Authentication failed'));
  }
}

/**
 * Middleware to require canonical platform-administration permission.
 * Must be used after requireAuth
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return next(Errors.unauthorized('Authentication required'));
  }

  try {
    const allowed = await permissionService.hasPermission(PlatformPermissions.AUTHZ_ROLES_MANAGE, {
      userId: req.user.userId,
      tenantId: req.tenant?.tenantId || null,
      resourceType: 'platform',
    });
    if (!allowed) {
      return next(Errors.adminRequired());
    }
  } catch {
    return next(Errors.internal('Authorization check failed'));
  }

  return next();
}

export async function requireOnboarding(req: Request, res: Response, next: NextFunction) {
  try {
    const token = typeof req.cookies?.onboardingToken === 'string' ? req.cookies.onboardingToken : '';
    const payload = normalizeUserJwtPayload(verifyToken(token));

    if (payload.type !== 'onboarding' || typeof payload.invitationId !== 'string' || payload.invitationId.trim().length === 0) {
      return next(Errors.unauthorized('Invalid onboarding token'));
    }

    // New onboarding tokens are session-bound; retain compatibility for
    // short-lived pre-refactor tokens that did not carry this claim.
    if (payload.authSessionVersion !== undefined) {
      const user = await (await getDataSource()).getRepository(User).findOneBy({ id: payload.userId, isActive: true });
      if (!user) return next(Errors.unauthorized('User not found or inactive'));
      if (payload.authSessionVersion !== (user.authSessionVersion ?? 0)) {
        return next(Errors.unauthorized('Session has been revoked'));
      }
    }

    req.onboarding = payload;
    return next();
  } catch (error) {
    if (error instanceof AppError) {
      return next(error);
    }
    if (error instanceof Error) {
      return next(Errors.unauthorized(error.message));
    }
    return next(Errors.unauthorized('Authentication failed'));
  }
}

/**
 * Optional auth - adds user if token present, but doesn't require it
 * Checks both Authorization header and cookies
 */
export async function optionalAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const tokenPayload = readOptionalAuthPayload(req);
    const payload = tokenPayload ? normalizeUserJwtPayload(tokenPayload) : null;
    if (payload?.type === 'access') {
      const dataSource = await getDataSource();
      const user = await dataSource.getRepository(User).findOneBy({
        id: payload.userId,
        isActive: true,
      });
      const recoveryIsCurrent = payload.recovery !== 'platform_administrator'
        || (await getActivePlatformAdministratorUserIds([payload.userId], dataSource)).has(payload.userId);
      if (user && recoveryIsCurrent && (payload.authSessionVersion ?? 0) === (user.authSessionVersion ?? 0)) {
        req.user = { ...payload, email: user.email };
        // Optional authentication must establish the same tenant-aware request
        // context as required authentication. If the enterprise resolver cannot
        // resolve that context, clear the tentative identity and continue as an
        // anonymous request rather than exposing a partially authenticated user.
        try {
          await runEnterprisePostAuthResolver(req, { tokenPayload: payload, user });
        } catch {
          delete req.user;
          return next();
        }
        updateBpmnEngineRequestContext({ userId: payload.userId });
      }
    }
  } catch {
    // Ignore errors for optional auth
  }

  next();
}

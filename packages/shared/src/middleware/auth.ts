import { Request, Response, NextFunction } from 'express';
import { verifyToken, type JwtPayload } from '@enterpriseglue/shared/utils/jwt.js';
import { Errors, AppError } from './errorHandler.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import { config } from '@enterpriseglue/shared/config/index.js';
import { updateBpmnEngineRequestContext } from '@enterpriseglue/shared/services/bpmn-engine-request-context.js';

/**
 * Authentication middleware
 * Verifies JWT tokens and adds user info to request
 */

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
      onboarding?: JwtPayload;
    }
  }
}

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
 * Middleware to require authentication
 * Verifies JWT token from Authorization header OR cookies
 * Supports both Bearer token auth (email/password) and cookie auth (Microsoft OAuth)
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const payload = readRequiredAuthPayload(req);

    if (payload.type !== 'access') {
      throw Errors.unauthorized('Invalid token type. Use access token.');
    }

    // Add user info to request
    req.user = payload;
    updateBpmnEngineRequestContext({ userId: payload.userId });

    const dataSource = await getDataSource();
    const userRepo = dataSource.getRepository(User);
    const user = await userRepo.findOneBy({ id: payload.userId, isActive: true });

    if (!user) {
      throw Errors.unauthorized('User not found or inactive');
    }

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
 * Middleware to require admin role
 * Must be used after requireAuth
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return next(Errors.unauthorized('Authentication required'));
  }

  if (req.user.platformRole !== 'admin') {
    return next(Errors.adminRequired());
  }

  next();
}

export function requireOnboarding(req: Request, res: Response, next: NextFunction) {
  try {
    const token = typeof req.cookies?.onboardingToken === 'string' ? req.cookies.onboardingToken : '';
    const payload = verifyToken(token);

    if (payload.type !== 'onboarding' || typeof payload.invitationId !== 'string' || payload.invitationId.trim().length === 0) {
      return next(Errors.unauthorized('Invalid onboarding token'));
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
export function optionalAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const payload = readOptionalAuthPayload(req);
    if (payload?.type === 'access') {
      req.user = payload;
    }
  } catch {
    // Ignore errors for optional auth
  }

  next();
}

/**
 * Platform Authorization Middleware
 * Handles platform-level role checks (admin, developer, user)
 */

import { Request, Response, NextFunction } from 'express';
import { Errors } from './errorHandler.js';
import { requireAuth } from './auth.js';

/**
 * Require platform admin role
 */
export function requirePlatformAdmin(req: Request, res: Response, next: NextFunction) {
  const enforceAdmin = () => {
    if (!req.user) {
      throw Errors.unauthorized('Authentication required');
    }

    const platformRole = (req.user as any).platformRole;

    if (platformRole !== 'admin') {
      throw Errors.adminRequired();
    }

    next();
  };

  // If user is not yet authenticated, run requireAuth first.
  // This makes requirePlatformAdmin safe to use even when routes
  // forget to add requireAuth explicitly.
  if (!req.user) {
    return requireAuth(req, res, () => {
      enforceAdmin();
    });
  }

  enforceAdmin();
}

/**
 * Require specific platform role(s)
 * Usage: requirePlatformRole('admin', 'developer')
 */
export function requirePlatformRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      throw Errors.unauthorized('Authentication required');
    }

    const platformRole = (req.user as any).platformRole || 'user';

    if (!allowedRoles.includes(platformRole)) {
      throw Errors.forbidden('Insufficient platform permissions');
    }

    next();
  };
}

/**
 * Check if user is platform admin (non-blocking)
 * Sets req.isPlatformAdmin for use in route handlers
 */
export function checkPlatformAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user) {
    const platformRole = (req.user as any).platformRole;
    (req as any).isPlatformAdmin = platformRole === 'admin';
  } else {
    (req as any).isPlatformAdmin = false;
  }
  next();
}

/**
 * Check if request user is a platform admin
 * Use this helper instead of inline checks throughout the codebase
 */
export function isPlatformAdmin(req: Request): boolean {
  return !!req.user && req.user.platformRole === 'admin';
}

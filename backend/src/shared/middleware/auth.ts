import { Request, Response, NextFunction } from 'express';
import { verifyToken, type JwtPayload } from '@shared/utils/jwt.js';
import { Errors, AppError } from './errorHandler.js';
import { getDataSource } from '@shared/db/data-source.js';
import { User } from '@shared/db/entities/User.js';

/**
 * Authentication middleware
 * Verifies JWT tokens and adds user info to request
 */

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/**
 * Middleware to require authentication
 * Verifies JWT token from Authorization header OR cookies
 * Supports both Bearer token auth (email/password) and cookie auth (Microsoft OAuth)
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    let token: string | undefined;

    // Try Authorization header first (email/password login)
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7); // Remove 'Bearer ' prefix
    }

    // Fallback to cookie (Microsoft OAuth login)
    if (!token && req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    }

    // No token found in either location
    if (!token) {
      throw Errors.unauthorized('No token provided');
    }

    // Verify token
    const payload = verifyToken(token);

    if (payload.type !== 'access') {
      throw Errors.unauthorized('Invalid token type. Use access token.');
    }

    // Add user info to request
    req.user = payload;

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

    if (!user.isEmailVerified && !allowUnverifiedPaths.includes(requestPath)) {
      throw Errors.forbidden('Email verification required');
    }

    next();
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    if (error instanceof Error) {
      throw Errors.unauthorized(error.message);
    }
    throw Errors.unauthorized('Authentication failed');
  }
}

/**
 * Middleware to require admin role
 * Must be used after requireAuth
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    throw Errors.unauthorized('Authentication required');
  }

  if (req.user.platformRole !== 'admin') {
    throw Errors.adminRequired();
  }

  next();
}

/**
 * Optional auth - adds user if token present, but doesn't require it
 * Checks both Authorization header and cookies
 */
export function optionalAuth(req: Request, res: Response, next: NextFunction) {
  try {
    let token: string | undefined;

    // Try Authorization header first
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }

    // Fallback to cookie
    if (!token && req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    }

    if (token) {
      const payload = verifyToken(token);
      if (payload.type === 'access') {
        req.user = payload;
      }
    }
  } catch {
    // Ignore errors for optional auth
  }

  next();
}

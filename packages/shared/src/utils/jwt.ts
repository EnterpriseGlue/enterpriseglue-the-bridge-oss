import jwt from 'jsonwebtoken';
import { config } from '@enterpriseglue/shared/config/index.js';
import type { User } from '@enterpriseglue/shared/db/entities/User.js';
import type { PlatformRole } from '@enterpriseglue/shared/contracts/auth.js';

/**
 * JWT utility functions
 * Handles token generation and verification
 */

export interface JwtPayload {
  userId: string;
  email: string;
  platformRole: PlatformRole;
  type: 'access' | 'refresh';
}

/**
 * Generate an access token (short-lived)
 */
export function generateAccessToken(user: User | any): string {
  const payload: JwtPayload = {
    userId: user.id,
    email: user.email,
    platformRole: user.platformRole || 'user',
    type: 'access',
  };

  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtAccessTokenExpires,
  });
}

/**
 * Generate a refresh token (long-lived)
 */
export function generateRefreshToken(user: User | any): string {
  const payload: JwtPayload = {
    userId: user.id,
    email: user.email,
    platformRole: user.platformRole || 'user',
    type: 'refresh',
  };

  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtRefreshTokenExpires,
  });
}

/**
 * Verify and decode a JWT token
 */
export function verifyToken(token: string): JwtPayload {
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as JwtPayload;
    return decoded;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error('Token has expired');
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new Error('Invalid token');
    }
    throw new Error('Token verification failed');
  }
}

/**
 * Decode token without verification (for inspection)
 */
export function decodeToken(token: string): JwtPayload | null {
  try {
    return jwt.decode(token) as JwtPayload;
  } catch {
    return null;
  }
}

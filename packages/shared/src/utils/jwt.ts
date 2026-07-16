import jwt from 'jsonwebtoken';
import { config } from '@enterpriseglue/shared/config/index.js';
import type { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';

/**
 * JWT utility functions
 * Handles token generation and verification
 */

export interface JwtPayload {
  /**
   * Legacy identity fields accepted only while pre-principal session tokens
   * remain in circulation. New tokens carry `principalType`/`principalId`.
   */
  userId?: string;
  email?: string;
  /** Legacy claim accepted on older tokens but never emitted or authorized. */
  platformRole?: string;
  /** Explicit canonical principal fields. Omitted only by pre-refactor tokens. */
  principalType?: 'user';
  principalId?: string;
  authSessionVersion?: number;
  type: 'access' | 'refresh' | 'onboarding';
  invitationId?: string;
  tenantSlug?: string;
}

/** A validated browser-session principal, including a compatibility user id for request consumers. */
export type UserJwtPayload = JwtPayload & {
  userId: string;
  principalType: 'user';
  principalId: string;
};

/** Request identity after middleware has refreshed user profile data from persistence. */
export type AuthenticatedUserJwtPayload = UserJwtPayload & { email: string };

/**
 * Accept pre-principal user tokens during the migration, but make the
 * canonical principal the sole identity input for all newly issued tokens.
 */
export function normalizeUserJwtPayload(payload: JwtPayload): UserJwtPayload {
  const principalType = payload.principalType ?? 'user';
  const principalId = payload.principalId ?? payload.userId;
  if (
    principalType !== 'user' ||
    typeof principalId !== 'string' ||
    principalId.trim().length === 0 ||
    (payload.userId !== undefined && payload.userId !== principalId)
  ) {
    throw new Error('Invalid user principal');
  }

  return { ...payload, userId: principalId, principalType, principalId };
}

/**
 * Generate an access token (short-lived)
 */
export function generateAccessToken(user: User | any): string {
  const payload: JwtPayload = {
    principalType: 'user',
    principalId: user.id,
    authSessionVersion: Number.isInteger(user.authSessionVersion) ? user.authSessionVersion : 0,
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
    principalType: 'user',
    principalId: user.id,
    authSessionVersion: Number.isInteger(user.authSessionVersion) ? user.authSessionVersion : 0,
    type: 'refresh',
  };

  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtRefreshTokenExpires,
  });
}

export function generateOnboardingToken(payload: { userId: string; invitationId: string; tenantSlug: string; authSessionVersion?: number }): string {
  const tokenPayload: JwtPayload = {
    principalType: 'user',
    principalId: payload.userId,
    authSessionVersion: Number.isInteger(payload.authSessionVersion) ? payload.authSessionVersion : 0,
    type: 'onboarding',
    invitationId: payload.invitationId,
    tenantSlug: payload.tenantSlug,
  };

  return jwt.sign(tokenPayload, config.jwtSecret, {
    expiresIn: config.jwtAccessTokenExpires,
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

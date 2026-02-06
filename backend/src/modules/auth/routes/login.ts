import { Router } from 'express';
import { logger } from '@shared/utils/logger.js';
import { z } from 'zod';
import { generateId } from '@shared/utils/id.js';
import { addCaseInsensitiveEquals } from '@shared/db/adapters/QueryHelpers.js';
import { verifyPassword } from '@shared/utils/password.js';
import { generateAccessToken, generateRefreshToken } from '@shared/utils/jwt.js';
import bcrypt from 'bcryptjs';
import { logAudit, AuditActions } from '@shared/services/audit.js';
import { authLimiter , apiLimiter} from '@shared/middleware/rateLimiter.js';
import { getDataSource } from '@shared/db/data-source.js';
import { User } from '@shared/db/entities/User.js';
import { RefreshToken } from '@shared/db/entities/RefreshToken.js';
import { validateBody } from '@shared/middleware/validate.js';
import { asyncHandler, Errors } from '@shared/middleware/errorHandler.js';
import { buildUserCapabilities } from '@shared/services/capabilities.js';
import { config } from '@shared/config/index.js';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * POST /api/auth/login
 * Authenticate user and return tokens
 * Rate limited: 5 attempts per 15 minutes
 */
router.post('/api/auth/login', apiLimiter, authLimiter, validateBody(loginSchema), asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const dataSource = await getDataSource();
  const userRepo = dataSource.getRepository(User);
  const refreshTokenRepo = dataSource.getRepository(RefreshToken);

  // Find user by email (case-insensitive)
  let qb = userRepo.createQueryBuilder('u')
    .where('u.isActive = true');
  qb = addCaseInsensitiveEquals(qb, 'u', 'email', 'email', email);
  const user = await qb.getOne();

  if (!user) {
    // Log failed login attempt
    await logAudit({
      tenantId: req.tenant?.tenantId,
      action: AuditActions.LOGIN_FAILED,
      ipAddress: req.headers['x-forwarded-for'] as string || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      details: { email, reason: 'user_not_found' },
    });
    throw Errors.unauthorized('Invalid email or password');
  }

  // Check if account is locked
  if (user.lockedUntil && user.lockedUntil > Date.now()) {
    const unlockTime = new Date(user.lockedUntil).toISOString();
    await logAudit({
      tenantId: req.tenant?.tenantId,
      userId: user.id,
      action: AuditActions.LOGIN_FAILED,
      ipAddress: req.headers['x-forwarded-for'] as string || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      details: { email, reason: 'account_locked' },
    });
    return res.status(423).json({ 
      error: 'Account is temporarily locked due to failed login attempts',
      lockedUntil: unlockTime
    });
  }

  // Verify password
  const isValidPassword = await verifyPassword(password, user.passwordHash!);

  if (!isValidPassword) {
    // Increment failed login attempts
    const failedAttempts = (user.failedLoginAttempts || 0) + 1;
    let lockedUntil: number | null = null;

    // Lock account after 5 failed attempts for 15 minutes
    if (failedAttempts >= 5) {
      lockedUntil = Date.now() + 15 * 60 * 1000; // 15 minutes
    }

    await userRepo.update({ id: user.id }, {
      failedLoginAttempts: failedAttempts,
      lockedUntil,
      updatedAt: Date.now()
    });

    // Log failed login attempt
    await logAudit({
      tenantId: req.tenant?.tenantId,
      userId: user.id,
      action: lockedUntil ? AuditActions.ACCOUNT_LOCKED : AuditActions.LOGIN_FAILED,
      ipAddress: req.headers['x-forwarded-for'] as string || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      details: { email, reason: 'invalid_password', failedAttempts },
    });

    if (lockedUntil) {
      return res.status(423).json({ 
        error: 'Account locked due to too many failed attempts. Try again in 15 minutes.',
        lockedUntil: new Date(lockedUntil).toISOString()
      });
    }

    throw Errors.unauthorized('Invalid email or password');
  }

  // Password is correct - reset failed attempts and update last login
  await userRepo.update({ id: user.id }, {
    failedLoginAttempts: 0,
    lockedUntil: null,
    lastLoginAt: Date.now(),
    updatedAt: Date.now()
  });

  // Log successful login
  await logAudit({
    tenantId: req.tenant?.tenantId,
    userId: user.id,
    action: AuditActions.LOGIN_SUCCESS,
    ipAddress: req.headers['x-forwarded-for'] as string || req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
    details: { email },
  });

  // Generate tokens
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);

  // Store refresh token (hashed)
  const refreshTokenId = generateId();
  const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days

  await refreshTokenRepo.insert({
    id: refreshTokenId,
    userId: user.id,
    tokenHash: refreshTokenHash,
    expiresAt,
    createdAt: Date.now(),
    deviceInfo: JSON.stringify({
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    })
  });

  // Check email verification status
  const isAdminVerificationExempt =
    config.adminEmailVerificationExempt &&
    user.email.toLowerCase() === config.adminEmail.toLowerCase() &&
    user.createdByUserId === null;
  const isEmailVerified = Boolean(user.isEmailVerified) || isAdminVerificationExempt;

  const capabilities = await buildUserCapabilities({
    userId: user.id,
    platformRole: user.platformRole,
  });
  
  // Set tokens in HTTP-only cookies (same pattern as Microsoft OAuth)
  res.cookie('accessToken', accessToken, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
    maxAge: config.jwtAccessTokenExpires * 1000,
    path: '/',
  });

  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
    maxAge: config.jwtRefreshTokenExpires * 1000,
    path: '/',
  });

  // Return user info (tokens are in cookies, not in body)
  res.json({
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      platformRole: user.platformRole || 'user',
      mustResetPassword: Boolean(user.mustResetPassword),
      capabilities,
      isEmailVerified,
    },
    expiresIn: config.jwtAccessTokenExpires,
    emailVerificationRequired: !isEmailVerified, // Flag for frontend
  });
}));

export default router;

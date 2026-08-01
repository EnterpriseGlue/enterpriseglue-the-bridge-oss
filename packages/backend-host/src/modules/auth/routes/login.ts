import { Router, type Request, type Response } from 'express';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { z } from 'zod';
import { addCaseInsensitiveEquals, getDatabaseType } from '@enterpriseglue/shared/infrastructure/persistence/adapters/QueryHelpers.js';
import { verifyPassword } from '@enterpriseglue/shared/utils/password.js';
import { logAudit, AuditActions } from '@enterpriseglue/shared/services/audit.js';
import { authLimiter , apiLimiter} from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import { validateBody } from '@enterpriseglue/shared/middleware/validate.js';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { buildUserCapabilities } from '@enterpriseglue/shared/services/capabilities.js';
import { config, shouldUseSecureCookies } from '@enterpriseglue/shared/config/index.js';
import { createAuthenticatedSessionContext } from '@enterpriseglue/shared/utils/session-identity.js';
import { getActivePlatformAdministratorUserIds } from '@enterpriseglue/shared/services/platform-admin/PlatformAdministratorMembershipService.js';
import { authzGroupService } from '@enterpriseglue/shared/services/platform-admin/AuthzGroupService.js';
import { authSessionService } from '@enterpriseglue/shared/services/AuthSessionService.js';
import { AuthenticatedSessionLoginResponseSchema } from '@enterpriseglue/shared/schemas/auth/session.js';
import { loginMethodService } from '@enterpriseglue/shared/services/platform-admin/LoginMethodService.js';
import { recordLoginExperienceMetric, type LoginExperienceMethod } from '@enterpriseglue/shared/auth/login-experience-metrics.js';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * Authenticate a local credential. Ordinary login obeys the configured login
 * policy; administrator recovery is a deliberately separate route and checks
 * canonical administrator membership before verifying a password.
 */
async function authenticateLocal(req: Request, res: Response, recovery: boolean): Promise<void> {
  const { email, password } = req.body;
  const dataSource = await getDataSource();

  if (!recovery && !await loginMethodService.ordinaryLocalPasswordEnabled(req.tenant?.tenantId || null)) {
    await logAudit({
      tenantId: req.tenant?.tenantId,
      action: AuditActions.LOGIN_FAILED,
      ipAddress: req.headers['x-forwarded-for'] as string || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      details: { email, reason: 'local_login_disabled_by_policy' },
    });
    throw Errors.forbidden('Local login is disabled. Please use your organization sign-in.');
  }

  const userRepo = dataSource.getRepository(User);

  // Find user by email (case-insensitive)
  const activeValue = getDatabaseType() === 'oracle' ? 1 : true;
  let qb = userRepo.createQueryBuilder('u')
    .where('u.isActive = :isActive', { isActive: activeValue });
  qb = addCaseInsensitiveEquals(qb, 'u', 'email', 'email', email);
  const user = await qb.getOne();

  let preloadedPlatformAdministratorUserIds: Set<string> | null = null;
  if (recovery) {
    if (user?.authProvider === 'local' && user.passwordHash) {
      preloadedPlatformAdministratorUserIds = await getActivePlatformAdministratorUserIds([user.id], dataSource);
    }
    if (!user || !preloadedPlatformAdministratorUserIds?.has(user.id)) {
      await logAudit({
        tenantId: req.tenant?.tenantId,
        userId: user?.id,
        action: AuditActions.LOGIN_FAILED,
        ipAddress: req.headers['x-forwarded-for'] as string || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
        details: { email, reason: 'administrator_recovery_unavailable' },
      });
      throw Errors.forbidden('Administrator recovery is unavailable.');
    }
  }

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

  if (user.authProvider !== 'local' || !user.passwordHash) {
    await logAudit({
      tenantId: req.tenant?.tenantId,
      userId: user.id,
      action: AuditActions.LOGIN_FAILED,
      ipAddress: req.headers['x-forwarded-for'] as string || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      details: { email, reason: 'local_login_not_allowed_for_auth_provider', authProvider: user.authProvider },
    });
    throw Errors.forbidden('Local login is disabled for this account. Please use SSO.');
  }

  // Check if account is locked
  if (user.lockedUntil && Number(user.lockedUntil) > Date.now()) {
    const unlockTime = new Date(Number(user.lockedUntil)).toISOString();
    await logAudit({
      tenantId: req.tenant?.tenantId,
      userId: user.id,
      action: AuditActions.LOGIN_FAILED,
      ipAddress: req.headers['x-forwarded-for'] as string || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      details: { email, reason: 'account_locked' },
    });
    res.status(423).json({
      error: 'Account is temporarily locked due to failed login attempts',
      lockedUntil: unlockTime
    });
    return;
  }

  // Verify password
  const isValidPassword = await verifyPassword(password, user.passwordHash);

  if (!isValidPassword) {
    // Increment failed login attempts
    const failedAttempts = (Number(user.failedLoginAttempts) || 0) + 1;
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
      res.status(423).json({
        error: 'Account locked due to too many failed attempts. Try again in 15 minutes.',
        lockedUntil: new Date(lockedUntil).toISOString()
      });
      return;
    }

    throw Errors.unauthorized('Invalid email or password');
  }

  // Password is correct: update login state and ensure the canonical baseline
  // assignment at the same command boundary.
  await dataSource.transaction(async (manager) => {
    await manager.getRepository(User).update({ id: user.id }, {
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: Date.now(),
      updatedAt: Date.now()
    });
    await authzGroupService.ensureAuthenticatedUserMembershipWithManager(manager, user.id);
  });

  // Log successful login
  await logAudit({
    tenantId: req.tenant?.tenantId,
    userId: user.id,
    action: AuditActions.LOGIN_SUCCESS,
    ipAddress: req.headers['x-forwarded-for'] as string || req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
    details: { email, ...(recovery ? { recovery: 'platform_administrator' } : {}) },
  });

  const session = await authSessionService.issue(user, {
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
    ipAddress: req.ip,
  });

  // Check email verification status
  const isAdminVerificationExempt =
    config.adminEmailVerificationExempt &&
    user.email.toLowerCase() === config.adminEmail.toLowerCase() &&
    user.createdByUserId === null;
  const isEmailVerified = Boolean(user.isEmailVerified) || isAdminVerificationExempt;

  const capabilities = await buildUserCapabilities({
    userId: user.id,
    tenantId: req.tenant?.tenantId || null,
  });
  const platformAdministratorUserIds = preloadedPlatformAdministratorUserIds || await getActivePlatformAdministratorUserIds([user.id], dataSource);
  
  // Set tokens in HTTP-only cookies (same pattern as Microsoft OAuth)
  res.cookie('accessToken', session.accessToken, {
    httpOnly: true,
    secure: shouldUseSecureCookies(),
    sameSite: 'lax',
    maxAge: session.expiresIn * 1000,
    path: '/',
  });

  res.cookie('refreshToken', session.refreshToken, {
    httpOnly: true,
    secure: shouldUseSecureCookies(),
    sameSite: 'lax',
    maxAge: config.jwtRefreshTokenExpires * 1000,
    path: '/',
  });

  // Return user info (tokens are in cookies, not in body)
  res.json(AuthenticatedSessionLoginResponseSchema.parse({
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      platformRole: platformAdministratorUserIds.has(user.id) ? 'admin' : 'user',
      mustResetPassword: Boolean(user.mustResetPassword),
      capabilities,
      isEmailVerified,
      session: createAuthenticatedSessionContext(user.id, req.tenant?.tenantId),
    },
    expiresIn: config.jwtAccessTokenExpires,
    emailVerificationRequired: !isEmailVerified, // Flag for frontend
  }));
}

async function authenticateMeasuredLocal(req: Request, res: Response, recovery: boolean): Promise<void> {
  const method: LoginExperienceMethod = recovery ? 'recovery' : 'local';
  const startedAt = Date.now();
  recordLoginExperienceMetric({ method, event: 'selected' });
  try {
    await authenticateLocal(req, res, recovery);
    recordLoginExperienceMetric({
      method,
      event: res.statusCode >= 400 ? 'failed' : 'succeeded',
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    recordLoginExperienceMetric({ method, event: 'failed', durationMs: Date.now() - startedAt });
    throw error;
  }
}

/**
 * POST /api/auth/login
 * Authenticate an ordinary local user when the login policy permits it.
 */
router.post('/api/auth/login', apiLimiter, authLimiter, validateBody(loginSchema), asyncHandler(async (req, res) => {
  await authenticateMeasuredLocal(req, res, false);
}));

/**
 * POST /api/auth/recovery/login
 * Dedicated break-glass route for active canonical platform administrators.
 */
router.post('/api/auth/recovery/login', apiLimiter, authLimiter, validateBody(loginSchema), asyncHandler(async (req, res) => {
  await authenticateMeasuredLocal(req, res, true);
}));

export default router;

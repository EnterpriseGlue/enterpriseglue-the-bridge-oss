import { Router } from 'express';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import bcrypt from 'bcryptjs';
import { normalizeUserJwtPayload, verifyToken, type UserJwtPayload } from '@enterpriseglue/shared/utils/jwt.js';
import { generateAccessToken } from '@enterpriseglue/shared/utils/jwt.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import { RefreshToken } from '@enterpriseglue/shared/infrastructure/persistence/entities/RefreshToken.js';
import { IsNull, MoreThan } from 'typeorm';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { config, shouldUseSecureCookies } from '@enterpriseglue/shared/config/index.js';
import { RefreshAccessTokenResponseSchema } from '@enterpriseglue/shared/schemas/auth/session.js';
import { getActivePlatformAdministratorUserIds } from '@enterpriseglue/shared/services/platform-admin/PlatformAdministratorMembershipService.js';
import { tenantService } from '@enterpriseglue/shared/services/platform-admin/TenantService.js';
import { OSS_DEFAULT_TENANT_ID, OSS_DEFAULT_TENANT_SLUG } from '@enterpriseglue/shared/authz/tenant-scope.js';

const router = Router();

/**
 * POST /api/auth/refresh
 * Exchange refresh token for new access token
 * Reads refresh token from httpOnly cookie
 */
router.post('/api/auth/refresh', apiLimiter, asyncHandler(async (req, res) => {
  const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

  if (!refreshToken) {
    throw Errors.unauthorized('No refresh token provided');
  }

  // Verify refresh token
  let payload: UserJwtPayload;
  try {
    payload = normalizeUserJwtPayload(verifyToken(refreshToken));
  } catch {
    throw Errors.unauthorized('Invalid user principal');
  }

  if (payload.type !== 'refresh') {
    throw Errors.unauthorized('Invalid token type');
  }

  const tenantId = payload.tenantId || (config.tenancyMode !== 'pooled' ? OSS_DEFAULT_TENANT_ID : null);
  const tenantSlug = payload.tenantSlug || (config.tenancyMode !== 'pooled' ? OSS_DEFAULT_TENANT_SLUG : null);
  if (config.tenancyMode === 'pooled' && payload.recovery !== 'platform_administrator') {
    if (!tenantId || !tenantSlug) throw Errors.unauthorized('Tenant-scoped refresh token required');
    const tenant = await tenantService.getById(tenantId);
    if (!tenant || tenant.status !== 'active' || tenant.slug !== tenantSlug) {
      throw Errors.unauthorized('Session tenant is no longer active');
    }
    if (!await tenantService.hasMembership(payload.userId, tenantId)) {
      throw Errors.unauthorized('Tenant membership is no longer active');
    }
  }

  const dataSource = await getDataSource();
  const userRepo = dataSource.getRepository(User);
  const refreshTokenRepo = dataSource.getRepository(RefreshToken);

  // Get user
  const user = await userRepo.findOneBy({ id: payload.userId, isActive: true });

  if (!user) {
    throw Errors.validation('User not found or inactive');
  }
  if ((payload.authSessionVersion ?? 0) !== (user.authSessionVersion ?? 0)) {
    throw Errors.unauthorized('Session has been revoked');
  }
  if (payload.recovery === 'platform_administrator'
    && !(await getActivePlatformAdministratorUserIds([user.id], dataSource)).has(user.id)) {
    throw Errors.unauthorized('Session has been revoked');
  }

  // Verify refresh token exists and is not revoked
  const tokenResult = await refreshTokenRepo.find({
    where: config.tenancyMode !== 'pooled' ? [{
      userId: user.id,
      revokedAt: IsNull(),
      expiresAt: MoreThan(Date.now()),
      tenantId: tenantId || IsNull(),
    }, {
      userId: user.id,
      revokedAt: IsNull(),
      expiresAt: MoreThan(Date.now()),
      tenantId: IsNull(),
    }] : {
      userId: user.id,
      revokedAt: IsNull(),
      expiresAt: MoreThan(Date.now()),
      tenantId: tenantId!,
    },
    select: ['tokenHash', 'tenantId'],
  });

  // Check if any of the stored token hashes match the provided token
  let isValidToken = false;
  for (const row of tokenResult) {
    const isMatch = await bcrypt.compare(refreshToken, row.tokenHash);
    if (isMatch) {
      isValidToken = true;
      break;
    }
  }

  if (!isValidToken) {
    throw Errors.unauthorized('Invalid refresh token');
  }

  // Generate new access token
  const accessToken = generateAccessToken(user, {
    administratorRecovery: payload.recovery === 'platform_administrator',
    authenticationMethod: payload.authenticationMethod,
    mfaVerified: payload.mfaVerified === true,
    ...(tenantId ? { tenantId } : {}),
    ...(tenantSlug ? { tenantSlug } : {}),
  });

  // Set new access token as httpOnly cookie
  res.cookie('accessToken', accessToken, {
    httpOnly: true,
    secure: shouldUseSecureCookies(),
    sameSite: 'lax',
    maxAge: config.jwtAccessTokenExpires * 1000,
    path: '/',
  });

  res.json(RefreshAccessTokenResponseSchema.parse({
    expiresIn: config.jwtAccessTokenExpires,
  }));
}));

export default router;

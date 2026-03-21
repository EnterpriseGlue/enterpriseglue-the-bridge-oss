import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { requireOnboarding } from '@enterpriseglue/shared/middleware/auth.js';
import { validateBody } from '@enterpriseglue/shared/middleware/validate.js';
import { asyncHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { validatePassword } from '@enterpriseglue/shared/utils/password.js';
import { invitationService } from '@enterpriseglue/shared/services/invitations.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { generateAccessToken, generateRefreshToken } from '@enterpriseglue/shared/utils/jwt.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { RefreshToken } from '@enterpriseglue/shared/db/entities/RefreshToken.js';
import { User } from '@enterpriseglue/shared/db/entities/User.js';
import { buildUserCapabilities } from '@enterpriseglue/shared/services/capabilities.js';
import { config } from '@enterpriseglue/shared/config/index.js';
import { logAudit } from '@enterpriseglue/shared/services/audit.js';

const router = Router();

const completeOnboardingSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  newPassword: z.string().min(8),
});

router.post('/api/auth/complete-onboarding', apiLimiter, requireOnboarding, validateBody(completeOnboardingSchema), asyncHandler(async (req, res) => {
  const { firstName, lastName, newPassword } = req.body as z.infer<typeof completeOnboardingSchema>;
  const validation = validatePassword(newPassword);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.errors.join('. ') });
  }

  const result = await invitationService.completeInvitation(String(req.onboarding!.invitationId), newPassword, {
    firstName,
    lastName,
  });
  const dataSource = await getDataSource();
  const refreshTokenRepo = dataSource.getRepository(RefreshToken);
  const userRepo = dataSource.getRepository(User);
  const user = await userRepo.findOneByOrFail({ id: result.user.id });
  const capabilities = await buildUserCapabilities({
    userId: user.id,
    platformRole: user.platformRole,
  });
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);
  const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
  const now = Date.now();

  await userRepo.update({ id: user.id }, {
    lastLoginAt: now,
    updatedAt: now,
  });

  await refreshTokenRepo.insert({
    id: generateId(),
    userId: user.id,
    tokenHash: refreshTokenHash,
    expiresAt: now + 7 * 24 * 60 * 60 * 1000,
    createdAt: now,
    deviceInfo: JSON.stringify({
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    }),
  });

  await logAudit({
    userId: user.id,
    action: 'auth.onboarding.completed',
    resourceType: 'user',
    resourceId: user.id,
    ipAddress: req.headers['x-forwarded-for'] as string || req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
    details: { email: user.email },
  });

  res.clearCookie('onboardingToken', { path: '/' });
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

  res.json({
    user: {
      ...result.user,
      capabilities,
      isEmailVerified: true,
      mustResetPassword: false,
    },
    expiresIn: config.jwtAccessTokenExpires,
    emailVerificationRequired: false,
  });
}));

export default router;

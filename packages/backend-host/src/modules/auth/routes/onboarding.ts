import { Router } from 'express';
import { z } from 'zod';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { requireOnboarding } from '@enterpriseglue/shared/middleware/auth.js';
import { validateBody } from '@enterpriseglue/shared/middleware/validate.js';
import { asyncHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { validatePassword } from '@enterpriseglue/shared/utils/password.js';
import { invitationService } from '@enterpriseglue/shared/services/invitations.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import { buildUserCapabilities } from '@enterpriseglue/shared/services/capabilities.js';
import { config, shouldUseSecureCookies } from '@enterpriseglue/shared/config/index.js';
import { logAudit } from '@enterpriseglue/shared/services/audit.js';
import { createAuthenticatedSessionContext } from '@enterpriseglue/shared/utils/session-identity.js';
import { getActivePlatformAdministratorUserIds } from '@enterpriseglue/shared/services/platform-admin/PlatformAdministratorMembershipService.js';
import { authSessionService } from '@enterpriseglue/shared/services/AuthSessionService.js';

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
  const userRepo = dataSource.getRepository(User);
  const user = await userRepo.findOneByOrFail({ id: result.user.id });
  const capabilities = await buildUserCapabilities({
    userId: user.id,
    tenantId: req.tenant?.tenantId || null,
  });
  const platformAdministratorUserIds = await getActivePlatformAdministratorUserIds([user.id], dataSource);
  const now = Date.now();

  await userRepo.update({ id: user.id }, {
    lastLoginAt: now,
    updatedAt: now,
  });

  const session = await authSessionService.issue(user, {
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
    ipAddress: req.ip,
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

  res.json({
    user: {
      ...result.user,
      platformRole: platformAdministratorUserIds.has(user.id) ? 'admin' : 'user',
      capabilities,
      isEmailVerified: true,
      mustResetPassword: false,
      session: createAuthenticatedSessionContext(user.id, req.tenant?.tenantId),
    },
    expiresIn: config.jwtAccessTokenExpires,
    emailVerificationRequired: false,
  });
}));

export default router;

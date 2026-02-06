import { Router } from 'express';
import { logger } from '@shared/utils/logger.js';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { requireAuth } from '@shared/middleware/auth.js';
import { hashPassword, verifyPassword, validatePassword } from '@shared/utils/password.js';
import { sendVerificationEmail } from '@shared/services/email/index.js';
import { config } from '@shared/config/index.js';
import { logAudit, AuditActions } from '@shared/services/audit.js';
import { getDataSource } from '@shared/db/data-source.js';
import { User } from '@shared/db/entities/User.js';
import { RefreshToken } from '@shared/db/entities/RefreshToken.js';
import { validateBody } from '@shared/middleware/validate.js';
import { passwordResetLimiter , apiLimiter} from '@shared/middleware/rateLimiter.js';
import { asyncHandler, Errors } from '@shared/middleware/errorHandler.js';

const router = Router();

const resetPasswordSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string().min(8),
});

const changePasswordSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string().min(8),
});

/**
 * POST /api/auth/reset-password
 * Reset password on first login (when must_reset_password is true)
 * ✨ Migrated to TypeORM
 */
router.post('/api/auth/reset-password', apiLimiter, requireAuth, passwordResetLimiter, validateBody(resetPasswordSchema), asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  // Validate new password complexity
  const validation = validatePassword(newPassword);
  if (!validation.valid) {
    throw Errors.validation('Password does not meet requirements', validation.errors);
  }

  const dataSource = await getDataSource();
  const userRepo = dataSource.getRepository(User);
  const refreshTokenRepo = dataSource.getRepository(RefreshToken);
  
  const user = await userRepo.findOneBy({ id: req.user!.userId });
  
  if (!user) {
    throw Errors.notFound('User');
  }

  // Verify current password
  const isValid = await verifyPassword(currentPassword, user.passwordHash!);
  if (!isValid) {
    throw Errors.unauthorized('Current password is incorrect');
  }

  // Check if new password is same as current
  const isSame = await verifyPassword(newPassword, user.passwordHash!);
  if (isSame) {
    throw Errors.validation('New password must be different from current password');
  }

  // Hash new password
  const newPasswordHash = await hashPassword(newPassword);

  // Check if this is first password reset (must_reset_password was true)
  const wasFirstReset = Boolean(user.mustResetPassword);

  // Generate verification token if this is first reset
  let verificationToken: string | null = null;
  let tokenExpiry: number | null = null;
  if (wasFirstReset) {
    verificationToken = randomBytes(32).toString('hex');
    tokenExpiry = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
  }

  const now = Date.now();

  // Update password, clear must_reset_password flag, and set verification token
  if (wasFirstReset) {
    await userRepo.update({ id: user.id }, {
      passwordHash: newPasswordHash,
      mustResetPassword: false,
      emailVerificationToken: verificationToken,
      emailVerificationTokenExpiry: tokenExpiry,
      updatedAt: now
    });
  } else {
    await userRepo.update({ id: user.id }, {
      passwordHash: newPasswordHash,
      mustResetPassword: false,
      updatedAt: now
    });
  }

  // Revoke all refresh tokens (force re-login on all devices)
  await refreshTokenRepo.update({ userId: user.id }, { revokedAt: now });

  // Send verification email if this was first password reset
  if (wasFirstReset && verificationToken) {
    const verificationUrl = `${config.frontendUrl}/verify-email?token=${verificationToken}`;
    
    await sendVerificationEmail({
      to: user.email,
      firstName: user.firstName || undefined,
      verificationUrl,
    });

    await logAudit({
      userId: user.id,
      action: 'auth.verification.sent',
      ipAddress: req.headers['x-forwarded-for'] as string || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      details: { email: user.email, reason: 'first_password_reset' },
    });

    logger.info(`✅ Verification email sent to ${user.email} after first password reset`);
  }

  res.json({ 
    message: 'Password reset successfully',
    verificationEmailSent: wasFirstReset,
  });
}));

/**
 * POST /api/auth/change-password
 * Change password (when must_reset_password is false)
 * ✨ Migrated to TypeORM
 */
router.post('/api/auth/change-password', apiLimiter, requireAuth, validateBody(changePasswordSchema), asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  // Validate new password complexity
  const validation = validatePassword(newPassword);
  if (!validation.valid) {
    throw Errors.validation('Password does not meet requirements', validation.errors);
  }

  const dataSource = await getDataSource();
  const userRepo = dataSource.getRepository(User);
  
  const user = await userRepo.findOneBy({ id: req.user!.userId });
  
  if (!user) {
    throw Errors.notFound('User');
  }

  // Verify current password
  const isValid = await verifyPassword(currentPassword, user.passwordHash!);
  if (!isValid) {
    throw Errors.unauthorized('Current password is incorrect');
  }

  // Check if new password is same as current
  const isSame = await verifyPassword(newPassword, user.passwordHash!);
  if (isSame) {
    throw Errors.validation('New password must be different from current password');
  }

  // Hash new password
  const newPasswordHash = await hashPassword(newPassword);
  const now = Date.now();

  // Update password
  await userRepo.update({ id: user.id }, {
    passwordHash: newPasswordHash,
    updatedAt: now
  });

  res.json({ message: 'Password changed successfully' });
}));

export default router;

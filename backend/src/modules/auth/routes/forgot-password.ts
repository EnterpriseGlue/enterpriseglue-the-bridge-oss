/**
 * Forgot Password Routes
 * Handles password reset request and token-based password reset
 */

import { Router } from 'express';
import { asyncHandler, Errors } from '@shared/middleware/errorHandler.js';
import { logger } from '@shared/utils/logger.js';
import { z } from 'zod';
import { getDataSource } from '@shared/db/data-source.js';
import { User } from '@shared/db/entities/User.js';
import { PasswordResetToken } from '@shared/db/entities/PasswordResetToken.js';
import { validateBody } from '@shared/middleware/validate.js';
import { passwordResetLimiter, passwordResetVerifyLimiter, apiLimiter } from '@shared/middleware/rateLimiter.js';
import { sendPasswordResetEmail } from '@shared/services/email/index.js';
import { hashPassword } from '@shared/utils/password.js';
import { logAudit } from '@shared/services/audit.js';
import { IsNull } from 'typeorm';

const router = Router();

// Request password reset (forgot password)
const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

// Reset password with token
const resetWithTokenSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8),
});

/**
 * POST /api/auth/forgot-password
 * Request a password reset email
 */
router.post('/api/auth/forgot-password', apiLimiter, passwordResetLimiter, validateBody(forgotPasswordSchema), asyncHandler(async (req, res) => {
  const { email } = req.body;
  const dataSource = await getDataSource();
  const userRepo = dataSource.getRepository(User);
  const resetTokenRepo = dataSource.getRepository(PasswordResetToken);

  // Find user by email
  const user = await userRepo.findOneBy({ email: email.toLowerCase() });

  // Always return success to prevent email enumeration
  // But only actually send email if user exists and uses local auth
  if (user && user.isActive && user.authProvider === 'local') {
    const { randomBytes, createHash } = await import('crypto');
    const resetToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(resetToken).digest('hex');
    const tokenExpiry = Date.now() + 60 * 60 * 1000; // 1 hour

    await resetTokenRepo.update({ userId: user.id, consumedAt: IsNull() }, { consumedAt: Date.now() });

    await resetTokenRepo.insert({
      userId: user.id,
      tokenHash,
      expiresAt: tokenExpiry,
      createdAt: Date.now(),
      consumedAt: null,
    });

    await sendPasswordResetEmail({
      to: user.email,
      firstName: user.firstName ?? undefined,
      resetToken,
    });

    // Audit log
    await logAudit({
      userId: user.id,
      action: 'auth.password_reset.requested',
      resourceType: 'user',
      resourceId: user.id,
      ipAddress: req.headers['x-forwarded-for'] as string || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      details: { email: user.email },
    });
  }

  // Always return success to prevent email enumeration
  res.json({ 
    message: 'If an account exists with that email, a password reset link has been sent.',
  });
}));

/**
 * POST /api/auth/reset-password-with-token
 * Reset password using the token from email
 */
router.post('/api/auth/reset-password-with-token', apiLimiter, passwordResetVerifyLimiter, validateBody(resetWithTokenSchema), asyncHandler(async (req, res) => {
  const { token, newPassword } = req.body;
  const dataSource = await getDataSource();
  const userRepo = dataSource.getRepository(User);
  const resetTokenRepo = dataSource.getRepository(PasswordResetToken);
  const now = Date.now();

  const { createHash } = await import('crypto');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const resetToken = await resetTokenRepo.findOneBy({ tokenHash, consumedAt: IsNull() });

  if (!resetToken) {
    throw Errors.validation('Invalid or expired reset token');
  }

  if (resetToken.expiresAt < now) {
    throw Errors.validation('Reset token has expired. Please request a new password reset.');
  }

  const user = await userRepo.findOneBy({ id: resetToken.userId });

  if (!user) {
    throw Errors.validation('Invalid or expired reset token');
  }

  if (!user.isActive) {
    throw Errors.validation('This account has been disabled');
  }

  // Hash new password
  const newPasswordHash = await hashPassword(newPassword);

  // Update password
  await userRepo.update({ id: user.id }, {
    passwordHash: newPasswordHash,
    mustResetPassword: false,
    failedLoginAttempts: 0,
    lockedUntil: null,
    updatedAt: now,
  });

  await resetTokenRepo.update({ id: resetToken.id }, { consumedAt: now });

  // Audit log
  await logAudit({
    userId: user.id,
    action: 'auth.password_reset.completed',
    resourceType: 'user',
    resourceId: user.id,
    ipAddress: req.headers['x-forwarded-for'] as string || req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
    details: { email: user.email },
  });

  logger.info(`✅ Password reset completed for ${user.email}`);

  res.json({ 
    message: 'Password has been reset successfully. You can now login with your new password.',
  });
}));

/**
 * GET /api/auth/verify-reset-token
 * Verify if a reset token is valid (for frontend validation before showing form)
 */
router.get('/api/auth/verify-reset-token', apiLimiter, passwordResetVerifyLimiter, asyncHandler(async (req, res) => {
  const { token } = req.query;

  if (!token || typeof token !== 'string') {
    throw Errors.validation('Token is required');
  }

  const dataSource = await getDataSource();
  const userRepo = dataSource.getRepository(User);
  const resetTokenRepo = dataSource.getRepository(PasswordResetToken);
  const now = Date.now();

  const { createHash } = await import('crypto');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const resetToken = await resetTokenRepo.findOneBy({ tokenHash, consumedAt: IsNull() });

  if (!resetToken || resetToken.expiresAt < now) {
    return res.json({ valid: false, error: 'Invalid token' });
  }

  const user = await userRepo.findOneBy({ id: resetToken.userId });

  if (!user || !user.isActive) {
    return res.json({ valid: false, error: 'Invalid token' });
  }

  res.json({ valid: true });
}));

export default router;

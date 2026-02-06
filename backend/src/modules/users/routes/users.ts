import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '@shared/middleware/auth.js';
import { requirePermission } from '@shared/middleware/requirePermission.js';
import { asyncHandler, Errors } from '@shared/middleware/errorHandler.js';
import { sendWelcomeEmail } from '@shared/services/email/index.js';
import { logAudit, AuditActions } from '@shared/services/audit.js';
import { createUserLimiter } from '@shared/middleware/rateLimiter.js';
import { validateBody } from '@shared/middleware/validate.js';
import { PlatformPermissions } from '@shared/services/platform-admin/permissions.js';
import { userService } from '@shared/services/platform-admin/UserService.js';

const router = Router();

const createUserSchema = z.object({
  email: z.string().email(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  role: z.enum(['admin', 'user']).default('user'),
  platformRole: z.enum(['admin', 'developer', 'user']).optional(),
  sendEmail: z.boolean().default(true),
});

const updateUserSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  role: z.enum(['admin', 'user']).optional(),
  platformRole: z.enum(['admin', 'developer', 'user']).optional(),
  isActive: z.boolean().optional(),
});

/**
 * GET /api/users
 * List all users (admin only)
 * ✨ Migrated to TypeORM
 */
router.get('/api/users', requireAuth, requirePermission({ permission: PlatformPermissions.USER_MANAGE }), asyncHandler(async (req, res) => {
  const users = await userService.listUsers();
  res.json(users);
}));

/**
 * POST /api/users
 * Create a new user (admin only)
 * Rate limited: 20 user creations per hour
 * ✨ Uses validation middleware
 */
router.post('/api/users', requireAuth, requirePermission({ permission: PlatformPermissions.USER_MANAGE }), createUserLimiter, validateBody(createUserSchema), asyncHandler(async (req, res) => {
  const { email, firstName, lastName, platformRole, sendEmail } = req.body;

  const result = await userService.createUser({
    email,
    firstName,
    lastName,
    platformRole: platformRole || 'user',
    createdByUserId: req.user!.userId,
  });

  await logAudit({
    userId: req.user!.userId,
    action: AuditActions.USER_CREATE,
    resourceType: 'user',
    resourceId: result.user.id,
    ipAddress: req.headers['x-forwarded-for'] as string || req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
    details: { email, platformRole: result.user.platformRole },
  });

  let emailSent = false;
  let emailError: string | undefined;

  if (sendEmail) {
    const welcomeResult = await sendWelcomeEmail({
      to: email,
      firstName,
      temporaryPassword: result.temporaryPassword,
    });
    emailSent = welcomeResult.success;
    emailError = welcomeResult.error;
  }

  res.status(201).json({
    user: result.user,
    temporaryPassword: !emailSent ? result.temporaryPassword : undefined,
    emailSent,
    emailError,
    verificationRequired: true,
  });
}));

/**
 * GET /api/users/:id
 * Get user by ID (admin only)
 * ✨ Migrated to TypeORM
 */
router.get('/api/users/:id', requireAuth, requirePermission({ permission: PlatformPermissions.USER_MANAGE }), asyncHandler(async (req, res) => {
  const user = await userService.getUser(req.params.id);
  res.json(user);
}));

/**
 * PUT /api/users/:id
 * Update user (admin only)
 * ✨ Migrated to TypeORM
 * ✨ Uses validation middleware
 */
router.put('/api/users/:id', requireAuth, requirePermission({ permission: PlatformPermissions.USER_MANAGE }), validateBody(updateUserSchema), asyncHandler(async (req, res) => {
  const user = await userService.updateUser(req.params.id, req.body);
  res.json(user);
}));

/**
 * DELETE /api/users/:id
 * Delete user (soft delete - deactivate) (admin only)
 * ✨ Migrated to TypeORM
 */
router.delete('/api/users/:id', requireAuth, requirePermission({ permission: PlatformPermissions.USER_MANAGE }), asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (id === req.user!.userId) {
    throw Errors.validation('Cannot delete your own account');
  }

  await userService.deactivateUser(id);
  res.json({ message: 'User deleted successfully' });
}));

/**
 * POST /api/users/:id/unlock
 * Unlock locked user account (admin only)
 * ✨ Migrated to TypeORM
 */
router.post('/api/users/:id/unlock', requireAuth, requirePermission({ permission: PlatformPermissions.USER_MANAGE }), asyncHandler(async (req, res) => {
  await userService.unlockUser(req.params.id);
  res.json({ message: 'User account unlocked successfully' });
}));

export default router;

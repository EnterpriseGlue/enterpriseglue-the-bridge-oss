import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { requirePermission } from '@enterpriseglue/shared/middleware/requirePermission.js';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { logAudit, AuditActions } from '@enterpriseglue/shared/services/audit.js';
import { createUserLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { validateBody } from '@enterpriseglue/shared/middleware/validate.js';
import { PlatformPermissions } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import { userService } from '@enterpriseglue/shared/services/platform-admin/UserService.js';
import { invitationService } from '@enterpriseglue/shared/services/invitations.js';

const router = Router();

const createUserSchema = z.object({
  email: z.string().email(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  role: z.enum(['admin', 'user']).default('user'),
  platformRole: z.enum(['admin', 'user']).optional(),
  sendEmail: z.boolean().default(true),
});

const updateUserSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  role: z.enum(['admin', 'user']).optional(),
  platformRole: z.enum(['admin', 'user']).optional(),
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

  const user = await userService.createPendingUser({
    email,
    firstName,
    lastName,
    platformRole: platformRole || 'user',
    createdByUserId: req.user!.userId,
  });

  const inviteResult = await invitationService.createInvitation({
    userId: user.id,
    email,
    tenantSlug: 'default',
    resourceType: 'platform_user',
    resourceName: 'Platform access',
    platformRole: (platformRole || 'user'),
    createdByUserId: req.user!.userId,
    invitedByName: req.user!.email,
    deliveryMethod: sendEmail ? 'email' : 'manual',
  });

  await logAudit({
    userId: req.user!.userId,
    action: AuditActions.USER_CREATE,
    resourceType: 'user',
    resourceId: user.id,
    ipAddress: req.headers['x-forwarded-for'] as string || req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
    details: { email, platformRole: user.platformRole, deliveryMethod: sendEmail ? 'email' : 'manual' },
  });

  res.status(201).json({
    user,
    inviteUrl: inviteResult.emailSent ? undefined : inviteResult.inviteUrl,
    oneTimePassword: inviteResult.oneTimePassword,
    emailSent: inviteResult.emailSent,
    emailError: inviteResult.emailError,
  });
}));

/**
 * GET /api/users/:id
 * Get user by ID (admin only)
 * ✨ Migrated to TypeORM
 */
router.get('/api/users/:id', requireAuth, requirePermission({ permission: PlatformPermissions.USER_MANAGE }), asyncHandler(async (req, res) => {
  const userId = String(req.params.id);
  const user = await userService.getUser(userId);
  res.json(user);
}));

/**
 * PUT /api/users/:id
 * Update user (admin only)
 * ✨ Migrated to TypeORM
 * ✨ Uses validation middleware
 */
router.put('/api/users/:id', requireAuth, requirePermission({ permission: PlatformPermissions.USER_MANAGE }), validateBody(updateUserSchema), asyncHandler(async (req, res) => {
  const userId = String(req.params.id);
  const user = await userService.updateUser(userId, req.body);
  res.json(user);
}));

/**
 * DELETE /api/users/:id
 * Delete user (soft delete - deactivate) (admin only)
 * ✨ Migrated to TypeORM
 */
router.delete('/api/users/:id', requireAuth, requirePermission({ permission: PlatformPermissions.USER_MANAGE }), asyncHandler(async (req, res) => {
  const id = String(req.params.id);

  if (id === req.user!.userId) {
    throw Errors.validation('Cannot delete your own account');
  }

  await userService.deactivateUser(id);
  res.json({ message: 'User deleted successfully' });
}));

/**
 * DELETE /api/users/:id/permanent
 * Permanently delete a safe local user (pending or inactive) (admin only)
 */
router.delete('/api/users/:id/permanent', requireAuth, requirePermission({ permission: PlatformPermissions.USER_MANAGE }), asyncHandler(async (req, res) => {
  const id = String(req.params.id);

  if (id === req.user!.userId) {
    throw Errors.validation('Cannot delete your own account');
  }

  const localLoginDisabled = await invitationService.isLocalLoginDisabled();
  if (localLoginDisabled) {
    throw Errors.forbidden('Permanent delete is unavailable while SSO is enabled');
  }

  await userService.deleteUserPermanently(id);
  res.json({ message: 'User permanently deleted successfully' });
}));

/**
 * POST /api/users/:id/unlock
 * Unlock locked user account (admin only)
 * ✨ Migrated to TypeORM
 */
router.post('/api/users/:id/unlock', requireAuth, requirePermission({ permission: PlatformPermissions.USER_MANAGE }), asyncHandler(async (req, res) => {
  const userId = String(req.params.id);
  await userService.unlockUser(userId);
  res.json({ message: 'User account unlocked successfully' });
}));

export default router;

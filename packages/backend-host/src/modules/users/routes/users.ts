import { Router } from 'express';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { requireAction } from '@enterpriseglue/shared/middleware/requireAction.js';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { logAudit, AuditActions } from '@enterpriseglue/shared/services/audit.js';
import { createUserLimiter, identityAdminLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { validateBody, validateQuery } from '@enterpriseglue/shared/middleware/validate.js';
import { userService } from '@enterpriseglue/shared/services/platform-admin/UserService.js';
import { userDirectoryService } from '@enterpriseglue/shared/services/platform-admin/UserDirectoryService.js';
import { invitationService } from '@enterpriseglue/shared/services/invitations.js';
import {
  PlatformUserCreateRequestSchema,
  PlatformUserUpdateRequestSchema,
  UserAuditQuerySchema,
  UserDeactivateRequestSchema,
  UserDirectoryQuerySchema,
  UserReactivateRequestSchema,
  UserRevokeSessionsRequestSchema,
} from '@enterpriseglue/shared/schemas/platform-admin/user-directory.js';

const router = Router();

/**
 * GET /api/users
 * List all users
 * ✨ Migrated to TypeORM
 */
router.get('/api/users', requireAuth, requireAction('platform.users.read'), asyncHandler(async (req, res) => {
  const users = await userService.listUsers();
  res.json(users);
}));

/**
 * POST /api/users
 * Create a new user
 * Rate limited: 20 user creations per hour
 * ✨ Uses validation middleware
 */
router.post('/api/users', requireAuth, requireAction('platform.users.create'), createUserLimiter, validateBody(PlatformUserCreateRequestSchema), asyncHandler(async (req, res) => {
  const { email, firstName, lastName, role, platformRole, sendEmail } = req.body;
  const requestedPlatformRole = role ?? platformRole ?? 'user';

  const user = await userService.createPendingUser({
    email,
    firstName,
    lastName,
    platformRole: requestedPlatformRole,
    createdByUserId: req.user!.userId,
  });

  const inviteResult = await invitationService.createInvitation({
    userId: user.id,
    email,
    tenantSlug: 'default',
    resourceType: 'platform_user',
    resourceName: 'Platform access',
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

/** Source-aware enterprise user directory. Kept separate from the legacy array response. */
router.get('/api/users/directory', requireAuth, identityAdminLimiter, requireAction('platform.users.read'), validateQuery(UserDirectoryQuerySchema), asyncHandler(async (req, res) => {
  res.json(await userDirectoryService.list({
    ...req.query as any,
    tenantId: req.tenant?.tenantId || null,
  }));
}));

router.get('/api/users/:id/identity-context', requireAuth, identityAdminLimiter, requireAction('platform.users.read'), asyncHandler(async (req, res) => {
  res.json(await userDirectoryService.identityContext(String(req.params.id), req.tenant?.tenantId || null));
}));

router.get('/api/users/:id/effective-access', requireAuth, identityAdminLimiter, requireAction('platform.users.read'), asyncHandler(async (req, res) => {
  res.json(await userDirectoryService.effectiveAccess(String(req.params.id), req.tenant?.tenantId || null));
}));

router.get('/api/users/:id/sessions', requireAuth, identityAdminLimiter, requireAction('platform.users.read'), asyncHandler(async (req, res) => {
  res.json(await userDirectoryService.sessions(String(req.params.id)));
}));

router.get('/api/users/:id/audit', requireAuth, identityAdminLimiter, requireAction('platform.users.read'), validateQuery(UserAuditQuerySchema), asyncHandler(async (req, res) => {
  res.json(await userDirectoryService.audit(String(req.params.id), Number(req.query.limit)));
}));

router.post('/api/users/:id/deactivate', requireAuth, identityAdminLimiter, requireAction('platform.users.deactivate'), validateBody(UserDeactivateRequestSchema), asyncHandler(async (req, res) => {
  const userId = String(req.params.id);
  if (userId === req.user!.userId) throw Errors.validation('Cannot deactivate your own account');
  res.json(await userDirectoryService.deactivate({ userId, actorId: req.user!.userId, tenantId: req.tenant?.tenantId || null, reason: req.body.reason }));
}));

router.post('/api/users/:id/reactivate', requireAuth, identityAdminLimiter, requireAction('platform.users.update'), validateBody(UserReactivateRequestSchema), asyncHandler(async (req, res) => {
  res.json(await userDirectoryService.reactivate({ userId: String(req.params.id), actorId: req.user!.userId, tenantId: req.tenant?.tenantId || null, reason: req.body.reason }));
}));

router.post('/api/users/:id/revoke-sessions', requireAuth, identityAdminLimiter, requireAction('platform.users.update'), validateBody(UserRevokeSessionsRequestSchema), asyncHandler(async (req, res) => {
  res.json(await userDirectoryService.revokeSessions({ userId: String(req.params.id), actorId: req.user!.userId, tenantId: req.tenant?.tenantId || null, reason: req.body.reason }));
}));

/**
 * GET /api/users/:id
 * Get user by ID
 * ✨ Migrated to TypeORM
 */
router.get('/api/users/:id', requireAuth, requireAction('platform.users.read'), asyncHandler(async (req, res) => {
  const userId = String(req.params.id);
  const user = await userService.getUser(userId);
  res.json(user);
}));

/**
 * PUT /api/users/:id
 * Update user
 * ✨ Migrated to TypeORM
 * ✨ Uses validation middleware
 */
router.put('/api/users/:id', requireAuth, requireAction('platform.users.update'), validateBody(PlatformUserUpdateRequestSchema), asyncHandler(async (req, res) => {
  const userId = String(req.params.id);
  const { role, ...input } = req.body;
  const requestedPlatformRole = role ?? input.platformRole;
  const user = await userService.updateUser(
    userId,
    requestedPlatformRole ? { ...input, platformRole: requestedPlatformRole } : input
  );
  res.json(user);
}));

/**
 * DELETE /api/users/:id
 * Delete user (soft delete - deactivate)
 * ✨ Migrated to TypeORM
 */
router.delete('/api/users/:id', requireAuth, requireAction('platform.users.deactivate'), asyncHandler(async (req, res) => {
  const id = String(req.params.id);

  if (id === req.user!.userId) {
    throw Errors.validation('Cannot delete your own account');
  }

  await userService.deactivateUser(id);
  res.json({ message: 'User deleted successfully' });
}));

/**
 * DELETE /api/users/:id/permanent
 * Permanently delete a safe local user (pending or inactive)
 */
router.delete('/api/users/:id/permanent', requireAuth, requireAction('platform.users.permanent-delete'), asyncHandler(async (req, res) => {
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
 * Unlock locked user account
 * ✨ Migrated to TypeORM
 */
router.post('/api/users/:id/unlock', requireAuth, requireAction('platform.users.unlock'), asyncHandler(async (req, res) => {
  const userId = String(req.params.id);
  await userService.unlockUser(userId);
  res.json({ message: 'User account unlocked successfully' });
}));

export default router;

import { Router } from 'express';
import { logger } from '@shared/utils/logger.js';
import { z } from 'zod';
import { randomUUID, randomBytes } from 'crypto';
import { requireAuth } from '@shared/middleware/auth.js';
import { requirePermission } from '@shared/middleware/requirePermission.js';
import { asyncHandler, Errors } from '@shared/middleware/errorHandler.js';
import { hashPassword, generatePassword, validatePassword } from '@shared/utils/password.js';
import { sendWelcomeEmail, sendVerificationEmail } from '@shared/services/email/index.js';
import { logAudit, AuditActions } from '@shared/services/audit.js';
import { createUserLimiter } from '@shared/middleware/rateLimiter.js';
import { getDataSource } from '@shared/db/data-source.js';
import { User } from '@shared/db/entities/User.js';
import { RefreshToken } from '@shared/db/entities/RefreshToken.js';
import { ResourceService } from '@shared/services/resources.js';
import { validateBody } from '@shared/middleware/validate.js';
import { PlatformPermissions } from '@shared/services/platform-admin/permissions.js';

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
  try {
    const dataSource = await getDataSource();
    const userRepo = dataSource.getRepository(User);
    const result = await userRepo.find({
      order: { createdAt: 'DESC' },
    });

    const usersList = result.map((user) => ({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      platformRole: user.platformRole || 'user',
      isActive: Boolean(user.isActive),
      mustResetPassword: Boolean(user.mustResetPassword),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      lastLoginAt: user.lastLoginAt,
      createdByUserId: user.createdByUserId,
    }));

    res.json(usersList);
  } catch (error) {
    logger.error('List users error:', error);
    throw Errors.internal('Failed to list users');
  }
}));

/**
 * POST /api/users
 * Create a new user (admin only)
 * Rate limited: 20 user creations per hour
 * ✨ Uses validation middleware
 */
router.post('/api/users', requireAuth, requirePermission({ permission: PlatformPermissions.USER_MANAGE }), createUserLimiter, validateBody(createUserSchema), asyncHandler(async (req, res) => {
  try {
    const { email, firstName, lastName, platformRole, sendEmail } = req.body;

    const normalizedPlatformRole: 'admin' | 'developer' | 'user' = platformRole || 'user';

    // Generate temporary password
    const temporaryPassword = generatePassword();
    const passwordHash = await hashPassword(temporaryPassword);

    // Generate email verification token
    const verificationToken = randomBytes(32).toString('hex');
    const tokenExpiry = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

    // Create user
    const userId = randomUUID();
    const now = Date.now();

    const dataSource = await getDataSource();
    const userRepo = dataSource.getRepository(User);
    
    // Check if user already exists
    const existing = await userRepo.createQueryBuilder('u')
      .where('LOWER(u.email) = LOWER(:email)', { email })
      .getOne();
    
    if (existing) {
      throw Errors.conflict('User with this email already exists');
    }

    // Create user
    await userRepo.insert({
      id: userId,
      email,
      passwordHash,
      firstName: firstName || null,
      lastName: lastName || null,
      platformRole: normalizedPlatformRole,
      isActive: true,
      mustResetPassword: true,
      failedLoginAttempts: 0,
      createdAt: now,
      updatedAt: now,
      createdByUserId: req.user!.userId,
      isEmailVerified: false,
      emailVerificationToken: verificationToken,
      emailVerificationTokenExpiry: tokenExpiry,
    });

    // Log user creation
    await logAudit({
      userId: req.user!.userId,
      action: AuditActions.USER_CREATE,
      resourceType: 'user',
      resourceId: userId,
      ipAddress: req.headers['x-forwarded-for'] as string || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      details: { email, platformRole: normalizedPlatformRole },
    });

    // Send welcome email with password (verification email sent after password reset)
    let emailSent = false;
    let emailError: string | undefined;

    if (sendEmail) {
      // Send welcome email with password only
      const welcomeResult = await sendWelcomeEmail({
        to: email,
        firstName,
        temporaryPassword,
      });

      emailSent = welcomeResult.success;
      emailError = welcomeResult.error;
    }

    res.status(201).json({
      user: {
        id: userId,
        email,
        firstName,
        lastName,
        platformRole: normalizedPlatformRole,
        isActive: true,
        mustResetPassword: true,
        isEmailVerified: false,
        createdAt: now,
      },
      temporaryPassword: !emailSent ? temporaryPassword : undefined, // Only return password if email failed
      emailSent,
      emailError,
      verificationRequired: true,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw Errors.validation('Invalid request');
    }

    logger.error('Create user error:', error);
    throw Errors.internal('Failed to create user');
  }
}));

/**
 * GET /api/users/:id
 * Get user by ID (admin only)
 * ✨ Migrated to TypeORM
 */
router.get('/api/users/:id', requireAuth, requirePermission({ permission: PlatformPermissions.USER_MANAGE }), asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    
    const user: any = await ResourceService.getUserOrThrow(id);
    res.json({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      platformRole: user.platformRole || 'user',
      isActive: Boolean(user.isActive),
      mustResetPassword: Boolean(user.mustResetPassword),
      failedLoginAttempts: user.failedLoginAttempts,
      lockedUntil: user.lockedUntil,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      lastLoginAt: user.lastLoginAt,
      createdByUserId: user.createdByUserId,
    });
  } catch (error) {
    logger.error('Get user error:', error);
    throw Errors.internal('Failed to get user');
  }
}));

/**
 * PUT /api/users/:id
 * Update user (admin only)
 * ✨ Migrated to TypeORM
 * ✨ Uses validation middleware
 */
router.put('/api/users/:id', requireAuth, requirePermission({ permission: PlatformPermissions.USER_MANAGE }), validateBody(updateUserSchema), asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Build update query
    const updateFields: string[] = [];
    const updateValues: any[] = [];

    if (updates.firstName !== undefined) {
      updateFields.push('first_name');
      updateValues.push(updates.firstName);
    }

    if (updates.lastName !== undefined) {
      updateFields.push('last_name');
      updateValues.push(updates.lastName);
    }

    if (updates.platformRole !== undefined) {
      updateFields.push('platform_role');
      updateValues.push(updates.platformRole);
    }

    if (updates.isActive !== undefined) {
      updateFields.push('is_active');
      updateValues.push(updates.isActive);
    }

    if (updateFields.length === 0) {
      throw Errors.validation('No fields to update');
    }

    // Add updated_at
    updateFields.push('updated_at');
    updateValues.push(Date.now());

    // Check if user exists
    await ResourceService.getUserOrThrow(id);
    
    const dataSource = await getDataSource();
    const userRepo = dataSource.getRepository(User);

    // Build update object
    const updateData: any = { updatedAt: Date.now() };
    if (updates.firstName !== undefined) updateData.firstName = updates.firstName;
    if (updates.lastName !== undefined) updateData.lastName = updates.lastName;
    if (updates.platformRole !== undefined) updateData.platformRole = updates.platformRole;
    if (updates.isActive !== undefined) updateData.isActive = updates.isActive;

    // Update user
    await userRepo.update({ id }, updateData);

    // Get updated user
    const user = await userRepo.findOneBy({ id });
    res.json({
      id: user!.id,
      email: user!.email,
      firstName: user!.firstName,
      lastName: user!.lastName,
      platformRole: user!.platformRole || 'user',
      isActive: Boolean(user!.isActive),
      mustResetPassword: Boolean(user!.mustResetPassword),
      updatedAt: user!.updatedAt,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw Errors.validation('Invalid request');
    }

    logger.error('Update user error:', error);
    throw Errors.internal('Failed to update user');
  }
}));

/**
 * DELETE /api/users/:id
 * Delete user (soft delete - deactivate) (admin only)
 * ✨ Migrated to TypeORM
 */
router.delete('/api/users/:id', requireAuth, requirePermission({ permission: PlatformPermissions.USER_MANAGE }), asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    // Prevent deleting yourself
    if (id === req.user!.userId) {
      throw Errors.validation('Cannot delete your own account');
    }

    // Check if user exists
    await ResourceService.getUserOrThrow(id);
    
    const dataSource = await getDataSource();
    const userRepo = dataSource.getRepository(User);
    const refreshTokenRepo = dataSource.getRepository(RefreshToken);
    const now = Date.now();

    // Soft delete - deactivate user
    await userRepo.update({ id }, {
      isActive: false,
      updatedAt: now
    });

    // Revoke all refresh tokens
    await refreshTokenRepo.update({ userId: id }, { revokedAt: now });

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    logger.error('Delete user error:', error);
    throw Errors.internal('Failed to delete user');
  }
}));

/**
 * POST /api/users/:id/unlock
 * Unlock locked user account (admin only)
 * ✨ Migrated to TypeORM
 */
router.post('/api/users/:id/unlock', requireAuth, requirePermission({ permission: PlatformPermissions.USER_MANAGE }), asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const dataSource = await getDataSource();
    const userRepo = dataSource.getRepository(User);

    await userRepo.update({ id }, {
      failedLoginAttempts: 0,
      lockedUntil: null,
      updatedAt: Date.now()
    });

    res.json({ message: 'User account unlocked successfully' });
  } catch (error) {
    logger.error('Unlock user error:', error);
    throw Errors.internal('Failed to unlock user');
  }
}));

export default router;

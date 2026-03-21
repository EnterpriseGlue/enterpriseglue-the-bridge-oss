/**
 * Engine Management API Routes
 * Handles engine ownership, membership, environment tags, and project access
 */

import { Router, type Request } from 'express';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { z } from 'zod';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { validateBody, validateParams, validateQuery } from '@enterpriseglue/shared/middleware/validate.js';
import { asyncHandler, AppError, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { engineService, engineAccessService, projectMemberService } from '@enterpriseglue/shared/services/platform-admin/index.js';
import { userService } from '@enterpriseglue/shared/services/platform-admin/UserService.js';
import { invitationService } from '@enterpriseglue/shared/services/invitations.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { User } from '@enterpriseglue/shared/db/entities/User.js';
import { Engine } from '@enterpriseglue/shared/db/entities/Engine.js';
import { Invitation } from '@enterpriseglue/shared/db/entities/Invitation.js';
import { getEmailConfigForTenant } from '@enterpriseglue/shared/services/email/index.js';
// Invitation and Tenant entities removed - multi-tenancy is EE-only
import { In, IsNull } from 'typeorm';
import { addCaseInsensitiveEquals } from '@enterpriseglue/shared/db/adapters/QueryHelpers.js';
import { ENGINE_VIEW_ROLES, ENGINE_MANAGE_ROLES, MANAGE_ROLES } from '@enterpriseglue/shared/constants/roles.js';
import { logAudit } from '@enterpriseglue/shared/services/audit.js';

const router = Router();

async function canViewEngine(req: Request, engineId: string): Promise<boolean> {
  return engineService.hasEngineAccess(req.user!.userId, engineId, ENGINE_VIEW_ROLES);
}

async function canManageEngine(req: Request, engineId: string): Promise<boolean> {
  return engineService.hasEngineAccess(req.user!.userId, engineId, ENGINE_MANAGE_ROLES);
}

async function isEngineOwner(req: Request, engineId: string): Promise<boolean> {
  return engineService.hasEngineAccess(req.user!.userId, engineId, ['owner']);
}

// Validation schemas
const engineIdSchema = z.object({
  engineId: z.string(),
});

const userIdSchema = z.object({
  engineId: z.string(),
  userId: z.string().uuid(),
});

const addMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(['operator', 'deployer']),
  deliveryMethod: z.enum(['email', 'manual']).optional(),
});

const updateMemberRoleSchema = z.object({
  role: z.enum(['operator', 'deployer']),
});

const assignDelegateSchema = z.object({
  email: z.string().email().nullable(),
});

const pendingInviteIdSchema = z.object({
  engineId: z.string(),
  invitationId: z.string().uuid(),
});

const memberLookupSchema = z.object({
  email: z.string().email().optional(),
  role: z.enum(['delegate', 'operator', 'deployer']).optional(),
});

const setEnvironmentSchema = z.object({
  environmentTagId: z.string(),
});

const setLockedSchema = z.object({
  locked: z.boolean(),
});

type PendingInviteStatus = 'pending' | 'expired' | 'onboarding';

interface PendingEngineInvite {
  invitationId: string;
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: 'operator' | 'deployer';
  status: PendingInviteStatus;
  deliveryMethod: 'email' | 'manual';
  expiresAt: number;
  createdAt: number;
}

function parseInvitationRole(role: string | null): 'operator' | 'deployer' {
  return role === 'deployer' ? 'deployer' : 'operator';
}

function toPendingInviteStatus(invitation: Pick<Invitation, 'status' | 'expiresAt'>, now: number): PendingInviteStatus {
  if (invitation.status === 'otp_verified') {
    return 'onboarding';
  }

  if (invitation.expiresAt < now) {
    return 'expired';
  }

  return 'pending';
}

async function listPendingEngineInvites(engineId: string): Promise<PendingEngineInvite[]> {
  const dataSource = await getDataSource();
  const invitationRepo = dataSource.getRepository(Invitation);
  const userRepo = dataSource.getRepository(User);
  const now = Date.now();

  const invitationRows = await invitationRepo.find({
    where: {
      resourceType: 'engine',
      resourceId: engineId,
    },
    order: {
      updatedAt: 'DESC',
      createdAt: 'DESC',
    },
  });

  if (invitationRows.length === 0) {
    return [];
  }

  const latestByUser = new Map<string, Invitation>();
  for (const invitation of invitationRows) {
    const key = String(invitation.userId || invitation.email || invitation.id).toLowerCase();
    if (!latestByUser.has(key)) {
      latestByUser.set(key, invitation);
    }
  }

  const engineMembers = await engineService.getEngineMembers(engineId);
  const activeMemberUserIds = new Set(engineMembers.map((member) => String(member.userId)));
  const unresolvedInvitationRows = Array.from(latestByUser.values()).filter((invitation) => {
    if (invitation.revokedAt || invitation.completedAt) {
      return false;
    }
    return !activeMemberUserIds.has(String(invitation.userId));
  });

  if (unresolvedInvitationRows.length === 0) {
    return [];
  }

  const userIds = Array.from(new Set(unresolvedInvitationRows.map((invitation) => String(invitation.userId)).filter(Boolean)));
  const users = userIds.length > 0
    ? await userRepo.find({
        where: { id: In(userIds) },
        select: ['id', 'firstName', 'lastName'],
      })
    : [];
  const userMap = new Map(users.map((user) => [String(user.id), user]));

  return unresolvedInvitationRows.map((invitation) => {
    const user = userMap.get(String(invitation.userId));
    return {
      invitationId: invitation.id,
      userId: String(invitation.userId),
      email: invitation.email,
      firstName: user?.firstName || null,
      lastName: user?.lastName || null,
      role: parseInvitationRole(invitation.resourceRole),
      status: toPendingInviteStatus(invitation, now),
      deliveryMethod: invitation.deliveryMethod,
      expiresAt: Number(invitation.expiresAt),
      createdAt: Number(invitation.createdAt),
    };
  });
}

/**
 * GET /engines-api/engines/:engineId/members
 * List all members of an engine (owner, delegate, operators, deployers)
 */
router.get(
  '/engines-api/engines/:engineId/members',
  apiLimiter,
  requireAuth,
  validateParams(engineIdSchema),
  asyncHandler(async (req, res) => {
    try {
      const engineId = String(req.params.engineId);
      const userId = req.user!.userId;

      // Check if user has access to view members
      const hasAccess = await canViewEngine(req, engineId);
      if (!hasAccess) {
        throw Errors.forbidden();
      }

      const members = await engineService.getEngineMembers(engineId);
      const pendingInvites = await listPendingEngineInvites(engineId);
      res.json({ members, pendingInvites });
    } catch (error) {
      logger.error('Get engine members error:', error);
      throw Errors.internal('Failed to get engine members');
    }
  })
);

router.get(
  '/engines-api/engines/:engineId/members/capabilities',
  apiLimiter,
  requireAuth,
  validateParams(engineIdSchema),
  asyncHandler(async (req, res) => {
    const engineId = String(req.params.engineId);
    const canManage = await canManageEngine(req, engineId);
    if (!canManage) {
      throw Errors.forbidden('Only owners and delegates can inspect invite capabilities');
    }

    const emailConfig = await getEmailConfigForTenant((req as any).tenant?.tenantId);
    const ssoRequired = await invitationService.isLocalLoginDisabled();

    res.json({
      ssoRequired,
      emailConfigured: Boolean(emailConfig),
    });
  })
);

router.get(
  '/engines-api/engines/:engineId/members/lookup',
  apiLimiter,
  requireAuth,
  validateParams(engineIdSchema),
  validateQuery(memberLookupSchema),
  asyncHandler(async (req, res) => {
    try {
      const engineId = String(req.params.engineId);
      const email = typeof req.query?.email === 'string' ? String(req.query.email).trim().toLowerCase() : '';
      const role = req.query?.role === 'delegate' ? 'delegate' : (req.query?.role === 'deployer' ? 'deployer' : 'operator');

      const canManage = await canManageEngine(req, engineId);
      if (!canManage) {
        throw Errors.forbidden('Only owners and delegates can look up users');
      }

      if (!email) {
        return res.json({ mode: role === 'delegate' ? 'direct-add-only' : 'invite' });
      }

      const dataSource = await getDataSource();
      const userRepo = dataSource.getRepository(User);
      let targetQb = userRepo.createQueryBuilder('u')
        .select(['u.id', 'u.email', 'u.firstName', 'u.lastName', 'u.passwordHash']);
      targetQb = addCaseInsensitiveEquals(targetQb, 'u', 'email', 'email', email);
      const targetUser = await targetQb.getOne();

      if (!targetUser || !targetUser.passwordHash) {
        return res.json({ mode: role === 'delegate' ? 'direct-add-only' : 'invite' });
      }

      const existingRole = await engineService.getEngineRole(targetUser.id, engineId);
      if (existingRole) {
        return res.json({
          mode: 'existing-member',
          user: {
            id: targetUser.id,
            email: targetUser.email,
            firstName: (targetUser as any).firstName || null,
            lastName: (targetUser as any).lastName || null,
          },
        });
      }

      return res.json({
        mode: 'direct-add',
        user: {
          id: targetUser.id,
          email: targetUser.email,
          firstName: (targetUser as any).firstName || null,
          lastName: (targetUser as any).lastName || null,
        },
      });
    } catch (error) {
      logger.error('Lookup engine member candidate error:', error);
      throw Errors.internal('Failed to look up user');
    }
  })
);

/**
 * POST /engines-api/engines/:engineId/members
 * Add an operator or deployer to an engine (owner or delegate only)
 */
router.post(
  '/engines-api/engines/:engineId/members',
  apiLimiter,
  requireAuth,
  validateParams(engineIdSchema),
  validateBody(addMemberSchema),
  asyncHandler(async (req, res) => {
    try {
      const engineId = String(req.params.engineId);
      const { email, role, deliveryMethod } = req.body;
      const granterId = req.user!.userId;
      const requestedDeliveryMethod = deliveryMethod === 'manual' ? 'manual' : 'email';

      if (typeof email !== 'string') {
        throw Errors.validation('Invalid email');
      }
      const emailLower = email.toLowerCase();

      // Check if user has permission
      const canManage = await canManageEngine(req, engineId);
      if (!canManage) {
        throw Errors.forbidden('Only owners and delegates can add members');
      }

      // Find user by email
      const dataSource = await getDataSource();
      const userRepo = dataSource.getRepository(User);
      const engineRepo = dataSource.getRepository(Engine);

      let targetQb = userRepo.createQueryBuilder('u');
      targetQb = targetQb.select(['u.id', 'u.email', 'u.passwordHash']);
      targetQb = addCaseInsensitiveEquals(targetQb, 'u', 'email', 'email', emailLower);
      const targetUser = await targetQb.getOne();

      if (targetUser && targetUser.passwordHash) {
        // Check if user is already a member
        const existingRole = await engineService.getEngineRole(targetUser.id, engineId);
        if (existingRole) {
          throw Errors.conflict('User already has access to this engine');
        }

        // Add the member
        const result = await engineService.addEngineMember(engineId, targetUser.id, role, granterId);

        await logAudit({
          userId: granterId,
          action: 'engine.member.added',
          resourceType: 'engine',
          resourceId: engineId,
          ipAddress: req.headers['x-forwarded-for'] as string || req.socket.remoteAddress,
          userAgent: req.headers['user-agent'],
          details: { targetUserId: targetUser.id, email: targetUser.email, role },
        });

        return res.status(201).json({
          ...result,
          userId: targetUser.id,
          role,
          user: { id: targetUser.id, email: targetUser.email },
          invited: false,
        });
      }

      const pendingUser = targetUser || await userService.createPendingUser({
        email: emailLower,
        platformRole: 'user',
        createdByUserId: granterId,
      }).then((user) => ({ id: user.id, email: user.email } as Pick<User, 'id' | 'email'>));

      if (!pendingUser) {
        throw Errors.internal('Failed to prepare invitation user');
      }

      const existingRole = await engineService.getEngineRole(pendingUser.id, engineId);
      if (existingRole) {
        throw Errors.conflict('User already has access to this engine');
      }

      const engine = await engineRepo.findOne({ where: { id: engineId }, select: ['name'] });
      const tenantSlug = String(req.params.tenantSlug || '').trim() || 'default';
      const inviteResult = await invitationService.createInvitation({
        userId: pendingUser.id,
        email: emailLower,
        tenantSlug,
        resourceType: 'engine',
        resourceId: engineId,
        resourceName: engine?.name || engineId,
        resourceRole: role,
        resourceRoles: [role],
        createdByUserId: granterId,
        invitedByName: req.user!.email,
        deliveryMethod: requestedDeliveryMethod,
      });

      await logAudit({
        userId: granterId,
        action: 'engine.member.invited',
        resourceType: 'engine',
        resourceId: engineId,
        ipAddress: req.headers['x-forwarded-for'] as string || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
        details: { email: emailLower, role, deliveryMethod: requestedDeliveryMethod },
      });

      return res.status(201).json({
        invited: true,
        emailSent: inviteResult.emailSent,
        emailError: inviteResult.emailError,
        inviteUrl: inviteResult.emailSent ? undefined : inviteResult.inviteUrl,
        oneTimePassword: inviteResult.oneTimePassword,
      });
    } catch (error) {
      logger.error('Add engine member error:', error);
      if (error instanceof AppError) {
        throw error;
      }
      throw Errors.internal('Failed to add engine member');
    }
  })
);

/**
 * PATCH /engines-api/engines/:engineId/members/:userId
 * Update a member's role (owner or delegate only)
 */
router.patch(
  '/engines-api/engines/:engineId/members/:userId',
  apiLimiter,
  requireAuth,
  validateParams(userIdSchema),
  validateBody(updateMemberRoleSchema),
  asyncHandler(async (req, res) => {
    try {
      const engineId = String(req.params.engineId);
      const targetUserId = String(req.params.userId);
      const { role: newRole } = req.body;
      const requesterId = req.user!.userId;

      // Check if requester has permission
      const canManage = await canManageEngine(req, engineId);
      if (!canManage) {
        throw Errors.forbidden('Only owners and delegates can update roles');
      }

      // Check target's current role
      const targetRole = await engineService.getEngineRole(targetUserId, engineId);
      if (!targetRole) {
        throw Errors.notFound('Member');
      }
      if (targetRole === 'owner' || targetRole === 'delegate') {
        throw Errors.validation('Cannot modify owner or delegate roles here');
      }

      await engineService.updateEngineMemberRole(engineId, targetUserId, newRole);

      res.json({ message: 'Role updated successfully' });
    } catch (error) {
      logger.error('Update engine member role error:', error);
      throw Errors.internal('Failed to update role');
    }
  })
);

/**
 * DELETE /engines-api/engines/:engineId/members/:userId
 * Remove a member from an engine (owner or delegate only)
 */
router.delete(
  '/engines-api/engines/:engineId/members/:userId',
  apiLimiter,
  requireAuth,
  validateParams(userIdSchema),
  asyncHandler(async (req, res) => {
    try {
      const engineId = String(req.params.engineId);
      const targetUserId = String(req.params.userId);
      const requesterId = req.user!.userId;

      // Check if requester has permission
      const canManage = await canManageEngine(req, engineId);
      if (!canManage) {
        throw Errors.forbidden();
      }

      // Check target's current role
      const targetRole = await engineService.getEngineRole(targetUserId, engineId);
      if (!targetRole) {
        throw Errors.notFound('Member');
      }
      if (targetRole === 'owner') {
        throw Errors.validation('Cannot remove the engine owner');
      }
      if (targetRole === 'delegate') {
        throw Errors.validation('Use the delegate endpoint to remove delegate');
      }

      await engineService.removeEngineMember(engineId, targetUserId);

      res.status(204).send();
    } catch (error) {
      logger.error('Remove engine member error:', error);
      throw Errors.internal('Failed to remove member');
    }
  })
);

router.post(
  '/engines-api/engines/:engineId/pending-invites/:invitationId/reissue',
  apiLimiter,
  requireAuth,
  validateParams(pendingInviteIdSchema),
  asyncHandler(async (req, res) => {
    try {
      const engineId = String(req.params.engineId);
      const invitationId = String(req.params.invitationId);
      const requesterId = req.user!.userId;

      const canManage = await canManageEngine(req, engineId);
      if (!canManage) {
        throw Errors.forbidden('Only owners and delegates can manage invitations');
      }

      const dataSource = await getDataSource();
      const invitationRepo = dataSource.getRepository(Invitation);
      const engineRepo = dataSource.getRepository(Engine);

      const invitation = await invitationRepo.findOne({
        where: {
          id: invitationId,
          resourceType: 'engine',
          resourceId: engineId,
        },
      });

      if (!invitation || invitation.revokedAt || invitation.completedAt) {
        throw Errors.notFound('Invitation');
      }

      if (invitation.deliveryMethod !== 'manual') {
        throw Errors.validation('Only manual invitations can be reissued here');
      }

      if (invitation.status === 'otp_verified') {
        throw Errors.validation('Cannot reissue an invitation after onboarding has started');
      }

      const existingRole = await engineService.getEngineRole(String(invitation.userId), engineId);
      if (existingRole) {
        throw Errors.conflict('User already has access to this engine');
      }

      const engine = await engineRepo.findOne({ where: { id: engineId }, select: ['name'] });
      const inviteRole = parseInvitationRole(invitation.resourceRole);
      const inviteResult = await invitationService.createInvitation({
        userId: String(invitation.userId),
        email: invitation.email,
        tenantSlug: invitation.tenantSlug,
        resourceType: 'engine',
        resourceId: engineId,
        resourceName: engine?.name || invitation.resourceName || engineId,
        resourceRole: inviteRole,
        resourceRoles: [inviteRole],
        createdByUserId: requesterId,
        invitedByName: req.user!.email,
        deliveryMethod: 'manual',
      });

      await logAudit({
        userId: requesterId,
        action: 'engine.member.invite.reissued',
        resourceType: 'engine',
        resourceId: engineId,
        ipAddress: req.headers['x-forwarded-for'] as string || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
        details: { invitationId, email: invitation.email, deliveryMethod: 'manual', role: inviteRole },
      });

      return res.json({
        invited: true,
        emailSent: false,
        inviteUrl: inviteResult.inviteUrl,
        oneTimePassword: inviteResult.oneTimePassword,
      });
    } catch (error) {
      logger.error('Reissue engine invitation error:', error);
      if (error instanceof AppError) {
        throw error;
      }
      throw Errors.internal('Failed to reissue invitation');
    }
  })
);

/**
 * POST /engines-api/engines/:engineId/delegate
 * Assign or remove a delegate (owner only)
 */
router.post(
  '/engines-api/engines/:engineId/delegate',
  apiLimiter,
  requireAuth,
  validateParams(engineIdSchema),
  validateBody(assignDelegateSchema),
  asyncHandler(async (req, res) => {
    try {
      const engineId = String(req.params.engineId);
      const { email } = req.body;
      const ownerId = req.user!.userId;

      // Only owner can assign delegate
      const isOwner = await isEngineOwner(req, engineId);
      if (!isOwner) {
        throw Errors.forbidden('Only the owner can assign a delegate');
      }

      let delegateId: string | null = null;

      if (email) {
        // Find user by email
        const dataSource = await getDataSource();
        const userRepo = dataSource.getRepository(User);
        let delegateQb = userRepo.createQueryBuilder('u');
        delegateQb = addCaseInsensitiveEquals(delegateQb, 'u', 'email', 'email', email);
        const targetUser = await delegateQb.getOne();

        if (!targetUser) {
          throw Errors.notFound('User with this email');
        }

        delegateId = targetUser.id;
      }

      await engineService.assignDelegate(engineId, delegateId);

      res.json({ message: delegateId ? 'Delegate assigned' : 'Delegate removed' });
    } catch (error) {
      logger.error('Assign delegate error:', error);
      throw Errors.internal('Failed to assign delegate');
    }
  })
);

/**
 * POST /engines-api/engines/:engineId/transfer-ownership
 * Transfer engine ownership (owner only)
 */
router.post(
  '/engines-api/engines/:engineId/transfer-ownership',
  apiLimiter,
  requireAuth,
  validateParams(engineIdSchema),
  validateBody(z.object({ newOwnerEmail: z.string().email() })),
  asyncHandler(async (req, res) => {
    try {
      const engineId = String(req.params.engineId);
      const { newOwnerEmail } = req.body;
      const currentOwnerId = req.user!.userId;

      // Only owner can transfer
      const isOwner = await isEngineOwner(req, engineId);
      if (!isOwner) {
        throw Errors.forbidden('Only the owner can transfer ownership');
      }

      // Find new owner
      const dataSource = await getDataSource();
      const userRepo = dataSource.getRepository(User);
      let ownerQb = userRepo.createQueryBuilder('u');
      ownerQb = addCaseInsensitiveEquals(ownerQb, 'u', 'email', 'email', newOwnerEmail);
      const newOwner = await ownerQb.getOne();

      if (!newOwner) {
        throw Errors.notFound('User with this email');
      }

      await engineService.transferOwnership(engineId, newOwner.id);

      res.json({ message: 'Ownership transferred successfully' });
    } catch (error) {
      logger.error('Transfer ownership error:', error);
      throw Errors.internal('Failed to transfer ownership');
    }
  })
);

/**
 * POST /engines-api/engines/:engineId/environment
 * Set environment tag (owner or delegate only)
 */
router.post(
  '/engines-api/engines/:engineId/environment',
  apiLimiter,
  requireAuth,
  validateParams(engineIdSchema),
  validateBody(setEnvironmentSchema),
  asyncHandler(async (req, res) => {
    try {
      const engineId = String(req.params.engineId);
      const { environmentTagId } = req.body;
      const userId = req.user!.userId;

      const canManage = await canManageEngine(req, engineId);
      if (!canManage) {
        throw Errors.forbidden('Only owners and delegates can set environment');
      }

      await engineService.setEnvironmentTag(engineId, environmentTagId);

      res.json({ message: 'Environment tag updated' });
    } catch (error) {
      logger.error('Set environment error:', error);
      throw Errors.internal('Failed to set environment');
    }
  })
);

/**
 * POST /engines-api/engines/:engineId/lock
 * Lock/unlock environment (owner or delegate only)
 */
router.post(
  '/engines-api/engines/:engineId/lock',
  apiLimiter,
  requireAuth,
  validateParams(engineIdSchema),
  validateBody(setLockedSchema),
  asyncHandler(async (req, res) => {
    try {
      const engineId = String(req.params.engineId);
      const { locked } = req.body;
      const userId = req.user!.userId;

      const canManage = await canManageEngine(req, engineId);
      if (!canManage) {
        throw Errors.forbidden('Only owners and delegates can lock/unlock');
      }

      await engineService.setEnvironmentLocked(engineId, locked);

      res.json({ message: locked ? 'Environment locked' : 'Environment unlocked' });
    } catch (error) {
      logger.error('Lock environment error:', error);
      throw Errors.internal('Failed to lock/unlock environment');
    }
  })
);

/**
 * GET /engines-api/environment-tags
 * Get all environment tags
 */
router.get(
  '/engines-api/environment-tags',
  apiLimiter,
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const tags = await engineService.getEnvironmentTags();
      res.json(tags);
    } catch (error) {
      logger.error('Get environment tags error:', error);
      throw Errors.internal('Failed to get environment tags');
    }
  })
);

/**
 * GET /engines-api/engines/:engineId/my-role
 * Get current user's role on an engine
 */
router.get(
  '/engines-api/engines/:engineId/my-role',
  apiLimiter,
  requireAuth,
  validateParams(engineIdSchema),
  asyncHandler(async (req, res) => {
    try {
      const engineId = String(req.params.engineId);
      const userId = req.user!.userId;

      if (!(await canViewEngine(req, engineId))) {
        throw Errors.forbidden();
      }

      const role = await engineService.getEngineRole(userId, engineId);

      res.json({ role });
    } catch (error) {
      logger.error('Get my role error:', error);
      throw Errors.internal('Failed to get role');
    }
  })
);

/**
 * GET /engines-api/my-engines
 * Get all engines the current user has access to
 */
router.get(
  '/engines-api/my-engines',
  apiLimiter,
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const userId = req.user!.userId;
      // Filter engines by current tenant context
      const tenantId = req.tenant?.tenantId;
      const engines = await engineService.getUserEngines(userId, tenantId);
      res.json(engines);
    } catch (error) {
      logger.error('Get my engines error:', error);
      throw Errors.internal('Failed to get engines');
    }
  })
);

// ============ Project-Engine Access Routes ============

/**
 * POST /engines-api/engines/:engineId/request-access
 * Request project access to an engine
 */
router.post(
  '/engines-api/engines/:engineId/request-access',
  apiLimiter,
  requireAuth,
  validateParams(engineIdSchema),
  validateBody(z.object({ projectId: z.string().uuid() })),
  asyncHandler(async (req, res) => {
    try {
      const engineId = String(req.params.engineId);
      const { projectId } = req.body;
      const userId = req.user!.userId;

      const canRequest = await projectMemberService.hasRole(projectId, userId, MANAGE_ROLES);
      if (!canRequest) {
        throw Errors.forbidden('Only project owners and delegates can request engine access');
      }

      const result = await engineAccessService.requestAccess(projectId, engineId, userId);

      res.json(result);
    } catch (error) {
      logger.error('Request access error:', error);
      throw Errors.internal('Failed to request access');
    }
  })
);

/**
 * GET /engines-api/engines/:engineId/access-requests
 * Get pending access requests for an engine (owner/delegate only)
 */
router.get(
  '/engines-api/engines/:engineId/access-requests',
  apiLimiter,
  requireAuth,
  validateParams(engineIdSchema),
  asyncHandler(async (req, res) => {
    try {
      const engineId = String(req.params.engineId);
      const userId = req.user!.userId;

      const canManage = await canManageEngine(req, engineId);
      if (!canManage) {
        throw Errors.forbidden();
      }

      const requests = await engineAccessService.getPendingRequests(engineId);
      res.json(requests);
    } catch (error) {
      logger.error('Get access requests error:', error);
      throw Errors.internal('Failed to get access requests');
    }
  })
);

/**
 * POST /engines-api/engines/:engineId/access-requests/:requestId/approve
 * Approve an access request (owner/delegate only)
 */
router.post(
  '/engines-api/engines/:engineId/access-requests/:requestId/approve',
  apiLimiter,
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const engineId = String(req.params.engineId);
      const requestId = String(req.params.requestId);
      const userId = req.user!.userId;

      const canManage = await canManageEngine(req, engineId);
      if (!canManage) {
        throw Errors.forbidden();
      }

      await engineAccessService.approveRequest(requestId, userId);

      res.json({ message: 'Access request approved' });
    } catch (error) {
      logger.error('Approve request error:', error);
      throw Errors.internal('Failed to approve request');
    }
  })
);

/**
 * POST /engines-api/engines/:engineId/access-requests/:requestId/deny
 * Deny an access request (owner/delegate only)
 */
router.post(
  '/engines-api/engines/:engineId/access-requests/:requestId/deny',
  apiLimiter,
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const engineId = String(req.params.engineId);
      const requestId = String(req.params.requestId);
      const userId = req.user!.userId;

      const canManage = await canManageEngine(req, engineId);
      if (!canManage) {
        throw Errors.forbidden();
      }

      await engineAccessService.denyRequest(requestId, userId);

      res.json({ message: 'Access request denied' });
    } catch (error) {
      logger.error('Deny request error:', error);
      throw Errors.internal('Failed to deny request');
    }
  })
);

/**
 * DELETE /engines-api/engines/:engineId/projects/:projectId
 * Revoke project access to an engine (owner/delegate only)
 */
router.delete(
  '/engines-api/engines/:engineId/projects/:projectId',
  apiLimiter,
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const engineId = String(req.params.engineId);
      const projectId = String(req.params.projectId);
      const userId = req.user!.userId;

      const canManage = await canManageEngine(req, engineId);
      if (!canManage) {
        throw Errors.forbidden();
      }

      await engineAccessService.revokeAccess(projectId, engineId);

      res.status(204).send();
    } catch (error) {
      logger.error('Revoke access error:', error);
      throw Errors.internal('Failed to revoke access');
    }
  })
);

export default router;

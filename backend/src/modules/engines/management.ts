/**
 * Engine Management API Routes
 * Handles engine ownership, membership, environment tags, and project access
 */

import { Router, type Request } from 'express';
import { logger } from '@shared/utils/logger.js';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { requireAuth } from '@shared/middleware/auth.js';
import { validateBody, validateParams } from '@shared/middleware/validate.js';
import { asyncHandler, Errors } from '@shared/middleware/errorHandler.js';
import { apiLimiter } from '@shared/middleware/rateLimiter.js';
import { engineService, engineAccessService, projectMemberService } from '@shared/services/platform-admin/index.js';
import { getDataSource } from '@shared/db/data-source.js';
import { User } from '@shared/db/entities/User.js';
import { Invitation } from '@shared/db/entities/Invitation.js';
import { Tenant } from '@shared/db/entities/Tenant.js';
import { IsNull } from 'typeorm';
import { isPlatformAdmin } from '@shared/middleware/platformAuth.js';
import { generateId } from '@shared/utils/id.js';
import { sendInvitationEmail } from '@shared/services/email/index.js';
import { config } from '@shared/config/index.js';
import { ENGINE_VIEW_ROLES, ENGINE_MANAGE_ROLES, MANAGE_ROLES } from '@shared/constants/roles.js';

const router = Router();

async function canViewEngine(req: Request, engineId: string): Promise<boolean> {
  if (isPlatformAdmin(req)) return true;
  return engineService.hasEngineAccess(req.user!.userId, engineId, ENGINE_VIEW_ROLES);
}

async function canManageEngine(req: Request, engineId: string): Promise<boolean> {
  if (isPlatformAdmin(req)) return true;
  return engineService.hasEngineAccess(req.user!.userId, engineId, ENGINE_MANAGE_ROLES);
}

async function isEngineOwner(req: Request, engineId: string): Promise<boolean> {
  if (isPlatformAdmin(req)) return true;
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
  role: z.enum(['delegate', 'deployer', 'viewer']),
});

const updateMemberRoleSchema = z.object({
  role: z.enum(['deployer', 'viewer']),
});

const assignDelegateSchema = z.object({
  email: z.string().email().nullable(),
});

const setEnvironmentSchema = z.object({
  environmentTagId: z.string(),
});

const setLockedSchema = z.object({
  locked: z.boolean(),
});

/**
 * GET /engines-api/engines/:engineId/members
 * List all members of an engine (owner, delegate, deployers, viewers)
 */
router.get(
  '/engines-api/engines/:engineId/members',
  apiLimiter,
  requireAuth,
  validateParams(engineIdSchema),
  asyncHandler(async (req, res) => {
    try {
      const { engineId } = req.params;
      const userId = req.user!.userId;

      // Check if user has access to view members
      const hasAccess = await canViewEngine(req, engineId);
      if (!hasAccess) {
        throw Errors.forbidden();
      }

      const members = await engineService.getEngineMembers(engineId);
      res.json(members);
    } catch (error) {
      logger.error('Get engine members error:', error);
      throw Errors.internal('Failed to get engine members');
    }
  })
);

/**
 * POST /engines-api/engines/:engineId/members
 * Add a deployer or viewer to an engine (owner or delegate only)
 */
router.post(
  '/engines-api/engines/:engineId/members',
  apiLimiter,
  requireAuth,
  validateParams(engineIdSchema),
  validateBody(addMemberSchema),
  asyncHandler(async (req, res) => {
    try {
      const { engineId } = req.params;
      const { email, role } = req.body;
      const granterId = req.user!.userId;

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
      const tenantRepo = dataSource.getRepository(Tenant);
      const invitationRepo = dataSource.getRepository(Invitation);

      const targetUser = await userRepo.createQueryBuilder('u')
        .where('LOWER(u.email) = :email', { email: emailLower })
        .getOne();

      // If user exists, add them directly as a member
      if (targetUser) {
        // Check if user is already a member
        const existingRole = await engineService.getEngineRole(targetUser.id, engineId);
        if (existingRole) {
          throw Errors.conflict('User already has access to this engine');
        }

        // Add the member
        const result = await engineService.addEngineMember(engineId, targetUser.id, role, granterId);

        return res.status(201).json({
          ...result,
          userId: targetUser.id,
          role,
          user: { id: targetUser.id, email: targetUser.email },
          invited: false,
        });
      }

      // User doesn't exist - create an invitation instead
      // Use default tenant for engine invitations
      const tenantId = 'tenant-default';

      // Get tenant info for the invitation
      const tenant = await tenantRepo.findOne({
        where: { id: tenantId },
        select: ['slug', 'name'],
      }) || { slug: 'default', name: 'Default' };

      // Check for existing pending invitation
      const existingInvite = await invitationRepo.createQueryBuilder('i')
        .where('i.tenantId = :tenantId', { tenantId })
        .andWhere('LOWER(i.email) = :email', { email: emailLower })
        .andWhere('i.resourceType = :resourceType', { resourceType: 'engine' })
        .andWhere('i.resourceId = :resourceId', { resourceId: engineId })
        .andWhere('i.acceptedAt IS NULL')
        .andWhere('i.revokedAt IS NULL')
        .getOne();

      if (existingInvite) {
        throw Errors.conflict('An invitation is already pending for this email');
      }

      // Create the invitation
      const token = randomBytes(32).toString('hex');
      const now = Date.now();
      const expiresAt = now + 7 * 24 * 60 * 60 * 1000; // 7 days
      const invitationId = generateId();

      await invitationRepo.insert({
        id: invitationId,
        token,
        email: emailLower,
        tenantId,
        resourceType: 'engine',
        resourceId: engineId,
        role,
        invitedByUserId: granterId,
        expiresAt,
        createdAt: now,
      });

      // Send invitation email
      const inviteUrl = `${config.frontendUrl}/t/${tenant.slug}/invite/${token}`;
      let emailSent = false;
      let emailError: string | undefined;

      try {
        const result = await sendInvitationEmail({
          to: emailLower,
          tenantName: tenant.name,
          inviteUrl,
          resourceType: 'engine',
          invitedByName: req.user!.email,
        });
        emailSent = result.success;
        emailError = result.error;
      } catch (err) {
        emailError = err instanceof Error ? err.message : 'Failed to send email';
      }

      res.status(201).json({
        id: invitationId,
        email: emailLower,
        role,
        invited: true,
        emailSent,
        emailError,
      });
    } catch (error) {
      logger.error('Add engine member error:', error);
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
      const { engineId, userId: targetUserId } = req.params;
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
      const { engineId, userId: targetUserId } = req.params;
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
      const { engineId } = req.params;
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
        const targetUser = await userRepo.createQueryBuilder('u')
          .where('LOWER(u.email) = LOWER(:email)', { email })
          .getOne();

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
      const { engineId } = req.params;
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
      const newOwner = await userRepo.createQueryBuilder('u')
        .where('LOWER(u.email) = LOWER(:email)', { email: newOwnerEmail })
        .getOne();

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
      const { engineId } = req.params;
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
      const { engineId } = req.params;
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
      const { engineId } = req.params;
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
      const engines = await engineService.getUserEngines(userId);
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
      const { engineId } = req.params;
      const { projectId } = req.body;
      const userId = req.user!.userId;

      if (!isPlatformAdmin(req)) {
        const canRequest = await projectMemberService.hasRole(projectId, userId, MANAGE_ROLES);
        if (!canRequest) {
          throw Errors.forbidden('Only project owners and delegates can request engine access');
        }
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
      const { engineId } = req.params;
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
      const { engineId, requestId } = req.params;
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
      const { engineId, requestId } = req.params;
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
      const { engineId, projectId } = req.params;
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

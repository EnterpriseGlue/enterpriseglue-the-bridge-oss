/**
 * Project Members API Routes
 * Handles project collaboration - inviting members, managing roles
 */

import { Router } from 'express';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { addCaseInsensitiveEquals, caseInsensitiveColumn } from '@enterpriseglue/shared/db/adapters/QueryHelpers.js';
import { z } from 'zod';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { requireAction } from '@enterpriseglue/shared/middleware/requireAction.js';
import { validateBody, validateParams, validateQuery } from '@enterpriseglue/shared/middleware/validate.js';
import { asyncHandler, AppError, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { projectMemberService } from '@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js';
import { userService } from '@enterpriseglue/shared/services/platform-admin/UserService.js';
import { invitationService } from '@enterpriseglue/shared/services/invitations.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import { ProjectMember } from '@enterpriseglue/shared/infrastructure/persistence/entities/ProjectMember.js';
import { PermissionGrant } from '@enterpriseglue/shared/infrastructure/persistence/entities/PermissionGrant.js';
import { Project } from '@enterpriseglue/shared/infrastructure/persistence/entities/Project.js';
import { Invitation } from '@enterpriseglue/shared/infrastructure/persistence/entities/Invitation.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { In, IsNull, Not, Raw } from 'typeorm';
import { logAudit } from '@enterpriseglue/shared/services/audit.js';
import { getEmailConfigForTenant } from '@enterpriseglue/shared/services/email/index.js';
import { permissionService, ProjectPermissions, type Permission } from '@enterpriseglue/shared/services/platform-admin/permissions.js';

type ProjectRole = 'owner' | 'delegate' | 'developer' | 'editor' | 'viewer';

// Type for membership with roles array
interface MembershipWithRoles {
  id: string;
  projectId: string;
  userId: string;
  role: ProjectRole;
  roles: ProjectRole[];
  invitedById: string | null;
  joinedAt: number;
  createdAt: number;
  updatedAt: number;
}

// Helper to extract roles from membership
function getRolesFromMembership(membership: MembershipWithRoles | null): ProjectRole[] {
  if (!membership) return [];
  return Array.isArray(membership.roles) ? membership.roles : [membership.role];
}

type PendingInviteStatus = 'pending' | 'expired' | 'onboarding';

interface PendingProjectInvite {
  invitationId: string;
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: ProjectRole;
  roles: ProjectRole[];
  status: PendingInviteStatus;
  deliveryMethod: 'email' | 'manual';
  expiresAt: number;
  createdAt: number;
}

function parseInvitationRoles(value: string | null, fallbackRole: string | null): ProjectRole[] {
  try {
    const parsed = value ? JSON.parse(value) : [];
    const roles = Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
    const normalized = roles.filter((item): item is ProjectRole => ['owner', 'delegate', 'developer', 'editor', 'viewer'].includes(item));
    if (normalized.length > 0) {
      return normalized;
    }
  } catch {
  }

  if (fallbackRole && ['owner', 'delegate', 'developer', 'editor', 'viewer'].includes(fallbackRole)) {
    return [fallbackRole as ProjectRole];
  }

  return ['viewer'];
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

async function listPendingProjectInvites(projectId: string): Promise<PendingProjectInvite[]> {
  const dataSource = await getDataSource();
  const invitationRepo = dataSource.getRepository(Invitation);
  const userRepo = dataSource.getRepository(User);
  const projectMemberRepo = dataSource.getRepository(ProjectMember);
  const now = Date.now();

  const invitationRows = await invitationRepo.find({
    where: {
      resourceType: 'project',
      resourceId: projectId,
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

  const projectMembers = await projectMemberRepo.find({
    where: { projectId },
    select: ['userId'],
  });
  const activeMemberUserIds = new Set(projectMembers.map((member) => String(member.userId)));
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
    const roles = parseInvitationRoles(invitation.resourceRolesJson, invitation.resourceRole);
    const user = userMap.get(String(invitation.userId));
    return {
      invitationId: invitation.id,
      userId: String(invitation.userId),
      email: invitation.email,
      firstName: user?.firstName || null,
      lastName: user?.lastName || null,
      role: roles[0] || 'viewer',
      roles,
      status: toPendingInviteStatus(invitation, now),
      deliveryMethod: invitation.deliveryMethod,
      expiresAt: Number(invitation.expiresAt),
      createdAt: Number(invitation.createdAt),
    };
  });
}

const router = Router();

function projectPermissionContext(req: any, projectId: string) {
  return {
    userId: req.user!.userId,
    resourceType: 'project' as const,
    resourceId: projectId,
  };
}

async function hasProjectPermission(req: any, projectId: string, permission: Permission): Promise<boolean> {
  return permissionService.hasPermission(permission, projectPermissionContext(req, projectId));
}

async function canPerformProjectMemberAction(req: any, projectId: string, permission: Permission): Promise<boolean> {
  return hasProjectPermission(req, projectId, permission);
}

async function canManageProjectDelegates(req: any, projectId: string): Promise<boolean> {
  return hasProjectPermission(req, projectId, ProjectPermissions.DELEGATE_MANAGE);
}

const uuidLikeSchema = z.string().regex(
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
  'Invalid UUID format'
);

// Validation schemas
const projectIdSchema = z.object({
  projectId: uuidLikeSchema,
});

const memberIdSchema = z.object({
  projectId: uuidLikeSchema,
  userId: uuidLikeSchema,
});

const pendingInviteIdSchema = z.object({
  projectId: uuidLikeSchema,
  invitationId: uuidLikeSchema,
});

const addMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(['delegate', 'developer', 'editor', 'viewer']).optional(),
  roles: z.array(z.enum(['delegate', 'developer', 'editor', 'viewer'])).optional(),
  deliveryMethod: z.enum(['email', 'manual']).optional(),
});

const updateRoleSchema = z.object({
  role: z.enum(['delegate', 'developer', 'editor', 'viewer']).optional(),
  roles: z.array(z.enum(['delegate', 'developer', 'editor', 'viewer'])).optional(),
});

const updateDeployGrantSchema = z.object({
  allowed: z.boolean(),
});

const userSearchSchema = z.object({
  q: z.string().optional(),
});

const memberLookupSchema = z.object({
  email: z.string().email().optional(),
});

router.get(
  '/starbase-api/projects/:projectId/members/user-search',
  apiLimiter,
  requireAuth,
  validateParams(projectIdSchema),
  validateQuery(userSearchSchema),
  requireAction('project.members.search', { resourceResolver: 'project.byId', resourceIdFrom: 'params' }),
  asyncHandler(async (req, res) => {
    try {
      const projectId = String(req.params.projectId);
      const q = typeof req.query?.q === 'string' ? String(req.query.q).trim() : '';

      if (q.length < 2) {
        return res.json([]);
      }

      const dataSource = await getDataSource();
      const memberRepo = dataSource.getRepository(ProjectMember);
      const userRepo = dataSource.getRepository(User);

      const existingMemberRows = await memberRepo.find({
        where: { projectId },
        select: ['userId']
      });
      const existingMemberIds = existingMemberRows.map((r) => r.userId);

      const ciEmail = caseInsensitiveColumn('u.email');
      const ciFirst = caseInsensitiveColumn('u.firstName');
      const ciLast = caseInsensitiveColumn('u.lastName');
      const qb = userRepo.createQueryBuilder('u')
        .select(['u.id', 'u.email', 'u.firstName', 'u.lastName'])
        .where(`(${ciEmail} LIKE :q OR ${ciFirst} LIKE :q OR ${ciLast} LIKE :q)`, { q: `%${q.toLowerCase()}%` })
        .orderBy('u.email', 'ASC')
        .limit(20);

      if (existingMemberIds.length > 0) {
        qb.andWhere('u.id NOT IN (:...existingIds)', { existingIds: existingMemberIds });
      }

      const result = await qb.getMany();

      res.json(result);
    } catch (error) {
      logger.error('Search users for project members error:', error);
      throw Errors.internal('Failed to search users');
    }
  })
);

router.get(
  '/starbase-api/projects/:projectId/members/lookup',
  apiLimiter,
  requireAuth,
  validateParams(projectIdSchema),
  validateQuery(memberLookupSchema),
  requireAction('project.members.search', { resourceResolver: 'project.byId', resourceIdFrom: 'params' }),
  asyncHandler(async (req, res) => {
    try {
      const projectId = String(req.params.projectId);
      const email = typeof req.query?.email === 'string' ? String(req.query.email).trim().toLowerCase() : '';

      if (!email) {
        return res.json({ mode: 'invite' });
      }

      const dataSource = await getDataSource();
      const userRepo = dataSource.getRepository(User);
      let targetQb = userRepo.createQueryBuilder('u')
        .select(['u.id', 'u.email', 'u.firstName', 'u.lastName', 'u.passwordHash']);
      targetQb = addCaseInsensitiveEquals(targetQb, 'u', 'email', 'email', email);
      const targetUser = await targetQb.getOne();

      if (!targetUser || !targetUser.passwordHash) {
        return res.json({ mode: 'invite' });
      }

      const existingMembership = await projectMemberService.getMembership(projectId, targetUser.id);
      if (existingMembership) {
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
      logger.error('Lookup project member candidate error:', error);
      throw Errors.internal('Failed to look up user');
    }
  })
);

router.get(
  '/starbase-api/projects/:projectId/members/capabilities',
  apiLimiter,
  requireAuth,
  validateParams(projectIdSchema),
  requireAction('project.members.invite', { resourceResolver: 'project.byId', resourceIdFrom: 'params' }),
  asyncHandler(async (req, res) => {
    try {
      const emailConfig = await getEmailConfigForTenant((req as any).tenant?.tenantId);
      const ssoRequired = await invitationService.isLocalLoginDisabled();

      res.json({
        ssoRequired,
        emailConfigured: Boolean(emailConfig),
      });
    } catch (error) {
      logger.error('Project member capabilities lookup error:', error);
      throw Errors.internal('Failed to load member capabilities');
    }
  })
);

router.put(
  '/starbase-api/projects/:projectId/members/:userId/deploy-permission',
  apiLimiter,
  requireAuth,
  validateParams(memberIdSchema),
  validateBody(updateDeployGrantSchema),
  requireAction('project.members.deploy-grant.manage', { resourceResolver: 'project.byId', resourceIdFrom: 'params' }),
  asyncHandler(async (req, res) => {
    try {
      const projectId = String(req.params.projectId);
      const targetUserId = String(req.params.userId);
      const requesterId = req.user!.userId;
      const { allowed } = req.body as { allowed: boolean };

      const targetMembership = await projectMemberService.getMembership(projectId, targetUserId);
      if (!targetMembership) {
        throw Errors.projectNotFound();
      }

      const targetCanEditProjectFiles = await permissionService.hasPermission(ProjectPermissions.FILES_EDIT, {
        userId: targetUserId,
        resourceType: 'project',
        resourceId: projectId,
      });
      if (!targetCanEditProjectFiles) {
        throw Errors.validation('Deploy permission can only be granted to project file editors');
      }

      const dataSource = await getDataSource();
      const grantRepo = dataSource.getRepository(PermissionGrant);
      const now = Date.now();

      if (allowed) {
        await grantRepo.createQueryBuilder()
          .insert()
          .values({
            id: generateId(),
            userId: targetUserId,
            permission: 'project:deploy',
            resourceType: 'project',
            resourceId: projectId,
            grantedById: requesterId,
            createdAt: now,
          })
          .orIgnore()
          .execute();
      } else {
        await grantRepo.createQueryBuilder()
          .delete()
          .where('userId = :userId', { userId: targetUserId })
          .andWhere('permission IN (:...perms)', { perms: ['project:deploy', 'project.deploy'] })
          .andWhere('resourceType = :resourceType', { resourceType: 'project' })
          .andWhere('resourceId = :resourceId', { resourceId: projectId })
          .execute();
      }

      res.json({ allowed });
    } catch (error) {
      logger.error('Update deploy permission error:', error);
      if (error instanceof AppError) {
        throw error;
      }
      throw Errors.internal('Failed to update deploy permission');
    }
  })
);

/**
 * GET /starbase-api/projects/:projectId/members
 * List all members of a project
 */
router.get(
  '/starbase-api/projects/:projectId/members',
  apiLimiter,
  requireAuth,
  validateParams(projectIdSchema),
  requireAction('project.members.read', { resourceResolver: 'project.byId', resourceIdFrom: 'params' }),
  asyncHandler(async (req, res) => {
    try {
      const projectId = String(req.params.projectId);

      const members = await projectMemberService.getMembers(projectId);
      const pendingInvites = await listPendingProjectInvites(projectId);

      const editorIds = members
        .filter((m: any) => String(m.role) === 'editor')
        .map((m: any) => String(m.userId));

      let deployGrantSet = new Set<string>();
      if (editorIds.length > 0) {
        const dataSource = await getDataSource();
        const grantRepo = dataSource.getRepository(PermissionGrant);
        const deployGrantRows = await grantRepo.createQueryBuilder('pg')
          .select(['pg.userId'])
          .where('pg.userId IN (:...editorIds)', { editorIds })
          .andWhere('pg.permission IN (:...perms)', { perms: ['project:deploy', 'project.deploy'] })
          .andWhere('pg.resourceType = :resourceType', { resourceType: 'project' })
          .andWhere('pg.resourceId = :resourceId', { resourceId: projectId })
          .getMany();
        deployGrantSet = new Set(deployGrantRows.map((r) => String(r.userId)));
      }

      res.json({
        members: members.map((m: any) => ({
          ...m,
          deployAllowed: String(m.role) === 'editor' ? deployGrantSet.has(String(m.userId)) : null,
        })),
        pendingInvites,
      });
    } catch (error) {
      logger.error('Get project members error:', error);
      throw Errors.internal('Failed to get project members');
    }
  })
);

router.post(
  '/starbase-api/projects/:projectId/pending-invites/:invitationId/reissue',
  apiLimiter,
  requireAuth,
  validateParams(pendingInviteIdSchema),
  requireAction('project.members.invite', { resourceResolver: 'project.byId', resourceIdFrom: 'params' }),
  asyncHandler(async (req, res) => {
    try {
      const projectId = String(req.params.projectId);
      const invitationId = String(req.params.invitationId);
      const requesterId = req.user!.userId;
      const dataSource = await getDataSource();
      const invitationRepo = dataSource.getRepository(Invitation);
      const projectRepo = dataSource.getRepository(Project);

      const invitation = await invitationRepo.findOne({
        where: {
          id: invitationId,
          resourceType: 'project',
          resourceId: projectId,
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

      const existingMembership = await projectMemberService.getMembership(projectId, String(invitation.userId));
      if (existingMembership) {
        throw Errors.conflict('User is already a member of this project');
      }

      const project = await projectRepo.findOne({ where: { id: projectId }, select: ['name'] });
      const inviteRoles = parseInvitationRoles(invitation.resourceRolesJson, invitation.resourceRole);
      const inviteResult = await invitationService.createInvitation({
        userId: String(invitation.userId),
        email: invitation.email,
        tenantSlug: invitation.tenantSlug,
        resourceType: 'project',
        resourceId: projectId,
        resourceName: project?.name || invitation.resourceName || projectId,
        resourceRoles: inviteRoles,
        resourceRole: inviteRoles[0],
        createdByUserId: requesterId,
        invitedByName: req.user!.email,
        deliveryMethod: 'manual',
      });

      await logAudit({
        userId: requesterId,
        action: 'project.member.invite.reissued',
        resourceType: 'project',
        resourceId: projectId,
        ipAddress: req.headers['x-forwarded-for'] as string || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
        details: { invitationId, email: invitation.email, deliveryMethod: 'manual', roles: inviteRoles },
      });

      return res.json({
        invited: true,
        emailSent: false,
        inviteUrl: inviteResult.inviteUrl,
        oneTimePassword: inviteResult.oneTimePassword,
      });
    } catch (error) {
      logger.error('Reissue project invitation error:', error);
      if (error instanceof AppError) {
        throw error;
      }
      throw Errors.internal('Failed to reissue invitation');
    }
  })
);

/**
 * POST /starbase-api/projects/:projectId/members
 * Add a new member to a project
 */
router.post(
  '/starbase-api/projects/:projectId/members',
  apiLimiter,
  requireAuth,
  validateParams(projectIdSchema),
  validateBody(addMemberSchema),
  asyncHandler(async (req, res) => {
    try {
      const projectId = String(req.params.projectId);
      const { email, role, roles, deliveryMethod } = req.body as { email: string; role?: ProjectRole; roles?: ProjectRole[]; deliveryMethod?: 'email' | 'manual' };
      const inviterId = req.user!.userId;

      if (typeof email !== 'string') {
        throw Errors.validation('Invalid email address');
      }
      const emailLower = email.toLowerCase();
      const canAddMembers = await canPerformProjectMemberAction(req, projectId, ProjectPermissions.MEMBERS_ADD);
      const canInviteMembers = await canPerformProjectMemberAction(req, projectId, ProjectPermissions.MEMBERS_INVITE);

      const requestedRoles: ProjectRole[] = Array.isArray(roles) && roles.length > 0
        ? roles
        : (role ? [role] : (['viewer'] as ProjectRole[]));

      // Governance membership rows describe the project roster. They must not
      // bypass the canonical evaluator when assigning another delegate.
      const inviterCanManageDelegates = await canManageProjectDelegates(req, projectId);

      if (requestedRoles.includes('owner')) {
        throw Errors.forbidden('Use transfer ownership to assign project owner role');
      }

      if (!inviterCanManageDelegates && requestedRoles.includes('delegate')) {
        throw Errors.forbidden('Delegate assignment requires project delegate-management permission');
      }

      // Find user by email
      const dataSource = await getDataSource();
      const userRepo = dataSource.getRepository(User);
      const projectRepo = dataSource.getRepository(Project);
      let targetQb = userRepo.createQueryBuilder('u')
        .select(['u.id', 'u.email', 'u.passwordHash']);
      targetQb = addCaseInsensitiveEquals(targetQb, 'u', 'email', 'email', emailLower);
      const targetUser = await targetQb.getOne();

      if (targetUser && targetUser.passwordHash) {
        if (!canAddMembers) {
          throw Errors.forbidden('Only owners, delegates, or users with project member-add permission can add existing users');
        }

        // Check if user is already a member
        const existingMembership = await projectMemberService.getMembership(projectId, targetUser.id);
        if (existingMembership) {
          throw Errors.conflict('User is already a member of this project');
        }

        // Add the member directly
        const member = await projectMemberService.addMember(projectId, targetUser.id, requestedRoles, inviterId);

        await logAudit({
          userId: inviterId,
          action: 'project.member.added',
          resourceType: 'project',
          resourceId: projectId,
          ipAddress: req.headers['x-forwarded-for'] as string || req.socket.remoteAddress,
          userAgent: req.headers['user-agent'],
          details: { targetUserId: targetUser.id, email: targetUser.email, roles: requestedRoles },
        });

        return res.status(201).json({
          ...member,
          user: {
            id: targetUser.id,
            email: targetUser.email,
          },
          invited: false,
        });
      }

      if (!canInviteMembers) {
        throw Errors.forbidden('Only owners, delegates, or users with project member-invite permission can invite users');
      }

      const pendingUser = targetUser || await userService.createPendingUser({
        email: emailLower,
        createdByUserId: inviterId,
      }).then((user) => ({ id: user.id, email: user.email } as Pick<User, 'id' | 'email'>));

      if (!pendingUser) {
        throw Errors.internal('Failed to prepare invitation user');
      }

      const existingMembership = await projectMemberService.getMembership(projectId, pendingUser.id);
      if (existingMembership) {
        throw Errors.conflict('User is already a member of this project');
      }

      const project = await projectRepo.findOne({ where: { id: projectId }, select: ['name'] });
      const tenantSlug = String(req.params.tenantSlug || '').trim() || 'default';
      const inviteResult = await invitationService.createInvitation({
        userId: pendingUser.id,
        email: emailLower,
        tenantSlug,
        resourceType: 'project',
        resourceId: projectId,
        resourceName: project?.name || projectId,
        resourceRoles: requestedRoles,
        resourceRole: requestedRoles[0],
        createdByUserId: inviterId,
        invitedByName: req.user!.email,
        deliveryMethod: deliveryMethod === 'email' ? 'email' : 'manual',
      });

      await logAudit({
        userId: inviterId,
        action: 'project.member.invited',
        resourceType: 'project',
        resourceId: projectId,
        ipAddress: req.headers['x-forwarded-for'] as string || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
        details: { email: emailLower, roles: requestedRoles },
      });

      return res.status(201).json({
        invited: true,
        emailSent: inviteResult.emailSent,
        emailError: inviteResult.emailError,
        inviteUrl: inviteResult.emailSent ? undefined : inviteResult.inviteUrl,
        oneTimePassword: inviteResult.oneTimePassword,
      });
    } catch (error) {
      logger.error('Add project member error:', error);
      if (error instanceof AppError) {
        throw error;
      }
      throw Errors.internal('Failed to add project member');
    }
  })
);

/**
 * PATCH /starbase-api/projects/:projectId/members/:userId
 * Update a member's role
 */
router.patch(
  '/starbase-api/projects/:projectId/members/:userId',
  apiLimiter,
  requireAuth,
  validateParams(memberIdSchema),
  validateBody(updateRoleSchema),
  requireAction('project.members.update-role', { resourceResolver: 'project.byId', resourceIdFrom: 'params' }),
  asyncHandler(async (req, res) => {
    try {
      const projectId = String(req.params.projectId);
      const targetUserId = String(req.params.userId);
      const { role, roles } = req.body as { role?: ProjectRole; roles?: ProjectRole[] };
      const requesterId = req.user!.userId;

      // Can't change owner role through this endpoint unless requester is owner
      const targetMembership = await projectMemberService.getMembership(projectId, targetUserId);
      if (!targetMembership) {
        throw Errors.projectNotFound();
      }
      const targetRoles = getRolesFromMembership(targetMembership as MembershipWithRoles);
      const requesterCanManageDelegates = await canManageProjectDelegates(req, projectId);

      if (targetRoles.includes('owner')) {
        throw Errors.validation('Cannot change owner role. Use transfer ownership instead.');
      }

      const requestedRoles = Array.isArray(roles) && roles.length > 0
        ? roles
        : (role ? [role] : []);
      if (requestedRoles.length === 0) {
        throw Errors.validation('No roles provided');
      }

      // Only owners can promote to delegate or owner.
      if (requestedRoles.includes('owner')) {
        throw Errors.forbidden('Use transfer ownership to assign project owner role');
      }

      if (!requesterCanManageDelegates && requestedRoles.includes('delegate')) {
        throw Errors.forbidden('Delegate assignment requires project delegate-management permission');
      }

      await projectMemberService.updateRoles(projectId, targetUserId, requestedRoles);

      res.json({ message: 'Role updated successfully' });
    } catch (error) {
      logger.error('Update member role error:', error);
      if (error instanceof AppError) {
        throw error;
      }
      throw Errors.internal('Failed to update member role');
    }
  })
);

/**
 * DELETE /starbase-api/projects/:projectId/members/:userId
 * Remove a member from a project
 */
router.delete(
  '/starbase-api/projects/:projectId/members/:userId',
  apiLimiter,
  requireAuth,
  validateParams(memberIdSchema),
  asyncHandler(async (req, res) => {
    try {
      const projectId = String(req.params.projectId);
      const targetUserId = String(req.params.userId);
      const requesterId = req.user!.userId;

      // Check if requester has permission (owner or delegate, or removing self)
      const isSelf = requesterId === targetUserId;
      const canRemoveMembers = isSelf
        ? true
        : await canPerformProjectMemberAction(req, projectId, ProjectPermissions.MEMBERS_REMOVE);
      
      if (!isSelf && !canRemoveMembers) {
        throw Errors.forbidden();
      }

      // Check target membership exists
      const targetMembership = await projectMemberService.getMembership(projectId, targetUserId);
      if (!targetMembership) {
        throw Errors.projectNotFound();
      }

      const targetRoles = getRolesFromMembership(targetMembership as MembershipWithRoles);

      // Can't remove the owner
      if (targetRoles.includes('owner')) {
        throw Errors.validation('Cannot remove the project owner');
      }

      await projectMemberService.removeMember(projectId, targetUserId);
      await invitationService.revokeOutstandingInvitations({
        userId: targetUserId,
        resourceType: 'project',
        resourceId: projectId,
      });

      res.status(204).send();
    } catch (error) {
      logger.error('Remove member error:', error);
      if (error instanceof AppError) {
        throw error;
      }
      throw Errors.internal('Failed to remove member');
    }
  })
);

/**
 * POST /starbase-api/projects/:projectId/transfer-ownership
 * Transfer project ownership to another member
 */
router.post(
  '/starbase-api/projects/:projectId/transfer-ownership',
  apiLimiter,
  requireAuth,
  validateParams(projectIdSchema),
  validateBody(z.object({ newOwnerId: z.string().uuid() })),
  requireAction('project.ownership.transfer', { resourceResolver: 'project.byId', resourceIdFrom: 'params' }),
  asyncHandler(async (req, res) => {
    try {
      const projectId = String(req.params.projectId);
      const { newOwnerId } = req.body;

      // New owner must already be a member
      const newOwnerMembership = await projectMemberService.getMembership(projectId, newOwnerId);
      if (!newOwnerMembership) {
        throw Errors.userNotFound();
      }

      const ownerIds = await projectMemberService.getProjectOwners(projectId);
      const currentOwnerId = ownerIds[0];
      if (!currentOwnerId) {
        throw Errors.userNotFound();
      }

      await projectMemberService.transferOwnership(projectId, currentOwnerId, newOwnerId);

      res.json({ message: 'Ownership transferred successfully' });
    } catch (error) {
      logger.error('Transfer ownership error:', error);
      if (error instanceof AppError) {
        throw error;
      }
      throw Errors.internal('Failed to transfer ownership');
    }
  })
);

/**
 * Get current user's membership in a project
 */
router.get(
  '/starbase-api/projects/:projectId/members/me',
  apiLimiter,
  requireAuth,
  validateParams(projectIdSchema),
  asyncHandler(async (req, res) => {
    try {
      const projectId = String(req.params.projectId);
      const userId = req.user!.userId;

      const membership = await projectMemberService.getMembership(projectId, userId);
      if (!membership) {
        throw Errors.notFound('Membership');
      }

      res.json(membership);
    } catch (error) {
      logger.error('Get my membership error:', error);
      throw Errors.internal('Failed to get membership');
    }
  })
);

export default router;

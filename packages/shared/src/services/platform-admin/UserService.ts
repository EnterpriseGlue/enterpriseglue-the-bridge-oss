/**
 * User Service
 * Handles user CRUD operations, account management, and email workflows
 */

import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import type { AdminUserStatus, LegacyPlatformRole } from '@enterpriseglue/shared/contracts/auth.js';
import { Invitation } from '@enterpriseglue/shared/infrastructure/persistence/entities/Invitation.js';
import { Notification } from '@enterpriseglue/shared/infrastructure/persistence/entities/Notification.js';
import { PasswordResetToken } from '@enterpriseglue/shared/infrastructure/persistence/entities/PasswordResetToken.js';
import { PermissionGrant } from '@enterpriseglue/shared/infrastructure/persistence/entities/PermissionGrant.js';
import { Project } from '@enterpriseglue/shared/infrastructure/persistence/entities/Project.js';
import { ProjectMember } from '@enterpriseglue/shared/infrastructure/persistence/entities/ProjectMember.js';
import { ProjectMemberRole } from '@enterpriseglue/shared/infrastructure/persistence/entities/ProjectMemberRole.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { EngineMember } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineMember.js';
import { AuthzGroupMembership } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroupMembership.js';
import { ExternalIdentity } from '@enterpriseglue/shared/infrastructure/persistence/entities/ExternalIdentity.js';
import { RbacRoleAssignment } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRoleAssignment.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import { RefreshToken } from '@enterpriseglue/shared/infrastructure/persistence/entities/RefreshToken.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { addCaseInsensitiveEquals } from '@enterpriseglue/shared/infrastructure/persistence/adapters/QueryHelpers.js';
import { hashPassword, generatePassword } from '@enterpriseglue/shared/utils/password.js';
import { randomBytes } from 'crypto';
import { Errors } from '@enterpriseglue/shared/interfaces/middleware/errorHandler.js';
import { authzGroupService } from './AuthzGroupService.js';
import { getActivePlatformAdministratorUserIds } from './PlatformAdministratorMembershipService.js';
import { IsNull } from 'typeorm';

export interface CreateUserInput {
  email: string;
  firstName?: string;
  lastName?: string;
  platformRole?: LegacyPlatformRole;
  createdByUserId: string;
}

export interface UpdateUserInput {
  firstName?: string;
  lastName?: string;
  platformRole?: LegacyPlatformRole;
  isActive?: boolean;
}

export interface UserDTO {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  platformRole: string;
  authProvider: string;
  isActive: boolean;
  isEmailVerified: boolean;
  mustResetPassword: boolean;
  adminStatus: AdminUserStatus;
  createdAt: number;
  updatedAt: number;
  lastLoginAt: number | null;
  createdByUserId: string | null;
  failedLoginAttempts?: number;
  lockedUntil?: number | null;
}

export interface CreateUserResult {
  user: UserDTO;
  temporaryPassword: string;
  verificationToken: string;
}

function normalizeRoleValue(role?: string | null): 'admin' | 'user' {
  return role === 'admin' ? 'admin' : 'user';
}

function resolveAdminUserStatus(user: User, pendingInvitationUserIds: Set<string>): AdminUserStatus {
  if (!user.isActive) {
    return 'inactive';
  }

  const authProvider = user.authProvider || 'local';
  const hasEstablishedIdentity = Boolean(
    user.lastLoginAt ||
    user.isEmailVerified ||
    authProvider !== 'local'
  );

  if (pendingInvitationUserIds.has(String(user.id)) && !hasEstablishedIdentity) {
    return 'pending';
  }

  return 'active';
}

function toUserDTO(
  user: User,
  options: { includeAdmin?: boolean; pendingInvitationUserIds?: Set<string>; platformAdministratorUserIds?: Set<string> } = {}
): UserDTO {
  const pendingInvitationUserIds = options.pendingInvitationUserIds || new Set<string>();
  const dto: UserDTO = {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    // Kept for API compatibility; effective access is group-derived.
    platformRole: options.platformAdministratorUserIds?.has(user.id) ? 'admin' : 'user',
    authProvider: user.authProvider || 'local',
    isActive: Boolean(user.isActive),
    isEmailVerified: Boolean(user.isEmailVerified),
    mustResetPassword: Boolean(user.mustResetPassword),
    adminStatus: resolveAdminUserStatus(user, pendingInvitationUserIds),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt,
    createdByUserId: user.createdByUserId,
  };

  if (options.includeAdmin) {
    dto.failedLoginAttempts = user.failedLoginAttempts;
    dto.lockedUntil = user.lockedUntil;
  }

  return dto;
}

export class UserService {
  /**
   * List all users ordered by creation date
   */
  async listUsers(): Promise<UserDTO[]> {
    const dataSource = await getDataSource();
    const invitationRepo = dataSource.getRepository(Invitation);
    const userRepo = dataSource.getRepository(User);
    const pendingInvitations = await invitationRepo.find({
      where: {
        resourceType: 'platform_user',
        revokedAt: IsNull(),
        completedAt: IsNull(),
      },
      select: ['userId'],
    });
    const pendingInvitationUserIds = new Set(pendingInvitations.map((invitation) => String(invitation.userId)));
    const result = await userRepo.find({ order: { createdAt: 'DESC' } });
    const platformAdministratorUserIds = await getActivePlatformAdministratorUserIds(
      result.map((user) => user.id),
      dataSource,
    );
    return result.map((u) => toUserDTO(u, { includeAdmin: true, pendingInvitationUserIds, platformAdministratorUserIds }));
  }

  /**
   * Get a single user by ID
   */
  async getUser(id: string): Promise<UserDTO> {
    const dataSource = await getDataSource();
    const invitationRepo = dataSource.getRepository(Invitation);
    const userRepo = dataSource.getRepository(User);
    const user = await userRepo.findOneBy({ id });
    if (!user) throw Errors.notFound('User', id);
    const pendingInvitationCount = await invitationRepo.count({
      where: {
        userId: id,
        resourceType: 'platform_user',
        revokedAt: IsNull(),
        completedAt: IsNull(),
      },
    });
    const platformAdministratorUserIds = await getActivePlatformAdministratorUserIds([id], dataSource);
    return toUserDTO(user, {
      includeAdmin: true,
      pendingInvitationUserIds: pendingInvitationCount > 0 ? new Set([id]) : new Set<string>(),
      platformAdministratorUserIds,
    });
  }

  /**
   * Create a new user with a temporary password and verification token
   */
  async createUser(input: CreateUserInput): Promise<CreateUserResult> {
    const { email, firstName, lastName, platformRole = 'user', createdByUserId } = input;
    const normalizedPlatformRole = normalizeRoleValue(platformRole);

    const temporaryPassword = generatePassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const verificationToken = randomBytes(32).toString('hex');
    const tokenExpiry = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

    const userId = generateId();
    const now = Date.now();

    const dataSource = await getDataSource();
    const result = await dataSource.transaction(async (manager) => {
      const userRepo = manager.getRepository(User);
      let existingQb = userRepo.createQueryBuilder('u');
      existingQb = addCaseInsensitiveEquals(existingQb, 'u', 'email', 'email', email);
      const existing = await existingQb.getOne();
      if (existing) throw Errors.conflict('User with this email already exists');

      await userRepo.insert({
        id: userId,
        email,
        passwordHash,
        firstName: firstName || null,
        lastName: lastName || null,
        // The database keeps its non-privileged compatibility default while
        // the canonical group membership below remains the access source.
        isActive: true,
        mustResetPassword: true,
        failedLoginAttempts: 0,
        createdAt: now,
        updatedAt: now,
        createdByUserId,
        isEmailVerified: false,
        emailVerificationToken: verificationToken,
        emailVerificationTokenExpiry: tokenExpiry,
      });
      await authzGroupService.ensureAuthenticatedUserMembershipWithManager(manager, userId);
      if (normalizedPlatformRole === 'admin') {
        await authzGroupService.ensureManualPlatformAdministratorMembershipWithManager(manager, userId);
      }
      const user = await userRepo.findOneBy({ id: userId });
      const platformAdministratorUserIds = await getActivePlatformAdministratorUserIds([userId], manager);
      return { user, platformAdministratorUserIds };
    });

    return {
      user: toUserDTO(result.user!, { platformAdministratorUserIds: result.platformAdministratorUserIds }),
      temporaryPassword,
      verificationToken,
    };
  }

  async createPendingUser(input: CreateUserInput): Promise<UserDTO> {
    const { email, firstName, lastName, platformRole = 'user', createdByUserId } = input;
    const normalizedEmail = email.toLowerCase();
    const normalizedPlatformRole = normalizeRoleValue(platformRole);
    const userId = generateId();
    const now = Date.now();

    const dataSource = await getDataSource();
    const result = await dataSource.transaction(async (manager) => {
      const userRepo = manager.getRepository(User);
      let existingQb = userRepo.createQueryBuilder('u');
      existingQb = addCaseInsensitiveEquals(existingQb, 'u', 'email', 'email', normalizedEmail);
      const existing = await existingQb.getOne();
      if (existing) throw Errors.conflict('User with this email already exists');

      await userRepo.insert({
        id: userId,
        email: normalizedEmail,
        authProvider: 'local',
        passwordHash: null,
        firstName: firstName || null,
        lastName: lastName || null,
        isActive: true,
        mustResetPassword: false,
        failedLoginAttempts: 0,
        lockedUntil: null,
        createdAt: now,
        updatedAt: now,
        createdByUserId,
        isEmailVerified: false,
        emailVerificationToken: null,
        emailVerificationTokenExpiry: null,
        lastLoginAt: null,
      });
      await authzGroupService.ensureAuthenticatedUserMembershipWithManager(manager, userId);
      if (normalizedPlatformRole === 'admin') {
        await authzGroupService.ensureManualPlatformAdministratorMembershipWithManager(manager, userId);
      }
      const user = await userRepo.findOneBy({ id: userId });
      const platformAdministratorUserIds = await getActivePlatformAdministratorUserIds([userId], manager);
      return { user, platformAdministratorUserIds };
    });
    return toUserDTO(result.user!, { platformAdministratorUserIds: result.platformAdministratorUserIds });
  }

  /**
   * Update user fields
   */
  async updateUser(id: string, input: UpdateUserInput): Promise<UserDTO> {
    const dataSource = await getDataSource();
    const result = await dataSource.transaction(async (manager) => {
      const userRepo = manager.getRepository(User);
      const existing = await userRepo.findOneBy({ id });
      if (!existing) throw Errors.notFound('User', id);

      const updateData: any = { updatedAt: Date.now() };
      if (input.firstName !== undefined) updateData.firstName = input.firstName;
      if (input.lastName !== undefined) updateData.lastName = input.lastName;
      if (input.isActive !== undefined) updateData.isActive = input.isActive;

      await userRepo.update({ id }, updateData);
      const nextIsActive = updateData.isActive ?? existing.isActive;
      if (nextIsActive) {
        await authzGroupService.ensureAuthenticatedUserMembershipWithManager(manager, id);
      } else if (existing.isActive || input.isActive === false) {
        await authzGroupService.removeAuthenticatedUserMembershipWithManager(manager, id);
        await manager.getRepository(RefreshToken).update({ userId: id }, { revokedAt: updateData.updatedAt });
      }
      if (input.platformRole !== undefined) {
        if (normalizeRoleValue(input.platformRole) === 'admin') {
          await authzGroupService.ensureManualPlatformAdministratorMembershipWithManager(manager, id);
        } else {
          await authzGroupService.removeManualPlatformAdministratorMembershipWithManager(manager, id);
        }
      }
      const updatedUser = await userRepo.findOneBy({ id });
      const platformAdministratorUserIds = await getActivePlatformAdministratorUserIds([id], manager);
      return { user: updatedUser, platformAdministratorUserIds };
    });
    return toUserDTO(result.user!, { platformAdministratorUserIds: result.platformAdministratorUserIds });
  }

  /**
   * Soft-delete user (deactivate) and revoke all refresh tokens
   */
  async deactivateUser(id: string): Promise<void> {
    const dataSource = await getDataSource();
    const userRepo = dataSource.getRepository(User);

    const existing = await userRepo.findOneBy({ id });
    if (!existing) throw Errors.notFound('User', id);

    const now = Date.now();
    await dataSource.transaction(async (manager) => {
      await manager.getRepository(User).update({ id }, {
        isActive: false,
        updatedAt: now,
      });
      await authzGroupService.removeAuthenticatedUserMembershipWithManager(manager, id);
      await manager.getRepository(RefreshToken).update({ userId: id }, { revokedAt: now });
    });
  }

  async deleteUserPermanently(id: string): Promise<void> {
    const dataSource = await getDataSource();
    const userRepo = dataSource.getRepository(User);
    const invitationRepo = dataSource.getRepository(Invitation);
    const projectRepo = dataSource.getRepository(Project);
    const engineRepo = dataSource.getRepository(Engine);
    const user = await userRepo.findOneBy({ id });

    if (!user) {
      throw Errors.notFound('User', id);
    }

    if ((user.authProvider || 'local') !== 'local') {
      throw Errors.validation('Only local users can be permanently deleted here');
    }

    const pendingPlatformInviteCount = await invitationRepo.count({
      where: {
        userId: id,
        resourceType: 'platform_user',
        revokedAt: IsNull(),
        completedAt: IsNull(),
      },
    });

    const [ownedProjectCount, ownedOrDelegatedEngineCount] = await Promise.all([
      projectRepo.count({ where: { ownerId: id } }),
      engineRepo.count({ where: [{ ownerId: id }, { delegateId: id }] }),
    ]);

    if (user.isActive && pendingPlatformInviteCount === 0) {
      throw Errors.validation('Only pending or inactive local users can be permanently deleted');
    }

    if (ownedProjectCount > 0 || ownedOrDelegatedEngineCount > 0) {
      throw Errors.validation('Reassign owned projects or engines before permanently deleting this user');
    }

    await dataSource.transaction(async (manager) => {
      await manager.getRepository(Notification).delete({ userId: id });
      await manager.getRepository(PasswordResetToken).delete({ userId: id });
      await manager.getRepository(PermissionGrant).delete({ userId: id });
      await manager.getRepository(RefreshToken).delete({ userId: id });
      await manager.getRepository(Invitation).delete({ userId: id });
      await manager.getRepository(ProjectMemberRole).delete({ userId: id });
      await manager.getRepository(ProjectMember).delete({ userId: id });
      await manager.getRepository(EngineMember).delete({ userId: id });
      // Principal-scoped assignments and group memberships have no database
      // foreign key to User. Revoke canonical rows before deleting the account
      // so a later id reuse cannot inherit access or leave a dangling
      // external-account link.
      await manager.getRepository(RbacRoleAssignment).delete({ principalType: 'user', principalId: id });
      await manager.getRepository(AuthzGroupMembership).delete({ userId: id });
      await manager.getRepository(ExternalIdentity).delete({ userId: id });
      await manager.getRepository(User).delete({ id });
    });
  }

  /**
   * Unlock a locked user account
   */
  async unlockUser(id: string): Promise<void> {
    const dataSource = await getDataSource();
    const userRepo = dataSource.getRepository(User);

    await userRepo.update({ id }, {
      failedLoginAttempts: 0,
      lockedUntil: null,
      updatedAt: Date.now(),
    });
  }
}

export const userService = new UserService();

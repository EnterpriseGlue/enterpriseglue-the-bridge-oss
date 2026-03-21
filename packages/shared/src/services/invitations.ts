import { createHash, randomBytes } from 'crypto';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Invitation, type InvitationDeliveryMethod, type InvitationResourceType } from '@enterpriseglue/shared/db/entities/Invitation.js';
import { User } from '@enterpriseglue/shared/db/entities/User.js';
import { SsoProvider } from '@enterpriseglue/shared/db/entities/SsoProvider.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { config } from '@enterpriseglue/shared/config/index.js';
import { generatePassword, hashPassword, verifyPassword } from '@enterpriseglue/shared/utils/password.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { sendInvitationEmail } from '@enterpriseglue/shared/services/email/index.js';
import { projectMemberService } from '@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js';
import { engineService } from '@enterpriseglue/shared/services/platform-admin/EngineService.js';
import type { PlatformRole, User as UserContract } from '@enterpriseglue/shared/contracts/auth.js';
import type { Repository } from 'typeorm';

const INVITATION_EXPIRY_MS = 24 * 60 * 60 * 1000;
const OTP_LOCK_WINDOW_MS = 15 * 60 * 1000;
const OTP_MAX_FAILED_ATTEMPTS = 5;

export type InvitationDisplayStatus = 'pending' | 'expired' | 'onboarding';

export interface CreateInvitationInput {
  userId: string;
  email: string;
  tenantSlug?: string;
  resourceType: InvitationResourceType;
  resourceId?: string;
  resourceName?: string;
  platformRole?: PlatformRole;
  resourceRole?: string;
  resourceRoles?: string[];
  createdByUserId: string;
  invitedByName: string;
  deliveryMethod: InvitationDeliveryMethod;
  tenantId?: string;
}

export interface CreateInvitationResult {
  invitationId: string;
  inviteUrl: string;
  oneTimePassword?: string;
  emailSent: boolean;
  emailError?: string;
}

export interface InvitationInfo {
  email: string;
  tenantSlug: string;
  resourceType: InvitationResourceType;
  resourceName: string | null;
  resourceRole: string | null;
  resourceRoles: string[];
  deliveryMethod: InvitationDeliveryMethod;
  expiresAt: number;
  status: InvitationDisplayStatus;
}

export interface VerifiedInvitationResult {
  invitationId: string;
  userId: string;
  tenantSlug: string;
}

function hashOpaqueToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeTenantSlug(value?: string): string {
  const trimmed = String(value || '').trim();
  return trimmed.length > 0 ? trimmed : 'default';
}

function parseRoles(value: string | null): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function serializeRoles(value?: string[]): string | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  return JSON.stringify(value.map((item) => String(item)));
}

function buildInviteUrl(inviteToken: string, tenantSlug: string): string {
  return `${config.frontendUrl}/t/${encodeURIComponent(tenantSlug)}/invite/${inviteToken}`;
}

async function revokeOutstandingInvitations(
  invitationRepo: Repository<Invitation>,
  now: number,
  scope: {
    userId: string;
    resourceType: InvitationResourceType;
    resourceId?: string | null;
    excludeInvitationId?: string;
  }
): Promise<void> {
  const revokeExistingQb = invitationRepo.createQueryBuilder()
    .update(Invitation)
    .set({
      status: 'revoked',
      revokedAt: now,
      updatedAt: now,
    })
    .where('user_id = :userId', { userId: scope.userId })
    .andWhere('resource_type = :resourceType', { resourceType: scope.resourceType })
    .andWhere('revoked_at IS NULL')
    .andWhere('completed_at IS NULL');

  if (scope.excludeInvitationId) {
    revokeExistingQb.andWhere('id <> :excludeInvitationId', { excludeInvitationId: scope.excludeInvitationId });
  }

  if (scope.resourceId) {
    revokeExistingQb.andWhere('resource_id = :resourceId', { resourceId: scope.resourceId });
  } else {
    revokeExistingQb.andWhere('resource_id IS NULL');
  }

  await revokeExistingQb.execute();
}

function toInvitationDisplayStatus(invitation: Pick<Invitation, 'status' | 'expiresAt'>, now: number): InvitationDisplayStatus {
  if (invitation.status === 'otp_verified') {
    return 'onboarding';
  }

  if (invitation.expiresAt < now) {
    return 'expired';
  }

  return 'pending';
}

function toInvitationInfo(invitation: Invitation, now: number): InvitationInfo {
  return {
    email: invitation.email,
    tenantSlug: invitation.tenantSlug,
    resourceType: invitation.resourceType,
    resourceName: invitation.resourceName,
    resourceRole: invitation.resourceRole,
    resourceRoles: parseRoles(invitation.resourceRolesJson),
    deliveryMethod: invitation.deliveryMethod,
    expiresAt: invitation.expiresAt,
    status: toInvitationDisplayStatus(invitation, now),
  };
}

async function getInvitationByTokenValue(token: string): Promise<Invitation | null> {
  const dataSource = await getDataSource();
  const invitationRepo = dataSource.getRepository(Invitation);
  const inviteTokenHash = hashOpaqueToken(token);
  return invitationRepo.findOneBy({ inviteTokenHash });
}

function assertLocalLoginAllowed(enabledProviderCount: number): void {
  if (enabledProviderCount > 0) {
    throw Errors.forbidden('Local login is disabled while SSO is enabled. One-time password invites are unavailable.');
  }
}

export class InvitationService {
  async revokeOutstandingInvitations(scope: {
    userId: string;
    resourceType: InvitationResourceType;
    resourceId?: string | null;
    excludeInvitationId?: string;
  }): Promise<void> {
    const dataSource = await getDataSource();
    await revokeOutstandingInvitations(dataSource.getRepository(Invitation), Date.now(), scope);
  }

  async isLocalLoginDisabled(): Promise<boolean> {
    const dataSource = await getDataSource();
    const ssoProviderRepo = dataSource.getRepository(SsoProvider);
    const enabledCount = await ssoProviderRepo.count({ where: { enabled: true } });
    return enabledCount > 0;
  }

  async createInvitation(input: CreateInvitationInput): Promise<CreateInvitationResult> {
    const dataSource = await getDataSource();
    const invitationRepo = dataSource.getRepository(Invitation);
    const ssoProviderRepo = dataSource.getRepository(SsoProvider);
    const enabledCount = await ssoProviderRepo.count({ where: { enabled: true } });
    const deliveryMethod = input.deliveryMethod === 'email' ? 'email' : 'manual';

    if (enabledCount > 0 && deliveryMethod !== 'email') {
      assertLocalLoginAllowed(enabledCount);
    }

    const tenantSlug = normalizeTenantSlug(input.tenantSlug);
    const inviteToken = randomBytes(32).toString('hex');
    const inviteTokenHash = hashOpaqueToken(inviteToken);
    const oneTimePassword = generatePassword();
    const oneTimePasswordHash = await hashPassword(oneTimePassword);
    const now = Date.now();
    const invitationId = generateId();

    await revokeOutstandingInvitations(invitationRepo, now, {
      userId: input.userId,
      resourceType: input.resourceType,
      resourceId: input.resourceId || null,
    });

    await invitationRepo.insert({
      id: invitationId,
      userId: input.userId,
      email: input.email.toLowerCase(),
      tenantSlug,
      resourceType: input.resourceType,
      resourceId: input.resourceId || null,
      resourceName: input.resourceName || null,
      platformRole: input.platformRole || null,
      resourceRole: input.resourceRole || null,
      resourceRolesJson: serializeRoles(input.resourceRoles),
      inviteTokenHash,
      oneTimePasswordHash,
      deliveryMethod,
      status: 'pending',
      expiresAt: now + INVITATION_EXPIRY_MS,
      createdAt: now,
      updatedAt: now,
      createdByUserId: input.createdByUserId,
      otpVerifiedAt: null,
      completedAt: null,
      revokedAt: null,
      failedAttempts: 0,
      lockedUntil: null,
    });

    const invitation = await invitationRepo.findOneByOrFail({ id: invitationId });
    const inviteUrl = buildInviteUrl(inviteToken, tenantSlug);

    let emailSent = false;
    let emailError: string | undefined;

    if (deliveryMethod === 'email') {
      const result = await sendInvitationEmail({
        to: input.email,
        tenantName: input.resourceName || tenantSlug,
        inviteUrl,
        resourceType: input.resourceType,
        invitedByName: input.invitedByName,
        tenantId: input.tenantId,
        expiresIn: '24 hours',
        resourceName: input.resourceName,
      });
      emailSent = result.success;
      emailError = result.error;
    }

    return {
      invitationId: invitation.id,
      inviteUrl,
      oneTimePassword: emailSent ? undefined : oneTimePassword,
      emailSent,
      emailError,
    };
  }

  async getInvitationInfo(token: string): Promise<InvitationInfo> {
    const invitation = await getInvitationByTokenValue(token);
    const now = Date.now();

    if (!invitation || invitation.revokedAt || invitation.completedAt) {
      throw Errors.notFound('Invitation');
    }

    return toInvitationInfo(invitation, now);
  }

  async verifyOneTimePassword(token: string, oneTimePassword: string): Promise<VerifiedInvitationResult> {
    const dataSource = await getDataSource();
    const invitationRepo = dataSource.getRepository(Invitation);
    const ssoProviderRepo = dataSource.getRepository(SsoProvider);
    const enabledCount = await ssoProviderRepo.count({ where: { enabled: true } });
    assertLocalLoginAllowed(enabledCount);

    const invitation = await getInvitationByTokenValue(token);
    const now = Date.now();

    if (!invitation || invitation.revokedAt || invitation.completedAt) {
      throw Errors.validation('Invalid or expired invitation');
    }

    if (invitation.status !== 'pending') {
      throw Errors.validation('This invitation has already been used');
    }

    if (invitation.expiresAt < now) {
      throw Errors.validation('This invitation has expired');
    }

    if (invitation.lockedUntil && invitation.lockedUntil > now) {
      throw Errors.validation('Too many invalid one-time password attempts. Please wait before trying again.');
    }

    const isValid = await verifyPassword(oneTimePassword, invitation.oneTimePasswordHash);

    if (!isValid) {
      const failedAttempts = invitation.failedAttempts + 1;
      const lockedUntil = failedAttempts >= OTP_MAX_FAILED_ATTEMPTS ? now + OTP_LOCK_WINDOW_MS : null;
      await invitationRepo.update({ id: invitation.id }, {
        failedAttempts,
        lockedUntil,
        updatedAt: now,
      });
      throw Errors.validation('Invalid one-time password');
    }

    const updateResult = await invitationRepo.createQueryBuilder()
      .update(Invitation)
      .set({
        status: 'otp_verified',
        otpVerifiedAt: now,
        failedAttempts: 0,
        lockedUntil: null,
        updatedAt: now,
      })
      .where('id = :id', { id: invitation.id })
      .andWhere('status = :status', { status: 'pending' })
      .andWhere('otp_verified_at IS NULL')
      .execute();

    if (!updateResult.affected) {
      throw Errors.validation('This invitation has already been used');
    }

    return {
      invitationId: invitation.id,
      userId: invitation.userId,
      tenantSlug: invitation.tenantSlug,
    };
  }

  async redeemEmailInvitation(token: string): Promise<VerifiedInvitationResult> {
    const dataSource = await getDataSource();
    const invitationRepo = dataSource.getRepository(Invitation);
    const invitation = await getInvitationByTokenValue(token);
    const now = Date.now();

    if (!invitation || invitation.revokedAt || invitation.completedAt) {
      throw Errors.validation('Invalid or expired invitation');
    }

    if (invitation.deliveryMethod !== 'email') {
      throw Errors.validation('This invitation requires a one-time password');
    }

    if (invitation.status === 'pending' && invitation.expiresAt < now) {
      throw Errors.validation('This invitation has expired');
    }

    if (invitation.status === 'pending') {
      const updateResult = await invitationRepo.createQueryBuilder()
        .update(Invitation)
        .set({
          status: 'otp_verified',
          otpVerifiedAt: now,
          failedAttempts: 0,
          lockedUntil: null,
          updatedAt: now,
        })
        .where('id = :id', { id: invitation.id })
        .andWhere('status = :status', { status: 'pending' })
        .andWhere('delivery_method = :deliveryMethod', { deliveryMethod: 'email' })
        .execute();

      if (!updateResult.affected) {
        const refreshed = await invitationRepo.findOneBy({ id: invitation.id });
        if (!refreshed || refreshed.revokedAt || refreshed.completedAt || refreshed.deliveryMethod !== 'email' || refreshed.status !== 'otp_verified') {
          throw Errors.validation('This invitation is no longer available');
        }
      }
    } else if (invitation.status !== 'otp_verified') {
      throw Errors.validation('This invitation has already been used');
    }

    return {
      invitationId: invitation.id,
      userId: invitation.userId,
      tenantSlug: invitation.tenantSlug,
    };
  }

  async completeInvitation(
    invitationId: string,
    newPassword: string,
    profile?: { firstName?: string; lastName?: string }
  ): Promise<{ user: UserContract; tenantSlug: string }> {
    const dataSource = await getDataSource();
    const invitationRepo = dataSource.getRepository(Invitation);
    const userRepo = dataSource.getRepository(User);
    const invitation = await invitationRepo.findOneBy({ id: invitationId });
    const now = Date.now();
    const firstName = typeof profile?.firstName === 'string' ? profile.firstName.trim() : '';
    const lastName = typeof profile?.lastName === 'string' ? profile.lastName.trim() : '';

    if (!invitation || invitation.revokedAt || invitation.completedAt) {
      throw Errors.validation('Invalid invitation state');
    }

    if (invitation.status !== 'otp_verified' || !invitation.otpVerifiedAt) {
      throw Errors.validation('One-time password verification is required before setting a password');
    }

    const user = await userRepo.findOneBy({ id: invitation.userId });

    if (!user) {
      throw Errors.validation('Invitation user could not be found');
    }

    const passwordHash = await hashPassword(newPassword);

    await dataSource.transaction(async (manager) => {
      await manager.getRepository(User).update({ id: user.id }, {
        passwordHash,
        firstName: firstName || user.firstName || null,
        lastName: lastName || user.lastName || null,
        mustResetPassword: false,
        isEmailVerified: true,
        emailVerificationToken: null,
        emailVerificationTokenExpiry: null,
        failedLoginAttempts: 0,
        lockedUntil: null,
        updatedAt: now,
      });

      if (invitation.resourceType === 'project' && invitation.resourceId) {
        const roles = parseRoles(invitation.resourceRolesJson);
        await projectMemberService.addMember(
          invitation.resourceId,
          user.id,
          roles.length > 0 ? (roles as Array<'delegate' | 'developer' | 'editor' | 'viewer' | 'owner'>) : [String(invitation.resourceRole || 'viewer') as 'delegate' | 'developer' | 'editor' | 'viewer' | 'owner'],
          invitation.createdByUserId || user.createdByUserId || user.id,
        );
      }

      if (invitation.resourceType === 'engine' && invitation.resourceId) {
        await engineService.addEngineMember(
          invitation.resourceId,
          user.id,
          String(invitation.resourceRole || 'operator') as 'operator' | 'deployer',
          invitation.createdByUserId || user.createdByUserId || user.id,
        );
      }

      await revokeOutstandingInvitations(manager.getRepository(Invitation), now, {
        userId: invitation.userId,
        resourceType: invitation.resourceType,
        resourceId: invitation.resourceId || null,
        excludeInvitationId: invitation.id,
      });

      await manager.getRepository(Invitation).update({ id: invitation.id }, {
        status: 'completed',
        completedAt: now,
        updatedAt: now,
      });
    });

    const updatedUser = await userRepo.findOneByOrFail({ id: user.id });

    return {
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        firstName: updatedUser.firstName || undefined,
        lastName: updatedUser.lastName || undefined,
        platformRole: updatedUser.platformRole as PlatformRole,
        isActive: Boolean(updatedUser.isActive),
        isEmailVerified: Boolean(updatedUser.isEmailVerified),
        mustResetPassword: Boolean(updatedUser.mustResetPassword),
        createdAt: updatedUser.createdAt,
        lastLoginAt: updatedUser.lastLoginAt || undefined,
      },
      tenantSlug: invitation.tenantSlug,
    };
  }
}

export const invitationService = new InvitationService();

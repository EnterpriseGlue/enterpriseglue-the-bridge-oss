import { Brackets, In, IsNull, type DataSource, type EntityManager } from 'typeorm';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuditLog } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuditLog.js';
import { AuthzGroup } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroup.js';
import { AuthzGroupMembership } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroupMembership.js';
import { ExternalIdentity } from '@enterpriseglue/shared/infrastructure/persistence/entities/ExternalIdentity.js';
import { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { IdentityProvisioningDirectory } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvisioningDirectory.js';
import { RbacRole } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRole.js';
import { RbacRoleAssignment } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRoleAssignment.js';
import { RefreshToken } from '@enterpriseglue/shared/infrastructure/persistence/entities/RefreshToken.js';
import { ScimUserLink } from '@enterpriseglue/shared/infrastructure/persistence/entities/ScimUserLink.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import type {
  UserAuditResponse,
  UserDirectorySummary,
  UserEffectiveAccessResponse,
  UserIdentityContext,
  UserSessionsResponse,
} from '@enterpriseglue/shared/schemas/platform-admin/user-directory.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { authzGroupService } from './AuthzGroupService.js';
import {
  getActivePlatformAdministratorUserIds,
  PLATFORM_ADMINISTRATORS_GROUP_ID,
} from './PlatformAdministratorMembershipService.js';

type AuthenticationSource = UserDirectorySummary['authenticationSources'][number];
type ProvisioningSource = UserDirectorySummary['provisioningSource'];
type AccessSource = UserEffectiveAccessResponse['lineage'][number]['sourceType'];

function tenantJoin(alias: string, tenantId: string | null): { clause: string; parameters: Record<string, unknown> } {
  return tenantId
    ? { clause: `${alias}.tenantId = :directoryTenantId`, parameters: { directoryTenantId: tenantId } }
    : { clause: `${alias}.tenantId IS NULL`, parameters: {} };
}

function parseObject(value: string | null | undefined): Record<string, unknown> {
  try {
    const parsed = value ? JSON.parse(value) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function userStatus(user: User): UserDirectorySummary['status'] {
  if (!user.isActive) return 'deactivated';
  if ((user.lockedUntil != null && Number(user.lockedUntil) > Date.now()) || Number(user.failedLoginAttempts || 0) > 0) return 'locked';
  if ((user.authProvider || 'local') === 'local' && !user.isEmailVerified && user.lastLoginAt == null) return 'invited';
  return 'active';
}

function accessSource(source: string | null | undefined): AccessSource {
  if (source === 'config') return 'configuration';
  if (source === 'api') return 'api';
  if (source === 'scim') return 'directory_mapping';
  if (source === 'sso') return 'provider_mapping';
  return 'manual';
}

function safeAuthProvider(value: string | null | undefined): AuthenticationSource | null {
  return ['local', 'oidc', 'saml', 'ldap'].includes(value || '') ? value as AuthenticationSource : null;
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

async function writeLifecycleAudit(manager: EntityManager, input: {
  tenantId: string | null;
  actorId: string;
  action: string;
  userId: string;
  reason: string;
  sourceType: ProvisioningSource;
}): Promise<void> {
  await manager.getRepository(AuditLog).insert({
    id: generateId(),
    tenantId: input.tenantId,
    userId: input.actorId,
    action: input.action,
    resourceType: 'user',
    resourceId: input.userId,
    ipAddress: null,
    userAgent: null,
    details: JSON.stringify({ reason: input.reason, sourceType: input.sourceType, outcome: 'success' }),
    createdAt: Date.now(),
  });
}

export class UserDirectoryService {
  constructor(private readonly dataSourceProvider: () => Promise<DataSource> = getDataSource) {}

  private async pageContext(dataSource: DataSource, users: User[], tenantId: string | null) {
    const userIds = users.map((user) => user.id);
    if (userIds.length === 0) {
      return {
        scimByUser: new Map<string, ScimUserLink>(), externalByUser: new Map<string, ExternalIdentity[]>(),
        directories: new Map<string, IdentityProvisioningDirectory>(), providers: new Map<string, IdentityProvider>(),
        platformAdministrators: new Set<string>(),
      };
    }
    const tenantWhere = tenantId ? { tenantId } : { tenantId: IsNull() };
    const [scimLinks, externalIdentities, platformAdministrators] = await Promise.all([
      dataSource.getRepository(ScimUserLink).find({ where: { ...tenantWhere, userId: In(userIds) } }),
      dataSource.getRepository(ExternalIdentity).find({ where: { ...tenantWhere, userId: In(userIds) } }),
      getActivePlatformAdministratorUserIds(userIds, dataSource),
    ]);
    const directoryIds = unique(scimLinks.map((link) => link.directoryId));
    const providerIds = unique(externalIdentities.map((identity) => identity.providerId));
    const [directoryRows, providerRows] = await Promise.all([
      directoryIds.length ? dataSource.getRepository(IdentityProvisioningDirectory).find({ where: { id: In(directoryIds) } }) : [],
      providerIds.length ? dataSource.getRepository(IdentityProvider).find({ where: { id: In(providerIds) } }) : [],
    ]);
    const externalByUser = new Map<string, ExternalIdentity[]>();
    for (const identity of externalIdentities) externalByUser.set(identity.userId, [...(externalByUser.get(identity.userId) || []), identity]);
    return {
      scimByUser: new Map(scimLinks.map((link) => [link.userId, link])),
      externalByUser,
      directories: new Map(directoryRows.map((directory) => [directory.id, directory])),
      providers: new Map(providerRows.map((provider) => [provider.id, provider])),
      platformAdministrators,
    };
  }

  private summary(user: User, context: Awaited<ReturnType<UserDirectoryService['pageContext']>>): UserDirectorySummary {
    const scim = context.scimByUser.get(user.id);
    const directory = scim ? context.directories.get(scim.directoryId) : undefined;
    const external = (context.externalByUser.get(user.id) || []).filter((identity) => identity.status === 'active');
    const authenticationSources = unique([
      ...external.map((identity) => context.providers.get(identity.providerId)?.protocol as AuthenticationSource | undefined),
      safeAuthProvider(user.authProvider),
      ...(context.platformAdministrators.has(user.id) && (user.authProvider || 'local') === 'local' ? ['recovery' as const] : []),
    ].filter((source): source is AuthenticationSource => Boolean(source)));
    if (authenticationSources.length === 0) authenticationSources.push('none');
    const provisioningSource: ProvisioningSource = scim
      ? 'scim'
      : (user.authProvider === 'ldap' ? 'ldap' : external.length > 0 ? 'jit' : 'none');
    const provisioningHealth = !scim
      ? 'not_applicable'
      : scim.status === 'conflict'
        ? 'failed'
        : !directory || directory.status !== 'active' || (Boolean(user.isActive) !== Boolean(scim.active))
          ? 'warning'
          : 'healthy';
    const displayName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.email;
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName,
      status: userStatus(user),
      platformRole: context.platformAdministrators.has(user.id) ? 'admin' : 'user',
      authenticationSources,
      provisioningSource,
      provisioningDirectoryKey: directory?.key || null,
      lastSignInAt: user.lastLoginAt == null ? null : Number(user.lastLoginAt),
      lastProvisionedAt: scim ? Number(scim.lastProvisionedAt) : null,
      provisioningHealth,
    };
  }

  async list(input: {
    tenantId: string | null;
    search?: string;
    status?: UserDirectorySummary['status'];
    authenticationSource?: AuthenticationSource;
    provisioningSource?: ProvisioningSource;
    provisioningDirectoryKey?: string;
    limit: number;
    offset: number;
  }): Promise<{ items: UserDirectorySummary[]; total: number; limit: number; offset: number }> {
    const dataSource = await this.dataSourceProvider();
    const scimTenant = tenantJoin('scim', input.tenantId);
    const externalTenant = tenantJoin('externalIdentity', input.tenantId);
    const providerTenant = tenantJoin('identityProvider', input.tenantId);
    const qb = dataSource.getRepository(User).createQueryBuilder('user')
      .leftJoin(ScimUserLink, 'scim', `scim.userId = user.id AND ${scimTenant.clause}`, scimTenant.parameters)
      .leftJoin(IdentityProvisioningDirectory, 'directory', 'directory.id = scim.directoryId')
      .leftJoin(ExternalIdentity, 'externalIdentity', `externalIdentity.userId = user.id AND externalIdentity.status = :activeIdentity AND ${externalTenant.clause}`, { activeIdentity: 'active', ...externalTenant.parameters })
      .leftJoin(IdentityProvider, 'identityProvider', `identityProvider.id = externalIdentity.providerId AND ${providerTenant.clause}`, providerTenant.parameters)
      .distinct(true);

    if (input.search) {
      qb.andWhere(new Brackets((where) => {
        where.where('LOWER(user.email) LIKE :userSearch')
          .orWhere('LOWER(user.firstName) LIKE :userSearch')
          .orWhere('LOWER(user.lastName) LIKE :userSearch');
      }), { userSearch: `%${input.search.toLowerCase()}%` });
    }
    const now = Date.now();
    if (input.status === 'deactivated') qb.andWhere('user.isActive = :statusActive', { statusActive: false });
    if (input.status === 'locked') qb.andWhere('user.isActive = :statusActive AND (user.lockedUntil > :now OR user.failedLoginAttempts > 0)', { statusActive: true, now });
    if (input.status === 'invited') qb.andWhere("user.isActive = :statusActive AND user.authProvider = 'local' AND user.isEmailVerified = :verified AND user.lastLoginAt IS NULL", { statusActive: true, verified: false });
    if (input.status === 'active') qb.andWhere("user.isActive = :statusActive AND (user.lockedUntil IS NULL OR user.lockedUntil <= :now) AND user.failedLoginAttempts = 0 AND NOT (user.authProvider = 'local' AND user.isEmailVerified = :verified AND user.lastLoginAt IS NULL)", { statusActive: true, verified: false, now });

    if (input.provisioningDirectoryKey) qb.andWhere('directory.key = :directoryKey', { directoryKey: input.provisioningDirectoryKey });
    if (input.provisioningSource === 'scim') qb.andWhere('scim.id IS NOT NULL');
    if (input.provisioningSource === 'ldap') qb.andWhere("user.authProvider = 'ldap'");
    if (input.provisioningSource === 'jit') qb.andWhere("scim.id IS NULL AND externalIdentity.id IS NOT NULL AND user.authProvider <> 'ldap'");
    if (input.provisioningSource === 'none') qb.andWhere("scim.id IS NULL AND externalIdentity.id IS NULL AND user.authProvider <> 'ldap'");

    if (input.authenticationSource === 'none') qb.andWhere("user.authProvider = 'scim' AND externalIdentity.id IS NULL");
    if (input.authenticationSource === 'local') qb.andWhere("user.authProvider = 'local'");
    if (['oidc', 'saml', 'ldap'].includes(input.authenticationSource || '')) {
      qb.andWhere('(user.authProvider = :authSource OR identityProvider.protocol = :authSource)', { authSource: input.authenticationSource });
    }
    if (input.authenticationSource === 'recovery') {
      qb.innerJoin(AuthzGroupMembership, 'recoveryMembership', 'recoveryMembership.userId = user.id AND recoveryMembership.groupId = :recoveryGroupId AND (recoveryMembership.expiresAt IS NULL OR recoveryMembership.expiresAt > :now)', { recoveryGroupId: PLATFORM_ADMINISTRATORS_GROUP_ID, now })
        .andWhere("user.authProvider = 'local'");
    }

    const total = await qb.getCount();
    const users = await qb.orderBy('user.createdAt', 'DESC').skip(input.offset).take(input.limit).getMany();
    const context = await this.pageContext(dataSource, users, input.tenantId);
    return { items: users.map((user) => this.summary(user, context)), total, limit: input.limit, offset: input.offset };
  }

  async identityContext(userId: string, tenantId: string | null): Promise<UserIdentityContext> {
    const dataSource = await this.dataSourceProvider();
    const user = await dataSource.getRepository(User).findOneBy({ id: userId });
    if (!user) throw Errors.notFound('User', userId);
    const context = await this.pageContext(dataSource, [user], tenantId);
    const scim = context.scimByUser.get(userId);
    const directory = scim ? context.directories.get(scim.directoryId) : undefined;
    const external = context.externalByUser.get(userId) || [];
    const linkedIdentities: UserIdentityContext['linkedIdentities'] = [
      ...external.map((identity) => {
        const provider = context.providers.get(identity.providerId);
        return {
          id: identity.id,
          sourceType: 'identity_provider' as const,
          sourceKey: provider?.key || identity.providerId,
          sourceName: provider?.displayName || provider?.key || identity.providerType,
          externalSubject: identity.subjectId,
          status: ['active', 'inactive', 'unlinked', 'archived'].includes(identity.status) ? identity.status as 'active' | 'inactive' | 'unlinked' | 'archived' : 'inactive',
          linkedAt: Number(identity.linkedAt),
          lastSeenAt: identity.lastSeenAt == null ? null : Number(identity.lastSeenAt),
        };
      }),
      ...(scim && directory ? [{
        id: scim.id,
        sourceType: 'provisioning_directory' as const,
        sourceKey: directory.key,
        sourceName: directory.displayName,
        externalSubject: scim.externalId || scim.userName,
        status: scim.status === 'active' ? 'active' as const : scim.status === 'archived' ? 'archived' as const : 'inactive' as const,
        linkedAt: Number(scim.createdAt),
        lastSeenAt: Number(scim.lastProvisionedAt),
      }] : []),
    ];
    const profile = scim ? parseObject(scim.profileJson) : {};
    const profileName = profile.name && typeof profile.name === 'object' ? profile.name as Record<string, unknown> : {};
    const directoryFields = new Set<string>(scim ? ['email', 'active'] : []);
    if (typeof profileName.givenName === 'string') directoryFields.add('firstName');
    if (typeof profileName.familyName === 'string') directoryFields.add('lastName');
    if (typeof profile.displayName === 'string' || typeof profileName.formatted === 'string') directoryFields.add('displayName');
    const fieldOwnership = (['email', 'firstName', 'lastName', 'displayName', 'active'] as const).map((field) => ({
      field,
      owner: directoryFields.has(field) ? 'directory' as const : 'application' as const,
      sourceKey: directoryFields.has(field) ? directory?.key || null : null,
    }));
    return {
      user: this.summary(user, context),
      linkedIdentities,
      fieldOwnership,
      recoveryAdministrator: context.platformAdministrators.has(user.id) && (user.authProvider || 'local') === 'local' && Boolean(user.passwordHash),
    };
  }

  async effectiveAccess(userId: string, tenantId: string | null): Promise<UserEffectiveAccessResponse> {
    const dataSource = await this.dataSourceProvider();
    const user = await dataSource.getRepository(User).findOneBy({ id: userId });
    if (!user) throw Errors.notFound('User', userId);
    const memberships = await dataSource.getRepository(AuthzGroupMembership).find({ where: { userId } });
    const groupIds = unique(memberships.map((membership) => membership.groupId));
    const assignments = await dataSource.getRepository(RbacRoleAssignment).find({
      where: [
        { principalType: 'user', principalId: userId },
        ...(groupIds.length ? [{ principalType: 'group', principalId: In(groupIds) }] : []),
      ],
    });
    const roleIds = unique(assignments.map((assignment) => assignment.roleId));
    const [groups, roles, administrators] = await Promise.all([
      groupIds.length ? dataSource.getRepository(AuthzGroup).find({ where: { id: In(groupIds) } }) : [],
      roleIds.length ? dataSource.getRepository(RbacRole).find({ where: { id: In(roleIds) } }) : [],
      getActivePlatformAdministratorUserIds([userId], dataSource),
    ]);
    const groupsById = new Map(groups.map((group) => [group.id, group]));
    const rolesById = new Map(roles.map((role) => [role.id, role]));
    const now = Date.now();
    const lineage: UserEffectiveAccessResponse['lineage'] = [{
      sourceType: 'manual', sourceId: null, sourceName: 'Platform user compatibility access',
      assignmentType: 'platform_role', assignmentId: `platform-role:${user.id}`,
      assignmentName: administrators.has(user.id) ? 'Platform administrator' : 'Platform user', active: Boolean(user.isActive),
    }];
    for (const membership of memberships) {
      const group = groupsById.get(membership.groupId);
      if (!group) continue;
      lineage.push({
        sourceType: accessSource(membership.source), sourceId: membership.sourceRef,
        sourceName: membership.sourceRef, assignmentType: 'group', assignmentId: group.id,
        assignmentName: group.name, active: !group.isArchived && (membership.expiresAt == null || Number(membership.expiresAt) > now),
      });
    }
    for (const assignment of assignments) {
      const role = rolesById.get(assignment.roleId);
      if (!role) continue;
      const scope = assignment.scopeId ? `${assignment.scopeType} ${assignment.scopeId}` : assignment.scopeType;
      lineage.push({
        sourceType: accessSource(assignment.source), sourceId: assignment.sourceRef, sourceName: assignment.sourceRef,
        assignmentType: 'role', assignmentId: assignment.id, assignmentName: `${role.name} on ${scope}`,
        active: !role.isArchived && (assignment.expiresAt == null || Number(assignment.expiresAt) > now),
      });
    }
    return { userId, platformRole: administrators.has(user.id) ? 'admin' : 'user', lineage, evaluatedAt: now };
  }

  async sessions(userId: string): Promise<UserSessionsResponse> {
    const dataSource = await this.dataSourceProvider();
    const user = await dataSource.getRepository(User).findOneBy({ id: userId });
    if (!user) throw Errors.notFound('User', userId);
    const tokens = await dataSource.getRepository(RefreshToken).find({ where: { userId }, order: { createdAt: 'DESC' } });
    const providerIds = unique(tokens.map((token) => token.identityProviderId).filter((id): id is string => Boolean(id)));
    const providers = providerIds.length ? await dataSource.getRepository(IdentityProvider).find({ where: { id: In(providerIds) } }) : [];
    const providerById = new Map(providers.map((provider) => [provider.id, provider]));
    return {
      userId,
      sessions: tokens.map((token) => {
        const device = parseObject(token.deviceInfo);
        const provider = token.identityProviderId ? providerById.get(token.identityProviderId) : undefined;
        return {
          id: token.id,
          createdAt: Number(token.createdAt),
          lastUsedAt: typeof device.lastUsedAt === 'number' ? device.lastUsedAt : null,
          expiresAt: Number(token.expiresAt),
          revokedAt: token.revokedAt == null ? null : Number(token.revokedAt),
          authenticationSource: (provider?.protocol || safeAuthProvider(user.authProvider) || 'none') as AuthenticationSource,
          ipAddress: typeof device.ipAddress === 'string' ? device.ipAddress.slice(0, 128) : null,
          userAgent: typeof device.userAgent === 'string' ? device.userAgent.slice(0, 1000) : null,
        };
      }),
    };
  }

  async audit(userId: string, limit: number): Promise<UserAuditResponse> {
    const dataSource = await this.dataSourceProvider();
    if (!await dataSource.getRepository(User).exist({ where: { id: userId } })) throw Errors.notFound('User', userId);
    const rows = await dataSource.getRepository(AuditLog).find({
      where: [{ resourceType: 'user', resourceId: userId }, { userId }],
      order: { createdAt: 'DESC' },
      take: limit,
    });
    return {
      userId,
      events: rows.map((row) => {
        const details = parseObject(row.details);
        const outcome = ['success', 'failure', 'denied'].includes(String(details.outcome))
          ? String(details.outcome) as 'success' | 'failure' | 'denied'
          : /fail|denied|reject/i.test(row.action) ? 'failure' : 'success';
        return {
          id: row.id,
          action: row.action,
          outcome,
          actorId: row.userId,
          sourceType: typeof details.sourceType === 'string' ? details.sourceType.slice(0, 128) : null,
          reason: typeof details.reason === 'string' ? details.reason.slice(0, 1000) : null,
          occurredAt: Number(row.createdAt),
        };
      }),
    };
  }

  private async provisioningSource(dataSource: DataSource | EntityManager, userId: string, tenantId: string | null): Promise<ProvisioningSource> {
    const tenantWhere = tenantId ? { tenantId } : { tenantId: IsNull() };
    if (await dataSource.getRepository(ScimUserLink).exist({ where: { ...tenantWhere, userId } })) return 'scim';
    const user = await dataSource.getRepository(User).findOneBy({ id: userId });
    if (user?.authProvider === 'ldap') return 'ldap';
    if (await dataSource.getRepository(ExternalIdentity).exist({ where: { ...tenantWhere, userId, status: 'active' } })) return 'jit';
    return 'none';
  }

  private async assertRecoveryContinuity(dataSource: DataSource, user: User): Promise<void> {
    if ((user.authProvider || 'local') !== 'local' || !user.passwordHash) return;
    const localUsers = await dataSource.getRepository(User).find({
      where: [{ isActive: true, authProvider: 'local' }, { isActive: true, authProvider: IsNull() }],
    });
    const recoveryIds = await getActivePlatformAdministratorUserIds(localUsers.filter((candidate) => Boolean(candidate.passwordHash)).map((candidate) => candidate.id), dataSource);
    if (recoveryIds.has(user.id) && recoveryIds.size <= 1) {
      throw Errors.conflict('Cannot deactivate the last active local recovery administrator');
    }
  }

  async deactivate(input: { userId: string; actorId: string; tenantId: string | null; reason: string }) {
    const dataSource = await this.dataSourceProvider();
    const user = await dataSource.getRepository(User).findOneBy({ id: input.userId });
    if (!user) throw Errors.notFound('User', input.userId);
    await this.assertRecoveryContinuity(dataSource, user);
    const source = await this.provisioningSource(dataSource, input.userId, input.tenantId);
    const changedAt = Date.now();
    const nextVersion = Number(user.authSessionVersion || 0) + 1;
    await dataSource.transaction(async (manager) => {
      await manager.getRepository(User).update({ id: input.userId }, { isActive: false, authSessionVersion: nextVersion, updatedAt: changedAt });
      await authzGroupService.removeAuthenticatedUserMembershipWithManager(manager, input.userId);
      await manager.getRepository(RefreshToken).update({ userId: input.userId }, { revokedAt: changedAt });
      await writeLifecycleAudit(manager, { tenantId: input.tenantId, actorId: input.actorId, action: 'identity.user.deactivate', userId: input.userId, reason: input.reason, sourceType: source });
    });
    return { userId: input.userId, status: 'deactivated' as const, authSessionVersion: nextVersion, changedAt };
  }

  async reactivate(input: { userId: string; actorId: string; tenantId: string | null; reason: string }) {
    const dataSource = await this.dataSourceProvider();
    const user = await dataSource.getRepository(User).findOneBy({ id: input.userId });
    if (!user) throw Errors.notFound('User', input.userId);
    const source = await this.provisioningSource(dataSource, input.userId, input.tenantId);
    if (source === 'scim') throw Errors.conflict('This user is directory-managed. Reactivate the assignment in the authoritative directory.');
    const changedAt = Date.now();
    const nextVersion = Number(user.authSessionVersion || 0) + 1;
    await dataSource.transaction(async (manager) => {
      await manager.getRepository(User).update({ id: input.userId }, { isActive: true, authSessionVersion: nextVersion, updatedAt: changedAt });
      await authzGroupService.ensureAuthenticatedUserMembershipWithManager(manager, input.userId);
      await writeLifecycleAudit(manager, { tenantId: input.tenantId, actorId: input.actorId, action: 'identity.user.reactivate', userId: input.userId, reason: input.reason, sourceType: source });
    });
    return { userId: input.userId, status: 'active' as const, authSessionVersion: nextVersion, changedAt };
  }

  async revokeSessions(input: { userId: string; actorId: string; tenantId: string | null; reason: string }) {
    const dataSource = await this.dataSourceProvider();
    const user = await dataSource.getRepository(User).findOneBy({ id: input.userId });
    if (!user) throw Errors.notFound('User', input.userId);
    const source = await this.provisioningSource(dataSource, input.userId, input.tenantId);
    const changedAt = Date.now();
    const nextVersion = Number(user.authSessionVersion || 0) + 1;
    await dataSource.transaction(async (manager) => {
      await manager.getRepository(User).update({ id: input.userId }, { authSessionVersion: nextVersion, updatedAt: changedAt });
      await manager.getRepository(RefreshToken).update({ userId: input.userId }, { revokedAt: changedAt });
      await writeLifecycleAudit(manager, { tenantId: input.tenantId, actorId: input.actorId, action: 'identity.user.sessions.revoke', userId: input.userId, reason: input.reason, sourceType: source });
    });
    return { userId: input.userId, status: userStatus(user), authSessionVersion: nextVersion, changedAt };
  }
}

export const userDirectoryService = new UserDirectoryService();

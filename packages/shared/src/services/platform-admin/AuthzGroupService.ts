import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuditLog } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuditLog.js';
import { AuthzGroup } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroup.js';
import { AuthzGroupMembership } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroupMembership.js';
import { RbacRoleAssignment } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRoleAssignment.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { SYSTEM_ROLE_IDS } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import { canonicalRoleAssignmentKey } from '@enterpriseglue/shared/authz/role-assignment-identity.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { In, type DataSource, type EntityManager } from 'typeorm';

export type AuthzGroupSource = 'manual' | 'sso' | 'identity_provider' | 'api' | 'automation' | 'system' | 'config';
export type AuthzGroupOwnershipMode = 'manual' | 'config_locked' | 'config_warn';

export interface AuthzGroupView {
  id: string;
  tenantId: string | null;
  key: string;
  name: string;
  description: string | null;
  source: AuthzGroupSource;
  sourceRef: string | null;
  ownershipMode: AuthzGroupOwnershipMode;
  sourceHash: string | null;
  lastAppliedAt: number | null;
  driftStatus: string | null;
  isSystem: boolean;
  isArchived: boolean;
  createdById: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface AuthzGroupMembershipView {
  id: string;
  tenantId: string | null;
  groupId: string;
  groupKey: string | null;
  groupName: string | null;
  userId: string;
  source: AuthzGroupSource;
  sourceRef: string | null;
  expiresAt: number | null;
  createdById: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateAuthzGroupInput {
  tenantId?: string | null;
  key?: string;
  name: string;
  description?: string | null;
  source?: AuthzGroupSource;
  sourceRef?: string | null;
  isSystem?: boolean;
  createdById?: string | null;
}

export interface UpdateAuthzGroupInput {
  tenantId?: string | null;
  name?: string;
  description?: string | null;
  isArchived?: boolean;
  updatedById?: string | null;
}

export interface AddAuthzGroupMembershipInput {
  tenantId?: string | null;
  groupId: string;
  userId: string;
  source?: AuthzGroupSource;
  sourceRef?: string | null;
  expiresAt?: number | null;
  createdById?: string | null;
}

export const DEFAULT_PLATFORM_GROUP_IDS = {
  PLATFORM_ADMINISTRATORS: 'system.group.platform_administrators',
  AUTHENTICATED_USERS: 'system.group.authenticated_users',
  ACCESS_ADMINISTRATORS: 'system.group.access_administrators',
  ACCESS_AUDITORS: 'system.group.access_auditors',
  USER_ADMINISTRATORS: 'system.group.user_administrators',
  SSO_ADMINISTRATORS: 'system.group.sso_administrators',
  ENGINE_REGISTRY_ADMINISTRATORS: 'system.group.engine_registry_administrators',
  API_CLIENT_ADMINISTRATORS: 'system.group.api_client_administrators',
} as const;

const AUTHENTICATED_USER_BASELINE_SOURCE_REF = 'authenticated-user-baseline';
const BOOTSTRAP_PLATFORM_ADMIN_SOURCE_REF = 'bootstrap-platform-administrator';
const MANUAL_PLATFORM_ADMIN_SOURCE_REF = 'manual-platform-administrator';
const LEGACY_PLATFORM_ADMIN_SOURCE_REF = 'legacy-platform-role-administrator';
const LEGACY_SSO_PLATFORM_ADMIN_SOURCE_REF_PREFIX = 'legacy-sso-platform-role:';

export const DEFAULT_PLATFORM_GROUPS = [
  {
    id: DEFAULT_PLATFORM_GROUP_IDS.PLATFORM_ADMINISTRATORS,
    key: 'platform-administrators',
    name: 'Platform Administrators',
    description: 'Bootstrap and full platform administration.',
    roleId: SYSTEM_ROLE_IDS.PLATFORM_ADMIN,
  },
  {
    id: DEFAULT_PLATFORM_GROUP_IDS.AUTHENTICATED_USERS,
    key: 'authenticated-users',
    name: 'Authenticated Users',
    description: 'Baseline group for every active local or SSO user.',
    roleId: SYSTEM_ROLE_IDS.PLATFORM_USER,
  },
  {
    id: DEFAULT_PLATFORM_GROUP_IDS.ACCESS_ADMINISTRATORS,
    key: 'access-administrators',
    name: 'Access Administrators',
    description: 'Day-to-day Access Control administration without full platform admin.',
    roleId: SYSTEM_ROLE_IDS.PLATFORM_ACCESS_ADMIN,
  },
  {
    id: DEFAULT_PLATFORM_GROUP_IDS.ACCESS_AUDITORS,
    key: 'access-auditors',
    name: 'Access Auditors',
    description: 'Read-only authorization and audit review.',
    roleId: SYSTEM_ROLE_IDS.PLATFORM_ACCESS_AUDITOR,
  },
  {
    id: DEFAULT_PLATFORM_GROUP_IDS.USER_ADMINISTRATORS,
    key: 'user-administrators',
    name: 'User Administrators',
    description: 'User lifecycle administration without full platform admin.',
    roleId: SYSTEM_ROLE_IDS.PLATFORM_USER_ADMIN,
  },
  {
    id: DEFAULT_PLATFORM_GROUP_IDS.SSO_ADMINISTRATORS,
    key: 'sso-administrators',
    name: 'SSO Administrators',
    description: 'SSO provider and SSO assignment mapping administration.',
    roleId: SYSTEM_ROLE_IDS.PLATFORM_SSO_ADMIN,
  },
  {
    id: DEFAULT_PLATFORM_GROUP_IDS.ENGINE_REGISTRY_ADMINISTRATORS,
    key: 'engine-registry-administrators',
    name: 'Engine Registry Administrators',
    description: 'Engine inventory, Engine Set, and project-engine target registry administration.',
    roleId: SYSTEM_ROLE_IDS.PLATFORM_ENGINE_REGISTRY_ADMIN,
  },
  {
    id: DEFAULT_PLATFORM_GROUP_IDS.API_CLIENT_ADMINISTRATORS,
    key: 'api-client-administrators',
    name: 'API Client Administrators',
    description: 'API client and service account administration.',
    roleId: SYSTEM_ROLE_IDS.PLATFORM_API_CLIENT_ADMIN,
  },
] as const;

function normalizeTenantId(tenantId?: string | null): string | null {
  const normalized = tenantId?.trim();
  return normalized || null;
}

function groupKeyFromName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toGroupView(group: AuthzGroup): AuthzGroupView {
  return {
    id: group.id,
    tenantId: group.tenantId,
    key: group.key,
    name: group.name,
    description: group.description,
    source: group.source as AuthzGroupSource,
    sourceRef: group.sourceRef,
    ownershipMode: (group.ownershipMode || (group.source === 'config' ? 'config_locked' : 'manual')) as AuthzGroupOwnershipMode,
    sourceHash: group.sourceHash || null,
    lastAppliedAt: group.lastAppliedAt ? Number(group.lastAppliedAt) : null,
    driftStatus: group.driftStatus || null,
    isSystem: group.isSystem,
    isArchived: group.isArchived,
    createdById: group.createdById,
    createdAt: Number(group.createdAt),
    updatedAt: Number(group.updatedAt),
  };
}

async function recordGroupAudit(
  dataSource: DataSource | EntityManager,
  entry: {
    tenantId?: string | null;
    userId?: string | null;
    action: string;
    resourceType: string;
    resourceId: string;
    details?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    await dataSource.getRepository(AuditLog).insert({
      id: generateId(),
      tenantId: normalizeTenantId(entry.tenantId),
      userId: entry.userId || null,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      ipAddress: null,
      userAgent: null,
      details: entry.details ? JSON.stringify(entry.details) : null,
      createdAt: Date.now(),
    });
  } catch (error) {
    logger.error('Failed to write authorization group audit log:', error);
  }
}

export class AuthzGroupService {
  async seedDefaultPlatformGroups(
    providedDataSource?: DataSource,
    now: number = Date.now()
  ): Promise<{ groups: number; assignments: number }> {
    const dataSource = providedDataSource || await getDataSource();
    const groupRepo = dataSource.getRepository(AuthzGroup);
    const assignmentRepo = dataSource.getRepository(RbacRoleAssignment);

    await groupRepo.upsert(
      DEFAULT_PLATFORM_GROUPS.map((group) => ({
        id: group.id,
        tenantId: null,
        key: group.key,
        name: group.name,
        description: group.description,
        source: 'system',
        sourceRef: 'default-platform-groups',
        isSystem: true,
        isArchived: false,
        createdById: null,
        createdAt: now,
        updatedAt: now,
      })),
      { conflictPaths: ['id'], skipUpdateIfNoValuesChanged: true }
    );

    await assignmentRepo.upsert(
      DEFAULT_PLATFORM_GROUPS.map((group) => ({
        id: `bootstrap.assignment.${group.id}.${group.roleId}`,
        tenantId: null,
        userId: null,
        principalType: 'group',
        principalId: group.id,
        assignmentKey: canonicalRoleAssignmentKey({
          tenantId: null,
          principalType: 'group',
          principalId: group.id,
          roleId: group.roleId,
          scopeType: 'platform',
          scopeId: null,
          source: 'bootstrap',
          sourceRef: 'default-platform-groups',
        }),
        roleId: group.roleId,
        resourceType: null,
        resourceId: null,
        scopeType: 'platform',
        scopeId: null,
        source: 'bootstrap',
        sourceMappingId: null,
        sourceRef: 'default-platform-groups',
        expiresAt: null,
        lastSeenAt: null,
        createdById: null,
        createdAt: now,
        updatedAt: now,
      })),
      { conflictPaths: ['id'], skipUpdateIfNoValuesChanged: true }
    );

    return {
      groups: DEFAULT_PLATFORM_GROUPS.length,
      assignments: DEFAULT_PLATFORM_GROUPS.length,
    };
  }

  async listGroups(filters: { tenantId?: string | null; includeArchived?: boolean } = {}): Promise<AuthzGroupView[]> {
    const dataSource = await getDataSource();
    const qb = dataSource.getRepository(AuthzGroup)
      .createQueryBuilder('group')
      .orderBy('group.name', 'ASC');
    const tenantId = normalizeTenantId(filters.tenantId);
    if (tenantId) {
      qb.andWhere('(group.tenantId = :tenantId OR group.tenantId IS NULL)', { tenantId });
    }
    if (!filters.includeArchived) {
      qb.andWhere('group.isArchived = :isArchived', { isArchived: false });
    }
    const groups = await qb.getMany();
    return groups.map(toGroupView);
  }

  async createGroup(input: CreateAuthzGroupInput, store?: DataSource | EntityManager): Promise<{ id: string }> {
    const name = input.name.trim();
    if (!name) throw Errors.validation('Group name is required');
    const key = (input.key?.trim() || groupKeyFromName(name));
    if (!key) throw Errors.validation('Group key is required');

    const tenantId = normalizeTenantId(input.tenantId);
    const dataSource = store || await getDataSource();
    const repo = dataSource.getRepository(AuthzGroup);
    const duplicateQb = repo.createQueryBuilder('group')
      .where('group.key = :key', { key });
    if (tenantId) {
      duplicateQb.andWhere('group.tenantId = :tenantId', { tenantId });
    } else {
      duplicateQb.andWhere('group.tenantId IS NULL');
    }
    if (await duplicateQb.getOne()) {
      throw Errors.conflict('Group key already exists');
    }

    const id = generateId();
    const now = Date.now();
    await repo.insert({
      id,
      tenantId,
      key,
      name,
      description: input.description?.trim() || null,
      source: input.source || 'manual',
      sourceRef: input.sourceRef || null,
      ownershipMode: input.source === 'config' ? 'config_locked' : 'manual',
      sourceHash: null,
      lastAppliedAt: null,
      driftStatus: null,
      isSystem: Boolean(input.isSystem),
      isArchived: false,
      createdById: input.createdById || null,
      createdAt: now,
      updatedAt: now,
    });
    await recordGroupAudit(dataSource, {
      tenantId,
      userId: input.createdById || null,
      action: 'authz.group.create',
      resourceType: 'authz_group',
      resourceId: id,
      details: {
        groupId: id,
        tenantId,
        key,
        name,
        source: input.source || 'manual',
        sourceRef: input.sourceRef || null,
        isSystem: Boolean(input.isSystem),
      },
    });
    return { id };
  }

  async updateGroup(id: string, input: UpdateAuthzGroupInput): Promise<void> {
    const dataSource = await getDataSource();
    const repo = dataSource.getRepository(AuthzGroup);
    const group = await repo.findOneBy({ id });
    if (!group) throw Errors.notFound('Group');
    if (group.isSystem && input.isArchived) {
      throw Errors.validation('System groups cannot be archived');
    }
    const isConfigWarn = group.source === 'config' && group.ownershipMode === 'config_warn';
    if (group.source !== 'manual' && !isConfigWarn) {
      throw Errors.forbidden('Source-managed groups must be updated by their source');
    }

    const isArchive = input.isArchived === true && !group.isArchived;
    await repo.update({ id }, {
      name: input.name?.trim() || group.name,
      description: input.description !== undefined ? input.description?.trim() || null : group.description,
      isArchived: input.isArchived ?? group.isArchived,
      ...(isConfigWarn ? { driftStatus: 'drifted' } : {}),
      updatedAt: Date.now(),
    });
    await recordGroupAudit(dataSource, {
      tenantId: group.tenantId,
      userId: input.updatedById || null,
      action: isArchive ? 'authz.group.archive' : 'authz.group.update',
      resourceType: 'authz_group',
      resourceId: id,
      details: {
        groupId: id,
        tenantId: group.tenantId,
        key: group.key,
        previousName: group.name,
        nextName: input.name?.trim() || group.name,
        isArchived: input.isArchived ?? group.isArchived,
        ownershipMode: group.ownershipMode || 'manual',
        driftStatus: isConfigWarn ? 'drifted' : group.driftStatus || null,
      },
    });
  }

  async listMemberships(filters: { tenantId?: string | null; groupId?: string; userId?: string } = {}): Promise<AuthzGroupMembershipView[]> {
    const dataSource = await getDataSource();
    const qb = dataSource.getRepository(AuthzGroupMembership)
      .createQueryBuilder('membership')
      .orderBy('membership.createdAt', 'DESC');
    const tenantId = normalizeTenantId(filters.tenantId);
    if (tenantId) {
      qb.andWhere('(membership.tenantId = :tenantId OR membership.tenantId IS NULL)', { tenantId });
    }
    if (filters.groupId) {
      qb.andWhere('membership.groupId = :groupId', { groupId: filters.groupId });
    }
    if (filters.userId) {
      qb.andWhere('membership.userId = :userId', { userId: filters.userId });
    }

    const memberships = await qb.getMany();
    const groupIds = Array.from(new Set(memberships.map((membership) => membership.groupId)));
    const groups = groupIds.length
      ? await dataSource.getRepository(AuthzGroup).find({ where: { id: In(groupIds) } })
      : [];
    const groupsById = new Map(groups.map((group) => [group.id, group]));

    return memberships.map((membership) => {
      const group = groupsById.get(membership.groupId);
      return {
        id: membership.id,
        tenantId: membership.tenantId,
        groupId: membership.groupId,
        groupKey: group?.key || null,
        groupName: group?.name || null,
        userId: membership.userId,
        source: membership.source as AuthzGroupSource,
        sourceRef: membership.sourceRef,
        expiresAt: membership.expiresAt,
        createdById: membership.createdById,
        createdAt: Number(membership.createdAt),
        updatedAt: Number(membership.updatedAt),
      };
    });
  }

  async addMembership(input: AddAuthzGroupMembershipInput): Promise<{ id: string }> {
    const tenantId = normalizeTenantId(input.tenantId);
    const dataSource = await getDataSource();
    const group = await dataSource.getRepository(AuthzGroup).findOneBy({ id: input.groupId });
    if (!group || group.isArchived) throw Errors.notFound('Group');
    if (group.source !== 'manual') {
      throw Errors.forbidden('Source-managed group memberships must be updated by their source');
    }
    if (tenantId && group.tenantId && group.tenantId !== tenantId) {
      throw Errors.forbidden('Group is not available in this tenant');
    }
    const user = await dataSource.getRepository(User).findOne({ where: { id: input.userId }, select: ['id'] });
    if (!user) throw Errors.notFound('User');

    const source = input.source || 'manual';
    const sourceRef = input.sourceRef || null;
    const repo = dataSource.getRepository(AuthzGroupMembership);
    const duplicateQb = repo.createQueryBuilder('membership')
      .where('membership.groupId = :groupId', { groupId: input.groupId })
      .andWhere('membership.userId = :userId', { userId: input.userId })
      .andWhere('membership.source = :source', { source });
    if (sourceRef) {
      duplicateQb.andWhere('membership.sourceRef = :sourceRef', { sourceRef });
    } else {
      duplicateQb.andWhere('membership.sourceRef IS NULL');
    }
    const existing = await duplicateQb.getOne();
    if (existing) return { id: existing.id };

    const id = generateId();
    const now = Date.now();
    await repo.insert({
      id,
      tenantId,
      groupId: input.groupId,
      userId: input.userId,
      source,
      sourceRef,
      expiresAt: input.expiresAt ?? null,
      createdById: input.createdById || null,
      createdAt: now,
      updatedAt: now,
    });
    await recordGroupAudit(dataSource, {
      tenantId,
      userId: input.createdById || null,
      action: 'authz.group_membership.create',
      resourceType: 'authz_group_membership',
      resourceId: id,
      details: {
        membershipId: id,
        tenantId,
        groupId: input.groupId,
        userId: input.userId,
        source,
        sourceRef,
        expiresAt: input.expiresAt ?? null,
      },
    });
    return { id };
  }

  /**
   * Adds the non-privileged platform baseline for an authenticated identity.
   * This is intentionally source-managed and transaction-bound so provisioning
   * cannot leave a user account without the group-backed platform-user grant.
   */
  async ensureAuthenticatedUserMembershipWithManager(
    manager: EntityManager,
    userId: string
  ): Promise<{ id: string; created: boolean }> {
    return this.ensureSystemGroupMembershipWithManager(
      manager,
      DEFAULT_PLATFORM_GROUP_IDS.AUTHENTICATED_USERS,
      userId,
      AUTHENTICATED_USER_BASELINE_SOURCE_REF
    );
  }

  async ensureLegacyPlatformAdministratorMembershipWithManager(
    manager: EntityManager,
    userId: string
  ): Promise<{ id: string; created: boolean }> {
    return this.ensureSystemGroupMembershipWithManager(
      manager,
      DEFAULT_PLATFORM_GROUP_IDS.PLATFORM_ADMINISTRATORS,
      userId,
      LEGACY_PLATFORM_ADMIN_SOURCE_REF
    );
  }

  async ensureBootstrapPlatformAdministratorMembershipWithManager(
    manager: EntityManager,
    userId: string
  ): Promise<{ id: string; created: boolean }> {
    return this.ensureSystemGroupMembershipWithManager(
      manager,
      DEFAULT_PLATFORM_GROUP_IDS.PLATFORM_ADMINISTRATORS,
      userId,
      BOOTSTRAP_PLATFORM_ADMIN_SOURCE_REF
    );
  }

  async ensureManualPlatformAdministratorMembershipWithManager(
    manager: EntityManager,
    userId: string
  ): Promise<{ id: string; created: boolean }> {
    return this.ensureSystemGroupMembershipWithManager(
      manager,
      DEFAULT_PLATFORM_GROUP_IDS.PLATFORM_ADMINISTRATORS,
      userId,
      MANUAL_PLATFORM_ADMIN_SOURCE_REF,
      'manual'
    );
  }

  async removeManualPlatformAdministratorMembershipWithManager(
    manager: EntityManager,
    userId: string
  ): Promise<{ removed: boolean }> {
    return this.removeSystemGroupMembershipWithManager(
      manager,
      DEFAULT_PLATFORM_GROUP_IDS.PLATFORM_ADMINISTRATORS,
      userId,
      MANUAL_PLATFORM_ADMIN_SOURCE_REF,
      'manual'
    );
  }

  /**
   * Keeps a legacy SSO role mapping effective through the canonical platform
   * administrator group. The provider-specific source reference ensures one
   * SSO provider cannot remove a grant managed by another source.
   */
  async syncLegacySsoPlatformAdministratorMembershipWithManager(
    manager: EntityManager,
    userId: string,
    providerId: string,
    role: 'admin' | 'user'
  ): Promise<{ created: boolean; removed: boolean }> {
    const normalizedProviderId = providerId.trim();
    if (!normalizedProviderId) {
      throw new Error('SSO provider identifier is required for legacy role synchronization');
    }

    const sourceRef = `${LEGACY_SSO_PLATFORM_ADMIN_SOURCE_REF_PREFIX}${normalizedProviderId}`;
    if (role === 'admin') {
      const membership = await this.ensureSystemGroupMembershipWithManager(
        manager,
        DEFAULT_PLATFORM_GROUP_IDS.PLATFORM_ADMINISTRATORS,
        userId,
        sourceRef,
        'sso'
      );
      return { created: membership.created, removed: false };
    }

    const membershipRepo = manager.getRepository(AuthzGroupMembership);
    const membership = await membershipRepo.findOneBy({
      groupId: DEFAULT_PLATFORM_GROUP_IDS.PLATFORM_ADMINISTRATORS,
      userId,
      source: 'sso',
      sourceRef,
    });
    if (!membership) return { created: false, removed: false };

    await membershipRepo.delete({ id: membership.id });
    await recordGroupAudit(manager, {
      tenantId: null,
      userId: null,
      action: 'authz.group_membership.legacy_sso_platform_admin_remove',
      resourceType: 'authz_group_membership',
      resourceId: membership.id,
      details: {
        membershipId: membership.id,
        groupId: DEFAULT_PLATFORM_GROUP_IDS.PLATFORM_ADMINISTRATORS,
        userId,
        source: 'sso',
        sourceRef,
      },
    });
    return { created: false, removed: true };
  }

  async removeLegacyPlatformAdministratorMembershipWithManager(
    manager: EntityManager,
    userId: string
  ): Promise<{ removed: boolean }> {
    return this.removeSystemGroupMembershipWithManager(
      manager,
      DEFAULT_PLATFORM_GROUP_IDS.PLATFORM_ADMINISTRATORS,
      userId,
      LEGACY_PLATFORM_ADMIN_SOURCE_REF,
      'system'
    );
  }

  async backfillAuthenticatedUserMemberships(
    providedDataSource?: DataSource,
    now: number = Date.now()
  ): Promise<{ scanned: number; created: number }> {
    const dataSource = providedDataSource || await getDataSource();
    return dataSource.transaction(async (manager) => {
      const group = await manager.getRepository(AuthzGroup).findOneBy({ id: DEFAULT_PLATFORM_GROUP_IDS.AUTHENTICATED_USERS });
      if (!group || group.isArchived || group.source !== 'system' || group.tenantId !== null) {
        throw new Error('Authenticated users system group is unavailable');
      }

      const users = await manager.getRepository(User).find({
        where: { isActive: true },
        select: ['id'],
      });
      const userIds = users.map((user) => user.id);
      if (userIds.length === 0) return { scanned: 0, created: 0 };

      const membershipRepo = manager.getRepository(AuthzGroupMembership);
      const existing = await membershipRepo.find({
        where: {
          groupId: group.id,
          source: 'system',
          sourceRef: AUTHENTICATED_USER_BASELINE_SOURCE_REF,
        },
        select: ['userId'],
      });
      const existingUserIds = new Set(existing.map((membership) => membership.userId));
      const missingUserIds = userIds.filter((userId) => !existingUserIds.has(userId));
      if (missingUserIds.length === 0) return { scanned: userIds.length, created: 0 };

      await membershipRepo.insert(missingUserIds.map((userId) => ({
        id: generateId(),
        tenantId: null,
        groupId: group.id,
        userId,
        source: 'system',
        sourceRef: AUTHENTICATED_USER_BASELINE_SOURCE_REF,
        expiresAt: null,
        createdById: null,
        createdAt: now,
        updatedAt: now,
      })));
      await recordGroupAudit(manager, {
        tenantId: null,
        userId: null,
        action: 'authz.group_membership.backfill',
        resourceType: 'authz_group',
        resourceId: group.id,
        details: {
          groupId: group.id,
          source: 'system',
          sourceRef: AUTHENTICATED_USER_BASELINE_SOURCE_REF,
          scanned: userIds.length,
          created: missingUserIds.length,
        },
      });
      return { scanned: userIds.length, created: missingUserIds.length };
    });
  }

  async backfillLegacyPlatformAdministratorMemberships(
    providedDataSource?: DataSource,
    now: number = Date.now()
  ): Promise<{ scanned: number; created: number }> {
    const dataSource = providedDataSource || await getDataSource();
    return this.backfillSystemGroupMemberships(dataSource, {
      groupId: DEFAULT_PLATFORM_GROUP_IDS.PLATFORM_ADMINISTRATORS,
      sourceRef: LEGACY_PLATFORM_ADMIN_SOURCE_REF,
      userWhere: { isActive: true, platformRole: 'admin' },
      now,
      auditAction: 'authz.group_membership.legacy_platform_admin_backfill',
    });
  }

  private async backfillSystemGroupMemberships(
    dataSource: DataSource,
    input: {
      groupId: string;
      sourceRef: string;
      userWhere: Record<string, unknown>;
      now: number;
      auditAction: string;
    }
  ): Promise<{ scanned: number; created: number }> {
    return dataSource.transaction(async (manager) => {
      const group = await manager.getRepository(AuthzGroup).findOneBy({ id: input.groupId });
      if (!group || group.isArchived || group.source !== 'system' || group.tenantId !== null) {
        throw new Error('Required system authorization group is unavailable');
      }

      const users = await manager.getRepository(User).find({
        where: input.userWhere as any,
        select: ['id'],
      });
      const userIds = users.map((user) => user.id);
      if (userIds.length === 0) return { scanned: 0, created: 0 };

      const membershipRepo = manager.getRepository(AuthzGroupMembership);
      const existing = await membershipRepo.find({
        where: {
          groupId: group.id,
          source: 'system',
          sourceRef: input.sourceRef,
        },
        select: ['userId'],
      });
      const existingUserIds = new Set(existing.map((membership) => membership.userId));
      const missingUserIds = userIds.filter((userId) => !existingUserIds.has(userId));
      if (missingUserIds.length === 0) return { scanned: userIds.length, created: 0 };

      await membershipRepo.insert(missingUserIds.map((userId) => ({
        id: generateId(),
        tenantId: null,
        groupId: group.id,
        userId,
        source: 'system',
        sourceRef: input.sourceRef,
        expiresAt: null,
        createdById: null,
        createdAt: input.now,
        updatedAt: input.now,
      })));
      await recordGroupAudit(manager, {
        tenantId: null,
        userId: null,
        action: input.auditAction,
        resourceType: 'authz_group',
        resourceId: group.id,
        details: {
          groupId: group.id,
          source: 'system',
          sourceRef: input.sourceRef,
          scanned: userIds.length,
          created: missingUserIds.length,
        },
      });
      return { scanned: userIds.length, created: missingUserIds.length };
    });
  }

  private async ensureSystemGroupMembershipWithManager(
    manager: EntityManager,
    groupId: string,
    userId: string,
    sourceRef: string,
    source: Extract<AuthzGroupSource, 'manual' | 'sso' | 'system'> = 'system'
  ): Promise<{ id: string; created: boolean }> {
    const groupRepo = manager.getRepository(AuthzGroup);
    const group = await groupRepo.findOneBy({ id: groupId });
    if (!group || group.isArchived || group.source !== 'system' || group.tenantId !== null) {
      throw new Error('Required system authorization group is unavailable');
    }

    const membershipRepo = manager.getRepository(AuthzGroupMembership);
    const existing = await membershipRepo.findOneBy({
      groupId: group.id,
      userId,
      source,
      sourceRef,
    });
    if (existing) return { id: existing.id, created: false };

    const id = generateId();
    const now = Date.now();
    await membershipRepo.insert({
      id,
      tenantId: null,
      groupId: group.id,
      userId,
      source,
      sourceRef,
      expiresAt: null,
      createdById: null,
      createdAt: now,
      updatedAt: now,
    });
    await recordGroupAudit(manager, {
      tenantId: null,
      userId: null,
      action: 'authz.group_membership.authenticate',
      resourceType: 'authz_group_membership',
      resourceId: id,
      details: {
        membershipId: id,
        groupId: group.id,
        userId,
        source,
        sourceRef,
      },
    });
    return { id, created: true };
  }

  private async removeSystemGroupMembershipWithManager(
    manager: EntityManager,
    groupId: string,
    userId: string,
    sourceRef: string,
    source: Extract<AuthzGroupSource, 'manual' | 'sso' | 'system'>
  ): Promise<{ removed: boolean }> {
    const membershipRepo = manager.getRepository(AuthzGroupMembership);
    const membership = await membershipRepo.findOneBy({ groupId, userId, source, sourceRef });
    if (!membership) return { removed: false };

    await membershipRepo.delete({ id: membership.id });
    await recordGroupAudit(manager, {
      tenantId: null,
      userId: null,
      action: 'authz.group_membership.remove',
      resourceType: 'authz_group_membership',
      resourceId: membership.id,
      details: { membershipId: membership.id, groupId, userId, source, sourceRef },
    });
    return { removed: true };
  }

  async removeMembership(id: string, removedById?: string | null): Promise<void> {
    const dataSource = await getDataSource();
    const repo = dataSource.getRepository(AuthzGroupMembership);
    const membership = await repo.findOneBy({ id });
    if (!membership) throw Errors.notFound('Group membership');
    if (membership.source !== 'manual') {
      throw Errors.forbidden('Source-managed group memberships must be updated by their source');
    }
    const group = await dataSource.getRepository(AuthzGroup).findOneBy({ id: membership.groupId });
    if (!group || group.source !== 'manual') {
      throw Errors.forbidden('Source-managed group memberships must be updated by their source');
    }
    await repo.delete({ id });
    await recordGroupAudit(dataSource, {
      tenantId: membership.tenantId,
      userId: removedById || null,
      action: 'authz.group_membership.delete',
      resourceType: 'authz_group_membership',
      resourceId: id,
      details: {
        membershipId: id,
        tenantId: membership.tenantId,
        groupId: membership.groupId,
        userId: membership.userId,
        source: membership.source,
        sourceRef: membership.sourceRef,
      },
    });
  }

  async getUserGroupIds(userId: string, tenantId?: string | null): Promise<string[]> {
    const dataSource = await getDataSource();
    const now = Date.now();
    const qb = dataSource.getRepository(AuthzGroupMembership)
      .createQueryBuilder('membership')
      .innerJoin(AuthzGroup, 'group', 'group.id = membership.groupId')
      .where('membership.userId = :userId', { userId })
      .andWhere('(membership.expiresAt IS NULL OR membership.expiresAt > :now)', { now })
      .andWhere('group.isArchived = :isArchived', { isArchived: false });
    const normalizedTenantId = normalizeTenantId(tenantId);
    if (normalizedTenantId) {
      qb.andWhere('(membership.tenantId = :tenantId OR membership.tenantId IS NULL)', { tenantId: normalizedTenantId });
      qb.andWhere('(group.tenantId = :tenantId OR group.tenantId IS NULL)', { tenantId: normalizedTenantId });
    }

    const memberships = await qb.getMany();
    return Array.from(new Set(memberships.map((membership) => membership.groupId))).sort();
  }
}

export const authzGroupService = new AuthzGroupService();

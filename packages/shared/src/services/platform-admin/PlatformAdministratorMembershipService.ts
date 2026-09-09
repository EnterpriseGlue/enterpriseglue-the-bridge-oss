import { AuthzGroupMembership } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroupMembership.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { IsNull, type DataSource, type EntityManager } from 'typeorm';
import { runWithPlatformDatabaseCapability } from '../platform-database-context.js';
import { config } from '@enterpriseglue/shared/config/index.js';

export const PLATFORM_ADMINISTRATORS_GROUP_ID = 'system.group.platform_administrators';

/**
 * Compatibility projection for endpoints that still expose `platformRole`.
 * Authorization itself uses assignments and permissions, never this value.
 */
export async function getActivePlatformAdministratorUserIds(
  userIds: string[],
  providedDataSource?: DataSource | EntityManager,
  now: number = Date.now(),
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const dataSource = providedDataSource || await getDataSource();
  const memberships = (await Promise.all(userIds.map(userId => runWithPlatformDatabaseCapability({kind:'authenticated-account',userId}, () => dataSource.getRepository(AuthzGroupMembership).find({
    where: {
      tenantId: IsNull(),
      groupId: PLATFORM_ADMINISTRATORS_GROUP_ID,
      userId,
    },
    select: ['userId', 'expiresAt'],
  }))))).flat();
  return new Set(
    memberships
      .filter((membership) => membership.expiresAt === null || Number(membership.expiresAt) > now)
      .map((membership) => String(membership.userId))
  );
}

/**
 * Returns only the deployment-level setup witness. In pooled mode the
 * temporary capability can read active, global platform-administrator rows,
 * while this service boundary exposes no membership identifiers or directory.
 */
export async function hasActivePlatformAdministrator(
  providedDataSource?: DataSource | EntityManager,
  now: number = Date.now(),
): Promise<boolean> {
  const dataSource = providedDataSource || await getDataSource();
  const exists = () => dataSource.getRepository(AuthzGroupMembership)
    .createQueryBuilder('membership')
    .innerJoin(User, 'administrator', 'administrator.id = membership.userId AND administrator.isActive = :active', { active: true })
    .where({ tenantId: IsNull(), groupId: PLATFORM_ADMINISTRATORS_GROUP_ID })
    .andWhere('(membership.expiresAt IS NULL OR membership.expiresAt > :now)', { now })
    .getExists();
  return config.tenancyMode === 'pooled'
    ? runWithPlatformDatabaseCapability({ kind: 'administrator-status' }, exists)
    : exists();
}

/**
 * Claims one current administrator-membership row for the surrounding
 * transaction. The no-op update serializes administrator removal with
 * break-glass session issue across replicas.
 * Call only after local password verification. Pooled PostgreSQL needs an
 * UPDATE policy even for SELECT FOR UPDATE, so the temporary write capability
 * is bound to every persisted field of the already-read row, allowing no-op
 * claims only. It is revoked before session issue continues.
 */
export async function claimActivePlatformAdministratorMembership(
  userId: string,
  manager: EntityManager,
  now: number = Date.now(),
): Promise<boolean> {
  const repo = manager.getRepository(AuthzGroupMembership);
  const pooled = config.tenancyMode === 'pooled';
  const memberships = pooled
    ? await runWithPlatformDatabaseCapability({ kind: 'authenticated-account', userId }, () => repo.find({
      where: { tenantId: IsNull(), groupId: PLATFORM_ADMINISTRATORS_GROUP_ID, userId },
    }))
    : await repo.find({ where: { groupId: PLATFORM_ADMINISTRATORS_GROUP_ID, userId } });
  for (const membership of memberships) {
    if (membership.expiresAt !== null && Number(membership.expiresAt) <= now) continue;
    if (pooled && (membership.tenantId !== null || membership.groupId !== PLATFORM_ADMINISTRATORS_GROUP_ID || membership.userId !== userId)) continue;
    const update = () => repo.update({ id: membership.id, updatedAt: membership.updatedAt }, { updatedAt: membership.updatedAt });
    const claim = pooled ? await runWithPlatformDatabaseCapability({
      kind: 'administrator-recovery-claim', userId, membershipId: membership.id,
      source: membership.source, sourceRef: membership.sourceRef,
      expiresAt: membership.expiresAt === null ? null : String(membership.expiresAt),
      createdById: membership.createdById, createdAt: String(membership.createdAt), updatedAt: String(membership.updatedAt),
    }, update) : await update();
    if (claim.affected === 1) return true;
  }
  return false;
}

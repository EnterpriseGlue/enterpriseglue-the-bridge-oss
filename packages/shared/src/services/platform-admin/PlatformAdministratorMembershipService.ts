import { AuthzGroupMembership } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroupMembership.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { In, type DataSource, type EntityManager } from 'typeorm';

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
  const memberships = await dataSource.getRepository(AuthzGroupMembership).find({
    where: {
      groupId: PLATFORM_ADMINISTRATORS_GROUP_ID,
      userId: In(userIds),
    },
    select: ['userId', 'expiresAt'],
  });
  return new Set(
    memberships
      .filter((membership) => membership.expiresAt === null || Number(membership.expiresAt) > now)
      .map((membership) => String(membership.userId))
  );
}

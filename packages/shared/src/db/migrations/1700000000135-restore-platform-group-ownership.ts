import { In, IsNull, type MigrationInterface, type QueryRunner } from 'typeorm';
import { AuthzGroup } from '../../infrastructure/persistence/entities/AuthzGroup.js';
import { AuthzGroupMembership } from '../../infrastructure/persistence/entities/AuthzGroupMembership.js';
import { LEGACY_PLATFORM_GROUP_IDS } from './support/platform-group-ownership.js';

/** Repairs only the reserved global groups incorrectly scoped by migration 125. */
export class RestorePlatformGroupOwnership1700000000135 implements MigrationInterface {
  name = 'RestorePlatformGroupOwnership1700000000135';

  async up(queryRunner: QueryRunner): Promise<void> {
    const groups = queryRunner.manager.getRepository(AuthzGroup);
    const canonicalGroups = {
      id: In(LEGACY_PLATFORM_GROUP_IDS),
      source: 'system',
      sourceRef: 'default-platform-groups',
      isSystem: true,
    };
    await groups.update({ ...canonicalGroups, tenantId: 'tenant-default' }, { tenantId: null });
    const globalGroups = await groups.find({
      where: { ...canonicalGroups, tenantId: IsNull() },
      select: ['id'],
    });
    const globalGroupIds = new Set(globalGroups.map((group) => group.id));
    // A default-tenant row alone cannot prove former global authority. Restore
    // only provenance emitted by the canonical global membership services.
    const knownMemberships = [
      { groupId: 'system.group.platform_administrators', source: 'system', sourceRef: 'bootstrap-platform-administrator' },
      { groupId: 'system.group.platform_administrators', source: 'system', sourceRef: 'legacy-platform-role-administrator' },
      { groupId: 'system.group.platform_administrators', source: 'manual', sourceRef: 'manual-platform-administrator' },
      { groupId: 'system.group.authenticated_users', source: 'system', sourceRef: 'authenticated-user-baseline' },
    ];
    const memberships = queryRunner.manager.getRepository(AuthzGroupMembership);
    for (const provenance of knownMemberships) {
      if (!globalGroupIds.has(provenance.groupId)) continue;
      await memberships.update({ ...provenance, tenantId: 'tenant-default' }, { tenantId: null });
    }
  }

  async down(): Promise<void> {
    // Restoring corrupted ownership must not re-scope platform authority.
    // Membership sources, expiry, revocations and tenant assignments are unchanged.
  }
}

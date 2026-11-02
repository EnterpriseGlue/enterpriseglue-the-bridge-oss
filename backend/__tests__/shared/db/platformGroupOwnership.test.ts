import { afterEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { AuthzGroup } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroup.js';
import { AuthzGroupMembership } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroupMembership.js';
import { BackfillNativeTenantOwnership1700000000125 } from '@enterpriseglue/shared/db/migrations/1700000000125-backfill-native-tenant-ownership.js';
import { RestorePlatformGroupOwnership1700000000135 } from '@enterpriseglue/shared/db/migrations/1700000000135-restore-platform-group-ownership.js';
import { LEGACY_PLATFORM_GROUP_IDS } from '@enterpriseglue/shared/db/migrations/support/platform-group-ownership.js';
import { DEFAULT_PLATFORM_GROUPS } from '@enterpriseglue/shared/services/platform-admin/AuthzGroupService.js';
import { getActivePlatformAdministratorUserIds } from '@enterpriseglue/shared/services/platform-admin/PlatformAdministratorMembershipService.js';

let source: DataSource;
const adminGroup = 'system.group.platform_administrators';

afterEach(async () => { if (source?.isInitialized) await source.destroy(); });

async function fixture() {
  source = new DataSource({ type: 'sqljs', entities: [AuthzGroup, AuthzGroupMembership], synchronize: true });
  await source.initialize();
  await source.getRepository(AuthzGroup).insert([
    { id: adminGroup, key: 'platform-administrators', groupKeyIdentity: 'platform:platform-administrators', name: 'Platform Administrators', tenantId: null, source: 'system', sourceRef: 'default-platform-groups', isSystem: true, createdAt: 1, updatedAt: 1 },
    { id: 'tenant-admins', key: 'tenant-admins', groupKeyIdentity: 'platform:tenant-admins', name: 'Tenant Administrators', tenantId: null, source: 'manual', createdAt: 1, updatedAt: 1 },
  ]);
  await source.getRepository(AuthzGroupMembership).insert([
    { id: 'active', groupId: adminGroup, userId: 'admin', tenantId: null, source: 'manual', sourceRef: 'manual-platform-administrator', expiresAt: null, createdAt: 1, updatedAt: 1 },
    { id: 'expired', groupId: adminGroup, userId: 'expired-admin', tenantId: null, source: 'manual', sourceRef: 'manual-platform-administrator', expiresAt: 2, createdAt: 1, updatedAt: 1 },
    { id: 'tenant', groupId: 'tenant-admins', userId: 'tenant-admin', tenantId: null, source: 'manual', sourceRef: null, expiresAt: null, createdAt: 1, updatedAt: 1 },
    { id: 'sibling', groupId: adminGroup, userId: 'sibling-admin', tenantId: 'tenant-other', source: 'manual', sourceRef: null, expiresAt: null, createdAt: 1, updatedAt: 1 },
    { id: 'lookalike', groupId: adminGroup, userId: 'lookalike-admin', tenantId: 'tenant-default', source: 'manual', sourceRef: null, expiresAt: null, createdAt: 1, updatedAt: 1 },
  ]);
  return source.createQueryRunner();
}

describe('platform group ownership across native tenancy upgrades', () => {
  it('keeps the historical reserved group inventory explicit', () => {
    expect(LEGACY_PLATFORM_GROUP_IDS).toEqual(DEFAULT_PLATFORM_GROUPS.map(group => group.id));
  });

  it('preserves global platform memberships while backfilling ordinary tenant groups, including retries', async () => {
    const runner = await fixture();
    try {
      const migration = new BackfillNativeTenantOwnership1700000000125();
      await migration.up(runner);
      await migration.up(runner);
      expect((await source.getRepository(AuthzGroup).findOneByOrFail({ id: adminGroup })).tenantId).toBeNull();
      expect((await source.getRepository(AuthzGroupMembership).findOneByOrFail({ id: 'active' })).tenantId).toBeNull();
      expect((await source.getRepository(AuthzGroupMembership).findOneByOrFail({ id: 'tenant' })).tenantId).toBe('tenant-default');
      expect((await source.getRepository(AuthzGroupMembership).findOneByOrFail({ id: 'sibling' })).tenantId).toBe('tenant-other');
      expect(await getActivePlatformAdministratorUserIds(['admin', 'expired-admin', 'tenant-admin', 'sibling-admin', 'lookalike-admin'], source, 10)).toEqual(new Set(['admin']));
    } finally { await runner.release(); }
  });

  it('repairs an already-applied backfill without granting, renewing or recreating memberships', async () => {
    const runner = await fixture();
    try {
      await source.getRepository(AuthzGroup).update({ id: adminGroup }, { tenantId: 'tenant-default' });
      await source.getRepository(AuthzGroupMembership).update({ id: 'active' }, { tenantId: 'tenant-default' });
      await source.getRepository(AuthzGroupMembership).update({ id: 'expired' }, { tenantId: 'tenant-default' });
      const before = await source.getRepository(AuthzGroupMembership).find({ order: { id: 'ASC' } });
      expect(await getActivePlatformAdministratorUserIds(['admin'], source, 10)).toEqual(new Set());
      const repair = new RestorePlatformGroupOwnership1700000000135();
      await repair.up(runner);
      await repair.up(runner);
      await repair.down();
      const after = await source.getRepository(AuthzGroupMembership).find({ order: { id: 'ASC' } });
      expect(after).toEqual(before.map(row => ['active', 'expired'].includes(row.id) ? { ...row, tenantId: null } : row));
      expect(await getActivePlatformAdministratorUserIds(['admin', 'expired-admin', 'tenant-admin', 'sibling-admin', 'lookalike-admin'], source, 10)).toEqual(new Set(['admin']));
      await source.getRepository(AuthzGroupMembership).delete({ id: 'active' });
      await repair.up(runner);
      expect(await getActivePlatformAdministratorUserIds(['admin'], source, 10)).toEqual(new Set());
    } finally { await runner.release(); }
  });

  it('refuses to globalize a reserved ID without canonical system-group provenance', async () => {
    const runner = await fixture();
    try {
      await source.getRepository(AuthzGroup).update({ id: adminGroup }, { tenantId: 'tenant-default', source: 'manual' });
      await source.getRepository(AuthzGroupMembership).update({ id: 'active' }, { tenantId: 'tenant-default' });
      await new RestorePlatformGroupOwnership1700000000135().up(runner);
      expect((await source.getRepository(AuthzGroupMembership).findOneByOrFail({ id: 'active' })).tenantId).toBe('tenant-default');
    } finally { await runner.release(); }
  });

  it.each(['bootstrap-platform-administrator', 'legacy-platform-role-administrator'])('restores a system administrator created by %s', async (sourceRef) => {
    const runner = await fixture();
    try {
      await source.getRepository(AuthzGroup).update({ id: adminGroup }, { tenantId: 'tenant-default' });
      await source.getRepository(AuthzGroupMembership).update({ id: 'active' }, { tenantId: 'tenant-default', source: 'system', sourceRef });
      await new RestorePlatformGroupOwnership1700000000135().up(runner);
      expect(await getActivePlatformAdministratorUserIds(['admin'], source, 10)).toEqual(new Set(['admin']));
    } finally { await runner.release(); }
  });
});

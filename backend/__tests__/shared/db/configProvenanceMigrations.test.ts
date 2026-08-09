import { describe, expect, it, vi } from 'vitest';
import { AddConfigBundleApiVersion1700000000071 } from '@enterpriseglue/shared/db/migrations/1700000000071-add-config-bundle-api-version.js';
import { AddRuntimeResourceSetConfigProvenance1700000000072 } from '@enterpriseglue/shared/db/migrations/1700000000072-add-runtime-resource-set-config-provenance.js';
import { AddIdentityConfigProvenance1700000000073 } from '@enterpriseglue/shared/db/migrations/1700000000073-add-identity-config-provenance.js';
import { AddRuntimeResourceSetOwnershipMode1700000000088 } from '@enterpriseglue/shared/db/migrations/1700000000088-add-runtime-resource-set-ownership-mode.js';
import { AddIdentityMappingOwnershipMode1700000000104 } from '@enterpriseglue/shared/db/migrations/1700000000104-add-identity-mapping-ownership-mode.js';
import { AddPlatformGovernanceSettingsOwnership1700000000105 } from '@enterpriseglue/shared/db/migrations/1700000000105-add-platform-governance-settings-ownership.js';
import { AddLoginExperienceMetadata1700000000106 } from '@enterpriseglue/shared/db/migrations/1700000000106-add-login-experience-metadata.js';
import { ConsolidateLoginProviderPreference1700000000107 } from '@enterpriseglue/shared/db/migrations/1700000000107-consolidate-login-provider-preference.js';
import { TableColumn } from 'typeorm';

function runner(
  tables: string[],
  existingColumns: string[] = [],
  tablePaths: Record<string, string> = {},
  database = 'postgres',
) {
  const columns = new Map(existingColumns.map((key) => {
    const keyParts = key.split(':');
    const name = keyParts[keyParts.length - 1] || key;
    return [key, new TableColumn({ name, type: 'text' })];
  }));
  return {
    hasTable: vi.fn(async (table: string) => tables.includes(table)),
    hasColumn: vi.fn(async (table: string, column: string) => columns.has(`${table}:${column}`)),
    addColumn: vi.fn(async (table: string, column: TableColumn) => {
      columns.set(`${table}:${column.name}`, column.clone());
    }),
    changeColumn: vi.fn(async (table: string, _existing: TableColumn, column: TableColumn) => {
      columns.set(`${table}:${column.name}`, column.clone());
    }),
    getTable: vi.fn(async (table: string) => ({
      columns: [...columns.entries()]
        .filter(([key]) => key.startsWith(`${table}:`))
        .map(([, column]) => column.clone()),
      indices: [],
    })),
    dropColumn: vi.fn(async (table: string, column: string) => { columns.delete(`${table}:${column}`); }),
    createIndex: vi.fn(async () => undefined),
    dropIndex: vi.fn(async () => undefined),
    query: vi.fn<(sql: string) => Promise<unknown>>(async (_sql: string) => undefined),
    updateDDL: vi.fn(async () => undefined),
    connection: {
      options: { type: database },
      driver: {
        escape: (value: string) => `"${value}"`,
        createFullType: (column: TableColumn) => column.type,
      },
      getMetadata: (name: string) => {
        const tablePath = tablePaths[name];
        if (!tablePath) throw new Error(`Missing metadata for ${name}`);
        return { tablePath };
      },
    },
  };
}

describe('config provenance migrations', () => {
  it('adds the apply-run API version once', async () => {
    const queryRunner = runner(['config_bundle_apply_runs']);
    const migration = new AddConfigBundleApiVersion1700000000071();
    await migration.up(queryRunner as any);
    await migration.up(queryRunner as any);
    expect(queryRunner.addColumn).toHaveBeenCalledTimes(1);
    expect(queryRunner.addColumn).toHaveBeenCalledWith('config_bundle_apply_runs', expect.objectContaining({ name: 'bundle_api_version' }));
  });

  it('adds normalized provenance fields for runtime resources and identity configuration', async () => {
    const queryRunner = runner(['runtime_resource_sets', 'identity_providers', 'identity_entitlement_mappings']);
    await new AddRuntimeResourceSetConfigProvenance1700000000072().up(queryRunner as any);
    await new AddIdentityConfigProvenance1700000000073().up(queryRunner as any);
    expect(queryRunner.addColumn).toHaveBeenCalledTimes(9);
    expect(queryRunner.addColumn).toHaveBeenCalledWith('identity_providers', expect.objectContaining({ name: 'source_hash' }));
    expect(queryRunner.addColumn).toHaveBeenCalledWith('identity_entitlement_mappings', expect.objectContaining({ name: 'drift_status' }));
  });

  it('adds ownership mode once and backfills existing config-owned runtime resource sets', async () => {
    const queryRunner = runner(['main.runtime_resource_sets'], [], { RuntimeResourceSet: 'main.runtime_resource_sets' });
    const migration = new AddRuntimeResourceSetOwnershipMode1700000000088();
    await migration.up(queryRunner as any);
    await migration.up(queryRunner as any);
    expect(queryRunner.addColumn).toHaveBeenCalledTimes(1);
    expect(queryRunner.addColumn).toHaveBeenCalledWith('main.runtime_resource_sets', expect.objectContaining({ name: 'ownership_mode', default: "'manual'" }));
    expect(queryRunner.query).toHaveBeenCalledWith(expect.stringContaining("UPDATE main.runtime_resource_sets SET ownership_mode = 'config_locked'"));
  });

  it('preserves existing mapping locks while adding explicit mapping ownership', async () => {
    const queryRunner = runner(['main.identity_entitlement_mappings'], [], { IdentityEntitlementMapping: 'main.identity_entitlement_mappings' });
    await new AddIdentityMappingOwnershipMode1700000000104().up(queryRunner as any);
    await new AddIdentityMappingOwnershipMode1700000000104().up(queryRunner as any);
    expect(queryRunner.addColumn).toHaveBeenCalledTimes(1);
    expect(queryRunner.addColumn).toHaveBeenCalledWith('main.identity_entitlement_mappings', expect.objectContaining({ name: 'ownership_mode', isNullable: true }));
    expect(queryRunner.changeColumn).toHaveBeenCalledWith(
      'main.identity_entitlement_mappings',
      expect.objectContaining({ name: 'ownership_mode' }),
      expect.objectContaining({ name: 'ownership_mode', default: "'manual'", isNullable: false }),
    );
    expect(queryRunner.query).toHaveBeenCalledWith(expect.stringContaining("SET \"ownership_mode\" = 'config_locked'"));
  });

  it('adds portable governance ownership metadata and backfills required state', async () => {
    const queryRunner = runner(
      ['main.platform_settings'],
      [],
      { PlatformSettings: 'main.platform_settings' },
    );
    const migration = new AddPlatformGovernanceSettingsOwnership1700000000105();
    await migration.up(queryRunner as any);
    await migration.up(queryRunner as any);

    expect(queryRunner.addColumn).toHaveBeenCalledTimes(5);
    expect(queryRunner.addColumn).toHaveBeenCalledWith(
      'main.platform_settings',
      expect.objectContaining({ name: 'access_governance_ownership_mode', type: 'text', isNullable: true }),
    );
    expect(queryRunner.changeColumn).toHaveBeenCalledWith(
      'main.platform_settings',
      expect.objectContaining({ name: 'access_governance_ownership_mode' }),
      expect.objectContaining({ name: 'access_governance_ownership_mode', default: "'manual'", isNullable: false }),
    );
    expect(queryRunner.query).toHaveBeenCalledWith(
      'UPDATE "main"."platform_settings" SET "access_governance_ownership_mode" = \'manual\' WHERE "access_governance_ownership_mode" IS NULL',
    );
  });

  it('adds provider presentation and login-policy columns idempotently', async () => {
    const queryRunner = runner(
      ['main.identity_providers', 'main.platform_settings'],
      [],
      {
        IdentityProvider: 'main.identity_providers',
        PlatformSettings: 'main.platform_settings',
      },
    );
    const migration = new AddLoginExperienceMetadata1700000000106();
    await migration.up(queryRunner as any);
    await migration.up(queryRunner as any);

    expect(queryRunner.addColumn).toHaveBeenCalledTimes(7);
    expect(queryRunner.addColumn).toHaveBeenCalledWith(
      'main.identity_providers',
      expect.objectContaining({ name: 'display_name', isNullable: true, default: undefined }),
    );
    expect(queryRunner.addColumn).toHaveBeenCalledWith(
      'main.identity_providers',
      expect.objectContaining({ name: 'login_domains_json', isNullable: true, default: undefined }),
    );
    expect(queryRunner.changeColumn).toHaveBeenCalledWith(
      'main.platform_settings',
      expect.objectContaining({ name: 'local_password_login_mode' }),
      expect.objectContaining({
        name: 'local_password_login_mode',
        default: "'auto'",
        isNullable: false,
      }),
    );
    expect(queryRunner.changeColumn).toHaveBeenCalledWith(
      'main.platform_settings',
      expect.objectContaining({ name: 'sso_provider_selection_mode' }),
      expect.objectContaining({
        name: 'sso_provider_selection_mode',
        default: "'auto_redirect_single'",
        isNullable: false,
      }),
    );
    expect(queryRunner.query).toHaveBeenCalledWith(
      'UPDATE "main"."identity_providers" SET "display_name" = "key" WHERE "display_name" IS NULL',
    );
  });

  it('consolidates preferred-provider identity and removes the obsolete redirect flag', async () => {
    const queryRunner = runner(
      ['main.identity_providers', 'main.platform_settings'],
      ['main.platform_settings:sso_auto_redirect_single_provider'],
      { IdentityProvider: 'main.identity_providers', PlatformSettings: 'main.platform_settings' },
    );
    queryRunner.query.mockImplementation(async (sql: string) => sql.startsWith('SELECT')
      ? [
        { id: 'provider-a', tenant_id: 'tenant-a', is_preferred: true },
        { id: 'provider-b', tenant_id: 'tenant-a', is_preferred: true },
      ]
      : undefined);

    await new ConsolidateLoginProviderPreference1700000000107().up(queryRunner as any);

    expect(queryRunner.addColumn).toHaveBeenCalledWith(
      'main.identity_providers',
      expect.objectContaining({ name: 'preferred_scope_identity', isNullable: true }),
    );
    expect(queryRunner.query).toHaveBeenCalledWith(expect.stringContaining("'preferred:tenant-a'"));
    expect(queryRunner.query).toHaveBeenCalledWith(expect.stringContaining("'provider:provider-b'"));
    expect(queryRunner.createIndex).toHaveBeenCalledWith(
      'main.identity_providers',
      expect.objectContaining({ name: 'uq_identity_providers_preferred_scope_identity', isUnique: true }),
    );
    expect(queryRunner.dropColumn).toHaveBeenCalledWith('main.platform_settings', 'sso_auto_redirect_single_provider');
  });
});

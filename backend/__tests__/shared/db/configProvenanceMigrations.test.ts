import { describe, expect, it, vi } from 'vitest';
import { AddConfigBundleApiVersion1700000000071 } from '@enterpriseglue/shared/db/migrations/1700000000071-add-config-bundle-api-version.js';
import { AddRuntimeResourceSetConfigProvenance1700000000072 } from '@enterpriseglue/shared/db/migrations/1700000000072-add-runtime-resource-set-config-provenance.js';
import { AddIdentityConfigProvenance1700000000073 } from '@enterpriseglue/shared/db/migrations/1700000000073-add-identity-config-provenance.js';
import { AddRuntimeResourceSetOwnershipMode1700000000088 } from '@enterpriseglue/shared/db/migrations/1700000000088-add-runtime-resource-set-ownership-mode.js';

function runner(tables: string[], existingColumns: string[] = [], tablePaths: Record<string, string> = {}) {
  const columns = new Set(existingColumns);
  return {
    hasTable: vi.fn(async (table: string) => tables.includes(table)),
    hasColumn: vi.fn(async (table: string, column: string) => columns.has(`${table}:${column}`)),
    addColumn: vi.fn(async (table: string, column: { name: string }) => { columns.add(`${table}:${column.name}`); }),
    dropColumn: vi.fn(async (table: string, column: string) => { columns.delete(`${table}:${column}`); }),
    query: vi.fn(async () => undefined),
    connection: {
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
});

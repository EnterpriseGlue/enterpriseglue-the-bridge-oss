import { describe, expect, it, vi } from 'vitest';
import { AddManagedResourceKeyIdentities1700000000079 } from '@enterpriseglue/shared/db/migrations/1700000000079-add-managed-resource-key-identities.js';

describe('AddManagedResourceKeyIdentities1700000000079', () => {
  it('backfills and uniquely constrains Engine Set and runtime-resource-set keys', async () => {
    const table = { columns: [
      { name: 'engine_set_key_identity', type: 'text', isNullable: true },
      { name: 'runtime_resource_set_key_identity', type: 'text', isNullable: true },
    ], uniques: [], indices: [] };
    const query = vi.fn(async (sql: string, parameters?: unknown[]) => {
      if (sql.includes('FROM engine_sets')) return [{ id: 'platform-set', tenant_id: null, key: 'operators' }];
      if (sql.includes('FROM runtime_resource_sets')) return [{ id: 'tenant-set', tenant_id: 'tenant-a', key: 'payments' }];
      return parameters;
    });
    const queryRunner = {
      getTable: vi.fn().mockResolvedValue(table), hasColumn: vi.fn().mockResolvedValue(true),
      addColumn: vi.fn(), changeColumn: vi.fn(), createUniqueConstraint: vi.fn(), query,
      connection: {
        getMetadata: () => { throw new Error('metadata unavailable'); },
        driver: { createParameter: (_name: string, index: number) => `$${index + 1}` },
      },
    };

    await new AddManagedResourceKeyIdentities1700000000079().up(queryRunner as any);

    expect(query).toHaveBeenCalledWith('UPDATE engine_sets SET engine_set_key_identity = $1 WHERE id = $2', ['platform:operators', 'platform-set']);
    expect(query).toHaveBeenCalledWith('UPDATE runtime_resource_sets SET runtime_resource_set_key_identity = $1 WHERE id = $2', ['tenant-a:payments', 'tenant-set']);
    expect(queryRunner.changeColumn).toHaveBeenCalledWith('engine_sets', 'engine_set_key_identity', expect.objectContaining({ isNullable: false }));
    expect(queryRunner.changeColumn).toHaveBeenCalledWith('runtime_resource_sets', 'runtime_resource_set_key_identity', expect.objectContaining({ isNullable: false }));
    expect(queryRunner.createUniqueConstraint).toHaveBeenCalledWith('engine_sets', expect.objectContaining({ name: 'uq_engine_sets_key_identity' }));
    expect(queryRunner.createUniqueConstraint).toHaveBeenCalledWith('runtime_resource_sets', expect.objectContaining({ name: 'uq_runtime_resource_sets_key_identity' }));
  });
});

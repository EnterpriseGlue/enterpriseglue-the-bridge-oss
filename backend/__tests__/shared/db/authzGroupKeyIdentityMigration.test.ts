import { describe, expect, it, vi } from 'vitest';
import { AddAuthzGroupKeyIdentity1700000000078 } from '@enterpriseglue/shared/db/migrations/1700000000078-add-authz-group-key-identity.js';

describe('AddAuthzGroupKeyIdentity1700000000078', () => {
  it('backfills and uniquely constrains global and tenant authorization group keys', async () => {
    const columns = [{ name: 'group_key_identity', type: 'text', isNullable: true }];
    const table = { columns, uniques: [], indices: [] };
    const query = vi.fn(async (sql: string, parameters?: unknown[]) => {
      if (sql.startsWith('SELECT')) return [
        { id: 'global-group', tenant_id: null, key: 'operators', group_key_identity: null },
        { id: 'tenant-group', tenant_id: 'tenant-a', key: 'operators', group_key_identity: null },
      ];
      return parameters;
    });
    const queryRunner = {
      getTable: vi.fn().mockResolvedValue(table),
      hasColumn: vi.fn().mockResolvedValue(true),
      addColumn: vi.fn(), changeColumn: vi.fn(), createUniqueConstraint: vi.fn(), query,
      connection: {
        getMetadata: () => { throw new Error('metadata unavailable'); },
        driver: { createParameter: (_name: string, index: number) => `$${index + 1}` },
      },
    };

    await new AddAuthzGroupKeyIdentity1700000000078().up(queryRunner as any);

    expect(query).toHaveBeenCalledWith('UPDATE authz_groups SET group_key_identity = $1 WHERE id = $2', ['platform:operators', 'global-group']);
    expect(query).toHaveBeenCalledWith('UPDATE authz_groups SET group_key_identity = $1 WHERE id = $2', ['tenant-a:operators', 'tenant-group']);
    expect(queryRunner.changeColumn).toHaveBeenCalledWith('authz_groups', 'group_key_identity', expect.objectContaining({ isNullable: false }));
    expect(queryRunner.createUniqueConstraint).toHaveBeenCalledWith('authz_groups', expect.objectContaining({
      name: 'uq_authz_groups_key_identity', columnNames: ['group_key_identity'],
    }));
  });
});

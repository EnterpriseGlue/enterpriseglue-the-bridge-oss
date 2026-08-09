import { describe, expect, it, vi } from 'vitest';
import { AddIdentityMappingConfigKeyIdentity1700000000080 } from '@enterpriseglue/shared/db/migrations/1700000000080-add-identity-mapping-config-key-identity.js';

describe('AddIdentityMappingConfigKeyIdentity1700000000080', () => {
  it('backfills config mappings while leaving manual mappings unkeyed', async () => {
    const table = { columns: [{ name: 'config_key_identity', type: 'text', isNullable: true }], uniques: [], indices: [] };
    const query = vi.fn(async (sql: string, parameters?: unknown[]) => {
      if (sql.startsWith('SELECT')) return [
        { id: 'configured', tenant_id: 'tenant-a', config_key: 'mapping.operators', config_key_identity: null },
        { id: 'manual', tenant_id: null, config_key: null, config_key_identity: null },
      ];
      return parameters;
    });
    const queryRunner = {
      getTable: vi.fn().mockResolvedValue(table), hasColumn: vi.fn().mockResolvedValue(true),
      addColumn: vi.fn(), createUniqueConstraint: vi.fn(), query,
      connection: {
        getMetadata: () => { throw new Error('metadata unavailable'); },
        driver: { createParameter: (_name: string, index: number) => `$${index + 1}` },
      },
    };

    await new AddIdentityMappingConfigKeyIdentity1700000000080().up(queryRunner as any);

    expect(query).toHaveBeenCalledWith('UPDATE identity_entitlement_mappings SET config_key_identity = $1 WHERE id = $2', ['tenant-a:mapping.operators', 'configured']);
    expect(query).not.toHaveBeenCalledWith('UPDATE identity_entitlement_mappings SET config_key_identity = $1 WHERE id = $2', [null, 'manual']);
    expect(queryRunner.createUniqueConstraint).toHaveBeenCalledWith('identity_entitlement_mappings', expect.objectContaining({
      name: 'uq_identity_entitlement_mapping_config_key_identity', columnNames: ['config_key_identity'],
    }));
  });
});

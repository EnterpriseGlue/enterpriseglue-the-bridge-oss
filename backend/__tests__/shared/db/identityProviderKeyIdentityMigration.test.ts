import { describe, expect, it, vi } from 'vitest';
import { Table } from 'typeorm';
import { AddIdentityProviderKeyIdentity1700000000077 } from '@enterpriseglue/shared/db/migrations/1700000000077-add-identity-provider-key-identity.js';

describe('AddIdentityProviderKeyIdentity1700000000077', () => {
  it('backfills and uniquely constrains global and tenant provider keys', async () => {
    const table = new Table({ name: 'identity_providers', columns: [{ name: 'provider_key_identity', type: 'text', isNullable: true }] });
    const query = vi.fn(async (sql: string, parameters?: unknown[]) => {
      if (sql.startsWith('SELECT')) return [
        { id: 'global-provider', tenant_id: null, key: 'identity.main', provider_key_identity: null },
        { id: 'tenant-provider', tenant_id: 'tenant-a', key: 'identity.main', provider_key_identity: null },
      ];
      return parameters;
    });
    const queryRunner = {
      getTable: vi.fn().mockResolvedValue(table),
      hasColumn: vi.fn().mockResolvedValue(true),
      addColumn: vi.fn(), changeColumn: vi.fn(), createUniqueConstraint: vi.fn(), query,
      connection: {
        options: { type: 'postgres' },
        getMetadata: () => { throw new Error('metadata unavailable'); },
        driver: { escape: (name: string) => `"${name}"`, createParameter: (_name: string, index: number) => `$${index + 1}` },
      },
    };

    await new AddIdentityProviderKeyIdentity1700000000077().up(queryRunner as any);

    expect(query).toHaveBeenCalledWith('UPDATE "identity_providers" SET "provider_key_identity" = $1 WHERE "id" = $2', ['platform:identity.main', 'global-provider']);
    expect(query).toHaveBeenCalledWith('UPDATE "identity_providers" SET "provider_key_identity" = $1 WHERE "id" = $2', ['tenant-a:identity.main', 'tenant-provider']);
    expect(queryRunner.changeColumn).toHaveBeenCalledWith('identity_providers', expect.objectContaining({ name: 'provider_key_identity', isNullable: true }), expect.objectContaining({ name: 'provider_key_identity', type: 'text', isNullable: false }));
    expect(queryRunner.createUniqueConstraint).toHaveBeenCalledWith('identity_providers', expect.objectContaining({
      name: 'uq_identity_providers_key_identity', columnNames: ['provider_key_identity'],
    }));
  });
});

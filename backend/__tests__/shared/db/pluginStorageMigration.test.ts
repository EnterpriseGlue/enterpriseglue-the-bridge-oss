import { AddPluginStorage1700000000116 } from '@enterpriseglue/shared/db/migrations/1700000000116-add-plugin-storage.js';
import { describe, expect, it, vi } from 'vitest';

describe('AddPluginStorage1700000000116', () => {
  it('uses a bounded hash for portable storage identity uniqueness on MySQL', async () => {
    const createTable = vi.fn(async (_table: any) => undefined);
    const queryRunner = {
      connection: {
        options: { type: 'mysql' },
        getMetadata: vi.fn(() => ({ tablePath: 'plugin_storage_entries' })),
      },
      hasTable: vi.fn(async () => false),
      createTable,
    } as any;

    await new AddPluginStorage1700000000116().up(queryRunner);

    const table = createTable.mock.calls[0]?.[0];
    if (!table) throw new Error('plugin storage migration did not create a table');
    const identityColumn = table.columns.find(
      (column: { name: string }) => column.name === 'identity_hash',
    );
    const identityIndex = table.indices.find(
      (index: { name: string }) => index.name === 'idx_plugin_storage_identity',
    );
    expect(identityColumn).toMatchObject({
      type: 'varchar',
      length: '64',
      charset: 'ascii',
      collation: 'ascii_bin',
    });
    expect(identityIndex).toMatchObject({
      isUnique: true,
      columnNames: ['identity_hash'],
    });
  });
});

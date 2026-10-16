import { describe, expect, it, vi } from 'vitest';
import { DataSource, Table, TableColumn, TableIndex } from 'typeorm';
import { CleanupLegacyInvitationsSchema1700000000013 } from '@enterpriseglue/shared/db/migrations/1700000000013-cleanup-legacy-invitations-schema.js';
import { AddSsoNormalizedIdentities1700000000038 } from '@enterpriseglue/shared/db/migrations/1700000000038-add-sso-normalized-identities.js';

describe('legacy migration data preservation', () => {
  it('relaxes MySQL invitation aliases without replacing populated TEXT columns', async () => {
    const connection = new DataSource({ type: 'mysql', database: 'migration_test' });
    vi.spyOn(connection, 'getMetadata').mockReturnValue({ tablePath: 'invitations' } as any);
    const queryRunner = connection.createQueryRunner();
    const table = new Table({
      name: 'invitations',
      columns: ['token', 'tenant_id', 'role', 'invited_by_user_id'].map((name) =>
        new TableColumn({ name, type: 'text', isNullable: false })),
      indices: ['user', 'email', 'status', 'expires'].map((suffix) =>
        new TableIndex({ name: `idx_invitations_${suffix}`, columnNames: [suffix] })),
    });
    // Use the real driver in SQL-memory mode: changing TEXT to VARCHAR makes
    // TypeORM emit DROP/ADD, even when the caller only intended to relax NULL.
    const cache = queryRunner as unknown as { loadedTables: Table[] };
    cache.loadedTables = [table];
    queryRunner.enableSqlMemory();
    vi.spyOn(queryRunner, 'hasTable').mockResolvedValue(true);
    vi.spyOn(queryRunner, 'hasColumn').mockResolvedValue(true);
    vi.spyOn(queryRunner, 'getTable').mockImplementation(async () => cache.loadedTables[0]);
    vi.spyOn(queryRunner as any, 'getCachedTable').mockImplementation(async () => cache.loadedTables[0]);
    vi.spyOn(queryRunner, 'getCurrentDatabase').mockResolvedValue('migration_test');

    await new CleanupLegacyInvitationsSchema1700000000013().up(queryRunner);

    const statements = queryRunner.getMemorySql().upQueries.map(({ query }) => query);
    expect(statements).toHaveLength(4);
    expect(statements.join('\n')).not.toMatch(/DROP\s+COLUMN|ADD\s+(?:COLUMN\s+)?`/i);
    expect(statements.join('\n')).not.toContain('NOT NULL');
    for (const name of ['token', 'tenant_id', 'role', 'invited_by_user_id']) {
      expect(statements).toContainEqual(expect.stringContaining(`CHANGE \`${name}\` \`${name}\` text`));
    }
    for (const column of cache.loadedTables[0].columns) {
      expect(column).toMatchObject({ type: 'text', length: '' });
    }
  });

  it.each([
    ['postgres', 'text', ''],
    ['mysql', 'varchar', '4000'],
    ['mssql', 'nvarchar', '4000'],
    ['oracle', 'varchar2', '4000'],
    ['spanner', 'string', '4096'],
  ])('keeps SSO documents larger than an index key on %s', async (database, type, length) => {
    const createTable = vi.fn();
    await new AddSsoNormalizedIdentities1700000000038().up({
      connection: { options: { type: database }, getMetadata: () => { throw new Error('legacy table'); } },
      hasTable: vi.fn().mockResolvedValue(false),
      createTable,
    } as any);

    const table = createTable.mock.calls[0][0] as Table;
    const payload = JSON.stringify(Array.from({ length: 12 }, (_, index) => `group-${index}-${'x'.repeat(32)}`));
    expect(payload.length).toBeGreaterThan(191);
    for (const name of ['groups_json', 'roles_json', 'claims_json']) {
      const column = table.findColumnByName(name)!;
      expect(column).toMatchObject({ type, length });
      if (column.length) expect(Number(column.length)).toBeGreaterThan(payload.length);
    }
    // Index participants still use the established bounded-key convention.
    expect(table.findColumnByName('provider_subject')?.length).toBe(database === 'postgres' ? '' : '191');
  });
});

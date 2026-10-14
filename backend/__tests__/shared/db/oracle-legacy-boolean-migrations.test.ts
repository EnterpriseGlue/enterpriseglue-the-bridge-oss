import { describe, expect, it, vi } from 'vitest';
import { DataSource, TableColumn } from 'typeorm';
import { legacyBooleanColumn } from '@enterpriseglue/shared/db/migrations/support/portable-columns.js';
import { AddSsoAutoRedirectSingleProvider1700000000006 } from '@enterpriseglue/shared/db/migrations/1700000000006-add-sso-auto-redirect-single-provider.js';
import { AddSsoAllEnginesAssignmentSetting1700000000035 } from '@enterpriseglue/shared/db/migrations/1700000000035-add-sso-all-engines-assignment-setting.js';
import { AddSsoAutoRedirectSingleProvider1700000000006 as BridgedMigration } from '@enterpriseglue/shared/infrastructure/persistence/migrations/1700000000006-add-sso-auto-redirect-single-provider.js';

function runner(database = 'oracle') {
  const columns = new Map<string, TableColumn>();
  return {
    connection: { options: { type: database }, getMetadata: () => ({ tablePath: 'platform_settings' }) },
    hasTable: vi.fn(async () => true),
    hasColumn: vi.fn(async (_table: string, name: string) => columns.has(name)),
    addColumn: vi.fn(async (_table: string, column: TableColumn) => { columns.set(column.name, column); }),
    dropColumn: vi.fn(async (_table: string, name: string) => { columns.delete(name); }),
    columns,
  };
}

function oracleSql(column: TableColumn): string {
  const source = new DataSource({ type: 'oracle', username: 'fixture', password: 'fixture', connectString: 'fixture/XEPDB1' });
  // Use TypeORM's actual Oracle DDL compiler without opening a database connection.
  const compiler = source.createQueryRunner() as unknown as { buildCreateColumnSql(column: TableColumn): string };
  return compiler.buildCreateColumnSql(column);
}

describe('historical Oracle boolean migration SQL', () => {
  it('reproduces the reported invalid DDL and repairs the actual SSO migration with numeric false', async () => {
    expect(oracleSql(new TableColumn({ name: 'flag', type: 'boolean', default: false })))
      .toBe('"flag" boolean DEFAULT false NOT NULL');
    const queryRunner = runner();
    const migration = new AddSsoAutoRedirectSingleProvider1700000000006();
    await migration.up(queryRunner as any);
    const column = queryRunner.columns.get('sso_auto_redirect_single_provider')!;
    expect(oracleSql(column)).toBe('"sso_auto_redirect_single_provider" number(1,0) DEFAULT 0 NOT NULL');
    await migration.up(queryRunner as any);
    expect(queryRunner.addColumn).toHaveBeenCalledOnce();
    await migration.down(queryRunner as any);
    await migration.down(queryRunner as any);
    expect(queryRunner.dropColumn).toHaveBeenCalledOnce();
  });

  it('emits numeric true for the historical all-engines setting', async () => {
    const queryRunner = runner();
    await new AddSsoAllEnginesAssignmentSetting1700000000035().up(queryRunner as any);
    expect(oracleSql(queryRunner.columns.get('sso_all_engines_assignment_mappings_enabled')!))
      .toBe('"sso_all_engines_assignment_mappings_enabled" number(1,0) DEFAULT 1 NOT NULL');
  });

  it('keeps nullable legacy booleans nullable without adding a default', () => {
    const column = new TableColumn({ name: 'flag', ...legacyBooleanColumn(runner() as any), isNullable: true });
    expect(oracleSql(column)).toBe('"flag" number(1,0)');
  });

  it.each(['postgres', 'mysql', 'mssql', 'spanner'])('preserves the original %s migration definitions', database => {
    for (const value of [undefined, false, true]) {
      expect(legacyBooleanColumn(runner(database) as any, value))
        .toEqual(value === undefined ? { type: 'boolean' } : { type: 'boolean', default: value });
    }
  });

  it('keeps the legacy migration bridge on the canonical fixed constructor', () => {
    expect(BridgedMigration).toBe(AddSsoAutoRedirectSingleProvider1700000000006);
  });
});

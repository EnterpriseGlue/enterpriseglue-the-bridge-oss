import { describe, expect, it, vi } from 'vitest';
import { TableColumn } from 'typeorm';
import { AddTenantApplicationMarketplace1700000000128 } from '@enterpriseglue/shared/db/migrations/1700000000128-add-tenant-application-marketplace.js';

function runner(database: string) {
  const installationColumns = [new TableColumn({ name: 'id', type: 'text' })];
  const enablementColumns = [new TableColumn({ name: 'id', type: 'text' })];
  const createdTables: any[] = [];
  const tableFor = (name: string) => name.includes('installations')
    ? { columns: installationColumns, indices: [], findColumnByName: (column: string) => installationColumns.find((item) => item.name === column) }
    : { columns: enablementColumns, indices: [], findColumnByName: (column: string) => enablementColumns.find((item) => item.name === column) };
  const escape = (value: string) => database === 'mysql' ? `\`${value}\`` : `"${value}"`;
  return {
    connection: {
      options: { type: database },
      getMetadata: vi.fn((entity: string | { name?: string }) => {
        const entityName = typeof entity === 'string' ? entity : entity.name;
        return {
          tablePath: entityName === 'PluginInstallation'
            ? 'main.plugin_installations'
            : entityName === 'PluginTenantEnablement'
              ? 'main.plugin_tenant_enablements'
              : 'main.plugin_tenant_application_operations',
        };
      }),
      driver: {
        escape,
        createFullType: (column: TableColumn) => column.length
          ? `${column.type}(${column.length})`
          : column.type,
      },
    },
    getTable: vi.fn(async (name: string) => tableFor(name)),
    hasColumn: vi.fn(async (name: string, column: string) => Boolean(tableFor(name).findColumnByName(column))),
    addColumn: vi.fn(async (name: string, column: TableColumn) => {
      (name.includes('installations') ? installationColumns : enablementColumns).push(column.clone());
    }),
    changeColumn: vi.fn(async (name: string, oldColumn: TableColumn, column: TableColumn) => {
      const columns = name.includes('installations') ? installationColumns : enablementColumns;
      const index = columns.findIndex((item) => item.name === oldColumn.name);
      columns[index] = column.clone();
    }),
    updateDDL: vi.fn(async () => {
      const column = enablementColumns.find((item) => item.name === 'activation_request_state');
      if (column) column.isNullable = false;
    }),
    query: vi.fn(async () => undefined),
    hasTable: vi.fn(async (name: string) => !name.includes('application_operations')),
    createTable: vi.fn(async (table: any) => { createdTables.push(table); }),
    dropTable: vi.fn(async () => undefined),
    dropColumn: vi.fn(async () => undefined),
    dropIndex: vi.fn(async () => undefined),
    createIndex: vi.fn(async () => undefined),
    installationColumns,
    enablementColumns,
    createdTables,
  } as any;
}

describe('AddTenantApplicationMarketplace1700000000128', () => {
  it.each(['postgres', 'mysql', 'mssql', 'oracle', 'spanner'])(
    'adds portable marketplace state and an idempotency ledger on %s',
    async (database) => {
      const queryRunner = runner(database);
      await new AddTenantApplicationMarketplace1700000000128().up(queryRunner);

      expect(queryRunner.installationColumns.map((column: TableColumn) => column.name)).toEqual([
        'id',
        'tenant_configuration_path',
        'tenant_configuration_schema_sha256',
      ]);
      expect(queryRunner.enablementColumns.find(
        (column: TableColumn) => column.name === 'activation_request_state',
      )).toMatchObject({ isNullable: false });
      expect(queryRunner.createdTables).toHaveLength(1);
      expect(queryRunner.createdTables[0].indices).toEqual(expect.arrayContaining([
        expect.objectContaining({
          name: 'idx_plugin_tenant_app_op_idempotency',
          isUnique: true,
        }),
      ]));
      expect(queryRunner.query).toHaveBeenCalledWith(expect.stringContaining("= 'none'"));
    },
  );
});

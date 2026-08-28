import { describe, expect, it, vi } from 'vitest';
import { TableColumn } from 'typeorm';
import { AddTenantPluginEligibility1700000000129 } from '@enterpriseglue/shared/db/migrations/1700000000129-add-tenant-plugin-eligibility.js';

function runner(database: string) {
  const installationColumns = [new TableColumn({ name: 'id', type: 'text' })];
  const createdTables: any[] = [];
  const escape = (value: string) => database === 'mysql' ? `\`${value}\`` : `"${value}"`;
  return {
    connection: {
      options: { type: database },
      getMetadata: vi.fn((entity: { name?: string }) => ({
        tablePath: entity.name === 'PluginInstallation'
          ? 'main.plugin_installations'
          : 'main.plugin_tenant_eligibilities',
      })),
      driver: {
        escape,
        createFullType: (column: TableColumn) => column.length
          ? `${column.type}(${column.length})`
          : column.type,
      },
    },
    getTable: vi.fn(async () => ({
      columns: installationColumns,
      indices: [],
      findColumnByName: (column: string) =>
        installationColumns.find((item) => item.name === column),
    })),
    hasColumn: vi.fn(async (_name: string, column: string) =>
      Boolean(installationColumns.find((item) => item.name === column))),
    addColumn: vi.fn(async (_name: string, column: TableColumn) => {
      installationColumns.push(column.clone());
    }),
    changeColumn: vi.fn(async (_name: string, oldColumn: TableColumn, column: TableColumn) => {
      const index = installationColumns.findIndex((item) => item.name === oldColumn.name);
      installationColumns[index] = column.clone();
    }),
    updateDDL: vi.fn(async () => {
      const column = installationColumns.find((item) => item.name === 'entitlement_provider');
      if (column) column.isNullable = false;
    }),
    query: vi.fn(async () => undefined),
    hasTable: vi.fn(async (name: string) => !name.includes('eligibilities')),
    createTable: vi.fn(async (table: any) => { createdTables.push(table); }),
    dropTable: vi.fn(async () => undefined),
    dropColumn: vi.fn(async () => undefined),
    installationColumns,
    createdTables,
  } as any;
}

describe('AddTenantPluginEligibility1700000000129', () => {
  it.each(['postgres', 'mysql', 'mssql', 'oracle', 'spanner'])(
    'adds a portable safe eligibility projection on %s',
    async (database) => {
      const queryRunner = runner(database);
      await new AddTenantPluginEligibility1700000000129().up(queryRunner);

      expect(queryRunner.installationColumns.map((column: TableColumn) => column.name)).toEqual([
        'id',
        'entitlement_provider',
        'entitlement_feature',
      ]);
      expect(queryRunner.createdTables).toHaveLength(1);
      expect(queryRunner.createdTables[0].name).toBe('main.plugin_tenant_eligibilities');
      expect(queryRunner.createdTables[0].columns.map((column: { name: string }) => column.name))
        .not.toContain('signed_projection');
      expect(queryRunner.createdTables[0].indices).toEqual(expect.arrayContaining([
        expect.objectContaining({
          name: 'idx_plugin_tenant_eligibility_identity',
          isUnique: true,
        }),
      ]));
      expect(queryRunner.query).toHaveBeenCalledWith(expect.stringContaining("= 'none'"));
    },
  );
});
